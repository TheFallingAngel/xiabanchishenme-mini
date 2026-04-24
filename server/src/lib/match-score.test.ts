/**
 * L1 单元测试 —— src/lib/match-score.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-MSCR-001..016 (16 条)
 *
 * 关键覆盖面:
 *   - 5 个维度的分段阈值 (tasteDimension/distanceDimension/budgetDimension/ratingDimension/freshnessDimension)
 *   - 自定义权重 → 归一化到 "四维 0.9 + freshness 0.1"
 *   - weightPercentages 的 UI 预览用途
 *   - scoreLabel 的分段
 *   - tasteMatches 的别名匹配
 */
import { describe, expect, it } from "vitest";
import {
  calculateMatchScore,
  scoreLabel,
  tasteMatches,
  weightPercentages,
  CUISINE_ALIASES,
  CUISINE_TAGS,
} from "./match-score";
import type { Restaurant, UserPreferences } from "./types";

function basePrefs(): UserPreferences {
  return {
    savedLocations: [],
    currentLocation: null,
    notInterested: {},
    notInterestedDetails: {},
    history: [],
    favorites: [],
    favoriteDetails: {},
    tastePreferences: [],
    monthlyBudget: 3000, // 日均 100
    maxWalkMinutes: 10,
    consecutiveDays: 0,
    lastVisitDate: null,
    advancedUnlocked: false,
  };
}

function rest(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "r1",
    name: "测试店",
    category: "川菜",
    address: "北京路",
    avgPrice: 50,
    rating: 4.5,
    walkMinutes: 5,
    distanceMeters: 400,
    location: { lng: 113, lat: 23 },
    ...over,
  };
}

