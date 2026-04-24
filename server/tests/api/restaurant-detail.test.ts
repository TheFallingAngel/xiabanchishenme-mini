/**
 * L2 API 路由测试 —— /api/restaurant/[id]
 * 对应 TEST-CASES-v1.xlsx TC-L2-APID-001..005 (5 条)
 *
 * 路由口径:
 *   - 无 id -> 400
 *   - getPoiDetail 返 null (包括无 key 直接 null / 高德 status!=1) -> 200 { detail: null }
 *   - getPoiDetail 抛错 -> 200 { detail: null }  (软降级, 不 5xx)
 *   - 命中 -> 200 { detail: {...} }
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/restaurant/[id]/route";
import { makeGet } from "../helpers/request";
import { amapPoiDetailOk } from "../fixtures/amap";

const origEnv = { ...process.env };

/** 路由签名是 (req, {params}),makeGet 只提供 req,这里封装一下。 */
async function callDetail(id: string, url = "http://test/api/restaurant/") {
  return GET(makeGet(`${url}${id}`), { params: { id } });
}

describe("/api/restaurant/[id] — L2 (TC-L2-APID-001..005)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // ---- 001: happy path ----
  it("TC-L2-APID-001: 有 key + 命中 -> 200 detail 含完整字段", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => amapPoiDetailOk("B0F1"),
    }) as unknown as typeof fetch;

    const res = await callDetail("B0F1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail).toBeTruthy();
    expect(body.detail.id).toBe("B0F1");
    expect(body.detail.name).toBe("湘村小馆");
    expect(body.detail.photos.length).toBeGreaterThan(0);
    // tag 字段拆出来是数组
    expect(Array.isArray(body.detail.tags)).toBe(true);
    expect(body.detail.tags).toContain("湘菜");
  });

  // ---- 002: 404-ish -> 200 + detail:null (现行口径) ----
  it("TC-L2-APID-002: 高德返 status!=1 -> 200 detail:null (软降级)", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "0", info: "INVALID_PARAM" }),
    }) as unknown as typeof fetch;

    const res = await callDetail("BAD_ID");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail).toBeNull();
  });

  // ---- 003: 缺 id -> 400 ----
  it("TC-L2-APID-003: id 为空 -> 400 'missing id'", async () => {
    process.env.AMAP_API_KEY = "key";
    const res = await GET(makeGet("http://test/api/restaurant/"), { params: { id: "" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/id/i);
  });

  // ---- 004: 无 AMAP_API_KEY -> getPoiDetail 返 null -> 200 detail:null ----
  it("TC-L2-APID-004: 无 AMAP_API_KEY -> 200 detail:null (无外部调用)", async () => {
    delete process.env.AMAP_API_KEY;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await callDetail("B0F1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  // ---- 005: fetch 抛错 -> 软降级 detail:null ----
  it("TC-L2-APID-005: fetch 抛错 -> 200 detail:null (catch 吞掉)", async () => {
    process.env.AMAP_API_KEY = "key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    const res = await callDetail("B0F1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detail).toBeNull();
  });
});
