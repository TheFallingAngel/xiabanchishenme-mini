/**
 * L1 单元测试 —— src/lib/dish-photos.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-DISH-001..008 (8 条)
 *
 * 覆盖:
 *   - groupDishPhotosByName: 聚合 / 排序 / 空菜名过滤
 *   - fetchDishPhotos: 成功 / 失败 / 异常 兜底
 *   - submitDishPhoto: 成功返回 / 失败抛错
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  fetchDishPhotos,
  submitDishPhoto,
  groupDishPhotosByName,
} from "./dish-photos";
import type { DishPhotoRecord } from "./types";

function rec(over: Partial<DishPhotoRecord>): DishPhotoRecord {
  return {
    id: "p1",
    restaurantId: "r1",
    dishName: "水煮鱼",
    imageUrl: "https://img/a.jpg",
    nickname: "Zz",
    createdAt: Date.now(),
    ...over,
  };
}

describe("dish-photos.ts — L1 单元测试 (TC-L1-DISH-001..008)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---- groupDishPhotosByName ----

  it("TC-L1-DISH-001: 空数组 -> 空 Map", () => {
    expect(groupDishPhotosByName([]).size).toBe(0);
  });

  it("TC-L1-DISH-002: 同菜名多图聚合, 按 createdAt 倒序", () => {
    const r = [
      rec({ id: "a", dishName: "水煮鱼", imageUrl: "u1", createdAt: 100 }),
      rec({ id: "b", dishName: "水煮鱼", imageUrl: "u2", createdAt: 300 }),
      rec({ id: "c", dishName: "水煮鱼", imageUrl: "u3", createdAt: 200 }),
    ];
    const m = groupDishPhotosByName(r);
    expect(m.size).toBe(1);
    expect(m.get("水煮鱼")).toEqual(["u2", "u3", "u1"]);
  });

  it("TC-L1-DISH-003: 空/空白 dishName 的记录被跳过", () => {
    const r = [
      rec({ id: "a", dishName: "", imageUrl: "u1" }),
      rec({ id: "b", dishName: "   ", imageUrl: "u2" }),
      rec({ id: "c", dishName: "水煮鱼", imageUrl: "u3" }),
    ];
    const m = groupDishPhotosByName(r);
    expect(m.size).toBe(1);
    expect(m.get("水煮鱼")).toEqual(["u3"]);
  });

  it("TC-L1-DISH-004: dishName trim 后作为 key", () => {
    const r = [
      rec({ id: "a", dishName: "  水煮鱼  ", imageUrl: "u1" }),
    ];
    const m = groupDishPhotosByName(r);
    expect(m.has("水煮鱼")).toBe(true);
    expect(m.has("  水煮鱼  ")).toBe(false);
  });

  // ---- fetchDishPhotos ----

  it("TC-L1-DISH-005: fetchDishPhotos 成功返回 photos 数组", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ photos: [rec({ id: "a" })] }),
    }) as unknown as typeof fetch;
    const out = await fetchDishPhotos("r1");
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("a");
  });

  it("TC-L1-DISH-006: fetchDishPhotos non-ok 响应 -> 返回 []", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "500" }),
    }) as unknown as typeof fetch;
    expect(await fetchDishPhotos("r1")).toEqual([]);
  });

  it("TC-L1-DISH-007: fetchDishPhotos 网络异常 -> 返回 []", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await fetchDishPhotos("r1")).toEqual([]);
  });

  // ---- submitDishPhoto ----

  it("TC-L1-DISH-008: submitDishPhoto 成功返回 photo; 失败抛 Error 带后端文案", async () => {
    // 成功
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ photo: rec({ id: "new" }) }),
    }) as unknown as typeof fetch;
    const p = await submitDishPhoto("r1", {
      nickname: "x",
      dishName: "水煮鱼",
      imageUrl: "u",
    });
    expect(p.id).toBe("new");

    // 失败 + 带 error 文案
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "菜名不存在" }),
    }) as unknown as typeof fetch;
    await expect(
      submitDishPhoto("r1", { nickname: "x", dishName: "水煮鱼", imageUrl: "u" })
    ).rejects.toThrow("菜名不存在");

    // 失败无 error 字段 -> fallback "提交失败"
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    await expect(
      submitDishPhoto("r1", { nickname: "x", dishName: "水煮鱼", imageUrl: "u" })
    ).rejects.toThrow("提交失败");
  });
});
