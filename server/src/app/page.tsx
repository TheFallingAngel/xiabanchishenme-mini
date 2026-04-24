"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin,
  ChevronDown,
  Navigation,
  Search,
} from "lucide-react";
import type { RecommendationCard, SavedLocation } from "@/lib/types";
import { loadPrefs, savePrefs, markNotInterested } from "@/lib/storage";
import { getRestaurantImage } from "@/lib/images";
import { generateRecommendations } from "@/lib/recommend";
import { calculateMatchScore } from "@/lib/match-score";
import { calculateBudget } from "@/lib/budget";
import { buildUserContextSignals } from "@/lib/reason-context";
import { inferHealthTags } from "@/lib/health-tags";
import { useHomeState } from "@/hooks/useHomeState";
import { DiceView } from "@/components/home/DiceView";
import { ResultCard } from "@/components/home/ResultCard";
import { TransitionView } from "@/components/home/TransitionView";
import { SwipeMode } from "@/components/home/SwipeMode";
import { ListView } from "@/components/home/ListView";
import { BudgetBar } from "@/components/home/BudgetBar";

// 骰子次数 / 列表模式展示家数的硬编码默认 —— 解锁高级模式后会被 prefs.modeSettings 覆盖
const DEFAULT_DICE_ATTEMPTS = 3;
// 列表模式默认展示 20 家 —— 用户反馈 6 家选择面太窄,想一屏看更多候选
const DEFAULT_LIST_CAP = 20;

