/**
 * L1 单元测试 —— src/lib/images.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-IMG-001..010 (10 条)
 */
import { describe, expect, it } from "vitest";
import {
  getImageForCategory,
  getRestaurantImage,
  getDishPhotos,
  getInteriorPhotos,
  FOOD_IMAGES,
  DISCOVERY_IMAGES,
} from "./images";

describe("images.ts — L1 单元测试 (TC-L1-IMG-001..010)", () => {
  it("TC-L1-IMG-001: getImageForCategory 命中关键字 (川菜/粤菜/火锅/日料/面/快餐)", () => {
    expect(getImageForCategory("川菜")).toBe(FOOD_IMAGES.sichuan);
    expect(getImageForCategory("湘菜馆")).toBe(FOOD_IMAGES.sichuan);
    expect(getImageForCategory("重庆火锅")).toBe(FOOD_IMAGES.hotpot);
    expect(getImageForCategory("日料店")).toBe(FOOD_IMAGES.ramen);
    expect(getImageForCategory("兰州拉面")).toBe(FOOD_IMAGES.ramen);
    expect(getImageForCategory("烧烤")).toBe(FOOD_IMAGES.bbq);
    expect(getImageForCategory("粤菜")).toBe(FOOD_IMAGES.dimsum);
    expect(getImageForCategory("快餐")).toBe(FOOD_IMAGES.friedRice);
  });

  it("TC-L1-IMG-002: getImageForCategory 未命中时兜底到 congee", () => {
    expect(getImageForCategory("未知菜系")).toBe(FOOD_IMAGES.congee);
    expect(getImageForCategory("")).toBe(FOOD_IMAGES.congee);
  });

  it("TC-L1-IMG-003: getRestaurantImage 空 photos -> 按 category 兜底", () => {
    expect(getRestaurantImage(undefined, "川菜")).toBe(FOOD_IMAGES.sichuan);
    expect(getRestaurantImage([], "火锅")).toBe(FOOD_IMAGES.hotpot);
  });

  it("TC-L1-IMG-004: getRestaurantImage hero 默认用 photos[0]", () => {
    const photos = ["https://a.jpg", "https://b.jpg"];
    expect(getRestaurantImage(photos, "川菜", "hero")).toBe("https://a.jpg");
  });

  it("TC-L1-IMG-005: getRestaurantImage hero 带 tags 按 HERO_PREF 顺序 (storefront 优先于 interior)", () => {
    const photos = ["https://a.jpg", "https://b.jpg", "https://c.jpg"];
    const tags = {
      "https://a.jpg": "interior" as const,
      "https://b.jpg": "storefront" as const,
      "https://c.jpg": "dish" as const,
    };
    expect(getRestaurantImage(photos, "川菜", "hero", tags)).toBe("https://b.jpg");
  });

  it("TC-L1-IMG-006: getRestaurantImage dish 无 tags -> photos[1]", () => {
    const photos = ["https://a.jpg", "https://b.jpg"];
    expect(getRestaurantImage(photos, "川菜", "dish")).toBe("https://b.jpg");
  });

  it("TC-L1-IMG-007: getDishPhotos 有 tags 时只保留 tag=dish", () => {
    const photos = ["https://a.jpg", "https://b.jpg", "https://c.jpg"];
    const tags = {
      "https://a.jpg": "dish" as const,
      "https://b.jpg": "interior" as const,
      "https://c.jpg": "dish" as const,
    };
    const out = getDishPhotos(photos, "川菜", 6, tags);
    expect(out).toEqual(["https://a.jpg", "https://c.jpg"]);
  });

  it("TC-L1-IMG-008: getDishPhotos 无 tags 时兜底到 photos.slice(1)", () => {
    const photos = ["https://a.jpg", "https://b.jpg", "https://c.jpg"];
    const out = getDishPhotos(photos, "川菜");
    expect(out).toEqual(["https://b.jpg", "https://c.jpg"]);
    // 空 photos -> []
    expect(getDishPhotos([], "川菜")).toEqual([]);
    expect(getDishPhotos(undefined, "川菜")).toEqual([]);
  });

  it("TC-L1-IMG-009: getInteriorPhotos 严格命中 ≥2 -> 只用 strict 子集; 不够 ≥2 -> 加 other 兜底", () => {
    // 严格命中足够 (2 张 interior)
    const strictEnough = getInteriorPhotos(["a", "b", "c"], {
      a: "interior",
      b: "storefront",
      c: "dish",
    });
    expect(strictEnough).toEqual(["a", "b"]);

    // 只有 1 张 interior + 1 张 other -> 扩到 withOther
    const needsOther = getInteriorPhotos(["a", "b", "c"], {
      a: "interior",
      b: "other",
      c: "dish",
    });
    expect(needsOther).toEqual(["a", "b"]);

    // strict=0 withOther=1 dish=2 -> 剔除 menu/logo 后剩 3 张,返回 nonUgly
    const fallback = getInteriorPhotos(["a", "b", "c"], {
      a: "dish",
      b: "dish",
      c: "menu",
    });
    expect(fallback).toEqual(["a", "b"]);
  });

  it("TC-L1-IMG-010: getInteriorPhotos undefined photos -> []; 无 tags -> 原样返回", () => {
    expect(getInteriorPhotos(undefined)).toEqual([]);
    expect(getInteriorPhotos(["a", "b"])).toEqual(["a", "b"]);
    // DISCOVERY_IMAGES 导出且有内容
    expect(DISCOVERY_IMAGES.length).toBeGreaterThan(0);
    expect(DISCOVERY_IMAGES[0].src).toBeDefined();
    expect(DISCOVERY_IMAGES[0].label).toBeDefined();
  });
});
