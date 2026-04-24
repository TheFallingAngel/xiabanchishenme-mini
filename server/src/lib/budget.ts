import type { UserPreferences, BudgetConfig } from "./types";

/** Calculate budget state from preferences and history */
export function calculateBudget(prefs: UserPreferences): BudgetConfig {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7); // YYYY-MM

  const monthlyBudget = prefs.monthlyBudget;
  const dailyBudget = Math.round(monthlyBudget / daysInMonth);

  // Sum spending this month from history
  const ateRecords = prefs.history.filter((h) => h.action === "ate_today");
  const spentThisMonth = ateRecords
    .filter((h) => h.date.startsWith(monthStr))
    .reduce((sum, h) => sum + (h.amount || 0), 0);

  const spentToday = ateRecords
    .filter((h) => h.date.startsWith(todayStr))
    .reduce((sum, h) => sum + (h.amount || 0), 0);

  return {
    monthlyBudget,
    dailyBudget,
    spentThisMonth,
    spentToday,
    remainingMonthly: Math.max(0, monthlyBudget - spentThisMonth),
    remainingToday: Math.max(0, dailyBudget - spentToday),
    daysInMonth,
    dayOfMonth,
  };
}

/** Get budget usage percentage for the month */
export function budgetUsagePercent(config: BudgetConfig): number {
  if (config.monthlyBudget <= 0) return 0;
  return Math.min(100, Math.round((config.spentThisMonth / config.monthlyBudget) * 100));
}

/** Get budget status label */
export function budgetStatus(config: BudgetConfig): { label: string; color: string } {
  const pct = budgetUsagePercent(config);
  const expectedPct = Math.round((config.dayOfMonth / config.daysInMonth) * 100);

  if (pct <= expectedPct * 0.8) return { label: "省着花", color: "text-green-600" };
  if (pct <= expectedPct * 1.1) return { label: "刚刚好", color: "text-gold" };
  if (pct <= expectedPct * 1.3) return { label: "稍超支", color: "text-orange-500" };
  return { label: "超预算", color: "text-deep-red" };
}
