import type { Restaurant, RecommendationCard, UserPreferences } from "./types";
import { isNotInterested, recentlyAte } from "./storage";
import { buildUserContextSignals, type UserContextSignals } from "./reason-context";
import { calculateBudget } from "./budget";

// 非正餐类别关键词黑名单（兜底过滤，防止 API 层漏网之鱼）
const NON_DINNER_KEYWORDS = ["咖啡", "茶饮", "奶茶", "茶艺", "茶馆", "茶室", "甜品", "冷饮", "饮品", "蛋糕", "冰淇淋", "酒吧", "面包", "烘焙", "饮料", "果汁", "鲜榨"];

function isDinnerEligible(category: string): boolean {
  return !NON_DINNER_KEYWORDS.some((kw) => category.includes(kw));
}

/** 选一个非兜底(category 匹配到的)模板池 */
const CATEGORY_POOL: Record<string, string[]> = {
  中餐: ["家常味道，今天不折腾", "一顿实在饭，吃完回家"],
  快餐: ["快、省、不纠结，就它", "脑子累了，吃一顿就收工"],
  火锅: ["一锅热的，慢慢吃", "想吃热的暖身，约一锅"],
  日料: ["清爽精致，换口味", "一碟寿司加一碗味增汤"],
  烧烤: ["撸串收工，心情能好一截", "烟火气这顿才治愈"],
  西餐: ["偶尔换个节奏", "来块牛排犒劳一下自己"],
  粤菜: ["清淡暖胃，对胃温柔", "喝碗汤再配份肠粉"],
  川菜: ["辣一下提提神", "麻辣解乏，一顿就够"],
  湘菜: ["下饭一顿，吃完满足", "香辣下饭，一个人也够香"],
  面食: ["一碗面，五分钟解决", "吃碗热汤面暖一下"],
  日式拉面: ["一碗热汤面，今晚收工"],
  寿司: ["几片生鱼片，清爽收场"],
  韩料: ["来顿石锅拌饭暖胃", "烤肉一份，解一天班味"],
  东南亚菜: ["换个风味，热带口气", "冬阴功换换心情"],
};

function categoryPool(category: string): string[] | null {
  for (const [key, pool] of Object.entries(CATEGORY_POOL)) {
    if (category.includes(key)) return pool;
  }
  return null;
}

/**
 * 模板降级文案生成器。
 *
 * 这是 LLM 失败时的兜底,但不能再"经典中餐，胃暖心也暖"这种空话了。
 * 哪怕没有 LLM,也要基于用户语境信号挑最强的那个钩子讲出来。
 *
 * 优先级 (命中即返回):
 * 1. "N 天没吃同菜系了" 强钩子
 * 2. 今天刚吃过同菜系 → 换个角度,不强调菜系
 * 3. 步行 ≤ 5 分钟 → "不用绕远路"
 * 4. 人均 ≤ 30 → "不心疼"
 * 5. 预算超人均 → "偶尔犒劳一下自己"
 * 6. 周五/周末 → "不用排队" / "一个人正好"
 * 7. 夜宵时段 → "晚了还开着"
 * 8. 预算紧张 → "还在预算内"
 * 9. 菜系 pool 兜底
 * 10. 终极兜底: "走 N 分钟,人均 ¥P"
 */
function pickReason(r: Restaurant, signals?: UserContextSignals): string {
  const cat = r.category;
  const walk = r.walkMinutes;
  const price = r.avgPrice;

  // 单独选其中一条带着随机性(同种钩子有 2 个变体,避免千篇一律)
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  if (signals) {
    const d = signals.daysSinceCategory;

    // 1. 长期没吃 (5 天以上)
    if (typeof d === "number" && d >= 5) {
      return pick([
        `${d} 天没吃 ${cat} 了，走 ${walk} 分钟就到`,
        `你已经 ${d} 天没碰 ${cat}，这家离你最近`,
      ]);
    }

    // 2. 今天刚吃过
    if (typeof d === "number" && d === 0) {
      return pick([
        `人均 ¥${price}，换个节奏也不亏`,
        `走 ${walk} 分钟换个胃口，不贵`,
      ]);
    }
  }

  // 3. 非常近的店
  if (walk <= 5) {
    return pick([
      `步行 ${walk} 分钟就到，不用绕远路`,
      `走 ${walk} 分钟解决晚饭，回家也早`,
    ]);
  }

  // 4. 便宜到不心疼
  if (price > 0 && price <= 30) {
    return pick([
      `人均 ¥${price}，轻松一顿`,
      `¥${price} 解决一顿，不心疼`,
    ]);
  }

  // 5. 周五 / 周末钩子
  if (signals && (signals.weekday.includes("周末") || signals.weekday === "周五")) {
    return pick([
      `${signals.weekday}也不用抢座，一个人正好`,
      `${signals.weekday} 下班了，走 ${walk} 分钟就到`,
    ]);
  }

  // 6. 夜宵时段
  if (signals && (signals.timeOfDay === "夜宵时段" || signals.timeOfDay === "深夜")) {
    return pick([
      `${signals.timeOfDay}还开着，走 ${walk} 分钟能吃上`,
      `晚了点，走 ${walk} 分钟这家还在营业`,
    ]);
  }

  // 7. 预算紧张/超支
  if (signals?.budgetStatus === "tight" && price <= signals.budgetRemaining) {
    return `人均 ¥${price}，今天预算还够`;
  }
  if (signals?.budgetStatus === "over") {
    return `人均 ¥${price}，这顿别超了`;
  }

  // 8. 按菜系挑 pool + 带一个数字
  const pool = categoryPool(cat);
  if (pool) {
    const line = pick(pool);
    // 若池子里没带数字,尾部补一个
    if (!/\d/.test(line)) {
      return `${line}，走 ${walk} 分钟`;
    }
    return line;
  }

  // 9. 终极兜底
  return `走 ${walk} 分钟就到，人均 ¥${price}`;
}

