"use client";

import type {
  UserPreferences,
  HistoryRecord,
  FeedbackAction,
  NotInterestedRecord,
  ScoringWeights,
  ModeSettings,
} from "./types";

const STORAGE_KEY = "xcm_prefs";

const DEFAULT_PREFS: UserPreferences = {
  savedLocations: [],
  currentLocation: null,
  notInterested: {},
  notInterestedDetails: {},
  history: [],
  favorites: [],
  favoriteDetails: {},
  tastePreferences: [],
  monthlyBudget: 3000,
  maxWalkMinutes: 25,
  consecutiveDays: 0,
  lastVisitDate: null,
  advancedUnlocked: false,
  visitDates: [],
};

function cloneDefaultPrefs(): UserPreferences {
  return {
    ...DEFAULT_PREFS,
    savedLocations: [],
    notInterested: {},
    notInterestedDetails: {},
    history: [],
    favorites: [],
    favoriteDetails: {},
    tastePreferences: [],
    visitDates: [],
  };
}

export function loadPrefs(): UserPreferences {
  if (typeof window === "undefined") return cloneDefaultPrefs();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultPrefs();
    // Merge with defaults for backward compatibility
    return { ...cloneDefaultPrefs(), ...JSON.parse(raw) };
  } catch {
    return cloneDefaultPrefs();
  }
}

