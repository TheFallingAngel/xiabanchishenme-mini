import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { request, type RequestError } from "@/lib/request";
import { useHomeState } from "@/hooks/useHomeState";
import { BudgetBar } from "@/components/home/BudgetBar";
import { DiceView } from "@/components/home/DiceView";
import { ResultCard } from "@/components/home/ResultCard";
import { TransitionView } from "@/components/home/TransitionView";
import { SwipeMode } from "@/components/home/SwipeMode";
import { ListView } from "@/components/home/ListView";
import { toastInfo, toastError } from "@/lib/toast";
import {
  loadPrefs,
  savePrefs,
  markNotInterested,
  isNotInterested,
} from "@shared/storage";
import { calculateBudget } from "@shared/budget";
import { generateRecommendations } from "@shared/recommend";
import { calculateMatchScore } from "@shared/match-score";
import type {
  RecommendationCard,
  Restaurant,
  SavedLocation,
  UserPreferences,
} from "@shared/types";
import "./index.scss";

const DEFAULT_DICE_ATTEMPTS = 3;
const DEFAULT_LIST_CAP = 20;

interface RestaurantsResponse {
  restaurants: Restaurant[];
  mock?: boolean;
}

/**
 * 首页 —— 1:1 复刻 H5 app/page.tsx 的状态机和交互。
 * Phases: DICE_IDLE → RESULT → TRANSITION_SWIPE → SWIPE_MODE → TRANSITION_LIST → LIST_MODE
 *
 * 数据来源:
 *   · 候选餐厅:wx.getLocation 拿坐标 → /api/restaurants → generateRecommendations 打分排序
 *   · 用户偏好:storage.ts loadPrefs (Taro storage shim 在 app.tsx 里挂上)
 *   · 月预算条:calculateBudget(prefs)
 */