/** Score a restaurant for ranking (higher = better) */
function score(r: Restaurant, prefs: UserPreferences, dailyCeiling: number): number {
  let s = 0;
  // Rating component (0-10)
  s += (r.rating / 5) * 10;
  // Distance penalty (closer = better)
  if (r.walkMinutes <= 10) s += 8;
  else if (r.walkMinutes <= 15) s += 5;
  else if (r.walkMinutes <= 20) s += 2;
  // Recency penalty
  if (recentlyAte(prefs, r.id)) s -= 15;
  // 预算惩罚 —— 明显超剩余日均的店拉低分,避免月底还推高客单
  if (r.avgPrice > 0 && dailyCeiling > 0) {
    const ratio = r.avgPrice / dailyCeiling;
    if (ratio > 2.5) s -= 12;
    else if (ratio > 1.5) s -= 6;
    else if (ratio <= 0.6) s += 3;
  }
  // 口味偏好硬加分 —— 用户明确表过态的 category 加 6 分,不然 taste 只在 matchScore 的展示里起作用
  if (prefs.tastePreferences.length > 0) {
    const hit = prefs.tastePreferences.some((t) => r.category.includes(t));
    if (hit) s += 6;
  }
  // Add some randomness for variety
  s += Math.random() * 4;
  return s;
}

export function generateRecommendations(
  restaurants: Restaurant[],
  prefs: UserPreferences,
  count = 5,
  excludeIds: Set<string> = new Set()
): RecommendationCard[] {
  // 步行上限硬过滤 —— API 层虽然已经过滤过,但本函数在筛选/切换模式时也会被单独调用,
  // 所以在客户端再守一道,两边一致。空的 walkMinutes 按 80m/min 兜底。
  const walkCap = Math.max(5, prefs.maxWalkMinutes || 15);

  // 预算日均 ceiling —— 供排序/打分时使用,统一口径和 matchScore 那边一致
  const budgetConfig = calculateBudget(prefs);
  const daysLeftInMonth = Math.max(
    1,
    budgetConfig.daysInMonth - budgetConfig.dayOfMonth + 1
  );
  let dailyCeiling: number;
  if (budgetConfig.remainingMonthly <= 0) {
    dailyCeiling = Math.max(20, Math.round(prefs.monthlyBudget / 40));
  } else {
    dailyCeiling = Math.max(
      20,
      Math.round(
        budgetConfig.remainingMonthly / daysLeftInMonth -
          budgetConfig.spentToday
      )
    );
  }

  // Filter
  const eligible = restaurants.filter((r) => {
    if (isNotInterested(prefs, r.id)) return false;
    if (excludeIds.has(r.id)) return false;
    if (!isDinnerEligible(r.category)) return false;
    const w = r.walkMinutes > 0 ? r.walkMinutes : Math.ceil(r.distanceMeters / 80);
    if (w > walkCap) return false;
    // 硬过滤:单人均超剩余日均 3 倍的店直接跳过 (月底还推 ¥300+ 的店是在坑用户)
    if (r.avgPrice > 0 && r.avgPrice > dailyCeiling * 3) return false;
    return true;
  });

  // Score and sort
  const scored = eligible.map((r) => ({ r, s: score(r, prefs, dailyCeiling) }));
  scored.sort((a, b) => b.s - a.s);

  // Take top N —— 每张卡片基于它自己的 category 计算用户语境信号
  const top = scored.slice(0, count).map(({ r }) => {
    const signals = buildUserContextSignals(prefs, r.category);
    return {
      ...r,
      reason: pickReason(r, signals),
    };
  });

  return top;
}
