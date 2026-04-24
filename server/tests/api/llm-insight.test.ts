/**
 * L2 API 路由测试 —— /api/llm/insight
 * 对应 TEST-CASES-v1.xlsx TC-L2-APILI-001..007 (7 条)
 *
 * 路由双路径:
 *   - 非流式 (body.stream !== true):走 generateLLMInsight → JSON
 *   - 流式   (body.stream === true):走 streamLLMInsight → SSE
 *
 * 两路径共享同一条 in-memory cache (6h)。缓存命中也走 SSE,只发一条 done 事件。
 * finalizeInsight 用真实实现,用来校验流式路径最终会把 chunks 收敛到合法 insight。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { makePostJson } from "../helpers/request";
import { readSseEvents } from "../helpers/request";

const { gen, stream } = vi.hoisted(() => ({
  gen: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@/lib/minimax", async () => {
  // 保留 finalizeInsight 的真实实现 —— 测试依赖它做最终 gate 校验
  const actual = await vi.importActual<typeof import("@/lib/minimax")>("@/lib/minimax");
  return {
    ...actual,
    generateLLMInsight: gen,
    streamLLMInsight: stream,
  };
});

import { POST } from "@/app/api/llm/insight/route";

const origEnv = { ...process.env };

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    restaurantName: "湘村小馆",
    category: "湘菜",
    avgPrice: 60,
    walkMinutes: 5,
    rating: 4.5,
    matchScore: 0.8,
    timeOfDay: "evening",
    weather: "小雨",
    daysSinceCategory: 3,
    tasteHit: true,
    tastePreferences: ["辣"],
    healthTags: [],
    priceTier: "mid",
    walkTier: "close",
    ratingTier: "high",
    budgetRemaining: 200,
    budgetStatus: "ok",
    ...overrides,
  };
}

/** 一句足够长、能过 finalizeInsight gate 的句子 */
const GOOD_INSIGHT = "下雨天的小馆氛围温暖,招牌剁椒鱼头咸香够味,走路 5 分钟就到,性价比在这片算顶配了。";

describe("/api/llm/insight — L2 (TC-L2-APILI-001..007)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.MINIMAX_API_KEY = "key";
    gen.mockReset();
    stream.mockReset();
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // ---- 001: 非流式 happy ----
  it("TC-L2-APILI-001: stream=false -> 200 insight JSON + cached:false", async () => {
    gen.mockResolvedValue(GOOD_INSIGHT);
    const res = await POST(
      makePostJson("http://test/api/llm/insight", baseBody({ restaurantName: "insight-nostream-1" }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insight).toBe(GOOD_INSIGHT);
    expect(body.cached).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
  });

  // ---- 002: 非流式缓存命中 ----
  it("TC-L2-APILI-002: 同语境第二次非流式 -> cached:true, 不再调 gen", async () => {
    gen.mockResolvedValue(GOOD_INSIGHT);
    const p = baseBody({ restaurantName: "insight-cache-1" });
    await POST(makePostJson("http://test/api/llm/insight", p));
    gen.mockClear();
    const res = await POST(makePostJson("http://test/api/llm/insight", p));
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.insight).toBe(GOOD_INSIGHT);
    expect(gen).not.toHaveBeenCalled();
  });

  // ---- 003: 流式 happy ----
  it("TC-L2-APILI-003: stream=true -> SSE 多条 chunk + 一条 done", async () => {
    stream.mockImplementation(async (_ctx: unknown, onChunk: (t: string) => void) => {
      onChunk("下雨天的小馆氛围温暖,");
      onChunk("招牌剁椒鱼头咸香够味,走路 5 分钟就到,");
      onChunk("性价比在这片算顶配了。");
      return GOOD_INSIGHT;
    });
    const res = await POST(
      makePostJson("http://test/api/llm/insight", baseBody({ restaurantName: "insight-stream-1", stream: true }))
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await readSseEvents(res as unknown as Response)) as Array<{ type: string; text?: string; insight?: string; cached?: boolean }>;
    const chunks = events.filter((e) => e.type === "chunk");
    const dones = events.filter((e) => e.type === "done");
    expect(chunks.length).toBe(3);
    expect(dones.length).toBe(1);
    // finalizeInsight 可能会微调末尾标点 —— 这里用包含关系保证核心内容完整
    expect(dones[0].insight).toContain("下雨天的小馆氛围温暖");
    expect(dones[0].insight).toContain("性价比在这片算顶配");
    expect(dones[0].cached).toBe(false);
  });

  // ---- 004: 流式命中缓存 -> 一条 done 事件 ----
  it("TC-L2-APILI-004: stream=true 缓存命中 -> 仅一条 done cached:true", async () => {
    gen.mockResolvedValue(GOOD_INSIGHT);
    // 先用非流式预热缓存
    const p = baseBody({ restaurantName: "insight-cache-stream" });
    await POST(makePostJson("http://test/api/llm/insight", p));
    // 再用流式请求 —— 期望直接 done
    const res = await POST(makePostJson("http://test/api/llm/insight", { ...p, stream: true }));
    const events = (await readSseEvents(res as unknown as Response)) as Array<{ type: string; insight?: string; cached?: boolean }>;
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("done");
    expect(events[0].cached).toBe(true);
    expect(events[0].insight).toBe(GOOD_INSIGHT);
    // 流式没被调
    expect(stream).not.toHaveBeenCalled();
  });

  // ---- 005: 缺必填 -> 400 (非流式) ----
  it("TC-L2-APILI-005: 缺 restaurantName -> 400", async () => {
    const res = await POST(
      makePostJson("http://test/api/llm/insight", baseBody({ restaurantName: "" }))
    );
    expect(res.status).toBe(400);
  });

  // ---- 006: 非流式 gen 返 null -> 200 insight:null ----
  it("TC-L2-APILI-006: 非流式 gen 返 null -> 200 insight:null, 不入 cache", async () => {
    gen.mockResolvedValue(null);
    const res = await POST(
      makePostJson("http://test/api/llm/insight", baseBody({ restaurantName: "insight-null" }))
    );
    const body = await res.json();
    expect(body.insight).toBeNull();
    expect(body.cached).toBe(false);
  });

  // ---- 007: 流式 stream 返回空 -> finalize 返 null -> done.insight:null, 不 cache ----
  it("TC-L2-APILI-007: 流式 stream 返空字符串 -> done.insight:null", async () => {
    stream.mockImplementation(async () => "");
    const res = await POST(
      makePostJson("http://test/api/llm/insight", baseBody({ restaurantName: "insight-empty-stream", stream: true }))
    );
    const events = (await readSseEvents(res as unknown as Response)) as Array<{ type: string; insight?: string | null; cached?: boolean }>;
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.insight).toBeNull();
  });
});
