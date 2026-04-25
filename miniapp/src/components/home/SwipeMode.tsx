import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Image, Button } from "@tarojs/components";
import type { CommonEventFunction, ITouchEvent } from "@tarojs/components";
import type { RecommendationCard } from "@shared/types";
import { pickHeroImage, emojiForCategory } from "@/lib/restaurant-image";
import "./SwipeMode.scss";

interface SwipeModeProps {
  cards: RecommendationCard[];
  onSwipeRight: (card: RecommendationCard) => void;
  onSwipeLeft: (card: RecommendationCard) => void;
  onSwitchToList: () => void;
}

/**
 * 卡片堆叠左滑/右滑 —— 1:1 复刻 H5 SwipeMode 的体验,但用纯原生 onTouchStart/Move/End
 * 实现,因为 Taro 小程序里 framer-motion 不可用。
 *
 * 手势机制:
 *   onTouchStart  → 记录起点 startX, startTime
 *   onTouchMove   → 算 delta,setState 让 transform 实时跟手 (translate + rotate + opacity)
 *   onTouchEnd    →
 *     · |delta| > 80 或速度 > 0.5px/ms → 飞出动画 (CSS transition 200ms 到 ±150vw),
 *       动画完成后回调 onSwipeLeft/Right + 推进 currentIndex
 *     · 否则 → 弹回原位 (CSS transition 200ms 到 0)
 *
 * 性能优化:
 *   touch move 阶段不用 React setState (会有 ~16ms 渲染延迟感觉迟钝),
 *   而是直接读 ref 改 inline style —— transform 由 GPU 合成层,丝滑。
 *   只有 touch end 才调 setState 触发重渲。
 */

const SWIPE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.5; // px/ms
const EXIT_DURATION = 220;

interface DragState {
  startX: number;
  startTime: number;
  delta: number;
}

