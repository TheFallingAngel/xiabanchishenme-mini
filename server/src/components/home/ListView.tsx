"use client";

import { Star, Sparkles, EyeOff } from "lucide-react";
import type { RecommendationCard } from "@/lib/types";
import { getRestaurantImage } from "@/lib/images";

interface ListViewProps {
  cards: RecommendationCard[];
  onSelect: (card: RecommendationCard) => void;
  /** 卡片右上角的 "不想吃":7 天内屏蔽这家 */
  onNotInterested?: (card: RecommendationCard) => void;
}

export function ListView({ cards, onSelect, onNotInterested }: ListViewProps) {
  if (cards.length === 0) {
    return (
      <div className="px-4 py-12 text-center animate-fade-in">
        <p className="text-muted text-sm">暂无推荐</p>
      </div>
    );
  }

  // Sort by match score descending
  const sorted = [...cards].sort(
    (a, b) => (b.matchScore || 0) - (a.matchScore || 0)
  );

  return (
    <div className="animate-fade-in">
      {/* Section header — matches Figma */}
      <div className="flex items-center justify-between px-4 mb-4">
        <h2 className="text-lg font-bold text-secondary">为你精选</h2>
        <span className="text-xs text-muted">按匹配度排序 ▾</span>
      </div>

      {/* Unified vertical list — matches Figma 1:816 */}
      <div className="px-4 space-y-4">
        {sorted.map((card, index) => {
          const matchScore = card.matchScore || 0;
          const imgSrc = getRestaurantImage(card.photos, card.category);

          return (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(card)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(card);
                }
              }}
              className="relative w-full bg-white rounded-2xl shadow-card border border-gray-50 overflow-hidden text-left active:shadow-card-hover transition-shadow cursor-pointer"
            >
              {/* 右下角 "不想吃" —— 7 天内屏蔽,stopPropagation 不触发跳详情
                  从右上换到右下,并把图标从 ThumbsDown(差评语义)换成 EyeOff(屏蔽语义):
                  匹配度徽章独占右上,这里的操作按钮下沉到右下,视觉权重明显下来 */}
              {onNotInterested && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNotInterested(card);
                  }}
                  className="absolute bottom-2 right-2 z-10 w-7 h-7 rounded-full bg-white/70 backdrop-blur-sm flex items-center justify-center text-muted/70 active:scale-90 active:text-deep-red"
                  aria-label="不想吃这家"
                  title="7 天内不再推荐"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Top section: image + info */}
              <div className="flex gap-3 p-4">
                {/* Food image with optional TOP badge */}
                <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  <img
                    src={imgSrc}
                    alt={card.name}
                    className="w-full h-full object-cover"
                  />
                  {index === 0 && (
                    <div className="absolute top-1 left-1 bg-deep-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      TOP1
                    </div>
                  )}
                </div>

                {/* Text info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-bold text-secondary text-base truncate pr-2">
                      {card.name}
                    </h3>
                    {/* Match score badge */}
                    {matchScore > 0 && (
                      <div className="flex-shrink-0 bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                        {matchScore}%
                        <span className="text-[10px]">🔥</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted mb-1.5">
                    <span>{card.category.split(";")[0]}</span>
                    {card.avgPrice > 0 && (
                      <span>¥{card.avgPrice}/人</span>
                    )}
                    <span>{card.walkMinutes}分钟</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {card.rating > 0 && (
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-gold text-gold" />
                        <span className="text-xs text-secondary">{card.rating}</span>
                      </div>
                    )}
                    {/* 口味命中标签 —— 用户设了的偏好该店命中哪个,给 "为什么推给我" 一个可读答案 */}
                    {card.matchedTastes && card.matchedTastes.length > 0 && (
                      <span className="text-[10px] bg-orange-100/70 text-deep-red px-1.5 py-0.5 rounded-full font-medium">
                        中:{card.matchedTastes.slice(0, 2).join("·")}
                        {card.matchedTastes.length > 2 && "·+"}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* AI reason bubble — matches Figma's warm card style */}
              {card.reason && (
                <div className="mx-4 mb-4 bg-[#FFF8F0] rounded-xl px-3.5 py-2.5 border border-orange-100/40">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-gold mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-secondary/70 leading-relaxed line-clamp-2">
                      {card.reason}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom message — matches Figma */}
      <div className="text-center py-6">
        <p className="text-sm text-muted">今天就这些啦，明天见 ✨</p>
      </div>
    </div>
  );
}
