"use client";

import {
  UtensilsCrossed,
  Flame,
  Soup,
  Coffee,
  Sandwich,
  Salad,
  Fish,
  Beef,
  type LucideIcon,
} from "lucide-react";

/** 根据餐厅分类返回对应图标和渐变色 */
const CATEGORY_STYLES: {
  keywords: string[];
  icon: LucideIcon;
  gradient: string;
}[] = [
  {
    keywords: ["火锅"],
    icon: Flame,
    gradient: "from-red-100 via-orange-50 to-amber-50",
  },
  {
    keywords: ["拉面", "面", "粉", "汤"],
    icon: Soup,
    gradient: "from-amber-50 via-yellow-50 to-orange-50",
  },
  {
    keywords: ["快餐", "汉堡", "三明治"],
    icon: Sandwich,
    gradient: "from-yellow-50 via-amber-50 to-orange-50",
  },
  {
    keywords: ["日料", "寿司", "鱼", "海鲜"],
    icon: Fish,
    gradient: "from-sky-50 via-blue-50 to-cyan-50",
  },
  {
    keywords: ["烧烤", "烤", "牛肉", "牛排"],
    icon: Beef,
    gradient: "from-orange-50 via-red-50 to-amber-50",
  },
  {
    keywords: ["沙拉", "轻食", "清淡"],
    icon: Salad,
    gradient: "from-green-50 via-emerald-50 to-lime-50",
  },
  {
    keywords: ["咖啡", "茶", "饮"],
    icon: Coffee,
    gradient: "from-amber-50 via-yellow-50 to-stone-50",
  },
];

function getStyle(category: string) {
  for (const style of CATEGORY_STYLES) {
    if (style.keywords.some((k) => category.includes(k))) {
      return style;
    }
  }
  return {
    icon: UtensilsCrossed,
    gradient: "from-cream-warm via-cream to-cream-dark",
  };
}

interface FoodPlaceholderProps {
  category: string;
  /** 图标尺寸 */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { icon: 20, container: "" },
  md: { icon: 36, container: "" },
  lg: { icon: 48, container: "" },
};

export default function FoodPlaceholder({
  category,
  size = "lg",
  className = "",
}: FoodPlaceholderProps) {
  const { icon: Icon, gradient } = getStyle(category);
  const s = SIZES[size];

  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br ${gradient} ${className}`}
    >
      <Icon
        size={s.icon}
        className="text-ink-hint/30"
        strokeWidth={1.2}
      />
    </div>
  );
}

/** 圆形缩略图版本 */
export function FoodThumbnail({
  category,
  className = "",
}: {
  category: string;
  className?: string;
}) {
  const { icon: Icon, gradient } = getStyle(category);
  return (
    <div
      className={`w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br ${gradient} flex-shrink-0 ${className}`}
    >
      <Icon size={22} className="text-ink-hint/40" strokeWidth={1.4} />
    </div>
  );
}