export default function Home() {
  const { state, dispatch } = useHomeState();
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPrefs());
  const [location, setLocation] = useState<SavedLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const hasInitialized = useRef(false);

  const budget = calculateBudget(prefs);
  const diceMaxAttempts =
    (prefs.advancedUnlocked && prefs.modeSettings?.diceMaxAttempts) ||
    DEFAULT_DICE_ATTEMPTS;
  const listModeCap =
    (prefs.advancedUnlocked && prefs.modeSettings?.listModeCap) ||
    DEFAULT_LIST_CAP;

  // -------- 首次 mount 拿定位 + 拉餐厅 --------
  useEffect(() => {
    const initialPrefs = loadPrefs();
    // 首页 mount 即记录"今天打开过",用于 visitDates / 高级解锁计数
    savePrefs(initialPrefs);
    setPrefs(loadPrefs());
    if (initialPrefs.currentLocation) {
      setLocation(initialPrefs.currentLocation);
      hasInitialized.current = true;
    } else {
      // 没缓存的位置 → 主动 wx.getLocation
      requestLocation();
    }
  }, []);

  // 用户从详情页返回时,从其他 tab 切回时刷新 prefs (favorites / notInterested 可能在别处改了)
  useDidShow(() => {
    setPrefs(loadPrefs());
  });

  // 位置变化时 fetchRestaurants
  useEffect(() => {
    if (!location) return;
    if (state.allCandidates.length > 0 && hasInitialized.current) return;
    fetchRestaurants(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lng, location?.lat]);

  // -------- 用 wx.getLocation 取坐标 --------
  async function requestLocation() {
    try {
      const res = await Taro.getLocation({ type: "gcj02" });
      const loc: SavedLocation = {
        name: "当前位置",
        address: "",
        lng: res.longitude,
        lat: res.latitude,
      };
      // 写回 prefs 供下次直接复用
      const next = { ...loadPrefs(), currentLocation: loc };
      savePrefs(next);
      setPrefs(loadPrefs());
      setLocation(loc);
    } catch {
      toastError("没拿到定位,先用默认位置");
      // 兜底:广州珠江新城
      setLocation({
        name: "珠江新城",
        address: "广东省广州市天河区",
        lng: 113.32,
        lat: 23.12,
      });
    }
  }

  // -------- 拉云托管餐厅列表 --------
  async function fetchRestaurants(loc: SavedLocation) {
    setLoading(true);
    try {
      const mins = Math.max(5, prefs.maxWalkMinutes || 25);
      const radius = Math.min(5000, Math.max(800, Math.round(mins * 80 * 1.2)));
      const data = await request<RestaurantsResponse>({
        path: "/api/restaurants",
        method: "GET",
        query: { lng: loc.lng, lat: loc.lat, radius, maxWalkMinutes: mins },
        timeout: 20000,
      });
      setIsMock(!!data.mock);
      const latest = loadPrefs();
      setPrefs(latest);
      const recs = generateRecommendations(data.restaurants || [], latest, 25);
      const withScores = recs.map((r) => {
        const s = calculateMatchScore(r, latest);
        return { ...r, matchScore: s.total, matchedTastes: s.matchedTastes };
      });
      dispatch({ type: "SET_CANDIDATES", cards: withScores });
    } catch (e) {
      const err = e as RequestError;
      console.error("[home] /api/restaurants 失败", err);
      toastError(err.message || "拉取失败,稍后重试");
    } finally {
      setLoading(false);
      hasInitialized.current = true;
    }
  }

  // -------- Phase: DICE → 摇骰子,选一张 --------
  const handleRollDice = useCallback(() => {
    const pool = state.allCandidates.filter(
      (c) => !state.rejectedIds.has(c.id) && !isNotInterested(loadPrefs(), c.id)
    );
    if (pool.length === 0) {
      toastInfo("候选已全部用完,切到列表看看");
      dispatch({ type: "ENTER_LIST" });
      return;
    }
    // 随机抽一张 (排除已拒)
    const pick = pool[Math.floor(Math.random() * pool.length)];
    dispatch({ type: "ROLL_DICE", card: pick });
  }, [state.allCandidates, state.rejectedIds, dispatch]);

  const handleSkipToSwipe = useCallback(() => {
    dispatch({ type: "ENTER_SWIPE" });
  }, [dispatch]);

  // -------- Phase: RESULT → 接受 / 再来 --------
  const handleAcceptResult = useCallback(() => {
    const card = state.currentCard;
    if (!card) return;
    dispatch({ type: "ACCEPT_RESULT" });
    // sessionStorage 保存当前选中,详情页 mount 直接读
    Taro.setStorageSync("selected_restaurant", JSON.stringify(card));
    Taro.navigateTo({
      url: `/pages/restaurant/index?id=${encodeURIComponent(card.id)}`,
    });
  }, [state.currentCard, dispatch]);

  const handleRejectResult = useCallback(() => {
    if (state.resultAttempt >= diceMaxAttempts) {
      // 用满了次数 → 切去 swipe 模式
      dispatch({ type: "REJECT_RESULT" });
      dispatch({ type: "ENTER_SWIPE" });
      return;
    }
    dispatch({ type: "REJECT_RESULT" });
  }, [state.resultAttempt, diceMaxAttempts, dispatch]);

  // -------- Phase: SWIPE → 左滑右滑 --------
  const handleSwipeRight = useCallback(
    (card: RecommendationCard) => {
      dispatch({ type: "SWIPE_RIGHT", card });
      Taro.setStorageSync("selected_restaurant", JSON.stringify(card));
      Taro.navigateTo({
        url: `/pages/restaurant/index?id=${encodeURIComponent(card.id)}`,
      });
    },
    [dispatch]
  );

  const handleSwipeLeft = useCallback(
    (card: RecommendationCard) => {
      dispatch({ type: "SWIPE_LEFT", card });
    },
    [dispatch]
  );

  const handleSwitchToList = useCallback(() => {
    dispatch({ type: "ENTER_LIST" });
  }, [dispatch]);

  // -------- Phase: LIST → 单击跳详情,EyeOff 拉黑 --------
  const handleSelectFromList = useCallback(
    (card: RecommendationCard) => {
      dispatch({ type: "SELECT_FROM_LIST", card });
      Taro.setStorageSync("selected_restaurant", JSON.stringify(card));
      Taro.navigateTo({
        url: `/pages/restaurant/index?id=${encodeURIComponent(card.id)}`,
      });
    },
    [dispatch]
  );

  const handleNotInterestedFromList = useCallback(
    (card: RecommendationCard) => {
      const p = loadPrefs();
      const next = markNotInterested(p, card.id, card.name, card.category);
      savePrefs(next);
      setPrefs(next);
      toastInfo("7 天内不再推荐");
    },
    []
  );

  // -------- 候选切片 (列表只展示前 N 家,排除已拉黑/已拒) --------
  function getListCards(): RecommendationCard[] {
    return state.allCandidates
      .filter((c) => !isNotInterested(loadPrefs(), c.id))
      .filter((c) => !state.rejectedIds.has(c.id))
      .slice(0, listModeCap);
  }

  function getSwipeCards(): RecommendationCard[] {
    return state.allCandidates
      .filter((c) => !isNotInterested(loadPrefs(), c.id))
      .filter((c) => !state.rejectedIds.has(c.id))
      .slice(0, listModeCap);
  }

  // -------- Phase 渲染分发 --------
  function renderPhase() {
    switch (state.phase) {
      case "DICE_IDLE":
        return <DiceView onRoll={handleRollDice} onSkipToSwipe={handleSkipToSwipe} />;
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
          <TransitionView
            target="swipe"
            onComplete={() => dispatch({ type: "COMPLETE_TRANSITION_SWIPE" })}
          />
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
          <TransitionView
            target="list"
            onComplete={() => dispatch({ type: "COMPLETE_TRANSITION_LIST" })}
          />
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
    <View className="home">
      {/* Header */}
      <View className="home__header">
        <View className="home__title-row">
          <Text className="home__title">下班吃什么</Text>
          {isMock && <Text className="home__badge">演示数据</Text>}
        </View>
        {location && (
          <View className="home__location" onClick={requestLocation}>
            <Text className="home__pin">📍</Text>
            <Text className="home__loc-text">{location.name || "当前位置"}</Text>
          </View>
        )}
      </View>

      {/* 预算条 */}
      <BudgetBar budget={budget} />

      {/* Loading 占位 */}
      {loading && (
        <View className="home__loading">
          <View className="home__spinner" />
          <Text className="home__loading-text">正在拉取附近餐厅…</Text>
        </View>
      )}

      {/* 主内容 (Phase 分发) */}
      {!loading && renderPhase()}
    </View>
  );
}
