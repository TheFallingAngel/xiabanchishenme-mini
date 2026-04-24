/**
 * L2 API 路由测试 —— /api/location/search
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIL-001..005 (5 条)
 *
 * 现行路由 (src/app/api/location/search/route.ts) 注意点:
 *   - 参数名是 `keyword`,不是 `q` (设计文档里写的是 q,这里锁现行接口)
 *   - 无 key 时返一条兜底 tip (keyword + '附近'),mock:true,状态 200
 *   - fetch 抛错 -> 200 + tips:[] + error:"API error"
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/location/search/route";
import { makeGet } from "../helpers/request";
import { amapInputTipsOk } from "../fixtures/amap";

const origEnv = { ...process.env };

describe("/api/location/search — L2 (TC-L2-APIL-001..005)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // ---- 001: 正常搜索 ----
  it("TC-L2-APIL-001: keyword=朝阳门 有 key -> 200 tips 含朝阳门, 过滤掉无坐标条", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => amapInputTipsOk,
    }) as unknown as typeof fetch;
    const res = await GET(makeGet("http://test/api/location/search?keyword=%E6%9C%9D%E9%98%B3%E9%97%A8"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(false);
    expect(Array.isArray(body.tips)).toBe(true);
    // 固定桩 3 条,过滤后剩 2 条
    expect(body.tips.length).toBe(2);
    expect(body.tips.every((t: { location: string }) => t.location.includes(","))).toBe(true);
  });

  // ---- 002: 空 keyword -> 400 ----
  it("TC-L2-APIL-002: 缺 keyword -> 400 'Missing keyword'", async () => {
    process.env.AMAP_API_KEY = "key";
    const res = await GET(makeGet("http://test/api/location/search"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/keyword/i);
  });

  // ---- 003: 无 key 降级 ----
  it("TC-L2-APIL-003: 无 AMAP_API_KEY -> 200 mock:true 一条 fallback tip", async () => {
    delete process.env.AMAP_API_KEY;
    const res = await GET(makeGet("http://test/api/location/search?keyword=foo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
    expect(body.tips.length).toBe(1);
    expect(body.tips[0].name).toContain("foo");
  });

  // ---- 004: fetch 抛错 -> 空 tips (降级, 非 504) ----
  it("TC-L2-APIL-004: fetch 抛错 -> 200 tips:[] + error 字段 (软降级,现行口径)", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const res = await GET(makeGet("http://test/api/location/search?keyword=foo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tips).toEqual([]);
    expect(body.error).toBeDefined();
  });

  // ---- 005: 特殊字符 keyword ----
  it("TC-L2-APIL-005: keyword='%%' (已 URL-encoded) -> URL encode OK 不崩", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "1", tips: [] }),
    }) as unknown as typeof fetch;
    // 浏览器会把 %% encode 成 %25%25
    const res = await GET(makeGet("http://test/api/location/search?keyword=%25%25"));
    expect(res.status).toBe(200);
  });
});
