"use client";

import { Star, MessageSquare } from "lucide-react";
import type { ReviewRecord } from "@/lib/types";
import { relativeTime } from "@/lib/reviews";
import { useState } from "react";

/**
 * 食客评价列表。
 *
 * 状态:
 *   · loading       -> 2 条骨架
 *   · 评价数 === 0   -> 空状态引导
 *   · 有评价         -> 列表
 *
 * 图片点击放大:本组件内自己处理一个 overlay,不引外部依赖。
 */
export function ReviewList({
  reviews,
  loading,
  myReviewIds = [],
}: {
  reviews: ReviewRecord[];
  loading: boolean;
  myReviewIds?: string[];
}) {
  const [preview, setPreview] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl p-4 shadow-card border border-gray-100"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-2.5 bg-gray-100 rounded animate-pulse w-14" />
              </div>
            </div>
            <div className="h-3 bg-gray-100 rounded animate-pulse w-full mb-2" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-card border border-gray-100 text-center">
        <MessageSquare className="w-8 h-8 text-muted mx-auto mb-2 opacity-60" />
        <p className="text-sm text-secondary mb-1">还没人写过这家</p>
        <p className="text-xs text-muted">吃完来留两句,帮下一个纠结的人省点事</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((r) => {
        const mine = myReviewIds.includes(r.id);
        return (
          <div
            key={r.id}
            className={`bg-white rounded-2xl p-4 shadow-card border ${
              mine ? "border-orange-200 bg-orange-50/30" : "border-gray-100"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {/* 头像占位 —— 取昵称首字 */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-deep-red to-gold text-white text-sm flex items-center justify-center font-medium shrink-0">
                {r.nickname.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-primary truncate max-w-[8rem]">
                    {r.nickname}
                  </span>
                  {mine && (
                    <span className="text-[10px] bg-orange-100 text-deep-red px-1.5 py-0.5 rounded-full">
                      我
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted">{relativeTime(r.createdAt)}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`w-3.5 h-3.5 ${
                      n <= r.rating
                        ? "fill-gold text-gold"
                        : "text-gray-200 fill-gray-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            {r.text && (
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-wrap break-words">
                {r.text}
              </p>
            )}

            {r.imageUrls.length > 0 && (
              <div className={`flex gap-2 mt-3 ${r.text ? "" : ""}`}>
                {r.imageUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPreview(url)}
                    className="w-20 h-20 rounded-lg overflow-hidden bg-gray-50 shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="评价图片"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 放大预览 overlay */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="评价图片"
            className="max-w-full max-h-full rounded-xl"
          />
        </div>
      )}
    </div>
  );
}
