/**
 * L1 单元测试 —— src/lib/budget.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-BUDG-001..014 (14 条)
 *
 * 时间源: 2026-04-19 20:00 +08:00 (FAKE_NOW, see tests/setup.ts)
 * 关键: calculateBudget 依赖 new Date() 拿今天/月份,所以用例都围绕 "2026-04-19 + 30 天/月" 展开
 */
import { describe, expect, it } from "vitest";
import {
  calculateBudget,
  budgetUsagePercent,
  budgetStatus,
} from "./budget";
import type { UserPreferences, BudgetConfig, HistoryRecord } from "./types";

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

function ate(restaurantId: string, date: string, amount?: number): HistoryRecord {
  return {
    restaurantId,
    restaurantName: "r",
    category: "c",
    date,
    action: "ate_today",
    amount,
  };
}

describe("budget.ts — L1 单元测试 (TC-L1-BUDG-001..014)", () => {
  // ---- calculateBudget ----

  it("TC-L1-BUDG-001: 空 history 返回零花销、满额剩余", () => {
    const p = basePrefs();
    p.monthlyBudget = 3000;
    const c = calculateBudget(p);
    expect(c.monthlyBudget).toBe(3000);
    expect(c.spentThisMonth).toBe(0);
    expect(c.spentToday).toBe(0);
    expect(c.remainingMonthly).toBe(3000);
    expect(c.daysInMonth).toBe(30); // 2026-04 有 30 天
    expect(c.dayOfMonth).toBe(19);
  });

  it("TC-L1-BUDG-002: dailyBudget = round(monthly/daysInMonth)", () => {
    const p = basePrefs();
    p.monthlyBudget = 3000;
    const c = calculateBudget(p);
    expect(c.dailyBudget).toBe(100); // 3000/30
  });

  it("TC-L1-BUDG-003: spentThisMonth 按 YYYY-MM 前缀累加", () => {
    const p = basePrefs();
    p.history = [
      ate("r1", "2026-04-01T12:00:00.000Z", 50),
      ate("r2", "2026-04-18T12:00:00.000Z", 80),
      ate("r3", "2026-03-30T12:00:00.000Z", 999), // 上个月不算
    ];
    const c = calculateBudget(p);
    expect(c.spentThisMonth).toBe(130);
    expect(c.remainingMonthly).toBe(3000 - 130);
  });

  it("TC-L1-BUDG-004: spentToday 只累加今天的记录", () => {
    const p = basePrefs();
    p.history = [
      ate("r1", "2026-04-19T03:00:00.000Z", 45), // 今天 (UTC 口径,因为代码用 toISOString)
      ate("r2", "2026-04-18T12:00:00.000Z", 80), // 昨天
    ];
    const c = calculateBudget(p);
    expect(c.spentToday).toBe(45);
  });

  it("TC-L1-BUDG-005: 只计 action === ate_today 的记录", () => {
    const p = basePrefs();
    p.history = [
      ate("r1", "2026-04-19T03:00:00.000Z", 45),
      { restaurantId: "r2", restaurantName: "x", category: "c", date: "2026-04-19T03:00:00.000Z", action: "favorite", amount: 9999 },
      { restaurantId: "r3", restaurantName: "x", category: "c", date: "2026-04-19T03:00:00.000Z", action: "not_interested", amount: 9999 },
    ];
    const c = calculateBudget(p);
    expect(c.spentToday).toBe(45);
    expect(c.spentThisMonth).toBe(45);
  });

  it("TC-L1-BUDG-006: amount 为 undefined 时当 0 处理,不抛错", () => {
    const p = basePrefs();
    p.history = [
      ate("r1", "2026-04-19T03:00:00.000Z", undefined),
      ate("r2", "2026-04-19T03:00:00.000Z", 30),
    ];
    const c = calculateBudget(p);
    expect(c.spentToday).toBe(30);
  });

  it("TC-L1-BUDG-007: remainingMonthly/remainingToday 下限为 0 (不会变负)", () => {
    const p = basePrefs();
    p.monthlyBudget = 100;
    p.history = [ate("r1", "2026-04-19T03:00:00.000Z", 500)];
    const c = calculateBudget(p);
    expect(c.remainingMonthly).toBe(0);
    expect(c.remainingToday).toBe(0);
  });

  // ---- budgetUsagePercent ----

  it("TC-L1-BUDG-008: budgetUsagePercent 正常计算 + 100 封顶", () => {
    const c: BudgetConfig = {
      monthlyBudget: 1000, dailyBudget: 33,
      spentThisMonth: 500, spentToday: 0,
      remainingMonthly: 500, remainingToday: 33,
      daysInMonth: 30, dayOfMonth: 15,
    };
    expect(budgetUsagePercent(c)).toBe(50);
    c.spentThisMonth = 1500;
    expect(budgetUsagePercent(c)).toBe(100);
  });

  it("TC-L1-BUDG-009: monthlyBudget <= 0 时返回 0 而不是 NaN", () => {
    const c: BudgetConfig = {
      monthlyBudget: 0, dailyBudget: 0,
      spentThisMonth: 100, spentToday: 0,
      remainingMonthly: 0, remainingToday: 0,
      daysInMonth: 30, dayOfMonth: 15,
    };
    expect(budgetUsagePercent(c)).toBe(0);
  });

  // ---- budgetStatus ----

  it("TC-L1-BUDG-010: 花得很省 -> '省着花' 绿色", () => {
    // dayOfMonth=15, daysInMonth=30 -> expected=50%. pct<=40% 属于 "省着花"
    const c: BudgetConfig = {
      monthlyBudget: 1000, dailyBudget: 33,
      spentThisMonth: 300, spentToday: 0, remainingMonthly: 700, remainingToday: 33,
      daysInMonth: 30, dayOfMonth: 15,
    };
    const s = budgetStatus(c);
    expect(s.label).toBe("省着花");
    expect(s.color).toContain("green");
  });

  it("TC-L1-BUDG-011: 花得接近预期 -> '刚刚好' 金色", () => {
    const c: BudgetConfig = {
      monthlyBudget: 1000, dailyBudget: 33,
      spentThisMonth: 500, spentToday: 0, remainingMonthly: 500, remainingToday: 33,
      daysInMonth: 30, dayOfMonth: 15,
    };
    const s = budgetStatus(c);
    expect(s.label).toBe("刚刚好");
    expect(s.color).toContain("gold");
  });

  it("TC-L1-BUDG-012: 稍超支 -> orange", () => {
    // expected=50, pct=60 (501/1000) -> 60 <= 50*1.3=65 命中 "稍超支"
    const c: BudgetConfig = {
      monthlyBudget: 1000, dailyBudget: 33,
      spentThisMonth: 600, spentToday: 0, remainingMonthly: 400, remainingToday: 33,
      daysInMonth: 30, dayOfMonth: 15,
    };
    const s = budgetStatus(c);
    expect(s.label).toBe("稍超支");
    expect(s.color).toContain("orange");
  });

  it("TC-L1-BUDG-013: 严重超预算 -> '超预算' 深红", () => {
    const c: BudgetConfig = {
      monthlyBudget: 1000, dailyBudget: 33,
      spentThisMonth: 900, spentToday: 0, remainingMonthly: 100, remainingToday: 33,
      daysInMonth: 30, dayOfMonth: 15,
    };
    const s = budgetStatus(c);
    expect(s.label).toBe("超预算");
    expect(s.color).toContain("deep-red");
  });

  it("TC-L1-BUDG-014: 月初 dayOfMonth=1 时 expected=3%,很容易进'稍超支/超预算'档", () => {
    // 2026-04-01, 一天花光月预算
    const p = basePrefs();
    p.monthlyBudget = 1000;
    p.history = [ate("r1", "2026-04-19T03:00:00.000Z", 1000)];
    const c = calculateBudget(p);
    const s = budgetStatus(c);
    // 花到 100% 必然是"超预算"
    expect(s.label).toBe("超预算");
    // sanity: remainingMonthly 不会变负
    expect(c.remainingMonthly).toBe(0);
  });
});
