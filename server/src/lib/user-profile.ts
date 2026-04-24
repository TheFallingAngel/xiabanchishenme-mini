import type { UserPreferences, UserProfile } from "./types";

/** 已知的菜系/口味关键词 —— 用于从复合 category ("川菜;粤菜") 里过滤出可沉淀的口味 */
const KNOWN_CUISINE_KEYWORDS = [
  "川菜",
  "粤菜",
  "日料",
  "西餐",
  "火锅",
  "湘菜",
  "烧烤",
  "快餐",
  "海鲜",
  "韩餐",
  "东南亚",
  "面食",
  "小吃",
  "中餐",
];

/** Analyze user dining history to build profile */
export function buildUserProfile(prefs: UserPreferences): UserProfile {
  const ateRecords = prefs.history.filter((h) => h.action === "ate_today");

  // Count categories
  const categoryCount: Record<string, number> = {};
  for (const record of ateRecords) {
    // Split compound categories like "川菜;湘菜"
    const cats = record.category.split(/[;；,，/]/).map((c) => c.trim()).filter(Boolean);
    for (const cat of cats) {
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }
  }
  const topCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  // Average spend
  const withAmount = ateRecords.filter((r) => r.amount && r.amount > 0);
  const avgSpend = withAmount.length > 0
    ? Math.round(withAmount.reduce((sum, r) => sum + (r.amount || 0), 0) / withAmount.length)
    : 0;

  // Dining frequency (meals per week)
  const totalMeals = ateRecords.length;
  let diningFrequency = 0;
  if (totalMeals >= 2) {
    const dates = ateRecords.map((r) => new Date(r.date).getTime());
    const earliest = Math.min(...dates);
    const latest = Math.max(...dates);
    const daySpan = Math.max(1, (latest - earliest) / (1000 * 60 * 60 * 24));
    diningFrequency = Math.round((totalMeals / daySpan) * 7 * 10) / 10;
  }

  // Preferred distance — would need restaurant data joined, use default
  const preferredDistance = prefs.maxWalkMinutes;

  return {
    topCategories,
    avgSpend,
    totalMeals,
    diningFrequency,
    preferredDistance,
  };
}

/**
 * 从历史足迹沉淀口味建议:
 * - 取去过 >= 2 次的菜系
 * - 排除已经在 tastePreferences 的
 * - 最多返回 top 5,按次数倒序
 * - 只保留命中 KNOWN_CUISINE_KEYWORDS 的,避免把"咖啡厅""茶饮"这种当成口味推给用户
 *
 * 用法:我的页面把这些作为 "建议加入" 芯片展示,用户点一下才真的写入 tastePreferences。
 * 故意不自动合并,避免用户的偏好被历史"悄悄污染"。
 */
export function suggestTasteCandidates(
  prefs: UserPreferences,
  { minVisits = 2, max = 5 }: { minVisits?: number; max?: number } = {}
): { category: string; count: number }[] {
  const ateRecords = prefs.history.filter((h) => h.action === "ate_today");
  if (ateRecords.length === 0) return [];

  const existing = new Set(prefs.tastePreferences);
  const count: Record<string, number> = {};
  for (const rec of ateRecords) {
    // 把 "川菜;湘菜" 拆开分别计数,但只保留已知口味关键词
    const tokens = rec.category
      .split(/[;；,，/]/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const tok of tokens) {
      // 用 "包含" 匹配,兼容 "川菜馆" / "湘菜馆" 这种后缀
      const matched = KNOWN_CUISINE_KEYWORDS.find((kw) => tok.includes(kw));
      if (!matched) continue;
      if (existing.has(matched)) continue;
      count[matched] = (count[matched] || 0) + 1;
    }
  }

  return Object.entries(count)
    .filter(([, n]) => n >= minVisits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([category, n]) => ({ category, count: n }));
}
