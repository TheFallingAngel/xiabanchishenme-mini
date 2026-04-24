import { NextRequest, NextResponse } from "next/server";

/**
 * 高德天气 API 代理 —— 给 LLM 推荐语喂"下雨/闷热/降温"这种描述钩子。
 *
 * 调用链:
 *   1. /v3/geocode/regeo?location=lng,lat → adcode (高德需要 6 位 adcode 查天气)
 *   2. /v3/weather/weatherInfo?city=<adcode>&extensions=base → 实时天气
 *
 * 缓存:按 (lng,lat) 两位小数 key 缓存 30 分钟,避免给每张卡都打一次外部调用。
 * 失败时返回 { weather: null },客户端需要能容错 — LLM prompt 里 weather 是可选。
 */

type WeatherLive = {
  desc: string; // 天气文字: "晴" / "小雨" / "多云"
  temp: string; // "18°C"
  note: string; // 合成后的友好提示: "下雨、凉" —— 真正喂给 LLM 的字段
};

const cache = new Map<string, { data: WeatherLive; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

function buildNote(desc: string, temp: number): string {
  const parts: string[] = [];
  if (/雨/.test(desc)) parts.push("下雨");
  else if (/雪/.test(desc)) parts.push("下雪");
  else if (/雾|霾/.test(desc)) parts.push("有雾霾");
  else if (/雷/.test(desc)) parts.push("雷阵雨");
  else if (/晴/.test(desc)) parts.push("晴天");
  else if (desc) parts.push(desc);

  if (Number.isFinite(temp)) {
    if (temp <= 5) parts.push("冷");
    else if (temp <= 12) parts.push("凉");
    else if (temp >= 32) parts.push("闷热");
    else if (temp >= 27) parts.push("热");
  }
  return parts.filter(Boolean).join("、");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lng = searchParams.get("lng");
  const lat = searchParams.get("lat");
  if (!lng || !lat) {
    return NextResponse.json(
      { weather: null, error: "missing lng/lat" },
      { status: 400 }
    );
  }

  const amapKey = process.env.AMAP_API_KEY;
  if (!amapKey) {
    // 没配 key 直接放空 —— LLM prompt 天气字段是可选的,不影响整体
    return NextResponse.json({ weather: null, reason: "no-amap-key" });
  }

  const cacheKey = `${Number(lng).toFixed(2)}_${Number(lat).toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ weather: cached.data, cached: true });
  }

  try {
    // 1. 逆地理:拿 adcode
    const regeoUrl = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${amapKey}`;
    const regeoRes = await fetch(regeoUrl, { next: { revalidate: 3600 } });
    if (!regeoRes.ok) {
      return NextResponse.json({ weather: null, reason: "regeo-http" });
    }
    const regeo = await regeoRes.json();
    const adcode: string | undefined =
      regeo?.regeocode?.addressComponent?.adcode ||
      regeo?.regeocode?.addressComponent?.citycode;
    if (!adcode) {
      return NextResponse.json({ weather: null, reason: "no-adcode" });
    }

    // 2. 实时天气
    const weatherUrl = `https://restapi.amap.com/v3/weather/weatherInfo?city=${adcode}&key=${amapKey}&extensions=base`;
    const wRes = await fetch(weatherUrl, { next: { revalidate: 1800 } });
    if (!wRes.ok) {
      return NextResponse.json({ weather: null, reason: "weather-http" });
    }
    const w = await wRes.json();
    const live = w?.lives?.[0];
    if (!live) {
      return NextResponse.json({ weather: null, reason: "no-live" });
    }

    const desc: string = live.weather || "";
    const tempRaw: string | number | undefined = live.temperature;
    const tempNum =
      typeof tempRaw === "number" ? tempRaw : Number(tempRaw || NaN);
    const data: WeatherLive = {
      desc,
      temp: Number.isFinite(tempNum) ? `${tempNum}°C` : "",
      note: buildNote(desc, tempNum),
    };

    if (data.note) {
      cache.set(cacheKey, { data, ts: Date.now() });
    }
    return NextResponse.json({ weather: data, cached: false });
  } catch (err) {
    console.error("[api/weather] Error:", err);
    return NextResponse.json({ weather: null, error: "fetch-error" });
  }
}
