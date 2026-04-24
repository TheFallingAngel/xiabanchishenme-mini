import { NextRequest, NextResponse } from "next/server";
import {
  generateLLMInsight,
  streamLLMInsight,
  finalizeInsight,
  type ReasonContext,
} from "@/lib/minimax";

// 详情页 insight 缓存:餐厅 × 语境桶。TTL 长一点 (6h),因为详情页是停留页,
// 用户会前后翻看,别让每次进都重新生成。
const cache = new Map<string, { insight: string; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000;

/**
 * 根据 body 构造 cache key + ctx。
 * 老版本 (非流式) 和流式共用同一套 key,这样预热 (非流式 POST) 和后续详情页的
 * 流式请求会命中同一条缓存。
 */
function buildKeyAndCtx(body: Record<string, unknown>): {
  key: string;
  ctx: ReasonContext;
  bad?: string;
} {
  const restaurantName = body.restaurantName as string | undefined;
  const category = body.category as string | undefined;
  if (!restaurantName || !category) {
    return { key: "", ctx: {} as ReasonContext, bad: "Missing required fields" };
  }

  const {
    avgPrice,
    walkMinutes,
    rating,
    matchScore,
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
  } = body as Record<string, unknown>;

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
  const highlightSig = highlight ? String(highlight).slice(0, 20) : "-";
  const weatherSig = weather ? String(weather).slice(0, 12) : "-";
  const healthSig =
    Array.isArray(healthTags) && healthTags.length
      ? healthTags.join(",").slice(0, 20)
      : "-";
  const tasteSig =
    Array.isArray(tastePreferences) && tastePreferences.length
      ? [...(tastePreferences as unknown[])]
          .map((s) => String(s).trim())
          .filter(Boolean)
          .sort()
          .join(",")
          .slice(0, 60)
      : "-";

  const key = `${restaurantName}:${category}:${historyBucket}:${timeOfDay || "-"}:${budgetStatus || "-"}:${tasteBucket}:${tasteSig}:${highlightSig}:${weatherSig}:${healthSig}`;

  const ctx: ReasonContext = {
    restaurantName,
    category,
    avgPrice: Number(avgPrice) || 0,
    walkMinutes: Number(walkMinutes) || 0,
    rating: typeof rating === "number" ? rating : 0,
    matchScore: typeof matchScore === "number" ? matchScore : 0,
    highlight: highlight as string | undefined,
    weekday: weekday as string | undefined,
    timeOfDay: timeOfDay as string | undefined,
    weather: weather as string | undefined,
    mood: mood as string | undefined,
    daysSinceCategory: typeof daysSinceCategory === "number" ? daysSinceCategory : undefined,
    recentHistory: Array.isArray(recentHistory) ? (recentHistory as string[]) : undefined,
    tastePreferences: Array.isArray(tastePreferences)
      ? (tastePreferences as string[])
      : undefined,
    tasteHit: typeof tasteHit === "boolean" ? tasteHit : undefined,
    healthTags: Array.isArray(healthTags) ? (healthTags as string[]) : undefined,
    socialHint: socialHint as string | undefined,
    priceTier: priceTier as ReasonContext["priceTier"],
    walkTier: walkTier as ReasonContext["walkTier"],
    ratingTier: ratingTier as ReasonContext["ratingTier"],
    budgetRemaining:
      typeof budgetRemaining === "number" ? (budgetRemaining as number) : undefined,
    budgetStatus: budgetStatus as ReasonContext["budgetStatus"],
  };

  return { key, ctx };
}

/** 生成一个 SSE 事件字符串。 */
function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const wantsStream = body?.stream === true;

    const { key: cacheKey, ctx, bad } = buildKeyAndCtx(body);
    if (bad) {
      return NextResponse.json({ error: bad }, { status: 400 });
    }

    const cached = cache.get(cacheKey);
    const cacheHit = cached && Date.now() - cached.ts < CACHE_TTL;

    // —— 非流式路径 (保持向后兼容:首页预热 / 老客户端) ——
    if (!wantsStream) {
      if (cacheHit) {
        return NextResponse.json({ insight: cached!.insight, cached: true });
      }
      console.log(
        `[llm/insight] gen ${ctx.restaurantName} | days=${ctx.daysSinceCategory ?? "?"} | time=${ctx.timeOfDay ?? "?"}`
      );
      const insight = await generateLLMInsight(ctx);
      console.log(
        `[llm/insight] ${ctx.restaurantName} → ${insight ? `"${insight.slice(0, 40)}..."` : "null"}`
      );
      if (insight) {
        cache.set(cacheKey, { insight, ts: Date.now() });
        return NextResponse.json({ insight, cached: false });
      }
      return NextResponse.json({ insight: null, cached: false });
    }

    // —— 流式路径 (详情页观感提速) ——
    // 缓存命中也走 SSE,只发一条 done 事件 —— 让客户端统一走 SSE 分支,少一个 if
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueue = (obj: unknown) => controller.enqueue(encoder.encode(sseEvent(obj)));

        if (cacheHit) {
          enqueue({ type: "done", insight: cached!.insight, cached: true });
          controller.close();
          return;
        }

        console.log(
          `[llm/insight] stream-gen ${ctx.restaurantName} | days=${ctx.daysSinceCategory ?? "?"} | time=${ctx.timeOfDay ?? "?"}`
        );

        // onChunk 回调:服务器端已剥 <think>,收到的都是非思考段的增量文本
        const raw = await streamLLMInsight(ctx, (text) => {
          enqueue({ type: "chunk", text });
        });

        // 对 raw 做最终校验 + 截断,保证和非流式路径规则一致 (passesInsightGate/120 char)
        const finalized = finalizeInsight(raw);
        console.log(
          `[llm/insight] stream ${ctx.restaurantName} → ${finalized ? `"${finalized.slice(0, 40)}..."` : "null"}`
        );

        if (finalized) {
          cache.set(cacheKey, { insight: finalized, ts: Date.now() });
        }
        enqueue({ type: "done", insight: finalized, cached: false });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Nginx / Vercel Edge 前面如果有 buffering,加这个避免堆积
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[llm/insight] Error:", err);
    return NextResponse.json({ insight: null, error: "LLM error" });
  }
}
