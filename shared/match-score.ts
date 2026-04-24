import type {
  Restaurant,
  UserPreferences,
  MatchScoreResult,
  ScoringWeights,
} from "./types";
import { recentlyAte } from "./storage";
import { calculateBudget } from "./budget";

/** 权重向量类型 —— 5 维打分最终归一化后的系数。 */
type WeightsVector = {
  taste: number;
  distance: number;
  budget: number;
  rating: number;
  freshness: number;
};

/** 默认权重 (对齐老逻辑),对应滑杆默认值的归一化形式。freshness 固定 0.10 不给用户调。 */
const DEFAULT_WEIGHTS: WeightsVector = {
  taste: 0.30,
  distance: 0.25,
  budget: 0.20,
  rating: 0.15,
  freshness: 0.10,
};

/**
 * 依据 prefs.scoringWeights (0-100 滑杆值) 归一到"四维累计 0.9 分、freshness 固定 0.1"的向量。
 * 若 prefs.scoringWeights 未设置,或 4 个值全 0 (防御性),直接用 DEFAULT_WEIGHTS。
 *
 * 为什么 freshness 不给用户调:
 *   - freshness 本质是"避免重复推荐昨天刚吃的那家"的硬约束,降到 0 会让"昨天吃过的" 反复出现
 *     —— 这不是用户偏好题,是体验题。
 *   - 如果解释成"频次偏好",放进权重会让调试复杂度激增 (0 权重 vs "直接过滤" 行为差异很大)。
 *   - 用户真想"多次推荐同一家" 其实去收藏页打开更快。所以 freshness 保留 0.10 固定。
 */
function resolveWeights(prefs: UserPreferences): WeightsVector {
  const sw = prefs.scoringWeights;
  if (!sw) return DEFAULT_WEIGHTS;
  const sum = sw.taste + sw.distance + sw.budget + sw.rating;
  if (!Number.isFinite(sum) || sum <= 0) return DEFAULT_WEIGHTS;
  const norm = 0.9 / sum;
  return {
    taste: sw.taste * norm,
    distance: sw.distance * norm,
    budget: sw.budget * norm,
    rating: sw.rating * norm,
    freshness: 0.1,
  };
}

/** 把滑杆 (0-100) 值反算成"最终百分比占比",给 UI 预览用 —— 总和应约为 100 */
export function weightPercentages(weights?: ScoringWeights): {
  taste: number;
  distance: number;
  budget: number;
  rating: number;
  freshness: number;
} {
  if (!weights) {
    return {
      taste: 30,
      distance: 25,
      budget: 20,
      rating: 15,
      freshness: 10,
    };
  }
  const sum = weights.taste + weights.distance + weights.budget + weights.rating;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { taste: 30, distance: 25, budget: 20, rating: 15, freshness: 10 };
  }
  const scale = 90 / sum;
  return {
    taste: Math.round(weights.taste * scale),
    distance: Math.round(weights.distance * scale),
    budget: Math.round(weights.budget * scale),
    rating: Math.round(weights.rating * scale),
    freshness: 10,
  };
}

/** All known cuisine tags for taste matching */
const CUISINE_TAGS = ["川菜", "粤菜", "日料", "西餐", "火锅", "湘菜", "烧烤", "快餐", "中餐", "海鲜", "韩餐", "东南亚", "面食", "小吃"];

/**
 * 口味偏好 → 相关关键词别名表。
 *
 * 为什么要这张表 (线上反馈 #71): 高德 POI 有时 category 只返回 "中餐厅" 这种粗颗粒,
 * 原来只用 category.includes(pref) 匹配,用户设了"川菜"偏好看了一堆川菜馆却都不加分。
 *
 * 规则:
 *   - key 是用户口味偏好里出现的词 (对齐 CUISINE_TAGS + 更日常的口味词)
 *   - value 是会出现在 category / 餐厅名 / 高德 tags 里的相关关键词
 *   - 匹配逻辑: pref → haystack 命中 pref 或 aliases[pref] 任一 → 算命中
 *
 * 例: 用户选 "川菜",店名叫 "蜀香园" category "中餐厅"
 *   - category 不含"川菜",但命中别名 "蜀"/"辣" → 从 30 分拉到命中分
 */