describe("match-score.ts — L1 单元测试 (TC-L1-MSCR-001..016)", () => {
  // ---- 口味维度 ----

  it("TC-L1-MSCR-001: 无口味偏好 -> taste = 70 (中性)", () => {
    const p = basePrefs();
    const s = calculateMatchScore(rest(), p);
    expect(s.taste).toBe(70);
  });

  it("TC-L1-MSCR-002: 口味命中 1 个 category -> taste = 95", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜"];
    const s = calculateMatchScore(rest({ category: "川菜" }), p);
    expect(s.taste).toBe(95);
    expect(s.matchedTastes).toEqual(["川菜"]);
  });

  it("TC-L1-MSCR-003: 口味通过别名命中 (#71): category='中餐厅' name 含'蜀' -> 95", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜"];
    const s = calculateMatchScore(rest({ category: "中餐厅", name: "蜀香园" }), p);
    expect(s.taste).toBe(95);
  });

  it("TC-L1-MSCR-004: 口味不命中 -> taste = 15 (本次调狠,miss penalty 30 → 15)", () => {
    const p = basePrefs();
    p.tastePreferences = ["日料"];
    const s = calculateMatchScore(rest({ category: "川菜", name: "麻辣烫" }), p);
    expect(s.taste).toBe(15);
    expect(s.matchedTastes).toEqual([]);
  });

  it("TC-L1-MSCR-004b: 命中 2 个偏好 -> taste = 110 (本次新增,奖励多重命中)", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜", "火锅"];
    const s = calculateMatchScore(rest({ category: "川菜", name: "老成都火锅" }), p);
    expect(s.taste).toBe(110);
    expect(s.matchedTastes).toEqual(["川菜", "火锅"]);
  });

  it("TC-L1-MSCR-004c: 命中 3+ 个偏好 -> taste = 120 (本次新增,顶配爆表)", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜", "火锅", "烧烤"];
    const s = calculateMatchScore(
      rest({ category: "川菜", name: "麻辣串串火锅烧烤" }),
      p
    );
    expect(s.taste).toBe(120);
    expect(s.matchedTastes?.length).toBe(3);
  });

  it("TC-L1-MSCR-004d: haystack 扩展到 poiType + poiTag (本次新增)", () => {
    const p = basePrefs();
    p.tastePreferences = ["粤菜"];
    // category 只是"中餐厅",但 poiType 里有"粤菜"
    const s = calculateMatchScore(
      rest({ category: "中餐厅", name: "老店", poiType: "餐饮服务;粤菜;茶餐厅" }),
      p
    );
    expect(s.taste).toBe(95);
    expect(s.matchedTastes).toEqual(["粤菜"]);
  });

  // ---- 距离维度 ----

  it("TC-L1-MSCR-005: walkMinutes 分段: <=50% -> 100, <=75% -> 85, <=100% -> 65, <=130% -> 35, else 10", () => {
    const p = basePrefs();
    p.maxWalkMinutes = 10;
    expect(calculateMatchScore(rest({ walkMinutes: 5 }), p).distance).toBe(100);   // 50%
    expect(calculateMatchScore(rest({ walkMinutes: 7 }), p).distance).toBe(85);    // 70%
    expect(calculateMatchScore(rest({ walkMinutes: 10 }), p).distance).toBe(65);   // 100%
    expect(calculateMatchScore(rest({ walkMinutes: 12 }), p).distance).toBe(35);   // 120%
    expect(calculateMatchScore(rest({ walkMinutes: 20 }), p).distance).toBe(10);   // 200%
  });

  // ---- 预算维度 ----

  it("TC-L1-MSCR-006: budget 维度: 低价命中 100, 超出拉低", () => {
    const p = basePrefs();
    // 月初月中 ceiling 大约 = 剩余预算/剩余天数。4-19, 30 天 -> 剩余 12 天 -> 3000/12=250
    // 今天未花,所以 dailyCeiling ≈ 250
    const cheap = calculateMatchScore(rest({ avgPrice: 30 }), p); // 30/250 ≈ 0.12 -> 100
    const ok = calculateMatchScore(rest({ avgPrice: 200 }), p);   // 200/250 = 0.8 -> 85
    const high = calculateMatchScore(rest({ avgPrice: 250 }), p); // 250/250 = 1.0 -> 65
    const over = calculateMatchScore(rest({ avgPrice: 400 }), p); // 400/250 = 1.6 -> 15
    expect(cheap.budget).toBe(100);
    expect(ok.budget).toBe(85);
    expect(high.budget).toBe(65);
    expect(over.budget).toBe(15);
  });

  it("TC-L1-MSCR-007: avgPrice <= 0 -> budget = 70 (中性)", () => {
    const p = basePrefs();
    expect(calculateMatchScore(rest({ avgPrice: 0 }), p).budget).toBe(70);
    expect(calculateMatchScore(rest({ avgPrice: -10 }), p).budget).toBe(70);
  });

  // ---- 评分维度 ----

  it("TC-L1-MSCR-008: rating 为 5 -> 100, 为 0/负 -> 50 (unknown)", () => {
    const p = basePrefs();
    expect(calculateMatchScore(rest({ rating: 5 }), p).rating).toBe(100);
    expect(calculateMatchScore(rest({ rating: 4 }), p).rating).toBe(80);
    expect(calculateMatchScore(rest({ rating: 0 }), p).rating).toBe(50);
    expect(calculateMatchScore(rest({ rating: -1 }), p).rating).toBe(50);
  });

  // ---- freshness 维度 ----

  it("TC-L1-MSCR-009: 1 天内吃过 -> freshness 10; 3 天内 -> 35; 7 天内 -> 60; 更早 -> 100", () => {
    const p = basePrefs();
    // 1 天内 (昨天刚吃)
    p.history = [{ restaurantId: "r1", restaurantName: "a", category: "c", date: "2026-04-19T03:00:00.000Z", action: "ate_today" }];
    expect(calculateMatchScore(rest({ id: "r1" }), p).freshness).toBe(10);

    // 2 天前 (3 天内但不是 1 天内)
    p.history = [{ restaurantId: "r2", restaurantName: "a", category: "c", date: "2026-04-17T12:00:00.000Z", action: "ate_today" }];
    expect(calculateMatchScore(rest({ id: "r2" }), p).freshness).toBe(35);

    // 5 天前 (7 天内)
    p.history = [{ restaurantId: "r3", restaurantName: "a", category: "c", date: "2026-04-14T12:00:00.000Z", action: "ate_today" }];
    expect(calculateMatchScore(rest({ id: "r3" }), p).freshness).toBe(60);

    // 从来没吃过 -> 100
    expect(calculateMatchScore(rest({ id: "brand-new" }), basePrefs()).freshness).toBe(100);
  });

  // ---- total 综合 ----

  it("TC-L1-MSCR-010: 总分 = 各维度 × 归一化权重 (默认 30/25/20/15/10)", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜"];
    // 构造一个"高分"店: 口味命中(95) + 半路程(100) + 便宜(100) + 5 星(100) + 没吃过(100)
    // 95*0.3 + 100*0.25 + 100*0.2 + 100*0.15 + 100*0.1 = 28.5 + 25 + 20 + 15 + 10 = 98.5 → 99
    const perfect = calculateMatchScore(
      rest({ category: "川菜", avgPrice: 30, rating: 5, walkMinutes: 2 }),
      p
    );
    expect(perfect.total).toBeGreaterThanOrEqual(98);
    expect(perfect.taste).toBe(95);
    expect(perfect.distance).toBe(100);
  });

  it("TC-L1-MSCR-011: 自定义权重 -> resolveWeights 按比例归一,freshness 固定 10%", () => {
    const p = basePrefs();
    p.tastePreferences = ["川菜"];
    // 权重全押在口味上 -> 不命中时 taste(15) 拖低总分
    p.scoringWeights = { taste: 100, distance: 0, budget: 0, rating: 0 };
    const mismatch = calculateMatchScore(rest({ category: "咖啡厅", name: "星巴克", rating: 5 }), p);
    // taste 15 × 0.9 + rating 100 × 0 + freshness 100 × 0.1 = 13.5 + 10 = 23.5 → 24
    expect(mismatch.total).toBe(24);
  });

  it("TC-L1-MSCR-012: 权重全 0 -> fallback 到默认 (避免除 0)", () => {
    const p = basePrefs();
    p.scoringWeights = { taste: 0, distance: 0, budget: 0, rating: 0 };
    // 不抛错,等同 DEFAULT_WEIGHTS
    const score = calculateMatchScore(rest(), p);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  // ---- 超预算边界 ----

  it("TC-L1-MSCR-013: 月内已超预算 -> ceiling 降到 monthlyBudget/40, 贵店 budget 被拉低", () => {
    const p = basePrefs();
    p.monthlyBudget = 4000;
    // 历史在本月花掉 4500 (超 500)
    p.history = [{
      restaurantId: "dummy", restaurantName: "x", category: "c",
      date: "2026-04-05T12:00:00.000Z", action: "ate_today", amount: 4500,
    }];
    // ceiling = max(20, round(4000/40)) = 100
    // 200 元店: 200/100=2.0 -> 15
    const over = calculateMatchScore(rest({ avgPrice: 200 }), p);
    expect(over.budget).toBe(15);
  });

  // ---- weightPercentages ----

  it("TC-L1-MSCR-014: weightPercentages: undefined -> 默认 30/25/20/15/10; 正常 sum=100 ± 1", () => {
    const d = weightPercentages(undefined);
    expect(d).toEqual({ taste: 30, distance: 25, budget: 20, rating: 15, freshness: 10 });

    const custom = weightPercentages({ taste: 40, distance: 30, budget: 20, rating: 10 });
    const total = custom.taste + custom.distance + custom.budget + custom.rating + custom.freshness;
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
    // freshness 固定 10
    expect(custom.freshness).toBe(10);
  });

  // ---- scoreLabel ----

  it("TC-L1-MSCR-015: scoreLabel 分段: 85+ 超级匹配 / 70 很合适 / 55 还不错 / 40 可以试试 / else 随缘吧", () => {
    expect(scoreLabel(95)).toBe("超级匹配");
    expect(scoreLabel(85)).toBe("超级匹配");
    expect(scoreLabel(84)).toBe("很合适");
    expect(scoreLabel(70)).toBe("很合适");
    expect(scoreLabel(55)).toBe("还不错");
    expect(scoreLabel(40)).toBe("可以试试");
    expect(scoreLabel(20)).toBe("随缘吧");
  });

  // ---- tasteMatches ----

  it("TC-L1-MSCR-016: tasteMatches 支持别名 + 大小写不敏感 + 空串安全", () => {
    // 英文别名 "pizza" 大小写不敏感
    expect(tasteMatches("西餐", ["意式 Pizza 店"])).toBe(true);
    // 中文别名 "蜀" 命中"蜀香园"
    expect(tasteMatches("川菜", [null, "蜀香园", undefined])).toBe(true);
    // 无别名的 pref 只走 includes
    expect(tasteMatches("unknown", ["中餐厅"])).toBe(false);
    // 空串/空 haystack
    expect(tasteMatches("", ["川菜"])).toBe(false);
    expect(tasteMatches("川菜", [])).toBe(false);
    expect(tasteMatches("川菜", [null, undefined])).toBe(false);
    // 导出: CUISINE_TAGS / CUISINE_ALIASES 公开给 UI 用
    expect(CUISINE_TAGS.length).toBeGreaterThan(0);
    expect(CUISINE_ALIASES["川菜"]).toBeDefined();
  });
});
