import { useReducer, useEffect } from "react";
import Taro from "@tarojs/taro";
import type { RecommendationCard } from "@shared/types";

/**
 * 首页相位状态机 —— 移植自 H5 hooks/useHomeState.ts。
 * 6 个相位映射用户的视觉路径:
 *   DICE_IDLE      ← 默认,大骰子等点击
 *   RESULT         ← 一张大卡片,接受/再来一个/已用满次数
 *   TRANSITION_SWIPE / TRANSITION_LIST ← 过渡画面 (~600ms)
 *   SWIPE_MODE     ← 卡片堆叠左右滑
 *   LIST_MODE      ← 列表浏览
 */

export type HomePhase =
  | "DICE_IDLE"
  | "RESULT"
  | "TRANSITION_SWIPE"
  | "SWIPE_MODE"
  | "TRANSITION_LIST"
  | "LIST_MODE";

export interface HomeState {
  phase: HomePhase;
  currentCard: RecommendationCard | null;
  resultAttempt: number;
  acceptedCards: RecommendationCard[];
  rejectedIds: Set<string>;
  allCandidates: RecommendationCard[];
}

export type HomeAction =
  | { type: "ROLL_DICE"; card: RecommendationCard }
  | { type: "ACCEPT_RESULT" }
  | { type: "REJECT_RESULT" }
  | { type: "ENTER_SWIPE" }
  | { type: "SWIPE_RIGHT"; card: RecommendationCard }
  | { type: "SWIPE_LEFT"; card: RecommendationCard }
  | { type: "ENTER_LIST" }
  | { type: "COMPLETE_TRANSITION_SWIPE" }
  | { type: "COMPLETE_TRANSITION_LIST" }
  | { type: "SELECT_FROM_LIST"; card: RecommendationCard }
  | { type: "RESET" }
  | { type: "SET_CANDIDATES"; cards: RecommendationCard[] };

const STORAGE_KEY = "home_state";

const INITIAL_STATE: HomeState = {
  phase: "DICE_IDLE",
  currentCard: null,
  resultAttempt: 0,
  acceptedCards: [],
  rejectedIds: new Set(),
  allCandidates: [],
};

function persistState(state: HomeState): void {
  try {
    const serializable = {
      phase: state.phase,
      currentCard: state.currentCard,
      resultAttempt: state.resultAttempt,
      acceptedCards: state.acceptedCards,
      rejectedIds: Array.from(state.rejectedIds),
      allCandidates: state.allCandidates,
    };
    // 用 wx 内存级存储 (类似 H5 的 sessionStorage —— 退出小程序就清)
    Taro.setStorageSync(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // 配额超限或其他存储问题,吞掉不影响内存状态
  }
}

function loadPersistedState(): HomeState {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw);
    return {
      phase: parsed.phase || "DICE_IDLE",
      currentCard: parsed.currentCard || null,
      resultAttempt: parsed.resultAttempt || 0,
      acceptedCards: parsed.acceptedCards || [],
      rejectedIds: new Set(parsed.rejectedIds || []),
      allCandidates: parsed.allCandidates || [],
    };
  } catch {
    return INITIAL_STATE;
  }
}

function reducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case "ROLL_DICE":
      return {
        ...state,
        phase: "RESULT",
        currentCard: action.card,
        resultAttempt: state.resultAttempt + 1,
        rejectedIds: new Set(state.rejectedIds).add(action.card.id),
      };
    case "ACCEPT_RESULT":
      return state.currentCard
        ? {
            ...state,
            acceptedCards: [...state.acceptedCards, state.currentCard],
            phase: "DICE_IDLE",
            currentCard: null,
          }
        : state;
    case "REJECT_RESULT":
      return { ...state, phase: "DICE_IDLE", currentCard: null };
    case "ENTER_SWIPE":
      return { ...state, phase: "TRANSITION_SWIPE" };
    case "COMPLETE_TRANSITION_SWIPE":
      return { ...state, phase: "SWIPE_MODE" };
    case "SWIPE_RIGHT":
      return {
        ...state,
        acceptedCards: [...state.acceptedCards, action.card],
      };
    case "SWIPE_LEFT": {
      const next = new Set(state.rejectedIds);
      next.add(action.card.id);
      return { ...state, rejectedIds: next };
    }
    case "ENTER_LIST":
      return { ...state, phase: "TRANSITION_LIST" };
    case "COMPLETE_TRANSITION_LIST":
      return { ...state, phase: "LIST_MODE" };
    case "SELECT_FROM_LIST":
      return {
        ...state,
        acceptedCards: [...state.acceptedCards, action.card],
      };
    case "RESET":
      return { ...INITIAL_STATE, allCandidates: state.allCandidates };
    case "SET_CANDIDATES":
      return {
        ...state,
        allCandidates: action.cards,
        // 候选刷新时清空"已 reject"——新一轮推荐的 id 可能跟上次重叠,但语境完全不同
        rejectedIds: new Set(),
      };
    default:
      return state;
  }
}

export function useHomeState() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, loadPersistedState);

  // 每次状态变化持久化 (异步写,不阻塞渲染)
  useEffect(() => {
    persistState(state);
  }, [state]);

  return { state, dispatch };
}