const CUISINE_ALIASES: Record<string, string[]> = {
  "川菜": ["川", "四川", "成都", "重庆", "蜀", "麻辣", "水煮", "辣子"],
  "湘菜": ["湘", "湖南", "长沙", "剁椒", "小炒黄牛"],
  "粤菜": ["粤", "广东", "潮汕", "顺德", "茶餐厅", "港式", "烧味", "早茶", "点心"],
  "日料": ["日本", "寿司", "刺身", "居酒屋", "拉面", "乌冬", "天妇罗", "鳗鱼", "和食", "铁板烧"],
  "韩餐": ["韩国", "韩式", "石锅", "部队锅", "炸鸡", "烤肉"],
  "西餐": ["意大利", "法式", "西班牙", "牛排", "披萨", "pizza", "pasta", "意面", "牛扒"],
  "火锅": ["串串", "冒菜", "麻辣烫", "牛蛙", "毛肚", "小火锅"],
  "烧烤": ["烤串", "烧鸟", "BBQ", "烤肉"],
  "快餐": ["简餐", "便当", "盖饭", "麦当劳", "肯德基", "kfc", "汉堡"],
  "中餐": ["家常菜", "江浙", "本帮", "东北", "鲁菜", "京菜", "徽菜", "闽菜"],
  "海鲜": ["鱼", "虾", "蟹", "贝", "生蚝", "花蛤", "海产"],
  "东南亚": ["泰", "越南", "新加坡", "马来", "咖喱", "冬阴功", "河粉"],
  "面食": ["面", "拉面", "兰州", "担担", "刀削", "馄饨", "饺子", "水饺"],
  "小吃": ["早点", "夜宵", "小笼", "生煎", "肉夹馍", "煎饼", "锅贴", "馅饼"],
};

/** 构造一个在所有可匹配语料里找关键词的 haystack (category + name + highlight) */
function buildTasteHaystack(restaurant: Restaurant): string {
  // 加空格隔开,别让 category 末尾粘住 name 开头造成假命中
  // haystack 扩展 (#73 后续): category 只有第一段"粤菜"/"中餐厅"信息太少,
  // 把 poiType (完整 "餐饮服务;粤菜;茶餐厅") 和 poiTag ("蛋挞,叉烧") 也纳入,
  // 捕获 "茶餐厅在 category 显示成中餐厅但 tag 里带粤" 这种情况
  return [
    restaurant.category,
    restaurant.name,
    restaurant.poiType || "",
    restaurant.poiTag || "",
  ].filter(Boolean).join(" ");
}

/**
 * Calculate taste match score.
 *
 * 匹配策略升级 (#71 + 本次):
 *   1. 在 haystack = category + name + poiType + poiTag 里查 pref 本身
 *   2. miss 则查别名表 CUISINE_ALIASES[pref] 里任一词
 *   3. 按命中数打分:
 *      · 无偏好 → 70 (中性)
 *      · 命中 0 个 → 15 (比原来 30 更狠,真推不感兴趣的品类会掉下去)
 *      · 命中 1 个 → 95
 *      · 命中 2 个 → 110 (爆表值,让"同时喜欢川菜和湘菜"的店顶到前)
 *      · 命中 3+ → 120
 *
 * 返回 { score, matchedPrefs:该店命中的用户偏好数组 }
 * 供 UI 在卡片上显示 "中:川菜·湘菜" 这种解释标签
 */
function tasteDimension(
  restaurant: Restaurant,
  tastePrefs: string[]
): { score: number; matchedPrefs: string[] } {
  if (tastePrefs.length === 0) return { score: 70, matchedPrefs: [] };
  // toLowerCase 不影响中文字符,但能处理 "pizza"/"KFC" 这种英文别名
  const hay = buildTasteHaystack(restaurant).toLowerCase();
  const matchedPrefs: string[] = [];
  for (const pref of tastePrefs) {
    const p = pref.trim();
    if (!p) continue;
    const pLow = p.toLowerCase();
    const hitSelf = hay.includes(pLow);
    const aliases = CUISINE_ALIASES[p];
    const hitAlias = aliases?.some((a) => hay.includes(a.toLowerCase())) ?? false;
    if (hitSelf || hitAlias) matchedPrefs.push(p);
  }
  let score: number;
  if (matchedPrefs.length === 0) score = 15;
  else if (matchedPrefs.length === 1) score = 95;
  else if (matchedPrefs.length === 2) score = 110;
  else score = 120;
  return { score, matchedPrefs };
}

/** Calculate distance score (0-100) based on maxWalkMinutes */
function distanceDimension(walkMinutes: number, maxWalk: number): number {
  if (walkMinutes <= maxWalk * 0.5) return 100;
  if (walkMinutes <= maxWalk * 0.75) return 85;
  if (walkMinutes <= maxWalk) return 65;
  if (walkMinutes <= maxWalk * 1.3) return 35;
  return 10;
}

