/**
 * 把 UserPreferences + 当下时间 → 浓缩成 LLM / 模板共用的"用户语境"信号。
 *
 * 核心设计:
 * 1. 历史钩子:距上次吃同菜系几天;最近几顿的菜系序列。
 * 2. 当下场景:周几、时段、(未来可扩) 天气心情。
 * 3. 钱包:剩余预算、本月趋势是"紧张"还是"宽松"。
 *
 * 这些信号同时喂给:
 *   · MiniMax (src/lib/minimax.ts) 作为 prompt 变量
 *   · 模板降级文案 (src/lib/recommend.ts) 让兜底也能"说人话"
 */

import type { UserPreferences } from "./types";
import { calculateBudget, budgetUsagePercent } from "./budget";
import { tasteMatches } from "./match-score";

export interface UserContextSignals {
  weekday: string;              // "周五" / "周末"
  timeOfDay: string;            // "傍晚" / "晚上" / "深夜"
  /** 距上次吃同菜系天数; undefined = 历史里没吃过这类 */
  daysSinceCategory?: number;
  /** 最近几顿: ["昨天·川菜", "3天前·日料"] */
  recentHistory: string[];
  /** 今日剩余预算(¥),小于 0 时 clamp 到 0 */
  budgetRemaining: number;
  /** 本月钱包节奏 */
  budgetStatus: "relaxed" | "tight" | "over";

  // —— 差异化信号 (解决 LLM 推荐语雷同) ——
  /** 用户 tastePreferences 是否命中该店 category;undefined 表示用户没设口味偏好 */
  tasteHit?: boolean;
  /** 用户选中的口味偏好全量(LLM 里可以被用来"换一家你爱吃的 X") */
  tastePreferences?: string[];
  /** 价格档: budget(≤30) / normal(30-80) / mid(80-150) / premium(>150) */
  priceTier?: "budget" | "normal" | "mid" | "premium";
  /** 步行档: very-close(≤5) / close(≤10) / normal(≤20) / far(>20) */
  walkTier?: "very-close" | "close" | "normal" | "far";
  /** 评分档: high(≥4.5) / normal(4.0-4.5) / low(<4.0) / unrated */
  ratingTier?: "high" | "normal" | "low" | "unrated";
  /** 该店的"突出点"提示词,来自高德 tags / alias / recommend 的精简 */
  highlight?: string;

  // —— 未来迭代槽位(现在不填,prompt 里有判空逻辑) ——
  /** 健康标签: "低油低盐" / "少糖" / "高蛋白" 等 — 未接 */
  healthTags?: string[];
  /** 天气: "小雨" / "降温" / "闷热" — 未接 */
  weather?: string;
  /** 社交推荐: "3 位同事最近去过" / "好友推荐" — 未接 */
  socialHint?: string;
}

function priceTierLabel(avgPrice: number): UserContextSignals["priceTier"] {
  if (!avgPrice || avgPrice <= 0) return undefined;
  if (avgPrice <= 30) return "budget";
  if (avgPrice <= 80) return "normal";
  if (avgPrice <= 150) return "mid";
  return "premium";
}

function walkTierLabel(walkMinutes: number): UserContextSignals["walkTier"] {
  if (!walkMinutes || walkMinutes <= 0) return undefined;
  if (walkMinutes <= 5) return "very-close";
  if (walkMinutes <= 10) return "close";
  if (walkMinutes <= 20) return "normal";
  return "far";
}

function ratingTierLabel(rating: number): UserContextSignals["ratingTier"] {
  if (!rating || rating <= 0) return "unrated";
  if (rating >= 4.5) return "high";
  if (rating >= 4.0) return "normal";
  return "low";
}

function weekdayLabel(d: Date): string {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dow = d.getDay();
  const base = names[dow];
  if (dow === 0 || dow === 6) return `周末(${base})`;
  if (dow === 5) return "周五";
  return base;
}

function timeOfDayLabel(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "深夜";
  if (h < 11) return "上午";
  if (h < 14) return "中午";
  if (h < 17) return "下午";
  if (h < 19) return "傍晚刚下班";
  if (h < 21) return "晚上";
  if (h < 23) return "夜宵时段";
  return "深夜";
}

function daysSinceDate(iso: string, now: Date): number {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/** 友好化的相对日期: 0 -> 今天, 1 -> 昨天, N -> N天前 */
function relativeDay(days: number): string {
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days === 2) return "前天";
  return `${days}天前`;
}

