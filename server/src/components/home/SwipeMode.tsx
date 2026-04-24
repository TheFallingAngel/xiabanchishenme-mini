"use client";

import { useState, useEffect, useCallback } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type PanInfo,
} from "framer-motion";
import { X, Check, Star, Sparkles } from "lucide-react";
import type { RecommendationCard } from "@/lib/types";
import { getRestaurantImage } from "@/lib/images";

interface SwipeModeProps {
  cards: RecommendationCard[];
  onSwipeRight: (card: RecommendationCard) => void;
  onSwipeLeft: (card: RecommendationCard) => void;
  onSwitchToList: () => void;
}

const SWIPE_THRESHOLD = 80;
const SWIPE_EXIT = 300;

export function SwipeMode({
  cards,
  onSwipeRight,
  onSwipeLeft,
  onSwitchToList,
}: SwipeModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exiting, setExiting] = useState<"left" | "right" | null>(null);

  // framer-motion values — GPU-accelerated, no React re-renders during drag
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-12, 0, 12]);
  const opacity = useTransform(x, [-200, 0, 200], [0.6, 1, 0.6]);

  // Hint opacity for left/right labels
  const leftHintOpacity = useTransform(x, [-100, -40, 0], [1, 0, 0]);
  const rightHintOpacity = useTransform(x, [0, 40, 100], [0, 0, 1]);

  // Auto-transition to list when all cards swiped
  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0) {
      const timer = setTimeout(() => onSwitchToList(), 400);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, cards.length, onSwitchToList]);

  const advanceCard = useCallback(
    (direction: "left" | "right") => {
      const card = cards[currentIndex];
      if (!card) return;
      setExiting(direction);

      // Animate card off screen
      const targetX = direction === "right" ? SWIPE_EXIT : -SWIPE_EXIT;
      animate(x, targetX, {
        type: "spring",
        stiffness: 300,
        damping: 30,
        onComplete: () => {
          if (direction === "right") {
            onSwipeRight(card);
          } else {
            onSwipeLeft(card);
          }
          setCurrentIndex((i) => i + 1);
          setExiting(null);
          x.set(0);
        },
      });
    },
    [cards, currentIndex, onSwipeRight, onSwipeLeft, x]
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const offset = info.offset.x;
      const velocity = info.velocity.x;

      if (offset > SWIPE_THRESHOLD || velocity > 500) {
        advanceCard("right");
      } else if (offset < -SWIPE_THRESHOLD || velocity < -500) {
        advanceCard("left");
      } else {
        // Snap back
        animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
      }
    },
    [advanceCard, x]
  );

  const currentCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];

  if (!currentCard) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 animate-fade-in">
        <div className="w-12 h-12 border-4 border-deep-red border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-muted">正在进入列表...</p>
      </div>
    );
  }

  const imgSrc = getRestaurantImage(currentCard.photos, currentCard.category);
  const matchScore = currentCard.matchScore || 0;

  return (
    <div className="px-4 animate-fade-in">
      {/* Instruction text */}
      <p className="text-center text-sm text-muted mb-3">
        向左跳过，向右选中
      </p>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 mb-4">
        {cards.map((_, i) => (
          <div
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === currentIndex
                ? "bg-deep-red w-5"
                : i < currentIndex
                ? "bg-deep-red/30 w-2"
                : "bg-gray-200 w-2"
            }`}
          />
        ))}
      </div>

      {/* Card stack */}
      <div className="relative h-[420px]">
        {/* Next card preview (underneath) */}
        {nextCard && (
          <div className="absolute inset-0 top-3 mx-2 bg-gray-800 rounded-3xl overflow-hidden opacity-60 scale-[0.96]">
            <div className="w-full h-52 bg-gray-700" />
            <div className="p-5">
              <div className="w-32 h-5 bg-gray-700 rounded mb-2" />
              <div className="w-20 h-3 bg-gray-700 rounded" />
            </div>
          </div>
        )}

        {/* Current card — draggable */}
        <motion.div
          className="absolute inset-0 bg-gray-900 rounded-3xl overflow-hidden shadow-float touch-pan-y"
          style={{ x, rotate, opacity }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.9}
          onDragEnd={handleDragEnd}
          whileTap={{ cursor: "grabbing" }}
        >
          {/* Swipe hint labels */}
          <motion.div
            className="absolute top-4 left-4 z-10 bg-red-500/90 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none"
            style={{ opacity: leftHintOpacity }}
          >
            跳过 ✕
          </motion.div>
          <motion.div
            className="absolute top-4 right-4 z-10 bg-green-500/90 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none"
            style={{ opacity: rightHintOpacity }}
          >
            选中 ✓
          </motion.div>

          {/* Food image */}
          <div className="w-full h-52 relative">
            <img
              src={imgSrc}
              alt={currentCard.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
            {matchScore > 0 && (
              <div className="absolute bottom-3 right-3 bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                {matchScore}%
                <span className="text-[10px]">🔥</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="p-5">
            <h2 className="text-xl font-bold text-white mb-1">
              {currentCard.name}
            </h2>

            <div className="flex items-center gap-3 text-sm text-white/60 mb-3">
              <span>{currentCard.category.split(";")[0]}</span>
              {currentCard.avgPrice > 0 && (
                <span>¥{currentCard.avgPrice}/人</span>
              )}
              <span>{currentCard.walkMinutes}分钟</span>
              {currentCard.rating > 0 && (
                <div className="flex items-center gap-0.5">
                  <Star className="w-3 h-3 fill-gold text-gold" />
                  <span className="text-gold">{currentCard.rating}</span>
                </div>
              )}
            </div>

            {/* AI reason */}
            <div className="bg-emerald-900/40 rounded-xl px-3.5 py-2.5 border border-emerald-500/20">
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-emerald-100/90 leading-relaxed">
                  {currentCard.reason}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-8 mt-6">
        <button
          onClick={() => advanceCard("left")}
          disabled={!!exiting}
          className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center shadow-card active:scale-90 transition-transform disabled:opacity-50"
        >
          <X className="w-6 h-6 text-muted" />
        </button>
        <button
          onClick={() => advanceCard("right")}
          disabled={!!exiting}
          className="w-14 h-14 rounded-full bg-gradient-to-r from-deep-red to-deep-red-dark flex items-center justify-center shadow-card active:scale-90 transition-transform disabled:opacity-50"
        >
          <Check className="w-7 h-7 text-white" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
