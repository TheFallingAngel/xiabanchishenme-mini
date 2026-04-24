import type { PhotoTag } from "./image-tag";

/** Mock food images from Unsplash CDN — keyed by cuisine/dish type */
export const FOOD_IMAGES: Record<string, string> = {
  congee: "https://images.unsplash.com/photo-1555126634-323283e090fa?w=400&h=300&fit=crop",
  dimsum: "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=400&h=300&fit=crop",
  hotpot: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&h=300&fit=crop",
  ramen: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&h=300&fit=crop",
  roastDuck: "https://images.unsplash.com/photo-1518492104633-130d0cc84637?w=400&h=300&fit=crop",
  sichuan: "https://images.unsplash.com/photo-1525755662778-989d0524087e?w=400&h=300&fit=crop",
  noodles: "https://images.unsplash.com/photo-1552611052-33e04de1b100?w=400&h=300&fit=crop",
  friedRice: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400&h=300&fit=crop",
  dumplings: "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400&h=300&fit=crop",
  bbq: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=400&h=300&fit=crop",
};

/** Map restaurant category keywords to a fallback image key */
export function getImageForCategory(category: string): string {
  if (category.includes("川菜") || category.includes("湘菜")) return FOOD_IMAGES.sichuan;
  if (category.includes("火锅")) return FOOD_IMAGES.hotpot;
  if (category.includes("日料") || category.includes("拉面")) return FOOD_IMAGES.ramen;
  if (category.includes("烧烤") || category.includes("烤")) return FOOD_IMAGES.bbq;
  if (category.includes("粤菜")) return FOOD_IMAGES.dimsum;
  if (category.includes("面")) return FOOD_IMAGES.noodles;
  if (category.includes("快餐")) return FOOD_IMAGES.friedRice;
  if (category.includes("小吃")) return FOOD_IMAGES.dumplings;
  return FOOD_IMAGES.congee;
}

/**
 * AI 打标后的 tag 展示优先级:
 * - hero 位: storefront > interior > logo > dish > other > menu
 *   (menu 是文字图,放 hero 最怪,垫最后)
 * - dish 网格: dish > interior > other (不要 storefront/menu/logo)
 *
 * 没 tag 时退回 "photos[0]/photos[1+]" 这套旧逻辑。
 */
type TagsMap = Record<string, PhotoTag | undefined> | undefined;

const HERO_PREF: PhotoTag[] = ["storefront", "interior", "logo", "dish", "other", "menu"];
const DISH_PREF: PhotoTag[] = ["dish", "interior", "other"];

function pickByTagPriority(
  photos: string[],
  tags: TagsMap,
  priority: PhotoTag[]
): string | undefined {
  if (!tags) return undefined;
  for (const want of priority) {
    const hit = photos.find((u) => tags[u] === want);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Get the best available image for a restaurant.
 *
 * 如果提供了 AI 打标 (tags),按 HERO_PREF 顺序挑第一张命中的;
 * 否则退回高德 photos 的默认顺序 ([0] 一般是门脸/环境)。
 *
 * @param photos - Amap photo URLs
 * @param category - Restaurant category for fallback
 * @param type - "hero" for storefront/environment, "dish" for food
 * @param tags - optional url→PhotoTag map from /api/images/tag
 */
export function getRestaurantImage(
  photos: string[] | undefined,
  category: string,
  type: "hero" | "dish" = "hero",
  tags?: TagsMap
): string {
  if (!photos || photos.length === 0) return getImageForCategory(category);

  if (type === "hero") {
    const byTag = pickByTagPriority(photos, tags, HERO_PREF);
    return byTag || photos[0] || getImageForCategory(category);
  }
  // dish
  const byTag = pickByTagPriority(photos, tags, DISH_PREF);
  return byTag || photos[1] || photos[0] || getImageForCategory(category);
}

/**
 * Get all dish photos for a restaurant.
 *
 * **#79 收紧**: 用户反馈店内实景漏进招牌菜网格,所以这里不再把 interior/other
 * 当作 dish 的兜底。有 VLM 打标时严格只返回 `tag==="dish"` 的图;
 * 无 tag 时才退回 `photos.slice(1)` 的粗兜底。也不再用 FOOD_IMAGES stock
 * 图填充 —— 那是 Unsplash 泛用图,用户一眼能看出"这不是这家店的菜"。
 *
 * 返回空数组是合理的 —— 上层(招牌菜渲染)据此跳过没照片的菜名。
 */
export function getDishPhotos(
  photos: string[] | undefined,
  category: string,
  max = 6,
  tags?: TagsMap
): string[] {
  if (!photos || photos.length === 0) return [];

  let dishPhotos: string[];
  if (tags && Object.keys(tags).length > 0) {
    // 严格 dish: 其他标签(interior/storefront/menu/logo/other)一律不进招牌菜格子
    // 老逻辑会掺 interior 图,导致用户在招牌菜里看到店内实景
    dishPhotos = photos.filter((u) => tags[u] === "dish");
  } else {
    // 未打标时仍用粗兜底 —— photos[0] 通常是门脸,招牌菜位从 [1] 开始
    dishPhotos = photos.slice(1).filter(Boolean);
  }

  return dishPhotos.slice(0, max);
}

/**
 * 从打标后的 photos 里挑出店内实景 (interior) 子集,配合"店内实景" 网格用。
 * 无 tag 时返回原数组 (沿用旧行为)。
 *
 * 关键阈值:**严格 interior/storefront 命中 <2 张时回退**到"去掉 menu/logo 的全集"
 * 因为上层 JSX 用 `length > 1` 作为显示门槛,命中 0/1 时过滤完就会让整块消失;
 * 用户反馈"店内实景几秒后消失"就是 VLM 打完标后只剩 1 张 storefront 导致的。
 */
export function getInteriorPhotos(
  photos: string[] | undefined,
  tags?: TagsMap
): string[] {
  if (!photos) return [];
  if (!tags) return photos;
  const strict = photos.filter((u) => {
    const t = tags[u];
    return t === "interior" || t === "storefront";
  });
  // 严格命中足够(≥2)—— 直接用 tag 过滤后的高质量子集
  if (strict.length >= 2) return strict;
  // 严格太少 —— 加进 "other" (VLM 不确定的环境图),再试一次
  const withOther = photos.filter((u) => {
    const t = tags[u];
    return t === "interior" || t === "storefront" || t === "other";
  });
  if (withOther.length >= 2) return withOther;
  // 仍然不够 —— 回到原集,但把放 grid 里最违和的 menu/logo 剔掉;
  // 剩下 <2 张就整张都返回(反正上层 length>1 会自己隐藏)
  const nonUgly = photos.filter((u) => {
    const t = tags[u];
    return t !== "menu" && t !== "logo";
  });
  return nonUgly.length >= 2 ? nonUgly : photos;
}

/** Discovery section images for the dice idle page */
export const DISCOVERY_IMAGES = [
  { src: FOOD_IMAGES.hotpot, label: "热辣火锅" },
  { src: FOOD_IMAGES.dimsum, label: "精致点心" },
];