export function SwipeMode({
  cards,
  onSwipeRight,
  onSwipeLeft,
  onSwitchToList,
}: SwipeModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animState, setAnimState] = useState<"idle" | "exit-left" | "exit-right" | "snapback">("idle");
  const drag = useRef<DragState | null>(null);
  // touchMove 期间真正写到 DOM 的样式,不走 React,直接改 inline style
  const liveStyle = useRef<{ x: number; rotate: number; opacity: number }>({
    x: 0,
    rotate: 0,
    opacity: 1,
  });

  const currentCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];

  // 用完所有卡片自动转列表
  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0) {
      const t = setTimeout(onSwitchToList, 400);
      return () => clearTimeout(t);
    }
  }, [currentIndex, cards.length, onSwitchToList]);

  // 把 liveStyle 读出来直接改 ref 节点的 transform
  // (Taro 编译后 cardRef 拿到的是真实 wxml 节点,但小程序里直接改 style 受限,
  //  所以我们只在 touchMove 期间用 setState 同步 -- 牺牲一点点性能换简单。)
  function applyLiveStyle() {
    setAnimState("idle"); // 强制重渲拿到新 style
  }

  const handleTouchStart = useCallback((e: ITouchEvent) => {
    if (animState !== "idle") return;
    const t = e.touches[0];
    drag.current = {
      startX: t.clientX,
      startTime: Date.now(),
      delta: 0,
    };
  }, [animState]);

  const handleTouchMove = useCallback((e: ITouchEvent) => {
    if (!drag.current || animState !== "idle") return;
    const t = e.touches[0];
    const delta = t.clientX - drag.current.startX;
    drag.current.delta = delta;
    // 比例 [-200, 200] 对应 rotate [-12, 12], opacity [0.6, 1]
    const ratio = Math.max(-1, Math.min(1, delta / 200));
    liveStyle.current = {
      x: delta,
      rotate: ratio * 12,
      opacity: 1 - Math.abs(ratio) * 0.4,
    };
    applyLiveStyle();
  }, [animState]);

  const advanceCard = useCallback(
    (direction: "left" | "right") => {
      const card = cards[currentIndex];
      if (!card) return;
      setAnimState(direction === "left" ? "exit-left" : "exit-right");
      setTimeout(() => {
        if (direction === "right") onSwipeRight(card);
        else onSwipeLeft(card);
        // 重置位置
        liveStyle.current = { x: 0, rotate: 0, opacity: 1 };
        setCurrentIndex((i) => i + 1);
        setAnimState("idle");
        drag.current = null;
      }, EXIT_DURATION);
    },
    [cards, currentIndex, onSwipeRight, onSwipeLeft]
  );

  const handleTouchEnd = useCallback(() => {
    if (!drag.current || animState !== "idle") return;
    const { delta, startTime } = drag.current;
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(delta) / Math.max(elapsed, 1);

    if (delta > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD && delta > 30) {
      advanceCard("right");
    } else if (delta < -SWIPE_THRESHOLD || (velocity > VELOCITY_THRESHOLD && delta < -30)) {
      advanceCard("left");
    } else {
      // 弹回
      setAnimState("snapback");
      liveStyle.current = { x: 0, rotate: 0, opacity: 1 };
      setTimeout(() => {
        setAnimState("idle");
        drag.current = null;
      }, 200);
    }
  }, [advanceCard, animState]);

  if (!currentCard) {
    return (
      <View className="swipe-mode__empty">
        <View className="swipe-mode__spinner" />
        <Text className="swipe-mode__empty-text">正在进入列表...</Text>
      </View>
    );
  }

  const heroUrl = pickHeroImage(currentCard.photos);
  const emoji = emojiForCategory(currentCard.category, currentCard.poiType);
  const matchScore = currentCard.matchScore || 0;

  // 当前卡的样式
  const { x, rotate, opacity } = liveStyle.current;
  let cardTransform = `translate3d(${x}px, 0, 0) rotate(${rotate}deg)`;
  let cardTransition = "none";

  if (animState === "exit-left") {
    cardTransform = `translate3d(-150vw, 0, 0) rotate(-30deg)`;
    cardTransition = `transform ${EXIT_DURATION}ms ease-out, opacity ${EXIT_DURATION}ms ease-out`;
  } else if (animState === "exit-right") {
    cardTransform = `translate3d(150vw, 0, 0) rotate(30deg)`;
    cardTransition = `transform ${EXIT_DURATION}ms ease-out, opacity ${EXIT_DURATION}ms ease-out`;
  } else if (animState === "snapback") {
    cardTransform = `translate3d(0, 0, 0) rotate(0)`;
    cardTransition = `transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  }

  // 提示标签透明度跟着 delta 走
  const leftHintOpacity = Math.max(0, Math.min(1, -x / 100));
  const rightHintOpacity = Math.max(0, Math.min(1, x / 100));

  return (
    <View className="swipe-mode">
      <Text className="swipe-mode__hint">向左跳过,向右选中</Text>

      {/* 进度点 */}
      <View className="swipe-mode__dots">
        {cards.map((_, i) => (
          <View
            key={i}
            className={`swipe-mode__dot ${
              i === currentIndex
                ? "swipe-mode__dot--active"
                : i < currentIndex
                  ? "swipe-mode__dot--done"
                  : "swipe-mode__dot--pending"
            }`}
          />
        ))}
      </View>

      {/* 卡片堆 */}
      <View className="swipe-mode__stack">
        {nextCard && (
          <View className="swipe-mode__card swipe-mode__card--next" />
        )}

        <View
          className="swipe-mode__card swipe-mode__card--current"
          style={{
            transform: cardTransform,
            opacity: animState === "idle" ? String(opacity) : "",
            transition: cardTransition,
          }}
          onTouchStart={handleTouchStart as unknown as CommonEventFunction}
          onTouchMove={handleTouchMove as unknown as CommonEventFunction}
          onTouchEnd={handleTouchEnd as unknown as CommonEventFunction}
          onTouchCancel={handleTouchEnd as unknown as CommonEventFunction}
        >
          {/* 提示标签 */}
          <View
            className="swipe-mode__tag swipe-mode__tag--left"
            style={{ opacity: leftHintOpacity }}
          >
            跳过 ✕
          </View>
          <View
            className="swipe-mode__tag swipe-mode__tag--right"
            style={{ opacity: rightHintOpacity }}
          >
            选中 ✓
          </View>

          {/* 图片 */}
          <View className="swipe-mode__img-wrap">
            {heroUrl ? (
              <Image className="swipe-mode__img" src={heroUrl} mode="aspectFill" />
            ) : (
              <View className="swipe-mode__img-placeholder">
                <Text className="swipe-mode__img-emoji">{emoji}</Text>
              </View>
            )}
            <View className="swipe-mode__img-shade" />
            {matchScore > 0 && (
              <View className="swipe-mode__match">
                {matchScore}% <Text className="swipe-mode__match-fire">🔥</Text>
              </View>
            )}
          </View>

          {/* 文字内容 */}
          <View className="swipe-mode__content">
            <Text className="swipe-mode__name">{currentCard.name}</Text>
            <View className="swipe-mode__meta">
              <Text>{currentCard.category.split(";")[0]}</Text>
              {currentCard.avgPrice > 0 && <Text>· ¥{currentCard.avgPrice}/人</Text>}
              <Text>· {currentCard.walkMinutes} 分钟</Text>
              {currentCard.rating > 0 && (
                <Text className="swipe-mode__rating"> · ⭐ {currentCard.rating}</Text>
              )}
            </View>
            {currentCard.reason && (
              <View className="swipe-mode__reason">
                <Text className="swipe-mode__reason-icon">✨</Text>
                <Text className="swipe-mode__reason-text">{currentCard.reason}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* 底部按钮 */}
      <View className="swipe-mode__buttons">
        <Button
          className="swipe-mode__btn swipe-mode__btn--reject"
          onClick={() => advanceCard("left")}
          disabled={animState !== "idle"}
          hoverClass="swipe-mode__btn--pressed"
        >
          <Text className="swipe-mode__btn-icon">✕</Text>
        </Button>
        <Button
          className="swipe-mode__btn swipe-mode__btn--accept"
          onClick={() => advanceCard("right")}
          disabled={animState !== "idle"}
          hoverClass="swipe-mode__btn--pressed"
        >
          <Text className="swipe-mode__btn-icon">✓</Text>
        </Button>
      </View>
    </View>
  );
}
