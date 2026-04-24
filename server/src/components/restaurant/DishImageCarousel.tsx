"use client";

import { useRef, useState } from "react";

/**
 * 招牌菜单元格的图片轮播 —— 一道菜在 UGC + POI 合并后可能有多张图,
 * 用 CSS scroll-snap 做滑动切换,触屏友好 + 无需额外手势库。
 *
 * 交互规则:
 *  · 单图:就是普通缩略图,点击回调 onImageClick(0)
 *  · 多图:
 *     - 横向 scroll-snap-x 一页一张,左右滑切换
 *     - 右上角显示 "1/N" 计数
 *     - 底部中央显示小圆点 (当前页拉长),跟随滚动同步
 *     - 点击当前图触发 onImageClick(currentIndex),进大图 lightbox
 *
 * badge 可选:如果这格子是 UGC-only 菜品 或 含 UGC 图,在左上角打角标
 * 区分"食客图"与 POI 原图。
 *
 * 注意:组件不处理 lightbox,只暴露回调;所有的 lightbox 控制在父组件里。
 * 这样能跟现有 Lightbox 组件共用一套图库。
 */
export function DishImageCarousel({
  images,
  badge,
  onImageClick,
}: {
  /** 图片 URL 列表,按优先级排好序 (UGC 最新 → POI 原图 → 兜底) */
  images: string[];
  /** 左上角可选角标,例如 "食客图" / "食客图 3" */
  badge?: string;
  /** 点击某张图的回调,带 index (0-based) */
  onImageClick?: (index: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // 节流靠 requestAnimationFrame —— 滚动频率高,rAF 保证一帧只更新一次 state
  const rafRef = useRef<number | null>(null);
  function handleScroll() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      if (next !== index && next >= 0 && next < images.length) {
        setIndex(next);
      }
    });
  }

  if (!images.length) return null;

  const multi = images.length > 1;

  return (
    <div className="w-full aspect-square rounded-xl overflow-hidden bg-gray-100 relative">
      <div
        ref={scrollerRef}
        onScroll={multi ? handleScroll : undefined}
        className={
          "flex h-full" +
          (multi
            ? " overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "")
        }
      >
        {images.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => onImageClick?.(i)}
            className="flex-none w-full h-full snap-start active:opacity-85 transition-opacity"
          >
            <img
              src={url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              draggable={false}
            />
          </button>
        ))}
      </div>

      {badge && (
        <span className="absolute top-1 left-1 bg-deep-red/90 text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium pointer-events-none">
          {badge}
        </span>
      )}

      {multi && (
        <>
          <span className="absolute top-1 right-1 bg-black/55 text-white text-[10px] leading-none px-1.5 py-1 rounded-full font-medium pointer-events-none">
            {index + 1}/{images.length}
          </span>
          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1 pointer-events-none">
            {images.map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 rounded-full transition-all duration-200 " +
                  (i === index ? "w-3 bg-white" : "w-1 bg-white/55")
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
