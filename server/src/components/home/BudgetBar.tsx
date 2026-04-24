"use client";

import type { BudgetConfig } from "@/lib/types";
import { budgetUsagePercent } from "@/lib/budget";

interface BudgetBarProps {
  budget: BudgetConfig;
}

export function BudgetBar({ budget }: BudgetBarProps) {
  const pct = budgetUsagePercent(budget);

  if (budget.monthlyBudget <= 0) return null;

  return (
    <div className="mx-4 mb-4 bg-white rounded-2xl px-4 py-3 shadow-card border border-gray-50">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-secondary">¥{budget.remainingMonthly}</span>
          <span className="text-xs text-muted">¥{budget.dailyBudget}/天</span>
        </div>
        <span className="text-xs font-medium text-gold">{Math.round(pct)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gold transition-all duration-500"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
