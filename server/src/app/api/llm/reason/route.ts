import { NextRequest, NextResponse } from "next/server";
import { generateLLMReason } from "@/lib/minimax";

// Simple in-memory cache (survives across requests within the same serverless invocation)
// Cache key includes 用户语境信号,避免"今天已吃过川菜"和"5天没吃川菜"共享一条理由。
const cache = new Map<string, { reason: string; ts: number }>();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      restaurantName,
      category,
      avgPrice,
      walkMinutes,
      rating,
      matchScore,
      highlight,
      // 当下场景
      weekday,
      timeOfDay,
      weather,
      mood,
      // 用户历史
      daysSinceCategory,
      recentHistory,
      // 用户偏好 / 个性化
      tastePreferences,
      tasteHit,
      healthTags,
      socialHint,
      // 档位
      priceTier,
      walkTier,
      ratingTier,
      // 钱包
      budgetRemaining,
      budgetStatus,
      // 去重
      avoidHooks,
    } = body;

    if (!restaurantName || !category) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Cache key: 餐厅身份 × 用户语境桶(历史新鲜度 + 时段 + 预算紧张度 + 口味命中 + avoidHooks 指纹)
    // 同一家店,同一个语境桶,返回同一句话;语境/卡组一变,重算。
    const historyBucket =
      typeof daysSinceCategory === "number"
        ? daysSinceCategory === 0
          ? "just-ate"
          : daysSinceCategory <= 2
            ? "recent"
            : daysSinceCategory >= 5
              ? "long-gap"
              : "normal"
        : "none";
    const tasteBucket =
      tasteHit === true ? "taste-hit" : tasteHit === false ? "taste-miss" : "taste-none";
    const avoidSig =
      Array.isArray(avoidHooks) && avoidHooks.length > 0
        ? [...avoidHooks].sort().join(",")
        : "-";
    // 天气 / 健康标签进 key:下雨天的推荐语和晴天的推荐语应该不一样;
    // 也防止 "天气晚到" 的升级版被之前的裸版 cache 挡住。
    const weatherSig = weather ? String(weather).slice(0, 12) : "-";
    const healthSig =
      Array.isArray(healthTags) && healthTags.length
        ? healthTags.join(",").slice(0, 20)
        : "-";
    // 完整口味指纹 —— 仅 tasteBucket (hit/miss/none) 粒度太粗,
    // 用户改完口味 hit 状态不翻转时,旧句子会一直被 cache 命中不刷新。
    // 这里把 tastePreferences 排序 + join 作稳定签名,让口味任何变动都触发重生成。
    const tasteSig =
      Array.isArray(tastePreferences) && tastePreferences.length
        ? [...tastePreferences]
            .map((s) => String(s).trim())
            .filter(Boolean)
            .sort()
            .join(",")
            .slice(0, 60)
        : "-";
    const cacheKey = `${restaurantName}:${category}:${avgPrice}:${historyBucket}:${timeOfDay || "-"}:${budgetStatus || "-"}:${tasteBucket}:${tasteSig}:${avoidSig}:${weatherSig}:${healthSig}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json({ reason: cached.reason, cached: true });
    }

    const hasKey = !!process.env.MINIMAX_API_KEY;
    console.log(
      `[llm/reason] gen ${restaurantName} | cat=${category} | days=${daysSinceCategory ?? "?"} | time=${timeOfDay ?? "?"} | budget=${budgetStatus ?? "?"} | taste=${tasteBucket} | avoid=${avoidSig} | hasKey=${hasKey}`
    );

    const reason = await generateLLMReason({
      restaurantName,
      category,
      avgPrice: avgPrice || 0,
      walkMinutes: walkMinutes || 0,
      rating: rating || 0,
      matchScore: matchScore || 0,
      highlight,
      weekday,
      timeOfDay,
      weather,
      mood,
      daysSinceCategory,
      recentHistory,
      tastePreferences,
      tasteHit,
      healthTags,
      socialHint,
      priceTier,
      walkTier,
      ratingTier,
      budgetRemaining,
      budgetStatus,
      avoidHooks,
    });

    console.log(
      `[llm/reason] ${restaurantName} → ${reason ? `"${reason}"` : "null (fallback)"}`
    );

    if (reason) {
      cache.set(cacheKey, { reason, ts: Date.now() });
      return NextResponse.json({ reason, cached: false });
    }

    // LLM failed — return null, client will use template fallback
    return NextResponse.json({ reason: null, cached: false });
  } catch (err) {
    console.error("[llm/reason] Error:", err);
    return NextResponse.json({ reason: null, error: "LLM error" });
  }
}