/** 判断餐厅 category 字符串与用户吃过的 category 是否"同类" */
function sameCategory(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // 高德返回经常是 "中餐;川菜" 或 "川菜馆" 这种复合串
  const norm = (s: string) => s.replace(/馆|店|家/g, "");
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

/** 可选的餐厅上下文,用于填充差异化信号(不传则只有用户侧 signals) */
export interface RestaurantSignalInput {
  avgPrice?: number;
  walkMinutes?: number;
  rating?: number;
  /** 餐厅名,用于口味命中兜底 (category="中餐厅" 但店名含"川") */
  name?: string;
  /** 高德 POI 扩展信息的标签 (详情页才拿得到),只取头 2-3 个做 highlight */
  amapTags?: string[];
  alias?: string;
  recommend?: string;
}

/**
 * 生成完整的用户语境信号。
 * now 默认 = new Date(),可注入方便测试。
 * restaurant 可选 — 传了就填 priceTier / walkTier / ratingTier / highlight。
 */
export function buildUserContextSignals(
  prefs: UserPreferences,
  category: string,
  now: Date = new Date(),
  restaurant?: RestaurantSignalInput
): UserContextSignals {
  // —— 最近几顿(限 "ate_today" 的动作,按日期倒序)——
  const ate = prefs.history
    .filter((h) => h.action === "ate_today")
    .slice() // 避免 mutate
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // 同类最近一次
  const lastSame = ate.find((h) => sameCategory(h.category, category));
  const daysSinceCategory = lastSame
    ? daysSinceDate(lastSame.date, now)
    : undefined;

  // 最近 4 顿的 "相对日期·菜系" 摘要
  const recentHistory = ate.slice(0, 4).map((h) => {
    const days = daysSinceDate(h.date, now);
    return `${relativeDay(days)}·${h.category.split(/[;；,，/]/)[0].trim()}`;
  });

  // —— 钱包 ——
  const budget = calculateBudget(prefs);
  const remainingToday = Math.max(0, budget.remainingToday);
  const pct = budgetUsagePercent(budget);
  const expectedPct = Math.round((budget.dayOfMonth / budget.daysInMonth) * 100);
  let budgetStatus: "relaxed" | "tight" | "over" = "relaxed";
  if (pct > expectedPct * 1.3) budgetStatus = "over";
  else if (pct > expectedPct * 1.1) budgetStatus = "tight";

  // —— 差异化信号 ——
  // 1. 口味命中: 用户 tastePreferences 有没有落到本店上 ——
  //    匹配语料 = category + name + amapTags + alias + recommend,用别名表扩展
  //    (比如"川菜"偏好会命中店名含"蜀"/tags 含"麻辣"的店)。
  //    这是 #71 口味偏好匹配范围扩展 的"喂给 LLM 的对应信号",必须和 match-score 对齐,
  //    不然 LLM 说"你爱吃川菜" 但打分没加分,两边信号错位。
  const tastes = (prefs.tastePreferences || []).filter((t) => !!t && t.trim().length > 0);
  const tasteHaystack: Array<string | undefined> = [
    category,
    restaurant?.name,
    ...(restaurant?.amapTags || []),
    restaurant?.alias,
    restaurant?.recommend,
  ];
  const tasteHit = tastes.length > 0
    ? tastes.some((t) => tasteMatches(t, tasteHaystack))
    : undefined;
  const tastePreferences = tastes.length > 0 ? tastes : undefined;

  // 2. 档位: 价格 / 步行 / 评分
  const priceTier = priceTierLabel(restaurant?.avgPrice ?? 0);
  const walkTier = walkTierLabel(restaurant?.walkMinutes ?? 0);
  const ratingTier = ratingTierLabel(restaurant?.rating ?? 0);

  // 3. highlight —— 优先 amapTags 头 2-3 个,其次 alias,最次 recommend(截断)
  let highlight: string | undefined;
  if (restaurant?.amapTags && restaurant.amapTags.length > 0) {
    const tags = restaurant.amapTags
      .filter((t) => !!t && t.trim().length > 0)
      .slice(0, 3);
    if (tags.length > 0) highlight = tags.join("·");
  }
  if (!highlight && restaurant?.alias && restaurant.alias.trim().length > 0) {
    highlight = restaurant.alias.trim().slice(0, 20);
  }
  if (!highlight && restaurant?.recommend && restaurant.recommend.trim().length > 0) {
    // recommend 常常是一大串 "招牌菜; 特色; 人气" 的逗号分隔串,只取头两项
    const parts = restaurant.recommend
      .split(/[;；,，/、]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
    if (parts.length > 0) highlight = parts.join("·");
  }

  const result: UserContextSignals = {
    weekday: weekdayLabel(now),
    timeOfDay: timeOfDayLabel(now),
    daysSinceCategory,
    recentHistory,
    budgetRemaining: remainingToday > 0 ? remainingToday : budget.dailyBudget,
    budgetStatus,
  };
  if (typeof tasteHit === "boolean") result.tasteHit = tasteHit;
  if (tastePreferences) result.tastePreferences = tastePreferences;
  if (priceTier) result.priceTier = priceTier;
  if (walkTier) result.walkTier = walkTier;
  if (ratingTier) result.ratingTier = ratingTier;
  if (highlight) result.highlight = highlight;
  return result;
}
