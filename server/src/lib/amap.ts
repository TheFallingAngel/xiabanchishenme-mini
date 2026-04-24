import type { Restaurant } from "./types";

const AMAP_BASE = "https://restapi.amap.com/v3";

interface AmapPOI {
  id: string;
  name: string;
  type: string;
  address: string;
  biz_ext?: { cost?: string; rating?: string };
  tel?: string;
  photos?: { url: string }[];
  location: string; // "lng,lat"
  distance?: string;
  /** 高德返回的标签串,like "蛋挞,叉烧,柠檬茶" —— 给口味匹配用的额外信号 */
  tag?: string;
}

/** Search nearby restaurants via Amap POI */
export async function searchRestaurants(
  lng: number,
  lat: number,
  keyword?: string,
  radius = 2000,
  apiKey?: string
): Promise<Restaurant[]> {
  const key = apiKey || process.env.AMAP_API_KEY;
  if (!key) throw new Error("AMAP_API_KEY not configured");

  const params = new URLSearchParams({
    key,
    location: `${lng},${lat}`,
    // 050100=中餐厅 050200=外国餐厅 050300=快餐厅，排除 050400 休闲餐饮（咖啡/茶艺/酒吧）和 050500 食品饮料店
    types: "050100|050200|050300",
    radius: String(radius),
    sortrule: "distance",
    offset: "50",
    extensions: "all",
  });
  if (keyword) params.set("keywords", keyword);

  const url = `${AMAP_BASE}/place/around?${params}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "1" || !data.pois) return [];

  return data.pois.map((poi: AmapPOI) => {
    const [pLng, pLat] = poi.location.split(",").map(Number);
    return {
      id: poi.id,
      name: poi.name,
      // category 仍取第一段供 UI 显示 "粤菜"/"快餐厅" 这种简洁标签
      category: poi.type?.split(";")[0] || "餐饮",
      address: poi.address || "",
      avgPrice: Number(poi.biz_ext?.cost) || 0,
      rating: Number(poi.biz_ext?.rating) || 0,
      walkMinutes: 0, // Will be filled by walking route
      distanceMeters: Number(poi.distance) || 0,
      tel: poi.tel,
      photos: poi.photos?.map((p) => p.url),
      location: { lng: pLng, lat: pLat },
      // 保留完整 type (多段,信息更密) + tag 给口味匹配 haystack 用
      poiType: typeof poi.type === "string" ? poi.type : undefined,
      poiTag: typeof poi.tag === "string" ? poi.tag : undefined,
    } as Restaurant;
  });
}

/** Get walking duration in minutes */
export async function getWalkingTime(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  apiKey?: string
): Promise<number> {
  const key = apiKey || process.env.AMAP_API_KEY;
  if (!key) return Math.round((Math.sqrt((fromLng - toLng) ** 2 + (fromLat - toLat) ** 2) * 111000) / 80);

  const params = new URLSearchParams({
    key,
    origin: `${fromLng},${fromLat}`,
    destination: `${toLng},${toLat}`,
  });

  try {
    const res = await fetch(`${AMAP_BASE}/direction/walking?${params}`);
    const data = await res.json();
    if (data.status === "1" && data.route?.paths?.[0]) {
      return Math.round(Number(data.route.paths[0].duration) / 60);
    }
  } catch {
    // Fallback: estimate from distance
  }
  return Math.round((Math.sqrt((fromLng - toLng) ** 2 + (fromLat - toLat) ** 2) * 111000) / 80);
}

/** Get single POI detail by id — returns raw fields we care about */
export interface AmapPoiDetail {
  id: string;
  name: string;
  type: string;
  address: string;
  tel: string;
  avgPrice: number;
  rating: number;
  photos: { url: string; title?: string }[];
  openTime: string;
  alias: string;
  location: { lng: number; lat: number };
  /** Raw `deep_info` block from Amap, when present — holds menu/tag snippets */
  tags?: string[];
  /** recommendation / featured items, if 高德 happens to return anything */
  recommend?: string;
}

export async function getPoiDetail(
  id: string,
  apiKey?: string
): Promise<AmapPoiDetail | null> {
  const key = apiKey || process.env.AMAP_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    key,
    id,
    extensions: "all",
  });

  try {
    const res = await fetch(`${AMAP_BASE}/place/detail?${params}`, {
      // 高德 POI 详情每次查询会扣一次额度,做一层 CDN 缓存
      next: { revalidate: 60 * 60 * 24 },
    });
    const data = await res.json();
    if (data.status !== "1" || !data.pois?.[0]) return null;

    const poi = data.pois[0];
    const [pLng, pLat] = (poi.location || "0,0").split(",").map(Number);
    const photos = Array.isArray(poi.photos)
      ? poi.photos
          .filter((p: { url?: string }) => !!p?.url)
          .map((p: { url: string; title?: string }) => ({
            url: p.url,
            title: p.title,
          }))
      : [];

    const tags: string[] = [];
    if (poi.tag) tags.push(...String(poi.tag).split(";").filter(Boolean));
    if (poi.biz_ext?.meal_ordering === "1") tags.push("在线点餐");
    if (poi.biz_ext?.seat_ordering === "1") tags.push("在线订位");

    return {
      id: poi.id,
      name: poi.name,
      type: poi.type || "",
      address: poi.address || "",
      tel: typeof poi.tel === "string" ? poi.tel : "",
      avgPrice: Number(poi.biz_ext?.cost) || 0,
      rating: Number(poi.biz_ext?.rating) || 0,
      photos,
      openTime:
        poi.biz_ext?.open_time_week ||
        poi.biz_ext?.open_time ||
        "",
      alias: poi.alias || "",
      location: { lng: pLng, lat: pLat },
      tags: tags.length ? tags : undefined,
      recommend: poi.biz_ext?.recommend || undefined,
    };
  } catch (err) {
    console.error("[amap] getPoiDetail failed:", err);
    return null;
  }
}

/** Batch fill walking times for restaurants */
export async function fillWalkingTimes(
  restaurants: Restaurant[],
  fromLng: number,
  fromLat: number,
  apiKey?: string
): Promise<Restaurant[]> {
  // To avoid too many API calls, only calculate for top 20
  const top = restaurants.slice(0, 20);
  const results = await Promise.all(
    top.map(async (r) => {
      const mins = await getWalkingTime(fromLng, fromLat, r.location.lng, r.location.lat, apiKey);
      return { ...r, walkMinutes: mins };
    })
  );
  return results;
}
