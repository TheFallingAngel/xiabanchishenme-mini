/**
 * L2 API 路由测试 —— /api/llm/reason
 * 对应 TEST-CASES-v1.xlsx TC-L2-APILR-001..007 (7 条)
 *
 * 路由特点:
 *   - 调 generateLLMReason —— 测试里直接 mock 掉整条 minimax 模块
 *   - 模块级 Map cache,4h TTL
 *   - cache key = 餐厅 × 价位 × 历史桶 × 时段 × 预算状态 × 口味桶 × tasteSig × avoidSig × weatherSig × healthSig
 *   - generateLLMReason 返空 -> 200 reason:null (模板降级留给前端)
 *   - throw -> 200 reason:null + error:"LLM error" (软降级口径)
 *   - 缺 restaurantName/category -> 400
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { makePostJson, makePostRaw } from "../helpers/request";

// vi.mock 会被 hoist 到文件顶,工厂里的变量必须用 vi.hoisted 声明才能被 factory 引用
const { gen } = vi.hoisted(() => ({ gen: vi.fn() }));

vi.mock("@/lib/minimax", () => ({
  generateLLMReason: gen,
}));

import { POST } from "@/app/api/llm/reason/route";

const origEnv = { ...process.env };

/** 造一份"必填齐全"的 body,单个测试通过 override 改单字段。 */
function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    restaurantName: "湘村小馆",
    category: "湘菜",
    avgPrice: 60,
    walkMinutes: 5,
    rating: 4.5,
    matchScore: 0.8,
    weekday: "Mon",
    timeOfDay: "evening",
    weather: "小雨",
    daysSinceCategory: 3,
    tasteHit: true,
    tastePreferences: ["辣", "湘菜"],
    healthTags: [],
    priceTier: "mid",
    walkTier: "close",
    ratingTier: "high",
    budgetRemaining: 200,
    budgetStatus: "ok",
    avoidHooks: [],
    ...overrides,
  };
}

describe("/api/llm/reason — L2 (TC-L2-APILR-001..007)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.MINIMAX_API_KEY = "key";
    gen.mockReset();
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // ---- 001: happy path 非缓存 ----
  it("TC-L2-APILR-001: 首次请求 -> 200 reason + cached:false", async () => {
    gen.mockResolvedValue("下雨天来口辣的,地道湘菜。");
    const res = await POST(makePostJson("http://test/api/llm/reason", baseBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toContain("湘菜");
    expect(body.cached).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  // ---- 002: 同 body 再打一次 -> 命中缓存 ----
  it("TC-L2-APILR-002: 相同语境桶再请求 -> cached:true, 不再调 gen", async () => {
    gen.mockResolvedValue("第一遍生成的句子");
    const p = baseBody({ restaurantName: "测试店-缓存" });
    await POST(makePostJson("http://test/api/llm/reason", p));
    gen.mockClear();
    const res = await POST(makePostJson("http://test/api/llm/reason", p));
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.reason).toBe("第一遍生成的句子");
    expect(gen).not.toHaveBeenCalled();
  });

  // ---- 003: tastePreferences 改动 -> key 不同, 强制重生成 ----
  it("TC-L2-APILR-003: 改 tastePreferences -> 不命中缓存, 重新生成", async () => {
    gen.mockResolvedValueOnce("版本 A").mockResolvedValueOnce("版本 B");
    const name = "测试店-tasteSig";
    await POST(makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: name, tastePreferences: ["辣"] })));
    const res = await POST(
      makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: name, tastePreferences: ["甜"] }))
    );
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.reason).toBe("版本 B");
    expect(gen).toHaveBeenCalledTimes(2);
  });

  // ---- 004: 缺必填 -> 400 ----
  it("TC-L2-APILR-004: 缺 restaurantName -> 400", async () => {
    const res = await POST(makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: "" })));
    expect(res.status).toBe(400);
    expect(gen).not.toHaveBeenCalled();
  });

  // ---- 005: gen 返 null -> 200 reason:null (模板降级) ----
  it("TC-L2-APILR-005: LLM 返 null -> 200 reason:null, 不入 cache", async () => {
    gen.mockResolvedValue(null);
    const res = await POST(
      makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: "测试店-LLMnull" }))
    );
    const body = await res.json();
    expect(body.reason).toBeNull();
    // 再来一次应该还是会打 gen (null 不缓存)
    gen.mockClear();
    gen.mockResolvedValue(null);
    await POST(makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: "测试店-LLMnull" })));
    expect(gen).toHaveBeenCalledTimes(1);
  });

  // ---- 006: gen 抛错 -> 软降级 ----
  it("TC-L2-APILR-006: LLM 抛错 -> 200 reason:null + error:'LLM error'", async () => {
    gen.mockRejectedValue(new Error("network broke"));
    const res = await POST(
      makePostJson("http://test/api/llm/reason", baseBody({ restaurantName: "测试店-LLMthrow" }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBeNull();
    expect(body.error).toBe("LLM error");
  });

  // ---- 007: 非法 JSON body -> catch -> 200 error:'LLM error' (现实现把 json 解析也包进 catch) ----
  it("TC-L2-APILR-007: 非 JSON body -> 走总 catch, 200 reason:null + error", async () => {
    const res = await POST(makePostRaw("http://test/api/llm/reason", "{not-json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBeNull();
    expect(body.error).toBe("LLM error");
  });
});
