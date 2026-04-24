/** Standardized restaurant data */
export interface Restaurant {
  id: string;
  name: string;
  category: string;
  address: string;
  avgPrice: number;
  rating: number;
  walkMinutes: number;
  distanceMeters: number;
  tel?: string;
  photos?: string[];
  location: { lng: number; lat: number };
  /** 高德 POI 返回的完整 type 串 (如 "餐饮服务;粤菜;茶餐厅") ——
   * 比 category 字段 (取第一段) 信息更密,口味匹配 haystack 用这个 */
  poiType?: string;
  /** 高德 POI 返回的 tag 串 (如 "蛋挞,叉烧,柠檬茶"),口味匹配额外的命中面 */
  poiTag?: string;
}

/** Recommendation card with reason */
export interface RecommendationCard extends Restaurant {
  reason: string;
  matchScore?: number; // 0-100 percentage
  /** 命中的用户口味偏好,供卡片 UI 显示 "为你:川菜 +1" 这种小标签 */
  matchedTastes?: string[];
}

/** User feedback actions */
export type FeedbackAction = "not_interested" | "ate_today" | "favorite";

/** Stored history record */
export interface HistoryRecord {
  restaurantId: string;
  restaurantName: string;
  category: string;
  date: string; // ISO date string
  action: FeedbackAction;
  amount?: number; // optional spend amount
  /** 当时的餐厅头图 (高德 POI photo[0]);为旧记录留空字符串兼容 */
  heroImage?: string;
}

/** Saved location */
export interface SavedLocation {
  name: string;
  address: string;
  lng: number;
  lat: number;
}

export interface FavoriteRecord {
  restaurantId: string;
  restaurantName: string;
  category: string;
  /** 收藏时的餐厅头图,列表页直接用它,比 category-placeholder 更真实 */
  heroImage?: string;
}

/** "不想吃" 记录 —— 跟 FavoriteRecord 对称,用来在"我的"页面渲染可管理列表 */
export interface NotInterestedRecord {
  restaurantId: string;
  restaurantName: string;
  category: string;
  heroImage?: string;
  /** 被标记的时刻 —— 用来排序/展示"X 天前标的" */
  notedAt: string;
}

/**
 * 推荐打分权重 —— 4 维可调,freshness 仍固定为 10 (避免让用户推荐"昨天刚吃的那家")。
 * 滑杆值 0-100,求和后按比例归一到 0.9 分 (剩 0.1 留给 freshness)。默认对齐老 WEIGHTS。
 * 高级模式解锁 (advancedUnlocked) 后才允许调整;非解锁状态默认 undefined,走老逻辑。
 */
export interface ScoringWeights {
  taste: number;    // default 30
  distance: number; // default 25
  budget: number;   // default 20
  rating: number;   // default 15
}

/**
 * 模式门槛 —— 骰子次数上限 / 列表模式最多展示多少家。
 * 未定义时用硬编码默认 (3 / 6),解锁后允许在 "我的" 页面调整。
 */
export interface ModeSettings {
  diceMaxAttempts: number; // default 3, 合法范围 1-6
  listModeCap: number;     // default 6, 合法范围 3-12
}

/** Local preferences stored in localStorage */
export interface UserPreferences {
  savedLocations: SavedLocation[];
  currentLocation: SavedLocation | null;
  notInterested: Record<string, string>; // restaurantId -> expiry ISO string
  /** 我的页面需要列出"不想吃"的餐厅,所以要一起存名字/头图等展示字段 */
  notInterestedDetails?: Record<string, NotInterestedRecord>;
  history: HistoryRecord[];
  favorites: string[]; // restaurantId[]
  favoriteDetails: Record<string, FavoriteRecord>;
  // Phase 4 additions
  tastePreferences: string[];
  monthlyBudget: number;
  maxWalkMinutes: number;
  consecutiveDays: number;
  lastVisitDate: string | null;
  advancedUnlocked: boolean;
  /** 累计使用日集合 (YYYY-MM-DD),高级设置解锁的新口径 —— "3 个不同日期打开过 App 即可"。
   *  替代原来基于 consecutiveDays 的"必须连续 3 天"判定 (那个只有触发 savePrefs 才计数,
   *  中间断一天就重置,用户感觉"明明用了好多天却一直没解锁")。最多保留最近 30 天。 */
  visitDates?: string[];
  // Reviews feature (Phase 2 add-on)
  nickname?: string; // 用户自己填的昵称,评价时用
  myReviewIds?: string[]; // 本地记录自己写过的评价 id,允许删除
  /** 高级解锁后的推荐权重自定义 —— undefined 则走硬编码默认 */
  scoringWeights?: ScoringWeights;
  /** 高级解锁后的模式门槛自定义 —— undefined 则走硬编码默认 */
  modeSettings?: ModeSettings;
}

/** 评价记录 —— 存在 Vercel KV 里,跨用户共享可见 */
export interface ReviewRecord {
  id: string; // uuid
  restaurantId: string;
  nickname: string;
  rating: number; // 1-5
  text: string;
  imageUrls: string[];
  createdAt: number; // Date.now() 毫秒
  /** 设备级匿名 ID (方案 A),仅用于"这条记录属于谁",不用于鉴权。老记录没有这个字段。 */
  deviceId?: string;
}

/**
 * 招牌菜用户上传照片 —— 存在 Vercel KV 里,按 restaurantId 聚合,跨用户共享。
 * 一家店一个 list,每条记录挂到一个具体 dishName 上,在详情页的招牌菜网格里替换 POI 原图。
 * 为什么不按 dishName 单独拆 key:
 *   · 菜名同义变种太多("水煮鱼/水煮活鱼/招牌水煮鱼"),一条一条拆反而难聚合;
 *   · 一家店总共也就 3-10 个菜,统一存一个 list 更简单。
 */
export interface DishPhotoRecord {
  id: string; // uuid
  restaurantId: string;
  /** 用户上传时选的菜名 —— 必须是当前页面上 POI 解析出来的菜名之一 */
  dishName: string;
  imageUrl: string;
  nickname: string;
  createdAt: number; // Date.now() 毫秒
  /** 设备级匿名 ID (方案 A),仅用于"这条记录属于谁",不用于鉴权。老记录没有这个字段。 */
  deviceId?: string;
}

/** User profile derived from history analysis */
export interface UserProfile {
  topCategories: { category: string; count: number }[];
  avgSpend: number;
  totalMeals: number;
  diningFrequency: number; // meals per week
  preferredDistance: number; // avg walk minutes
}

/** Budget configuration */
export interface BudgetConfig {
  monthlyBudget: number;
  dailyBudget: number;
  spentThisMonth: number;
  spentToday: number;
  remainingMonthly: number;
  remainingToday: number;
  daysInMonth: number;
  dayOfMonth: number;
}

/** Match score breakdown */
export interface MatchScoreResult {
  total: number; // 0-100
  taste: number;
  distance: number;
  budget: number;
  rating: number;
  freshness: number;
  /** 本家店命中了用户哪些口味偏好,UI 用来在卡片上显示 "中:川菜" 小标签 */
  matchedTastes?: string[];
}
