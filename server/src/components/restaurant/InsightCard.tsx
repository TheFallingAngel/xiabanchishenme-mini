"use client";

import { Sparkles, Loader2 } from "lucide-react";

/**
 * 详情页的 "为什么是这家" 段落。
 *
 * 三态:
 *   · loading    -> 如果有 fallback (卡片带来的短 reason),先用 fallback 占位+右上角"正在升级";
 *                   没有 fallback 才走骨架屏。目的是解决 MiniMax LLM 首次冷启 10s+ 的白屏观感。
 *   · insight    -> LLM 产出的 40-80 字段落,暖橙竖线 + Sparkles 图标
 *   · fallback   -> LLM 失败时,展示从卡片带来的一句话 reason (短版)
 *
 * 样式参考 ResultCard:浅粉底 + 暖橙强调色,与产品 "温暖 · 克制" 调性一致。
 */
export function InsightCard({
  loading,
  insight,
  fallback,
}: {
  loading: boolean;
  insight: string | null;
  fallback?: string;
}) {
  // 既没有 LLM 结果也没有降级文案 → 不显示,避免空白占位
  if (!loading && !insight && !fallback) return null;

  // 正在加载并且有 fallback 可用 —— 先把 fallback 摆上去,LLM 回来再无缝替换
  const showFallbackWhileLoading = loading && !insight && !!fallback;

  return (
    <div className="bg-[#FFF8F0] rounded-2xl p-4 shadow-card mb-4 border border-orange-100/60 relative overflow-hidden">
      {/* 暖橙左侧竖线点缀 */}
      <div className="absolute left-0 top-4 bottom-4 w-1 bg-gradient-to-b from-deep-red to-gold rounded-r" />

      <div className="pl-2">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-deep-red" />
          <span className="text-sm font-medium text-secondary">为什么是这家</span>
          {loading && (
            <Loader2 className="w-3.5 h-3.5 text-muted animate-spin ml-1" />
          )}
          <span className="ml-auto text-[10px] bg-gold-light text-gold px-2 py-0.5 rounded-full">
            {showFallbackWhileLoading ? "升级中" : "AI 个性化"}
          </span>
        </div>

        {insight ? (
          <p className="text-sm text-secondary leading-relaxed">{insight}</p>
        ) : showFallbackWhileLoading ? (
          /* 有 fallback 可用 —— 用它先垫着,避免 LLM 冷启期间整卡空白 */
          <p className="text-sm text-secondary/80 leading-relaxed">{fallback}</p>
        ) : loading ? (
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-4/5" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          /* LLM 失败 + 没 insight 但有 fallback */
          <p className="text-sm text-secondary leading-relaxed">{fallback}</p>
        )}
      </div>
    </div>
  );
}