export function savePrefs(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  // Trim history to 14 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  prefs.history = prefs.history.filter((h) => new Date(h.date) >= cutoff);
  // Trim expired not-interested —— details 同步清理,保证"我的"页面列表不会悬浮一条已过期的记录
  const now = new Date().toISOString();
  if (!prefs.notInterestedDetails) prefs.notInterestedDetails = {};
  for (const [id, expiry] of Object.entries(prefs.notInterested)) {
    if (expiry < now) {
      delete prefs.notInterested[id];
      delete prefs.notInterestedDetails[id];
    }
  }
  // 清掉历史遗留的孤儿 details (notInterested 里已无对应项)
  for (const id of Object.keys(prefs.notInterestedDetails)) {
    if (!prefs.notInterested[id]) delete prefs.notInterestedDetails[id];
  }
  // ---- 使用日统计 (新口径) ----
  // 旧逻辑只看 savePrefs 调用日是否"昨天",用户中间断一天没做保存动作就重置,
  // 表现为"用了很多天但解锁进度还是 1 天"。新逻辑改为"累计独立打开日",
  // 用一个 YYYY-MM-DD 的 Set 记录,只追加不递减;中间断一天也不清零。
  const today = new Date().toISOString().slice(0, 10);
  const visitSet = new Set(prefs.visitDates || []);
  visitSet.add(today);
  // 兼容老数据:之前 consecutiveDays 已经 >= 3 的用户要保留解锁状态,
  // 即使 visitDates 还没攒够 3 个,也 backfill 前几天的占位日
  const legacyCount = Math.max(0, prefs.consecutiveDays || 0);
  if (legacyCount >= 3 && visitSet.size < legacyCount) {
    for (let i = 1; i < Math.min(legacyCount, 30); i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      visitSet.add(d.toISOString().slice(0, 10));
    }
  }
  // 排序后裁剪 —— 只保留最近 30 天,防止数组无界增长
  const sorted = [...visitSet].sort();
  prefs.visitDates = sorted.slice(-30);
  // consecutiveDays 字段保留但语义换成"累计使用天数",profile 页进度文案一起改
  prefs.consecutiveDays = prefs.visitDates.length;
  prefs.lastVisitDate = today;
  // 解锁阈值不变:累计 3 天打开过即可。解锁是单向的,已解锁不会因为任何原因回退
  if (prefs.consecutiveDays >= 3) {
    prefs.advancedUnlocked = true;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * 标记"不想吃" —— 7 天有效期,并把展示字段写进 notInterestedDetails,
 * 这样"我的"页面才能渲染成可管理的列表(带名字/头图/分类)。
 *
 * 兼容旧签名:只传 id 也能用,只是那样"我的"页面列出来就没名字/图了 —— 所以调用方
 * 应尽量把 restaurantName/category/heroImage 都传上。
 */
export function markNotInterested(
  prefs: UserPreferences,
  restaurantId: string,
  restaurantName?: string,
  category?: string,
  heroImage?: string
): UserPreferences {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  const details = { ...(prefs.notInterestedDetails || {}) };
  if (restaurantName) {
    details[restaurantId] = {
      restaurantId,
      restaurantName,
      category: category || "",
      heroImage,
      notedAt: new Date().toISOString(),
    };
  }
  return {
    ...prefs,
    notInterested: { ...prefs.notInterested, [restaurantId]: expiry.toISOString() },
    notInterestedDetails: details,
  };
}

/** 解除某一家的"不想吃" —— "我的"页面每条的"恢复"按钮用 */
export function unmarkNotInterested(
  prefs: UserPreferences,
  restaurantId: string
): UserPreferences {
  const notInterested = { ...prefs.notInterested };
  const notInterestedDetails = { ...(prefs.notInterestedDetails || {}) };
  delete notInterested[restaurantId];
  delete notInterestedDetails[restaurantId];
  return { ...prefs, notInterested, notInterestedDetails };
}

/** 一键清空所有"不想吃" —— "我的"页面的"全部解除"按钮用 */
export function clearNotInterested(prefs: UserPreferences): UserPreferences {
  return { ...prefs, notInterested: {}, notInterestedDetails: {} };
}

/**
 * 记一条"吃过了/去过"动作到足迹。**同一天同一餐厅** 会合并,不会再产生两条记录。
 *
 * 合并规则:
 *   - amount: 新值非 undefined 则覆盖,undefined 则保留旧值
 *     (这样先点"就它了"(无金额)再点"吃过了"(填了金额)能得到一条带金额的记录)
 *   - heroImage: 新值有则覆盖,否则保留旧值
 *   - date: 保持最早那次的 ISO 时间(让足迹显示"最初去过"的时刻),名字/分类用最新值
 *   - 合并后那条记录会被提到 history 最前面,和 append 新记录的视觉行为一致
 *
 * "同一天" 用本地时区的 YYYY-MM-DD 判断(不是 UTC),跨零点后算新的一天。
 */
export function markAteToday(
  prefs: UserPreferences,
  restaurantId: string,
  restaurantName: string,
  category: string,
  amount?: number,
  heroImage?: string
): UserPreferences {
  const now = new Date();
  const todayKey = localDateKey(now);
  // 找出今天已经存在的同餐厅记录(最多一条;历史上可能有多条,取第一条)
  const existingIdx = prefs.history.findIndex(
    (h) => h.restaurantId === restaurantId && localDateKey(new Date(h.date)) === todayKey
  );

  if (existingIdx >= 0) {
    // 合并模式 —— 不新增记录,更新已有那条
    const prev = prefs.history[existingIdx];
    const merged: HistoryRecord = {
      ...prev,
      restaurantName, // 用最新名字/分类,避免 POI 重命名后旧记录继续挂着老名
      category,
      action: "ate_today",
      amount: amount !== undefined ? amount : prev.amount,
      heroImage: heroImage || prev.heroImage,
    };
    const rest = prefs.history.filter((_, i) => i !== existingIdx);
    return { ...prefs, history: [merged, ...rest] };
  }

  // 首次 —— append 新记录到最前
  const record: HistoryRecord = {
    restaurantId,
    restaurantName,
    category,
    date: now.toISOString(),
    action: "ate_today",
    amount,
    heroImage,
  };
  return { ...prefs, history: [record, ...prefs.history] };
}

/** 本地时区的 YYYY-MM-DD,用来判断 "同一天" —— UTC 跨零点会误判 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 更新某条 history 的已花金额 —— 足迹页快速编辑用。
 * 定位方式: restaurantId + date (因为一天可能多条) ,如果找不到就原样返回。
 */
export function updateHistoryAmount(
  prefs: UserPreferences,
  restaurantId: string,
  date: string,
  amount: number | undefined
): UserPreferences {
  const idx = prefs.history.findIndex(
    (h) => h.restaurantId === restaurantId && h.date === date
  );
  if (idx < 0) return prefs;
  const next = [...prefs.history];
  next[idx] = { ...next[idx], amount };
  return { ...prefs, history: next };
}

/**
 * 删除某条 history —— 足迹页管理用。
 * 定位方式和 updateHistoryAmount 一致: restaurantId + date 精确匹配。
 * 找不到就原样返回 (这条已经被自动 trim 或被另一个 tab 删了)。
 */
export function removeHistoryRecord(
  prefs: UserPreferences,
  restaurantId: string,
  date: string
): UserPreferences {
  const next = prefs.history.filter(
    (h) => !(h.restaurantId === restaurantId && h.date === date)
  );
  // 没变化就返回原对象,避免无谓的 setState 触发重渲染
  if (next.length === prefs.history.length) return prefs;
  return { ...prefs, history: next };
}

export function toggleFavorite(
  prefs: UserPreferences,
  restaurantId: string,
  restaurantName?: string,
  category?: string,
  heroImage?: string
): UserPreferences {
  const exists = prefs.favorites.includes(restaurantId);
  const favs = exists
    ? prefs.favorites.filter((id) => id !== restaurantId)
    : [...prefs.favorites, restaurantId];

  const favoriteDetails = { ...prefs.favoriteDetails };
  if (exists) {
    delete favoriteDetails[restaurantId];
  } else if (restaurantName) {
    favoriteDetails[restaurantId] = {
      restaurantId,
      restaurantName,
      category: category || "",
      heroImage,
    };
  }

  return { ...prefs, favorites: favs, favoriteDetails };
}

export function isNotInterested(prefs: UserPreferences, restaurantId: string): boolean {
  const expiry = prefs.notInterested[restaurantId];
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}

export function recentlyAte(prefs: UserPreferences, restaurantId: string, days = 3): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return prefs.history.some(
    (h) => h.restaurantId === restaurantId && h.action === "ate_today" && new Date(h.date) >= cutoff
  );
}

export function updateTastePreferences(prefs: UserPreferences, tastes: string[]): UserPreferences {
  return { ...prefs, tastePreferences: tastes };
}

export function updateMonthlyBudget(prefs: UserPreferences, budget: number): UserPreferences {
  return { ...prefs, monthlyBudget: budget };
}

export function updateMaxWalkMinutes(prefs: UserPreferences, minutes: number): UserPreferences {
  return { ...prefs, maxWalkMinutes: minutes };
}

/** 保存评价昵称 —— 第一次写评价时让用户填一个 */
export function updateNickname(prefs: UserPreferences, nickname: string): UserPreferences {
  return { ...prefs, nickname: nickname.trim().slice(0, 12) };
}

/** 记录本地用户写过哪些评价 id,允许将来删除/标识 */
export function addMyReviewId(prefs: UserPreferences, reviewId: string): UserPreferences {
  const existing = prefs.myReviewIds || [];
  if (existing.includes(reviewId)) return prefs;
  return { ...prefs, myReviewIds: [reviewId, ...existing].slice(0, 200) };
}

/** 高级模式:推荐打分权重 (0-100)。单项 0 会被归一化时忽略,所以 UI 层需保证至少一个非 0 */
export function updateScoringWeights(
  prefs: UserPreferences,
  weights: ScoringWeights
): UserPreferences {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return {
    ...prefs,
    scoringWeights: {
      taste: clamp(weights.taste),
      distance: clamp(weights.distance),
      budget: clamp(weights.budget),
      rating: clamp(weights.rating),
    },
  };
}

/** 清空自定义权重,回到默认 30/25/20/15 */
export function resetScoringWeights(prefs: UserPreferences): UserPreferences {
  const next = { ...prefs };
  delete next.scoringWeights;
  return next;
}

/** 高级模式:模式门槛 —— 骰子次数 / 列表模式显示家数 */
export function updateModeSettings(
  prefs: UserPreferences,
  settings: ModeSettings
): UserPreferences {
  const diceMax = Math.max(1, Math.min(6, Math.round(settings.diceMaxAttempts)));
  const listCap = Math.max(3, Math.min(12, Math.round(settings.listModeCap)));
  return {
    ...prefs,
    modeSettings: { diceMaxAttempts: diceMax, listModeCap: listCap },
  };
}

/** 清空自定义模式门槛,回到 3/6 */
export function resetModeSettings(prefs: UserPreferences): UserPreferences {
  const next = { ...prefs };
  delete next.modeSettings;
  return next;
}
