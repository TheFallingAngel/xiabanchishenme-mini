/**
 * L1 单元测试 —— src/lib/user-profile.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-PROF-001..006 (6 条)
 *
 * 关键覆盖:
 *   - buildUserProfile: 空/单条/多条 + 复合 category 拆分
 *   - suggestTasteCandidates: KNOWN_CUISINE_KEYWORDS 过滤 + existing 去重 + minVisits 门槛
 */
import { describe, expect, it } from "vitest";
import { buildUserProfile, suggestTasteCandidates } from "./user-profile";
import type { UserPreferences, HistoryRecord } from "./types";

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
    monthlyBudget: 3000,
    maxWalkMinutes: 15,
    consecutiveDays: 0,
    lastVisitDate: null,
    advancedUnlocked: false,
  };
}

function ate(id: string, date: string, category: string, amount?: number): HistoryRecord {
  return {
    restaurantId: id,
    restaurantName: "r",
    category,
    date,
    action: "ate_today",
    amount,
  };
}

describe("user-profile.ts — L1 单元测试 (TC-L1-PROF-001..006)", () => {
  it("TC-L1-PROF-001: 空 history -> 零 totalMeals / 零 avgSpend / 空 topCategories", () => {
    const p = basePrefs();
    const profile = buildUserProfile(p);
    expect(profile.totalMeals).toBe(0);
    expect(profile.avgSpend).toBe(0);
    expect(profile.topCategories).toEqual([]);
    expect(profile.diningFrequency).toBe(0);
    expect(profile.preferredDistance).toBe(15); // maxWalkMinutes default
  });

  it("TC-L1-PROF-002: 多品类按次数倒序 top 5,复合 category 拆分分别计数", () => {
    const p = basePrefs();
    p.history = [
      ate("1", "2026-04-01T12:00:00.000Z", "川菜"),
      ate("2", "2026-04-02T12:00:00.000Z", "川菜;湘菜"),
      ate("3", "2026-04-03T12:00:00.000Z", "湘菜"),
      ate("4", "2026-04-04T12:00:00.000Z", "日料"),
    ];
    const profile = buildUserProfile(p);
    // 川菜=2, 湘菜=2, 日料=1
    expect(profile.topCategories[0].count).toBe(2);
    expect(["川菜", "湘菜"]).toContain(profile.topCategories[0].category);
    expect(profile.topCategories[2].category).toBe("日料");
    expect(profile.topCategories[2].count).toBe(1);
  });

  it("TC-L1-PROF-003: avgSpend 只计有 amount 的记录", () => {
    const p = basePrefs();
    p.history = [
      ate("1", "2026-04-01T12:00:00.000Z", "川菜", 50),
      ate("2", "2026-04-02T12:00:00.000Z", "湘菜", 100),
      ate("3", "2026-04-03T12:00:00.000Z", "川菜", undefined),
      ate("4", "2026-04-04T12:00:00.000Z", "川菜", 0), // amount>0 才计
    ];
    const profile = buildUserProfile(p);
    expect(profile.totalMeals).toBe(4);
    // avgSpend = round((50+100)/2) = 75
    expect(profile.avgSpend).toBe(75);
  });

  it("TC-L1-PROF-004: diningFrequency 只在 >=2 餐时计算,按日跨度推成每周次数", () => {
    const p = basePrefs();
    p.history = [
      ate("1", "2026-04-05T12:00:00.000Z", "川菜"),
      ate("2", "2026-04-12T12:00:00.000Z", "川菜"), // 7 天跨度, 2 次 -> 2/7*7=2 次/周
    ];
    const profile = buildUserProfile(p);
    expect(profile.diningFrequency).toBe(2);
    // 单条 -> 0
    p.history = [ate("1", "2026-04-05T12:00:00.000Z", "川菜")];
    expect(buildUserProfile(p).diningFrequency).toBe(0);
  });

  it("TC-L1-PROF-005: suggestTasteCandidates 只保留已知菜系 + 达到 minVisits + 未在 tastePreferences 中", () => {
    const p = basePrefs();
    p.tastePreferences = ["日料"]; // 已经选了日料,不该再建议
    p.history = [
      // 川菜 3 次 (命中)
      ate("1", "2026-04-01T12:00:00.000Z", "川菜"),
      ate("2", "2026-04-02T12:00:00.000Z", "蜀香川菜馆"), // 含"川菜"关键词
      ate("3", "2026-04-03T12:00:00.000Z", "川菜"),
      // 日料 3 次 但已选 -> 应被 existing 过滤掉
      ate("4", "2026-04-04T12:00:00.000Z", "日料"),
      ate("5", "2026-04-05T12:00:00.000Z", "日料"),
      ate("6", "2026-04-06T12:00:00.000Z", "日料"),
      // 湘菜 只 1 次 -> 未达 minVisits=2
      ate("7", "2026-04-07T12:00:00.000Z", "湘菜"),
      // 咖啡厅 -> 不在 KNOWN_CUISINE_KEYWORDS
      ate("8", "2026-04-08T12:00:00.000Z", "咖啡厅"),
      ate("9", "2026-04-09T12:00:00.000Z", "咖啡厅"),
    ];
    const candidates = suggestTasteCandidates(p);
    const cats = candidates.map((c) => c.category);
    expect(cats).toContain("川菜");
    expect(cats).not.toContain("日料"); // 已选
    expect(cats).not.toContain("湘菜"); // 未达门槛
    expect(cats).not.toContain("咖啡厅"); // 不在已知
  });

  it("TC-L1-PROF-006: suggestTasteCandidates 支持 minVisits 参数覆盖 + max 参数限量", () => {
    const p = basePrefs();
    // 每个 1 次
    p.history = [
      ate("1", "2026-04-01T12:00:00.000Z", "川菜"),
      ate("2", "2026-04-02T12:00:00.000Z", "湘菜"),
      ate("3", "2026-04-03T12:00:00.000Z", "粤菜"),
      ate("4", "2026-04-04T12:00:00.000Z", "日料"),
      ate("5", "2026-04-05T12:00:00.000Z", "韩餐"),
      ate("6", "2026-04-06T12:00:00.000Z", "火锅"),
    ];
    // minVisits=1, max=3
    const c = suggestTasteCandidates(p, { minVisits: 1, max: 3 });
    expect(c.length).toBe(3);
    // 空 history + 默认参数 -> 空
    expect(suggestTasteCandidates(basePrefs())).toEqual([]);
  });
});
