import { View, Text } from "@tarojs/components";
import type { BudgetConfig } from "@shared/types";
import { budgetUsagePercent } from "@shared/budget";
import "./BudgetBar.scss";

interface BudgetBarProps {
  budget: BudgetConfig;
}

/**
 * 月预算进度条 —— 餐厅卡片上方常驻提示。
 * UI 完全按 DESIGN.md §4 卡片规范: 暖白底, 16px 圆角, 三层阴影,
 * 主数字用 $font-card-title (20px/600) 配次要小字 13px/400。
 * 进度条本身在 0-100% 之内,超 100% 视觉上仍 100% 但徽章里写真实百分比。
 */
export function BudgetBar({ budget }: BudgetBarProps) {
  if (budget.monthlyBudget <= 0) return null;
  const pct = budgetUsagePercent(budget);
  const clamped = Math.min(100, pct);

  return (
    <View className="budget-bar">
      <View className="budget-bar__row">
        <View className="budget-bar__amounts">
          <Text className="budget-bar__remaining">¥{budget.remainingMonthly}</Text>
          <Text className="budget-bar__daily">¥{budget.dailyBudget}/天</Text>
        </View>
        <Text className="budget-bar__pct">{Math.round(pct)}%</Text>
      </View>
      <View className="budget-bar__track">
        <View
          className="budget-bar__fill"
          style={{ width: `${clamped}%` }}
        />
      </View>
    </View>
  );
}
