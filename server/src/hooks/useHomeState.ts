"use client";

import { useReducer, useEffect, useCallback, type Dispatch } from "react";
import type { RecommendationCard } from "@/lib/types";

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
  resultAttempt: number; // 1-3, how many dice rolls used
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

/** Serialize state to sessionStorage (Set → Array for JSON) */
function persistState(state: HomeState) {
  try {
    const serializable = {
      phase: state.phase,
      currentCard: state.currentCard,
      resultAttempt: state.resultAttempt,
      acceptedCards: state.acceptedCards,
      rejectedIds: Array.from(state.rejectedIds),
      allCandidates: state.allCandidates,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {}
}

/** Restore state from sessionStorage */
function loadPersistedState(): HomeState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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

function homeReducer(state: HomeState, action: HomeAction): HomeState {
  let next: HomeState;

  switch (action.type) {
    case "SET_CANDIDATES":
      next = { ...state, allCandidates: action.cards };
      break;

    case "ROLL_DICE":
      next = {
        ...state,
        phase: "RESULT",
        currentCard: action.card,
        resultAttempt: state.resultAttempt + 1,
      };
      break;

    case "ACCEPT_RESULT":
      next = {
        ...state,
        acceptedCards: state.currentCard
          ? [...state.acceptedCards, state.currentCard]
          : state.acceptedCards,
        phase: "DICE_IDLE",
        currentCard: null,
      };
      break;

    case "REJECT_RESULT": {
      const rejectedIds = new Set(state.rejectedIds);
      if (state.currentCard) rejectedIds.add(state.currentCard.id);

      // After 3 attempts, auto-transition to swipe
      if (state.resultAttempt >= 3) {
        next = {
          ...state,
          rejectedIds,
          currentCard: null,
          phase: "TRANSITION_SWIPE",
        };
      } else {
        // Otherwise back to dice idle for another roll
        next = {
          ...state,
          rejectedIds,
          currentCard: null,
          phase: "DICE_IDLE",
        };
      }
      break;
    }

    case "ENTER_SWIPE":
      next = { ...state, phase: "SWIPE_MODE" };
      break;

    case "SWIPE_RIGHT":
      next = {
        ...state,
        acceptedCards: [...state.acceptedCards, action.card],
      };
      break;

    case "SWIPE_LEFT": {
      const rejectedIds = new Set(state.rejectedIds);
      rejectedIds.add(action.card.id);
      next = { ...state, rejectedIds };
      break;
    }

    case "ENTER_LIST":
      next = { ...state, phase: "TRANSITION_LIST" };
      break;

    case "COMPLETE_TRANSITION_SWIPE":
      next = { ...state, phase: "SWIPE_MODE" };
      break;

    case "COMPLETE_TRANSITION_LIST":
      next = { ...state, phase: "LIST_MODE" };
      break;

    case "SELECT_FROM_LIST":
      next = {
        ...state,
        acceptedCards: [...state.acceptedCards, action.card],
      };
      break;

    case "RESET":
      next = { ...INITIAL_STATE, allCandidates: state.allCandidates };
      break;

    default:
      next = state;
  }

  // Persist every state change
  persistState(next);
  return next;
}

export function useHomeState() {
  const [state, dispatch] = useReducer(homeReducer, INITIAL_STATE, () => {
    // SSR guard: only read sessionStorage on client
    if (typeof window === "undefined") return INITIAL_STATE;
    return loadPersistedState();
  });

  return { state, dispatch };
}
