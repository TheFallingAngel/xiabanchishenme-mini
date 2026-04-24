/**
 * L2 API 路由测试 —— /api/weather
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIW-001..004 (4 条)
 *
 * 路由特点:
 *   - 模块级 cache Map 按 (lng,lat) 两位小数做 key —— 测试间得换坐标避免串位
 *   - 调用链: regeo -> weatherInfo (两次 fetch)
 *   - 缺 key / adcode / 上游报错 -> 一律 200 + weather:null + reason 字段
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/weather/route";
import { makeGet } from "../helpers/request";
import { amapRegeoOk, amapWeatherOk, amapWeatherHot } from "../fixtures/amap";

const origEnv = { ...process.env };

describe("/api/weather — L2 (TC-L2-APIW-001..004)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
  });
  afterEach(() => {
    process.env = origEnv;
  });

  /** regeo 返 adcode,weatherInfo 返指定实况。 */
  function mockWeatherChain(weatherResp: unknown) {
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.includes("/geocode/regeo")) {
        return { ok: true, json: async () => amapRegeoOk } as Response;
      }
      if (url.includes("/weather/weatherInfo")) {
        return { ok: true, json: async () => weatherResp } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  // ---- TC-L2-APIW-001: 小雨 happy path ----
  it("TC-L2-APIW-001: 小雨 18°C -> weather.note 含'下雨' ", async () => {
    process.env.AMAP_API_KEY = "key";
    mockWeatherChain(amapWeatherOk);
    // 坐标按 2 位小数做 cache key,这里每条用不一样的,避免串
    const res = await GET(makeGet("http://test/api/weather?lng=113.11&lat=23.11"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weather).toBeTruthy();
    expect(body.weather.desc).toBe("小雨");
    expect(body.weather.note).toContain("下雨");
    // 18°C 属"不冷不热"区间,note 只有"下雨"一项
    expect(body.weather.note).not.toMatch(/热|冷|凉|闷/);
  });

  // ---- TC-L2-APIW-002: 高温天 ----
  it("TC-L2-APIW-002: 晴 34°C -> note 含'闷热' ", async () => {
    process.env.AMAP_API_KEY = "key";
    mockWeatherChain(amapWeatherHot);
    const res = await GET(makeGet("http://test/api/weather?lng=113.22&lat=23.22"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weather).toBeTruthy();
    expect(body.weather.note).toContain("闷热");
    expect(body.weather.note).toContain("晴天");
  });

  // ---- TC-L2-APIW-003: 缺位置参数 -> 400 ----
  it("TC-L2-APIW-003: 缺 lat -> 400 missing lng/lat", async () => {
    process.env.AMAP_API_KEY = "key";
    const res = await GET(makeGet("http://test/api/weather?lng=113.33"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.weather).toBeNull();
    expect(body.error).toMatch(/lng|lat/);
  });

  // ---- TC-L2-APIW-004: 无 AMAP_API_KEY -> 200 weather:null reason:no-amap-key ----
  it("TC-L2-APIW-004: 无 key -> 200 weather:null reason:no-amap-key (不触 fetch)", async () => {
    delete process.env.AMAP_API_KEY;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const res = await GET(makeGet("http://test/api/weather?lng=113.44&lat=23.44"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weather).toBeNull();
    expect(body.reason).toBe("no-amap-key");
    expect(spy).not.toHaveBeenCalled();
  });
});
