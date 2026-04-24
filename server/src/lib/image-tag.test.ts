/**
 * L1 单元测试 —— src/lib/image-tag.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-TAG-001..008 (8 条)
 *
 * 覆盖:
 *   - PHOTO_TAGS 常量导出
 *   - classifyPhotos: 空/去重/截断 10 张, 无 API_KEY 时返回空 map 不抛错
 *   - classifyPhotos 带 mock fetch: storefront/dish/等标签解析
 *   - readCachedTags: 无缓存 -> 空
 *
 * 注意: image-tag.ts 会 lazy require("@vercel/kv"), 本地没配 KV_REST_API_URL 时返回 null,
 *       所以只用进程内 Map 缓存,测试之间要 reset memory。由于 memoryCache 不导出,
 *       我们只能通过 "不同 url" 来隔离测试。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { classifyPhotos, readCachedTags, PHOTO_TAGS } from "./image-tag";

const originalEnv = { ...process.env };

describe("image-tag.ts — L1 单元测试 (TC-L1-TAG-001..008)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 清干净 MINIMAX_API_KEY 的默认值
    process.env = { ...originalEnv };
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  it("TC-L1-TAG-001: PHOTO_TAGS 导出 6 个有序标签", () => {
    expect(PHOTO_TAGS).toEqual([
      "storefront",
      "interior",
      "dish",
      "menu",
      "logo",
      "other",
    ]);
  });

  it("TC-L1-TAG-002: classifyPhotos 空数组 -> 返回 {}", async () => {
    expect(await classifyPhotos([])).toEqual({});
  });

  it("TC-L1-TAG-003: classifyPhotos 非字符串 / 空串 被过滤", async () => {
    delete process.env.MINIMAX_API_KEY;
    // 没 API KEY,全部未命中缓存,直接返回 {}
    const out = await classifyPhotos([null as unknown as string, "", undefined as unknown as string]);
    expect(out).toEqual({});
  });

  it("TC-L1-TAG-004: classifyPhotos 去重 + 超 10 张截断 (本次无 KEY 不打标)", async () => {
    delete process.env.MINIMAX_API_KEY;
    const urls = Array.from({ length: 15 }, (_, i) => `https://amap/img${i}.jpg`);
    // 加两个重复
    urls.push(urls[0]);
    urls.push(urls[1]);
    const out = await classifyPhotos(urls);
    // 没 API KEY,无缓存 -> 空
    expect(out).toEqual({});
    // 不抛错即可
  });

  it("TC-L1-TAG-005: 无 API KEY 时不调用 fetch", async () => {
    delete process.env.MINIMAX_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("should not be called"));
    const out = await classifyPhotos(["https://amap/a.jpg"]);
    expect(out).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("TC-L1-TAG-006: classifyPhotos 带 key + 成功 mock -> 返回 url -> tag map", async () => {
    process.env.MINIMAX_API_KEY = "fake-key";
    // fetch 会被调 2 次: 1) 下载图 (返 arrayBuffer) 2) POST VLM
    const fetchMock = vi
      .fn()
      // 第一个 url 的两次 fetch
      .mockImplementationOnce(async () => ({
        ok: true,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new ArrayBuffer(8),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ base_resp: { status_code: 0 }, content: "storefront" }),
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await classifyPhotos(["https://amap/unique-1.jpg"]);
    expect(out).toEqual({ "https://amap/unique-1.jpg": "storefront" });
  });

  it("TC-L1-TAG-007: classifyPhotos base_resp 错误 -> 单张兜底为 'other', 不拖垮整组", async () => {
    process.env.MINIMAX_API_KEY = "fake-key";
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new ArrayBuffer(8),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ base_resp: { status_code: 1004, status_msg: "auth" }, content: "" }),
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await classifyPhotos(["https://amap/unique-2.jpg"]);
    expect(out).toEqual({ "https://amap/unique-2.jpg": "other" });
  });

  it("TC-L1-TAG-008: readCachedTags 未命中 -> 返回 {}", async () => {
    // 全新的 url, 不会命中缓存
    const out = await readCachedTags([`https://amap/never-seen-${Date.now()}.jpg`]);
    expect(out).toEqual({});
    // 空输入
    expect(await readCachedTags([])).toEqual({});
    // 非法输入被过滤
    expect(await readCachedTags(["", null as unknown as string])).toEqual({});
  });
});
