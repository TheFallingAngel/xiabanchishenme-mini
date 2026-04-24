/**
 * L2 API 路由测试 —— /api/images/tag
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIT-001..006 (6 条)
 *
 * 路由本身薄:POST 调 classifyPhotos,GET 调 readCachedTags。
 * 直接 mock @/lib/image-tag,单独跑路由层的 validation / 错误兜底 / cache header 路径。
 * classifyPhotos / readCachedTags 本身的 VLM & KV 分支放 L1 (image-tag.test.ts) 覆盖。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { makeGet, makePostJson, makePostRaw } from "../helpers/request";

const { classifyPhotos, readCachedTags } = vi.hoisted(() => ({
  classifyPhotos: vi.fn(),
  readCachedTags: vi.fn(),
}));

vi.mock("@/lib/image-tag", () => ({
  classifyPhotos,
  readCachedTags,
}));

import { GET, POST } from "@/app/api/images/tag/route";

const origEnv = { ...process.env };

describe("/api/images/tag — L2 (TC-L2-APIT-001..006)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    classifyPhotos.mockReset();
    readCachedTags.mockReset();
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // ---- 001: POST happy ----
  it("TC-L2-APIT-001: POST 合法 urls -> 200 tags map", async () => {
    classifyPhotos.mockResolvedValue({
      "https://a.test/1.jpg": "storefront",
      "https://a.test/2.jpg": "dish",
    });
    const res = await POST(
      makePostJson("http://test/api/images/tag", {
        urls: ["https://a.test/1.jpg", "https://a.test/2.jpg"],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags["https://a.test/1.jpg"]).toBe("storefront");
    expect(body.tags["https://a.test/2.jpg"]).toBe("dish");
  });

  // ---- 002: POST 空 / 非数组 urls -> 200 tags:{} , 不调底层 ----
  it("TC-L2-APIT-002: POST 空 urls -> 200 tags:{}, classifyPhotos 不被调", async () => {
    const r1 = await POST(makePostJson("http://test/api/images/tag", { urls: [] }));
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.tags).toEqual({});

    const r2 = await POST(makePostJson("http://test/api/images/tag", { urls: "not-array" }));
    const b2 = await r2.json();
    expect(b2.tags).toEqual({});

    expect(classifyPhotos).not.toHaveBeenCalled();
  });

  // ---- 003: POST invalid JSON -> 400 ----
  it("TC-L2-APIT-003: POST 非 JSON -> 400 'Invalid JSON'", async () => {
    const res = await POST(makePostRaw("http://test/api/images/tag", "{broken"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON/i);
  });

  // ---- 004: POST classifyPhotos 抛错 -> 200 tags:{} + error ----
  it("TC-L2-APIT-004: classifyPhotos 抛错 -> 200 tags:{} + error", async () => {
    classifyPhotos.mockRejectedValue(new Error("VLM blew up"));
    const res = await POST(
      makePostJson("http://test/api/images/tag", { urls: ["https://a.test/1.jpg"] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual({});
    expect(body.error).toBe("classification failed");
  });

  // ---- 005: GET 无 urls -> 200 tags:{}, 带 Cache-Control 长 header ----
  it("TC-L2-APIT-005: GET 无 urls -> 200 tags:{} + Cache-Control s-maxage", async () => {
    const res = await GET(makeGet("http://test/api/images/tag"));
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") || "";
    expect(cc).toContain("s-maxage=604800");
    expect(cc).toContain("stale-while-revalidate");
    const body = await res.json();
    expect(body.tags).toEqual({});
    expect(readCachedTags).not.toHaveBeenCalled();
  });

  // ---- 006: GET urls=a,b -> 调 readCachedTags 透传 ----
  it("TC-L2-APIT-006: GET ?urls=a,b -> 200 tags 来自 readCachedTags", async () => {
    readCachedTags.mockResolvedValue({ "https://a.test/1.jpg": "interior" });
    const res = await GET(
      makeGet("http://test/api/images/tag?urls=https%3A%2F%2Fa.test%2F1.jpg,https%3A%2F%2Fa.test%2F2.jpg")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags["https://a.test/1.jpg"]).toBe("interior");
    expect(readCachedTags).toHaveBeenCalledWith([
      "https://a.test/1.jpg",
      "https://a.test/2.jpg",
    ]);
  });
});
