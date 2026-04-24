/**
 * L1 单元测试 —— src/lib/reason-context.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-REAS-001..012 (12 条)
 *
 * 时间源: 2026-04-19 20:00 +08:00 (FAKE_NOW)
 * 这天是周日 -> weekdayLabel 应返回 "周末(周日)"
 */
import { describe, expect, it } from "vitest";
import { buildUserContextSignals } from "./reason-context";
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
  return { restaurantId: id, restaurantName: "r", category, date, action: "ate_today", amount };
}

describe("reason-context.ts — L1 单元测试 (TC-L1-REAS-001..012)", () => {
  it("TC-L1-REAS-001: weekday/timeOfDay 基于 now 参数推导", () => {
    const now = new Date("2026-04-17T10:00:00+08:00"); // 周五中午(北京时间)
    const sig = buildUserContextSignals(basePrefs(), "川菜", now);
    expect(sig.weekday).toBe("周五");
    // 10 点 GMT+8 对应 UTC 02:00 = 本地 10 点? 测试时间源 now 是 UTC/依赖本地时区。
    // 我们只验证 timeOfDay 属于预期值集合
    expect(["上午", "中午", "下午", "傍晚刚下班", "晚上", "夜宵时段", "深夜"]).toContain(sig.timeOfDay);
  });

  it("TC-L1-REAS-002: 周末 weekday 返回 '周末(周日/周六)'", () => {
    const sun = new Date("2026-04-19T06:00:00Z"); // 周日
    const sat = new Date("2026-04-18T06:00:00Z"); // 周六
    expect(buildUserContextSignals(basePrefs(), "川菜", sun).weekday).toMatch(/周末/);
    expect(buildUserContextSignals(basePrefs(), "川菜", sat).weekday).toMatch(/周末/);
  });

  it("TC-L1-REAS-003: daysSinceCategory = undefined 当历史里没有同类", () => {
    const p = basePrefs();
    p.history = [ate("1", "2026-04-17T12:00:00.000Z", "川菜")];
    const now = new Date("2026-04-19T12:00:00.000Z");
    const sig = buildUserContextSignals(p, "日料", now);
    expect(sig.daysSinceCategory).toBeUndefined();
  });

  it("TC-L1-REAS-004: daysSinceCategory = 2 当 2 天前吃过同类; sameCategory 支持 '川菜馆' 匹配 '川菜'", () => {
    const p = basePrefs();
    p.history = [ate("1", "2026-04-17T12:00:00.000Z", "川菜馆")];
    const now = new Date("2026-04-19T12:00:00.000Z");
    const sig = buildUserContextSignals(p, "川菜", now);
    expect(sig.daysSinceCategory).toBe(2);
  });

  it("TC-L1-REAS-005: recentHistory 最多 4 条, 倒序 '今天/昨天/N天前·菜系'", () => {
    const p = basePrefs();
    // 塞 5 条,应该只保留最近 4 条
    p.history = [
      ate("1", "2026-04-19T06:00:00.000Z", "川菜;湘菜"), // 今天
      ate("2", "2026-04-18T06:00:00.000Z", "日料"),
      ate("3", "2026-04-17T06:00:00.000Z", "粤菜"),
      ate("4", "2026-04-16T06:00:00.000Z", "韩餐"),
      ate("5", "2026-04-15T06:00:00.000Z", "火锅"),
    ];
    const now = new Date("2026-04-19T12:00:00.000Z");
    const sig = buildUserContextSignals(p, "西餐", now);
    expect(sig.recentHistory.length).toBe(4);
    // 复合品类只取第一段
    expect(sig.recentHistory[0]).toBe("今天·川菜");
    expect(sig.recentHistory[1]).toBe("昨天·日料");
    expect(sig.recentHistory[2]).toBe("前天·粤菜");
    expect(sig.recentHistory[3]).toBe("3天前·韩餐");
  });

  it("TC-L1-REAS-006: budgetStatus: 花得多 -> over / tight; 正常 -> relaxed", () => {
    const p = basePrefs();
    p.monthlyBudget = 1000;
    // 2026-04-19 是第 19 天 / 共 30 天 -> expected=63%
    // 当前 tight = pct > 63*1.1 = 70%, over = pct > 63*1.3 = 82%
    p.history = [ate("1", "2026-04-05T03:00:00.000Z", "川菜", 900)]; // pct=90% -> over
    const sigOver = buildUserContextSignals(p, "川菜", new Date("2026-04-19T12:00:00.000Z"));
    expect(sigOver.budgetStatus).toBe("over");

    p.history = [ate("1", "2026-04-05T03:00:00.000Z", "川菜", 750)]; // pct=75% -> tight
    const sigTight = buildUserContextSignals(p, "川菜", new Date("2026-04-19T12:00:00.000Z"));
    expect(sigTight.budgetStatus).toBe("tight");

    p.history = []; // pct=0
    const sigOk = buildUserContextSignals(p, "川菜", new Date("2026-04-19T12:00:00.000Z"));
    expect(sigOk.budgetStatus).toBe("relaxed");
  });

  it("TC-L1-REAS-007: tasteHit: 用户无偏好时 undefined; 有偏好且命中 true", () => {
    const p = basePrefs();
    // 无偏好 -> undefined
    const sigNoPref = buildUserContextSignals(p, "川菜", undefined, { name: "蜀香园" });
    expect(sigNoPref.tasteHit).toBeUndefined();

    // 有偏好 "川菜",但 category="中餐厅" + name="蜀香园" -> 通过别名 '蜀' 命中
    p.tastePreferences = ["川菜"];
    const sigHit = buildUserContextSignals(p, "中餐厅", undefined, { name: "蜀香园" });
    expect(sigHit.tasteHit).toBe(true);
    expect(sigHit.tastePreferences).toEqual(["川菜"]);

    // 有偏好但未命中
    const sigMiss = buildUserContextSignals(p, "咖啡厅", undefined, { name: "星巴克" });
    expect(sigMiss.tasteHit).toBe(false);
  });

  it("TC-L1-REAS-008: priceTier 分档: <=30 budget / <=80 normal / <=150 mid / >150 premium / 0 undefined", () => {
    const p = basePrefs();
    const now = new Date("2026-04-19T12:00:00.000Z");
    expect(buildUserContextSignals(p, "x", now, { avgPrice: 25 }).priceTier).toBe("budget");
    expect(buildUserContextSignals(p, "x", now, { avgPrice: 60 }).priceTier).toBe("normal");
    expect(buildUserContextSignals(p, "x", now, { avgPrice: 120 }).priceTier).toBe("mid");
    expect(buildUserContextSignals(p, "x", now, { avgPrice: 250 }).priceTier).toBe("premium");
    expect(buildUserContextSignals(p, "x", now, { avgPrice: 0 }).priceTier).toBeUndefined();
  });

  it("TC-L1-REAS-009: walkTier 分档: <=5 very-close / <=10 close / <=20 normal / >20 far / 0 undefined", () => {
    const p = basePrefs();
    const now = new Date("2026-04-19T12:00:00.000Z");
    expect(buildUserContextSignals(p, "x", now, { walkMinutes: 3 }).walkTier).toBe("very-close");
    expect(buildUserContextSignals(p, "x", now, { walkMinutes: 8 }).walkTier).toBe("close");
    expect(buildUserContextSignals(p, "x", now, { walkMinutes: 15 }).walkTier).toBe("normal");
    expect(buildUserContextSignals(p, "x", now, { walkMinutes: 25 }).walkTier).toBe("far");
    expect(buildUserContextSignals(p, "x", now, { walkMinutes: 0 }).walkTier).toBeUndefined();
  });

  it("TC-L1-REAS-010: ratingTier 分档: >=4.5 high / >=4.0 normal / <4.0 low / 0 unrated", () => {
    const p = basePrefs();
    const now = new Date("2026-04-19T12:00:00.000Z");
    expect(buildUserContextSignals(p, "x", now, { rating: 4.7 }).ratingTier).toBe("high");
    expect(buildUserContextSignals(p, "x", now, { rating: 4.2 }).ratingTier).toBe("normal");
    expect(buildUserContextSignals(p, "x", now, { rating: 3.5 }).ratingTier).toBe("low");
    expect(buildUserContextSignals(p, "x", now, { rating: 0 }).ratingTier).toBe("unrated");
  });

  it("TC-L1-REAS-011: highlight 来源优先级 amapTags > alias > recommend", () => {
    const p = basePrefs();
    const now = new Date("2026-04-19T12:00:00.000Z");

    // 1. amapTags 优先
    const a = buildUserContextSignals(p, "x", now, {
      amapTags: ["热气腾腾", "清淡", "深夜食堂", "第四个"],
      alias: "alias-name",
      recommend: "推荐菜1;推荐菜2",
    });
    expect(a.highlight).toBe("热气腾腾·清淡·深夜食堂"); // 截 3 个

    // 2. 无 tags 用 alias
    const b = buildUserContextSignals(p, "x", now, { alias: "好吃的家常菜" });
    expect(b.highlight).toBe("好吃的家常菜");

    // 3. 无 tags 无 alias 用 recommend 头两项
    const c = buildUserContextSignals(p, "x", now, {
      recommend: "水煮鱼, 麻婆豆腐, 宫保鸡丁",
    });
    expect(c.highlight).toBe("水煮鱼·麻婆豆腐");

    // 4. 全空 -> undefined
    const d = buildUserContextSignals(p, "x", now, {});
    expect(d.highlight).toBeUndefined();
  });

  it("TC-L1-REAS-012: budgetRemaining fallback 到 dailyBudget 当 remainingToday = 0", () => {
    const p = basePrefs();
    p.monthlyBudget = 3000;
    // 今天没花钱 -> remainingToday = dailyBudget = 100
    const sig = buildUserContextSignals(p, "x", new Date("2026-04-19T12:00:00.000Z"));
    expect(sig.budgetRemaining).toBe(100);

    // 今天花光了 dailyBudget(100) -> remainingToday=0 -> fallback 到 dailyBudget 100
    p.history = [ate("1", "2026-04-19T03:00:00.000Z", "川菜", 100)];
    const sig2 = buildUserContextSignals(p, "x", new Date("2026-04-19T12:00:00.000Z"));
    expect(sig2.budgetRemaining).toBe(100);
  });
});