/** Calculate budget score (0-100) */
function budgetDimension(avgPrice: number, dailyBudget: number): number {
  if (avgPrice <= 0) return 70; // unknown price = neutral
  const ratio = avgPrice / dailyBudget;
  if (ratio <= 0.6) return 100;
  if (ratio <= 0.8) return 85;
  if (ratio <= 1.0) return 65;
  if (ratio <= 1.3) return 40;
  return 15;
}

/** Calculate rating score (0-100) */
function ratingDimension(rating: number): number {
  if (rating <= 0) return 50; // unknown rating
  return Math.min(100, (rating / 5) * 100);
}

/** Calculate freshness score (0-100) — penalize recently eaten */
function freshnessDimension(restaurantId: string, prefs: UserPreferences): number {
  if (recentlyAte(prefs, restaurantId, 1)) return 10;
  if (recentlyAte(prefs, restaurantId, 3)) return 35;
  if (recentlyAte(prefs, restaurantId, 7)) return 60;
  return 100;
}

/** Calculate comprehensive match score for a restaurant */
export function calculateMatchScore(
  restaurant: Restaurant,
  prefs: UserPreferences
): MatchScoreResult {
  // 预算打分用 "剩余日均" —— 如果月底已超支,日均实际上是 0,
  // 这时应该用更保守的 ceiling 去比,而不是还让 ¥200/人的店拿到 100 分。
  // 口径:
  //   1. 默认 ceiling = 本月剩余预算 / 剩余天数,这样月初多花一点不会马上惩罚所有店,
  //      月底紧了再按真实剩余去卡。
  //   2. 如果已经超月预算,ceiling 降到 monthlyBudget/40 (大约是原始日均的 3/4),
  //      此时 ¥30 便宜店还能打高分,¥200 的店会直接被拉到最低档。
  //   3. ceiling 至少 20 元,防止被除零 / 被"一天花爆"事件单点打死。
  const budgetConfig = calculateBudget(prefs);
  const daysLeftInMonth = Math.max(
    1,
    budgetConfig.daysInMonth - budgetConfig.dayOfMonth + 1
  );
  let dailyCeiling: number;
  if (budgetConfig.remainingMonthly <= 0) {
    dailyCeiling = Math.max(20, Math.round(prefs.monthlyBudget / 40));
  } else {
    const projected = budgetConfig.remainingMonthly / daysLeftInMonth;
    // 减去今天已花,今天就别再推荐贵餐厅
    const afterToday = Math.max(
      20,
      Math.round(projected - budgetConfig.spentToday)
    );
    dailyCeiling = afterToday;
  }

  const tasteResult = tasteDimension(restaurant, prefs.tastePreferences);
  const taste = tasteResult.score;
  const distance = distanceDimension(restaurant.walkMinutes, prefs.maxWalkMinutes);
  const budget = budgetDimension(restaurant.avgPrice, dailyCeiling);
  const rating = ratingDimension(restaurant.rating);
  const freshness = freshnessDimension(restaurant.id, prefs);

  const w = resolveWeights(prefs);
  // total clamp 到 [0, 100] —— taste 可以爆表到 120 给排序加权用,但展示上不超过 100
  const totalRaw =
    taste * w.taste +
    distance * w.distance +
    budget * w.budget +
    rating * w.rating +
    freshness * w.freshness;
  const total = Math.min(100, Math.round(totalRaw));

  return {
    total,
    taste,
    distance,
    budget,
    rating,
    freshness,
    matchedTastes: tasteResult.matchedPrefs,
  };
}

/** Get a human-readable label for score range */
export function scoreLabel(score: number): string {
  if (score >= 85) return "超级匹配";
  if (score >= 70) return "很合适";
  if (score >= 55) return "还不错";
  if (score >= 40) return "可以试试";
  return "随缘吧";
}

export { CUISINE_TAGS, CUISINE_ALIASES };

/**
 * 单个口味偏好是否命中某家餐厅 (基于 category + name + 可选 highlight 的 haystack)。
 *
 * 供两处复用:
 *   - match-score.tasteDimension 里的打分
 *   - reason-context.tasteHit 里喂给 LLM 的"对胃口"信号
 *
 * 为什么不直接用 sameCategory: 同类判定要严格 (川菜 vs 湘菜 不是同类);
 * 口味命中判定要宽 (中餐厅·蜀香园 对 "川菜" 偏好应该算命中)。
 */
export function tasteMatches(
  pref: string,
  haystackParts: Array<string | undefined | null>
): boolean {
  const p = pref.trim();
  if (!p) return false;
  const hay = haystackParts
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  if (!hay) return false;
  if (hay.includes(p.toLowerCase())) return true;
  const aliases = CUISINE_ALIASES[p];
  if (!aliases) return false;
  return aliases.some((alias) => hay.includes(alias.toLowerCase()));
}