export default function HomePage() {
  const router = useRouter();
  const { state, dispatch } = useHomeState();

  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [location, setLocation] = useState<SavedLocation | null>(null);
  const [locationInput, setLocationInput] = useState("");
  const [locationTips, setLocationTips] = useState<{ name: string; address: string; location: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  // 天气描述:"下雨、凉" / "晴天、热" —— 给 LLM 当场景钩子用; 没拿到为空字符串
  const [weatherNote, setWeatherNote] = useState<string>("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const budget = calculateBudget(prefs);

  // 骰子 / 列表模式门槛 —— 解锁高级并设置过就走自定义,否则走默认
  const diceMaxAttempts =
    (prefs.advancedUnlocked && prefs.modeSettings?.diceMaxAttempts) || DEFAULT_DICE_ATTEMPTS;
  const listModeCap =
    (prefs.advancedUnlocked && prefs.modeSettings?.listModeCap) || DEFAULT_LIST_CAP;

  const hasInitialized = useRef(false);

  // Load saved location on mount
  useEffect(() => {
    const initialPrefs = loadPrefs();
    // 首页 mount 即认为"今天打开过",落一次 savePrefs 让 visitDates 把 today 收进去。
    // 否则只看的不操作的用户永远解不开高级设置 (旧 bug:计数绑在 savePrefs 调用频率上)
    savePrefs(initialPrefs);
    setPrefs(loadPrefs());
    if (initialPrefs.currentLocation) {
      setLocation(initialPrefs.currentLocation);
    }
    hasInitialized.current = true;
  }, []);

  // Auto-fetch when location changes — but skip if returning to page with existing data
  useEffect(() => {
    if (!location) return;
    // If we already have candidates (e.g. returning from detail page), don't refetch
    if (state.allCandidates.length > 0 && hasInitialized.current) return;
    fetchRestaurants(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lng, location?.lat]);

  // 天气:跟着定位走,失败静默,只用于 LLM 的场景钩子。30 分钟服务端缓存已经够。
  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/weather?lng=${location.lng}&lat=${location.lat}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const note: string = data?.weather?.note || "";
        if (!cancelled) setWeatherNote(note);
      } catch {
        // 忽略:天气只是锦上添花
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location?.lng, location?.lat]);

  async function fetchRestaurants(loc: SavedLocation) {
    setLoading(true);
    dispatch({ type: "RESET" });
    try {
      // 根据用户的最大步行分钟算召回半径:
      //   80 m/min 是成年人平均步行速度,再留 20% 余量避开路径绕行的情况。
      //   最低 800m 保证在 CBD 这种店密的地方也能召回够;最高 3000m 避免过度召回。
      const currentPrefs = loadPrefs();
      const mins = Math.max(5, currentPrefs.maxWalkMinutes || 25);
      const radius = Math.min(5000, Math.max(800, Math.round(mins * 80 * 1.2)));
      const res = await fetch(
        `/api/restaurants?lng=${loc.lng}&lat=${loc.lat}&radius=${radius}&maxWalkMinutes=${mins}`
      );
      const data = await res.json();
      setIsMock(data.mock || false);
      const latestPrefs = loadPrefs();
      setPrefs(latestPrefs);
      // 列表模式最多展示 20 家,多召 5 条做 rejected/not-interested 过滤后的余量
      const recs = generateRecommendations(data.restaurants || [], latestPrefs, 25);
      const withScores = recs.map((r) => {
        const s = calculateMatchScore(r, latestPrefs);
        return {
          ...r,
          matchScore: s.total,
          matchedTastes: s.matchedTastes,
        };
      });
      dispatch({ type: "SET_CANDIDATES", cards: withScores });

      // Async: fetch LLM reasons for top cards (non-blocking)
      // 天气 state 可能还在路上 —— 传当前快照,有就加进 prompt,没有也不影响整体。
      fetchLLMReasons(withScores.slice(0, 8), latestPrefs, weatherNote);
      // 并行预热前 3 家的详情页 insight —— 用户很可能会点进某一家,提前在服务器
      // in-memory Map 里暖好缓存,详情页 open 时直接命中 (< 50ms) 而不是等
      // MiniMax 冷跑 3~5s。只预热前 3 家是成本权衡:更多会打满并发配额。
      // extra.tags/alias/recommend 这时还没拉 —— 预热版和详情页第一次 useEffect
      // 的签名完全对齐(都不含 extra),所以首屏肯定能命中。
      prewarmInsightsForTopCards(withScores.slice(0, 3), latestPrefs, weatherNote);
    } catch (err) {
      console.error("Failed to fetch restaurants:", err);
    } finally {
      setLoading(false);
    }
  }

  /** Fetch LLM-generated reasons in background, update cards when ready */
  async function fetchLLMReasons(
    cards: RecommendationCard[],
    prefs: ReturnType<typeof loadPrefs>,
    weather?: string
  ) {
    try {
      // 卡片间避免钩子雷同: 按顺序为每张卡挑一个 "primary hook",
      // 后面的卡就把前几张用过的 hook 加到 avoidHooks 里,
      // 强制 LLM 走不同组合,避免 5 家店全是 "步行 X 分钟,人均 Y"。
      type Hook = "history" | "taste" | "walk" | "budget" | "weekday" | "highlight";
      const usedHooks: Hook[] = [];

      const perCard = cards.map((card) => {
        const signals = buildUserContextSignals(prefs, card.category, new Date(), {
          avgPrice: card.avgPrice,
          walkMinutes: card.walkMinutes,
          rating: card.rating,
          name: card.name,
        });

        // 选本卡最"强"的一个钩子,优先级: tasteHit > 长期没吃同类 > 非常近 > 有 highlight > 预算紧张 > 默认
        let primary: Hook = "walk";
        if (signals.tasteHit === true) primary = "taste";
        else if (typeof signals.daysSinceCategory === "number" && signals.daysSinceCategory >= 5)
          primary = "history";
        else if (signals.walkTier === "very-close") primary = "walk";
        else if (signals.highlight) primary = "highlight";
        else if (signals.budgetStatus === "tight" || signals.budgetStatus === "over")
          primary = "budget";
        else if (card.avgPrice > 0 && card.avgPrice <= 30) primary = "budget";
        else primary = "walk";

        // 本卡 avoid 最近 2 张用过的钩子(但别把自己的 primary 给 avoid 了)
        const avoidHooks = Array.from(new Set(usedHooks.slice(-2))).filter(
          (h) => h !== primary
        );
        usedHooks.push(primary);

        return { card, signals, avoidHooks };
      });

      const results = await Promise.allSettled(
        perCard.map(async ({ card, signals, avoidHooks }) => {
          const res = await fetch("/api/llm/reason", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              restaurantName: card.name,
              category: card.category,
              avgPrice: card.avgPrice,
              walkMinutes: card.walkMinutes,
              rating: card.rating,
              matchScore: card.matchScore || 0,
              highlight: signals.highlight,
              // —— 当下场景 ——
              weekday: signals.weekday,
              timeOfDay: signals.timeOfDay,
              weather: weather || undefined,
              // —— 用户历史 ——
              daysSinceCategory: signals.daysSinceCategory,
              recentHistory: signals.recentHistory,
              // —— 用户偏好 ——
              tastePreferences: signals.tastePreferences,
              tasteHit: signals.tasteHit,
              healthTags: inferHealthTags(card.category),
              // —— 档位 ——
              priceTier: signals.priceTier,
              walkTier: signals.walkTier,
              ratingTier: signals.ratingTier,
              // —— 钱包 ——
              budgetRemaining: signals.budgetRemaining,
              budgetStatus: signals.budgetStatus,
              // —— 去重 ——
              avoidHooks,
            }),
          });
          const data = await res.json();
          return { id: card.id, reason: data.reason as string | null };
        })
      );

      // Collect successful LLM reasons
      const updates: Record<string, string> = {};
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.reason) {
          updates[result.value.id] = result.value.reason;
        }
      }

      if (Object.keys(updates).length > 0) {
        // Update candidates with LLM reasons
        dispatch({
          type: "SET_CANDIDATES",
          cards: (state.allCandidates.length > 0 ? state.allCandidates : cards).map((c) =>
            updates[c.id] ? { ...c, reason: updates[c.id] } : c
          ),
        });
      }
    } catch {
      // LLM fetch failed silently — template reasons are fine
    }
  }

  /**
   * 预热详情页 insight —— fire-and-forget 调 /api/llm/insight 让服务器的
   * in-memory cache 暖起来,详情页 open 时就能直接命中。
   *
   * 预热请求的签名必须和详情页**首次** useEffect 的签名一致(见 restaurant/[id]/page.tsx):
   *   - extra 尚未到达时,buildUserContextSignals 不喂 amapTags/alias/recommend
   *   - 所以这里也同样不喂 —— 这样 cache key 完全一致,详情页首屏能命中
   *   - 详情页 extra 到达后会再发一次 (带 highlight 更全的版本),那次会重新生成,
   *     但用户已经先看到了首屏 insight,观感上 LLM 是秒出的
   *
   * 失败静默 —— 预热失败不影响用户路径,详情页打开时还是会正常调。
   */
  async function prewarmInsightsForTopCards(
    cards: RecommendationCard[],
    prefs: ReturnType<typeof loadPrefs>,
    weather?: string
  ) {
    try {
      await Promise.allSettled(
        cards.map(async (card) => {
          const signals = buildUserContextSignals(prefs, card.category, new Date(), {
            avgPrice: card.avgPrice,
            walkMinutes: card.walkMinutes,
            rating: card.rating,
            name: card.name,
            // 不传 amapTags/alias/recommend —— 和详情页首次 useEffect 对齐
          });
          const healthTags = inferHealthTags(card.category);
          await fetch("/api/llm/insight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              restaurantName: card.name,
              category: card.category,
              avgPrice: card.avgPrice,
              walkMinutes: card.walkMinutes,
              rating: card.rating,
              highlight: signals.highlight,
              weekday: signals.weekday,
              timeOfDay: signals.timeOfDay,
              daysSinceCategory: signals.daysSinceCategory,
              recentHistory: signals.recentHistory,
              tastePreferences: signals.tastePreferences,
              tasteHit: signals.tasteHit,
              priceTier: signals.priceTier,
              walkTier: signals.walkTier,
              ratingTier: signals.ratingTier,
              budgetRemaining: signals.budgetRemaining,
              budgetStatus: signals.budgetStatus,
              weather: weather || undefined,
              healthTags: healthTags.length ? healthTags : undefined,
            }),
          });
          // 响应 body 不用读 —— 服务器 Map 已写入,这就是预热的全部意义
        })
      );
    } catch {
      // 静默 —— 预热失败不影响主路径
    }
  }

  // Pick next card for dice roll (exclude rejected)
  function getNextCandidate(): RecommendationCard | null {
    const available = state.allCandidates.filter(
      (c) => !state.rejectedIds.has(c.id) && !state.acceptedCards.some((a) => a.id === c.id)
    );
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * Math.min(3, available.length))];
  }

  // Get cards for swipe mode (exclude rejected + accepted)
  function getSwipeCards(): RecommendationCard[] {
    return state.allCandidates.filter(
      (c) => !state.rejectedIds.has(c.id) && !state.acceptedCards.some((a) => a.id === c.id)
    );
  }

  // 列表模式只展示精选前 N 家 —— 避免一屏密密麻麻让用户无从选择
  // candidates 来自后端时已按 matchScore 降序 (recommend.ts),所以直接 slice
  // 仍然排除 rejected (包括"不想吃"和左滑);accepted (右滑喜欢) 留着
  function getListCards(): RecommendationCard[] {
    return state.allCandidates
      .filter((c) => !state.rejectedIds.has(c.id))
      .slice(0, listModeCap);
  }

  function handleRollDice() {
    const card = getNextCandidate();
    if (card) {
      dispatch({ type: "ROLL_DICE", card });
    } else {
      // No more candidates, go to list
      dispatch({ type: "ENTER_LIST" });
    }
  }

  function handleAcceptResult() {
    const card = state.currentCard;
    dispatch({ type: "ACCEPT_RESULT" });
    if (card) {
      sessionStorage.setItem("selected_restaurant", JSON.stringify(card));
      router.push(`/restaurant/${card.id}`);
    }
  }

  function handleRejectResult() {
    dispatch({ type: "REJECT_RESULT" });
  }

  const handleTransitionToSwipe = useCallback(() => {
    dispatch({ type: "COMPLETE_TRANSITION_SWIPE" });
  }, [dispatch]);

  const handleTransitionToList = useCallback(() => {
    dispatch({ type: "COMPLETE_TRANSITION_LIST" });
  }, [dispatch]);

  function handleSwipeRight(card: RecommendationCard) {
    // Swipe right = "选中了这家" — 记录喜欢，立刻进入详情页
    dispatch({ type: "SWIPE_RIGHT", card });
    sessionStorage.setItem("selected_restaurant", JSON.stringify(card));
    router.push(`/restaurant/${card.id}`);
  }

  function handleSwipeLeft(card: RecommendationCard) {
    dispatch({ type: "SWIPE_LEFT", card });
  }

  function handleSwitchToList() {
    dispatch({ type: "ENTER_LIST" });
  }

  function handleSelectFromList(card: RecommendationCard) {
    dispatch({ type: "SELECT_FROM_LIST", card });
    sessionStorage.setItem("selected_restaurant", JSON.stringify(card));
    router.push(`/restaurant/${card.id}`);
  }

  /**
   * 列表卡片右上角 "不想吃":
   * - 写 notInterested (7 天屏蔽) 到 prefs
   * - 复用 SWIPE_LEFT 把它从当前列表摘掉,避免二次闪现
   * - 更新 prefs state 让打分/排序实时重算
   */
  function handleNotInterestedFromList(card: RecommendationCard) {
    const p = loadPrefs();
    // 带上展示字段,让"我的"页面能列出可管理的卡片(名字/头图/分类)
    const heroImage = getRestaurantImage(card.photos, card.category, "hero");
    const nextPrefs = markNotInterested(p, card.id, card.name, card.category, heroImage);
    savePrefs(nextPrefs);
    setPrefs(nextPrefs);
    dispatch({ type: "SWIPE_LEFT", card });
  }

  function handleSkipToSwipe() {
    dispatch({ type: "ENTER_SWIPE" });
  }

  // Force refetch for a new location (user explicitly chose a new place)
  function forceRefreshLocation(loc: SavedLocation) {
    setLocation(loc);
    // Directly call fetch since the useEffect guard would skip if candidates exist
    fetchRestaurants(loc);
  }

  // Location handlers
  function handleGetLocation() {
    if (!navigator.geolocation) {
      alert("浏览器不支持定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Reverse geocode to get actual place name
        let name = "当前位置";
        let address = "自动定位";
        try {
          const res = await fetch(`/api/location/search?keyword=${pos.coords.longitude},${pos.coords.latitude}&type=regeo`);
          const data = await res.json();
          if (data.name) name = data.name;
          if (data.address) address = data.address;
        } catch {}

        const loc: SavedLocation = {
          name,
          address,
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
        };
        const nextPrefs = { ...prefs, currentLocation: loc };
        setPrefs(nextPrefs);
        savePrefs(nextPrefs);
        setShowLocationPicker(false);
        forceRefreshLocation(loc);
      },
      () => alert("定位失败，请手动输入地点")
    );
  }

  function handleLocationSearch(keyword: string) {
    setLocationInput(keyword);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!keyword.trim()) {
      setLocationTips([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/location/search?keyword=${encodeURIComponent(keyword)}`);
        const data = await res.json();
        setLocationTips(data.tips || []);
      } catch {}
    }, 300);
  }

  function handleSelectLocation(tip: { name: string; address: string; location: string }) {
    const [lng, lat] = tip.location.split(",").map(Number);
    const loc: SavedLocation = { name: tip.name, address: tip.address, lng, lat };
    const nextPrefs = { ...prefs, currentLocation: loc };
    const saved = nextPrefs.savedLocations.filter((l) => l.name !== tip.name);
    saved.unshift(loc);
    nextPrefs.savedLocations = saved.slice(0, 3);
    setPrefs(nextPrefs);
    savePrefs(nextPrefs);
    setShowLocationPicker(false);
    setLocationInput("");
    setLocationTips([]);
    forceRefreshLocation(loc);
  }

  // Render phase content
  function renderPhaseContent() {
    switch (state.phase) {
      case "DICE_IDLE":
        return (
          <DiceView
            attempt={state.resultAttempt}
            maxAttempts={diceMaxAttempts}
            onRoll={handleRollDice}
            onSkipToSwipe={handleSkipToSwipe}
          />
        );

      case "RESULT":
        return state.currentCard ? (
          <ResultCard
            card={state.currentCard}
            attempt={state.resultAttempt}
            maxAttempts={diceMaxAttempts}
            onAccept={handleAcceptResult}
            onReject={handleRejectResult}
          />
        ) : null;

      case "TRANSITION_SWIPE":
        return (
          <TransitionView target="swipe" onComplete={handleTransitionToSwipe} />
        );

      case "SWIPE_MODE":
        return (
          <SwipeMode
            cards={getSwipeCards()}
            onSwipeRight={handleSwipeRight}
            onSwipeLeft={handleSwipeLeft}
            onSwitchToList={handleSwitchToList}
          />
        );

      case "TRANSITION_LIST":
        return (
          <TransitionView target="list" onComplete={handleTransitionToList} />
        );

      case "LIST_MODE":
        return (
          <ListView
            cards={getListCards()}
            onSelect={handleSelectFromList}
            onNotInterested={handleNotInterestedFromList}
          />
        );

      default:
        return null;
    }
  }

  return (
    <main className="min-h-screen bg-cream animate-fade-in">
      {/* Header — title 左; 右边仅保留演示数据 badge (Bell / Search 去掉,因为还没接功能) */}
      <div className="px-4 pt-14 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-secondary">下班吃什么</h1>
          {isMock && (
            <span className="text-xs bg-gold-light text-gold px-2.5 py-1 rounded-full font-medium">
              演示数据
            </span>
          )}
        </div>
      </div>

      {/* Location — simple inline */}
      <div className="px-4 mb-3">
        <button
          onClick={() => setShowLocationPicker(!showLocationPicker)}
          className="flex items-center gap-1.5 text-sm text-muted"
        >
          <MapPin className="w-4 h-4 text-deep-red" />
          <span>{location ? location.name : "选择下班地点"}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLocationPicker ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Location picker */}
      {showLocationPicker && (
        <div className="px-4 mb-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-card p-4 border border-gray-50">
            <button
              onClick={handleGetLocation}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-deep-red to-deep-red-dark text-white rounded-xl py-3 mb-3 text-sm font-medium shadow-sm active:scale-[0.98] transition-transform"
            >
              <Navigation className="w-4 h-4" />
              使用当前位置
            </button>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                type="text"
                value={locationInput}
                onChange={(e) => handleLocationSearch(e.target.value)}
                placeholder="搜索地点（如：体育西路）"
                className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-deep-red focus:ring-1 focus:ring-deep-red/20 transition-all"
              />
            </div>

            {locationTips.length > 0 && (
              <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
                {locationTips.map((tip, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectLocation(tip)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-cream border-b border-gray-50 last:border-0 transition-colors"
                  >
                    <div className="font-medium text-secondary">{tip.name}</div>
                    <div className="text-xs text-muted mt-0.5">{tip.address}</div>
                  </button>
                ))}
              </div>
            )}

            {prefs.savedLocations.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1.5">最近使用</p>
                <div className="flex flex-wrap gap-2">
                  {prefs.savedLocations.map((loc, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectLocation({ name: loc.name, address: loc.address, location: `${loc.lng},${loc.lat}` })}
                      className="text-xs bg-cream text-secondary px-3 py-1.5 rounded-full border border-gray-100 hover:border-deep-red hover:text-deep-red transition-colors"
                    >
                      {loc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Budget bar */}
      {location && !loading && <BudgetBar budget={budget} />}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-12 h-12 border-4 border-deep-red border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-muted">正在搜索附近美食...</p>
        </div>
      )}

      {/* No location selected */}
      {!location && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-4">
            <MapPin className="w-12 h-12 text-deep-red/40" />
          </div>
          <h2 className="text-lg font-semibold text-secondary mb-2">先告诉我你在哪</h2>
          <p className="text-sm text-muted mb-6">选择下班地点，我帮你决定今晚吃什么</p>
          <button
            onClick={() => setShowLocationPicker(true)}
            className="bg-gradient-to-r from-deep-red to-deep-red-dark text-white px-8 py-3 rounded-xl text-sm font-medium shadow-card active:scale-95 transition-transform"
          >
            选择位置
          </button>
        </div>
      )}

      {/* Main flow content */}
      {!loading && location && state.allCandidates.length > 0 && (
        <div className="pb-24">
          {renderPhaseContent()}
        </div>
      )}

      {/* Empty state */}
      {!loading && location && state.allCandidates.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Search className="w-10 h-10 text-muted/40" />
          </div>
          <h2 className="text-base font-semibold text-secondary mb-1">附近没找到餐厅</h2>
          <p className="text-sm text-muted">换个地点试试？</p>
        </div>
      )}
    </main>
  );
}
