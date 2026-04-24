/**
 * L2 API 路由测试 —— /api/restaurants
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIR-001..007 (7 条)
 *
 * 路由依赖:
 *   - searchRestaurants (amap.ts) → fetch /v3/place/around
 *   - fillWalkingTimes  (amap.ts) → fetch /v3/direction/walking 每条一次 (最多 20)
 *   - 无 AMAP_API_KEY 时走 MOCK_RESTAURANTS 降级路径 (200 + mock:true)
 *   - catch 分支:AMAP 调用整体抛错 → 也走 MOCK 降级 (200 + mock:true + error)
 *
 * 注:TEST-CASES 设计里 003 期望 "503 降级 mock 或 明确提示",
 *     现行实现走 200 + mock:true,用 mock:true 作为"明确提示"判据。
 *     004 期望 "502 upstream",现行实现不抛 502,走 mock 降级 —— 记为 M6 候选偏差。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/restaurants/route";
import { makeGet } from "../helpers/request";
import {
  amapSearchOk,
  amapSearchEmpty,
  amapWalkingOk,
  makeAmapPoi,
} from "../fixtures/amap";

const origEnv = { ...process.env };

describe("/api/restaurants — L2 (TC-L2-APIR-001..007)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
  });
  afterEach(() => {
    process.env = origEnv;
  });

  /** 通用 fetch mock:place/around 返 pois,direction/walking 返固定 300s。 */
  function mockAmapFetch(pois: unknown, walkingSec = 300) {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/place/around")) {
        return {
          ok: true,
          json: async () => pois,
        } as Response;
      }
      if (url.includes("/direction/walking")) {
        return {
          ok: true,
          json: async () => amapWalkingOk(walkingSec),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  // ---- TC-L2-APIR-001: happy path ----
  it("TC-L2-APIR-001: 有 key + 命中 20 条 POI -> 200 含 restaurants 字段", async () => {
    process.env.AMAP_API_KEY = "key";
    mockAmapFetch(amapSearchOk(20));
    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(false);
    expect(Array.isArray(body.restaurants)).toBe(true);
    expect(body.restaurants.length).toBeGreaterThan(0);
    // 字段完整性
    const r = body.restaurants[0];
    expect(r).toHaveProperty("id");
    expect(r).toHaveProperty("name");
    expect(r).toHaveProperty("category");
    expect(r).toHaveProperty("location");
    expect(r).toHaveProperty("walkMinutes");
  });

  // ---- TC-L2-APIR-002: 缺位置参数 ----
  it("TC-L2-APIR-002: 缺 lat -> 400 Missing lng/lat", async () => {
    process.env.AMAP_API_KEY = "key";
    const req = makeGet("http://test/api/restaurants?lng=113.325");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/lng|lat|位置/);
  });

  // ---- TC-L2-APIR-003: 无 AMAP_API_KEY 降级 ----
  it("TC-L2-APIR-003: 无 AMAP_API_KEY -> 200 mock:true 走 MOCK_RESTAURANTS", async () => {
    delete process.env.AMAP_API_KEY;
    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
    expect(body.restaurants.length).toBeGreaterThan(0);
  });

  // ---- TC-L2-APIR-004: 高德异常 -> mock 降级 (记录实际行为 vs 设计预期) ----
  it("TC-L2-APIR-004: 高德抛错 -> 200 mock:true + error 字段 (现实现为软降级)", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream 503")) as unknown as typeof fetch;
    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125");
    const res = await GET(req);
    // 设计期望 502,现实现 200+mock 降级 —— 单测锁定现行,M6 报告再决策是否改硬失败
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
    expect(body.error).toBeDefined();
  });

  // ---- TC-L2-APIR-005: 高德首次返回 0 条 -> 直接返空,不扩搜 (现行实现) ----
  it("TC-L2-APIR-005: 高德返空 pois -> 200 空数组 (现未实现自动扩搜,设计欠账)", async () => {
    process.env.AMAP_API_KEY = "key";
    mockAmapFetch(amapSearchEmpty);
    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125&radius=1500");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(false);
    expect(body.restaurants).toEqual([]);
  });

  // ---- TC-L2-APIR-006: 高德返回重复 id -> searchRestaurants 不去重 (现行),路由不二次去重 ----
  it("TC-L2-APIR-006: 高德返重复 id -> 透传,不强制去重 (记录为现行口径)", async () => {
    process.env.AMAP_API_KEY = "key";
    const dup = makeAmapPoi(3).map((p) => ({ ...p, id: "DUPE-1" }));
    mockAmapFetch({ status: "1", count: "3", pois: dup });
    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125");
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    // 目前代码不 dedup -> 3 条都保留
    expect(body.restaurants.length).toBe(3);
    const ids = body.restaurants.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(1);
  });

  // ---- TC-L2-APIR-007: radius 超大 clamp ----
  it("TC-L2-APIR-007: radius=9999 -> clamp 到 3000, 不崩", async () => {
    process.env.AMAP_API_KEY = "key";
    let capturedUrl = "";
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/place/around")) {
        capturedUrl = url;
        return { ok: true, json: async () => amapSearchOk(3) } as Response;
      }
      return { ok: true, json: async () => amapWalkingOk(300) } as Response;
    }) as unknown as typeof fetch;

    const req = makeGet("http://test/api/restaurants?lng=113.325&lat=23.125&radius=9999");
    const res = await GET(req);
    expect(res.status).toBe(200);
    // 路由 clamp 到 [500, 3000]
    expect(capturedUrl).toMatch(/radius=3000/);
  });
});
