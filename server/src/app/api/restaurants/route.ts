import { NextRequest, NextResponse } from "next/server";
import { searchRestaurants, fillWalkingTimes } from "@/lib/amap";
import { MOCK_RESTAURANTS } from "@/lib/mock-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lng = Number(searchParams.get("lng"));
  const lat = Number(searchParams.get("lat"));
  const keyword = searchParams.get("keyword") || undefined;
  // 召回半径 —— 前端根据 maxWalkMinutes 计算好传过来,这里 clamp 做兜底
  // 5km 上限:用户反馈 3km 范围太紧,选择面不够;5km 对应 60min 步行上限
  const rawRadius = Number(searchParams.get("radius")) || 2000;
  const radius = Math.min(5000, Math.max(500, rawRadius));
  // 硬过滤阈值 —— 步行分钟,前端传过来;>0 时才过滤
  const maxWalkMinutes = Number(searchParams.get("maxWalkMinutes")) || 0;

  if (!lng || !lat) {
    return NextResponse.json({ error: "Missing lng/lat" }, { status: 400 });
  }

  function applyWalkFilter<T extends { walkMinutes: number; distanceMeters: number }>(
    list: T[]
  ): T[] {
    if (maxWalkMinutes <= 0) return list;
    return list.filter((r) => {
      // walkMinutes 还没填的情况下用距离兜底 (80 m/min)
      const w = r.walkMinutes > 0 ? r.walkMinutes : Math.ceil(r.distanceMeters / 80);
      return w <= maxWalkMinutes;
    });
  }

  try {
    const apiKey = process.env.AMAP_API_KEY;
    if (!apiKey) {
      // Dev / 无 key 时走 mock,mock 也要按步行时间过滤,保持行为一致
      console.log("[restaurants] No AMAP_API_KEY, returning mock data");
      return NextResponse.json({
        restaurants: applyWalkFilter(MOCK_RESTAURANTS),
        mock: true,
      });
    }

    let restaurants = await searchRestaurants(lng, lat, keyword, radius, apiKey);
    if (restaurants.length === 0) {
      return NextResponse.json({ restaurants: [], mock: false });
    }

    // Fill walking times
    restaurants = await fillWalkingTimes(restaurants, lng, lat, apiKey);
    // 根据用户设置硬过滤超过步行分钟上限的店
    restaurants = applyWalkFilter(restaurants);

    return NextResponse.json({ restaurants, mock: false });
  } catch (err: unknown) {
    console.error("[restaurants] Error:", err);
    // Fallback to mock (同样按步行过滤)
    return NextResponse.json({
      restaurants: applyWalkFilter(MOCK_RESTAURANTS),
      mock: true,
      error: "API error, using mock",
    });
  }
}
