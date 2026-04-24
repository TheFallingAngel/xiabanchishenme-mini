/**
 * L1 单元测试 —— src/lib/reviews.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-RVWS-001..010 (10 条)
 *
 * 覆盖:
 *   - fetchReviews / submitReview / uploadReviewImage 的 happy path 和失败兜底
 *   - compressImageForUpload 在非浏览器/小图/非图片类型的快路径
 *   - relativeTime 分段
 *
 * 时间源: 2026-04-19T12:00:00.000Z (FAKE_NOW)
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  fetchReviews,
  submitReview,
  uploadReviewImage,
  compressImageForUpload,
  relativeTime,
} from "./reviews";

describe("reviews.ts — L1 单元测试 (TC-L1-RVWS-001..010)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---- fetchReviews ----

  it("TC-L1-RVWS-001: fetchReviews 成功返回 reviews", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reviews: [
          { id: "r", restaurantId: "x", nickname: "n", rating: 5, text: "good", imageUrls: [], createdAt: 1 },
        ],
      }),
    }) as unknown as typeof fetch;
    const out = await fetchReviews("x");
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("r");
  });

  it("TC-L1-RVWS-002: fetchReviews non-ok -> []; 异常 -> []; 非数组响应 -> []", async () => {
    // non-ok
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await fetchReviews("x")).toEqual([]);

    // 异常
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    expect(await fetchReviews("x")).toEqual([]);

    // 响应体不是数组
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reviews: null }) }) as unknown as typeof fetch;
    expect(await fetchReviews("x")).toEqual([]);
  });

  // ---- submitReview ----

  it("TC-L1-RVWS-003: submitReview 成功返回 review 记录", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ review: { id: "r1", rating: 5, text: "棒", imageUrls: [], nickname: "z", restaurantId: "x", createdAt: 1 } }),
    }) as unknown as typeof fetch;
    const r = await submitReview("x", { nickname: "z", rating: 5, text: "棒", imageUrls: [] });
    expect(r.id).toBe("r1");
  });

  it("TC-L1-RVWS-004: submitReview 失败 -> 抛 Error 带后端 error 文案", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "评分非法" }),
    }) as unknown as typeof fetch;
    await expect(
      submitReview("x", { nickname: "z", rating: 99, text: "棒", imageUrls: [] })
    ).rejects.toThrow("评分非法");
  });

  // ---- uploadReviewImage ----

  it("TC-L1-RVWS-005: uploadReviewImage 成功返回 url", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob/x.jpg" }),
    }) as unknown as typeof fetch;
    // 用小文件避开压缩路径
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const url = await uploadReviewImage(file);
    expect(url).toBe("https://blob/x.jpg");
  });

  it("TC-L1-RVWS-006: uploadReviewImage 失败 -> 抛 '上传失败' 或后端文案", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "文件过大" }),
    }) as unknown as typeof fetch;
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await expect(uploadReviewImage(file)).rejects.toThrow("文件过大");

    // 无 error 字段 -> fallback
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(uploadReviewImage(file)).rejects.toThrow("上传失败");
  });

  // ---- compressImageForUpload ----

  it("TC-L1-RVWS-007: compressImageForUpload 非图片类型直接原样返回", async () => {
    const f = new File(["x"], "a.mp4", { type: "video/mp4" });
    const out = await compressImageForUpload(f);
    expect(out).toBe(f);
  });

  it("TC-L1-RVWS-008: compressImageForUpload 小文件 (<1MB) 直接原样返回", async () => {
    const f = new File(["x".repeat(1024)], "a.jpg", { type: "image/jpeg" }); // 1KB
    const out = await compressImageForUpload(f);
    expect(out).toBe(f);
  });

  // ---- relativeTime ----

  it("TC-L1-RVWS-009: relativeTime 分段: 刚刚/N 分钟前/N 小时前/昨天/N 天前/yyyy-mm-dd", () => {
    const now = Date.now();
    expect(relativeTime(now)).toBe("刚刚");
    expect(relativeTime(now - 30 * 1000)).toBe("刚刚"); // <1分
    expect(relativeTime(now - 5 * 60 * 1000)).toBe("5 分钟前");
    expect(relativeTime(now - 3 * 60 * 60 * 1000)).toBe("3 小时前");
    expect(relativeTime(now - 24 * 60 * 60 * 1000 - 100)).toBe("昨天");
    expect(relativeTime(now - 4 * 24 * 60 * 60 * 1000)).toBe("4 天前");
  });

  it("TC-L1-RVWS-010: relativeTime >=7 天 -> yyyy-mm-dd 格式", () => {
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1000;
    const out = relativeTime(old);
    // FAKE_NOW 是 2026-04-19, 10 天前 -> 2026-04-09
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toBe("2026-04-09");
  });
});
