/**
 * L1 单元测试 —— src/lib/storage.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-STOR-001..022 (22 条)
 *
 * 覆盖目标 ≥ 90% / 90% / 90% (lines/branches/functions)
 * 时间源被 tests/setup.ts 钉在 2026-04-19 20:00+08:00
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPrefs,
  savePrefs,
  markNotInterested,
  unmarkNotInterested,
  clearNotInterested,
  markAteToday,
  updateHistoryAmount,
  removeHistoryRecord,
  toggleFavorite,
  isNotInterested,
  recentlyAte,
  updateTastePreferences,
  updateMonthlyBudget,
  updateMaxWalkMinutes,
  updateNickname,
  addMyReviewId,
  updateScoringWeights,
  resetScoringWeights,
  updateModeSettings,
  resetModeSettings,
} from "./storage";
import type { UserPreferences } from "./types";

/** 每个 case 都先造一个干净的 prefs 基底 */
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

describe("storage.ts — L1 单元测试 (TC-L1-STOR-001..022)", () => {
  // ---- loadPrefs / savePrefs ----

  it("TC-L1-STOR-001: loadPrefs 首次读取返回默认偏好", () => {
    const prefs = loadPrefs();
    expect(prefs.monthlyBudget).toBe(3000);
    expect(prefs.maxWalkMinutes).toBe(15);
    expect(prefs.consecutiveDays).toBe(0);
    expect(prefs.history).toEqual([]);
    expect(prefs.favorites).toEqual([]);
    expect(prefs.advancedUnlocked).toBe(false);
  });

  it("TC-L1-STOR-002: loadPrefs 从 localStorage 恢复并合并缺省字段", () => {
    // 老版本没有 tastePreferences / advancedUnlocked 也应被补齐
    localStorage.setItem(
      "xcm_prefs",
      JSON.stringify({ monthlyBudget: 5000, favorites: ["r1"] })
    );
    const prefs = loadPrefs();
    expect(prefs.monthlyBudget).toBe(5000);
    expect(prefs.favorites).toEqual(["r1"]);
    // 缺省字段要被补出来
    expect(prefs.tastePreferences).toEqual([]);
    expect(prefs.history).toEqual([]);
    expect(prefs.advancedUnlocked).toBe(false);
  });

  it("TC-L1-STOR-003: loadPrefs 遇到坏 JSON 返回默认值而非抛错", () => {
    localStorage.setItem("xcm_prefs", "{corrupted");
    const prefs = loadPrefs();
    expect(prefs.monthlyBudget).toBe(3000);
    expect(prefs.history).toEqual([]);
  });

  it("TC-L1-STOR-004: savePrefs 写入 localStorage 的 xcm_prefs key", () => {
    const p = basePrefs();
    p.monthlyBudget = 4000;
    savePrefs(p);
    const raw = localStorage.getItem("xcm_prefs");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.monthlyBudget).toBe(4000);
  });

  it("TC-L1-STOR-005: savePrefs 裁剪超过 14 天的 history", () => {
    const p = basePrefs();
    // 1 条 20 天前, 1 条 3 天前 (相对固定 now 2026-04-19)
    p.history = [
      { restaurantId: "old", restaurantName: "A", category: "c", date: "2026-03-30T00:00:00.000Z", action: "ate_today" },
      { restaurantId: "new", restaurantName: "B", category: "c", date: "2026-04-16T00:00:00.000Z", action: "ate_today" },
    ];
    savePrefs(p);
    const parsed = JSON.parse(localStorage.getItem("xcm_prefs")!);
    const ids = parsed.history.map((h: any) => h.restaurantId);
    expect(ids).toEqual(["new"]);
  });

  it("TC-L1-STOR-006: savePrefs 清理过期的 notInterested + 同步清 details", () => {
    const p = basePrefs();
    // 一条已过期 (昨天), 一条未过期 (3 天后)
    p.notInterested = {
      expired: "2026-04-18T00:00:00.000Z",
      alive: "2026-04-22T00:00:00.000Z",
    };
    p.notInterestedDetails = {
      expired: { restaurantId: "expired", restaurantName: "E", category: "", notedAt: "" },
      alive:   { restaurantId: "alive",   restaurantName: "A", category: "", notedAt: "" },
      orphan:  { restaurantId: "orphan",  restaurantName: "O", category: "", notedAt: "" }, // 孤儿
    };
    savePrefs(p);
    const parsed = JSON.parse(localStorage.getItem("xcm_prefs")!);
    expect(Object.keys(parsed.notInterested)).toEqual(["alive"]);
    expect(Object.keys(parsed.notInterestedDetails)).toEqual(["alive"]);
  });

  it("TC-L1-STOR-007: savePrefs 连续两天访问 -> consecutiveDays +1; 第三天解锁 advanced", () => {
    // 先钉在 4-17 写一次,再 4-18,再 4-19
    const p = basePrefs();
    p.lastVisitDate = "2026-04-18"; // 昨天
    p.consecutiveDays = 2;
    savePrefs(p);
    const parsed = JSON.parse(localStorage.getItem("xcm_prefs")!);
    expect(parsed.consecutiveDays).toBe(3);
    expect(parsed.advancedUnlocked).toBe(true);
    expect(parsed.lastVisitDate).toBe("2026-04-19");
  });

  it("TC-L1-STOR-008: savePrefs 隔天 > 1 天 -> consecutiveDays 重置为 1", () => {
    const p = basePrefs();
    p.lastVisitDate = "2026-04-10"; // 9 天前
    p.consecutiveDays = 5;
    savePrefs(p);
    const parsed = JSON.parse(localStorage.getItem("xcm_prefs")!);
    expect(parsed.consecutiveDays).toBe(1);
    expect(parsed.advancedUnlocked).toBe(false);
  });

  it("TC-L1-STOR-009: savePrefs 同一天再次调用不改变 consecutiveDays", () => {
    const p = basePrefs();
    p.lastVisitDate = "2026-04-19"; // 今天
    p.consecutiveDays = 3;
    savePrefs(p);
    const parsed = JSON.parse(localStorage.getItem("xcm_prefs")!);
    expect(parsed.consecutiveDays).toBe(3);
  });

  // ---- not interested ----

  it("TC-L1-STOR-010: markNotInterested 加 7 天过期 + 写 details", () => {
    const p = basePrefs();
    const next = markNotInterested(p, "r1", "Sushi", "日料", "pic.jpg");
    // 过期 = 2026-04-26
    expect(next.notInterested.r1.slice(0, 10)).toBe("2026-04-26");
    expect(next.notInterestedDetails?.r1).toMatchObject({
      restaurantId: "r1",
      restaurantName: "Sushi",
      category: "日料",
      heroImage: "pic.jpg",
    });
    // 不污染原对象
    expect(p.notInterested).toEqual({});
  });

  it("TC-L1-STOR-011: markNotInterested 不传 name 时不写 details", () => {
    const next = markNotInterested(basePrefs(), "r1");
    expect(next.notInterested.r1).toBeTruthy();
    expect(next.notInterestedDetails?.r1).toBeUndefined();
  });

  it("TC-L1-STOR-012: unmarkNotInterested 同步清掉 details", () => {
    const p1 = markNotInterested(basePrefs(), "r1", "N", "c", "p");
    const p2 = unmarkNotInterested(p1, "r1");
    expect(p2.notInterested.r1).toBeUndefined();
    expect(p2.notInterestedDetails?.r1).toBeUndefined();
  });

  it("TC-L1-STOR-013: clearNotInterested 一键清空", () => {
    let p = basePrefs();
    p = markNotInterested(p, "r1", "A", "c");
    p = markNotInterested(p, "r2", "B", "c");
    const cleared = clearNotInterested(p);
    expect(cleared.notInterested).toEqual({});
    expect(cleared.notInterestedDetails).toEqual({});
  });

  it("TC-L1-STOR-014: isNotInterested 过期返回 false", () => {
    const p = basePrefs();
    p.notInterested = { alive: "2026-04-30T00:00:00.000Z", dead: "2026-04-18T00:00:00.000Z" };
    expect(isNotInterested(p, "alive")).toBe(true);
    expect(isNotInterested(p, "dead")).toBe(false);
    expect(isNotInterested(p, "missing")).toBe(false);
  });

  // ---- history / markAteToday ----

  it("TC-L1-STOR-015: markAteToday 首次写入到 history 头部", () => {
    const p = basePrefs();
    const next = markAteToday(p, "r1", "麻辣烫", "川菜", 45, "pic.jpg");
    expect(next.history.length).toBe(1);
    expect(next.history[0]).toMatchObject({
      restaurantId: "r1",
      restaurantName: "麻辣烫",
      category: "川菜",
      amount: 45,
      heroImage: "pic.jpg",
      action: "ate_today",
    });
  });

  it("TC-L1-STOR-016: markAteToday 同一天同餐厅合并 —— 金额覆盖,heroImage 保留旧值兜底", () => {
    let p = basePrefs();
    // 第一次: 只写了名字,没有金额
    p = markAteToday(p, "r1", "A", "川", undefined, "old.jpg");
    // 第二次: 补金额,不传 heroImage -> 保留旧 heroImage
    p = markAteToday(p, "r1", "A新名", "新品类", 50, undefined);
    expect(p.history.length).toBe(1);
    expect(p.history[0]).toMatchObject({
      restaurantId: "r1",
      restaurantName: "A新名",
      category: "新品类",
      amount: 50,
      heroImage: "old.jpg",
    });
  });

  it("TC-L1-STOR-017: recentlyAte 3 天内命中; 超过 3 天不命中", () => {
    const p = basePrefs();
    p.history = [
      { restaurantId: "r1", restaurantName: "A", category: "c", date: "2026-04-18T00:00:00.000Z", action: "ate_today" }, // 1 天前
      { restaurantId: "r2", restaurantName: "B", category: "c", date: "2026-04-10T00:00:00.000Z", action: "ate_today" }, // 9 天前
    ];
    expect(recentlyAte(p, "r1")).toBe(true);
    expect(recentlyAte(p, "r2")).toBe(false);
    expect(recentlyAte(p, "missing")).toBe(false);
  });

  it("TC-L1-STOR-018: updateHistoryAmount 精确匹配 id+date 修改金额;未命中时原样返回", () => {
    const p = basePrefs();
    const iso = "2026-04-18T00:00:00.000Z";
    p.history = [{ restaurantId: "r1", restaurantName: "A", category: "c", date: iso, action: "ate_today", amount: 30 }];
    const updated = updateHistoryAmount(p, "r1", iso, 88);
    expect(updated.history[0].amount).toBe(88);
    const noop = updateHistoryAmount(p, "rX", iso, 99);
    expect(noop).toBe(p); // 不命中直接原样
  });

  it("TC-L1-STOR-019: removeHistoryRecord 精确删除;未命中时返回原对象引用", () => {
    const p = basePrefs();
    const iso = "2026-04-18T00:00:00.000Z";
    p.history = [{ restaurantId: "r1", restaurantName: "A", category: "c", date: iso, action: "ate_today" }];
    const removed = removeHistoryRecord(p, "r1", iso);
    expect(removed.history.length).toBe(0);
    const noop = removeHistoryRecord(p, "rX", iso);
    expect(noop).toBe(p);
  });

  // ---- favorites ----

  it("TC-L1-STOR-020: toggleFavorite 首次加入时写 details; 再次调用时移除 + 清 details", () => {
    const p = basePrefs();
    const added = toggleFavorite(p, "r1", "Cafe", "咖啡", "pic.jpg");
    expect(added.favorites).toEqual(["r1"]);
    expect(added.favoriteDetails.r1).toMatchObject({ restaurantName: "Cafe", category: "咖啡" });

    const removed = toggleFavorite(added, "r1", "Cafe", "咖啡");
    expect(removed.favorites).toEqual([]);
    expect(removed.favoriteDetails.r1).toBeUndefined();
  });

  // ---- 小字段 setter + review + weights ----

  it("TC-L1-STOR-021: 小字段 setter (口味/预算/步行/昵称/reviewId) 规则正确", () => {
    let p = basePrefs();
    p = updateTastePreferences(p, ["spicy", "light"]);
    expect(p.tastePreferences).toEqual(["spicy", "light"]);
    p = updateMonthlyBudget(p, 5000);
    expect(p.monthlyBudget).toBe(5000);
    p = updateMaxWalkMinutes(p, 20);
    expect(p.maxWalkMinutes).toBe(20);
    // nickname: trim + slice(0,12)
    p = updateNickname(p, "   超长的昵称应该被截断掉   ");
    expect(p.nickname).toBe("超长的昵称应该被截断掉"); // 11 个中文字符
    // reviewId 去重 + 头插 + 截断 200
    p = addMyReviewId(p, "id1");
    p = addMyReviewId(p, "id2");
    p = addMyReviewId(p, "id1"); // 重复不插
    expect(p.myReviewIds).toEqual(["id2", "id1"]);
  });

  it("TC-L1-STOR-022: 权重/模式门槛 setter 做 clamp + reset 清空字段", () => {
    let p = basePrefs();
    // 权重 clamp 到 0-100
    p = updateScoringWeights(p, { taste: 200, distance: -50, budget: 40.6, rating: 80 });
    expect(p.scoringWeights).toEqual({ taste: 100, distance: 0, budget: 41, rating: 80 });
    p = resetScoringWeights(p);
    expect(p.scoringWeights).toBeUndefined();

    // 模式: diceMax 1-6, listCap 3-12
    p = updateModeSettings(p, { diceMaxAttempts: 10, listModeCap: 1 });
    expect(p.modeSettings).toEqual({ diceMaxAttempts: 6, listModeCap: 3 });
    p = updateModeSettings(p, { diceMaxAttempts: 0, listModeCap: 50 });
    expect(p.modeSettings).toEqual({ diceMaxAttempts: 1, listModeCap: 12 });
    p = resetModeSettings(p);
    expect(p.modeSettings).toBeUndefined();
  });
});
