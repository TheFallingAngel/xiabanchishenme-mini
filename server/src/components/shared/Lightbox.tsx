"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface LightboxProps {
  images: { url: string; title?: string }[];
  initialIndex?: number;
  onClose: () => void;
}

/**
 * 全屏图片查看器
 * - 支持左右切换
 * - 支持单指滑动关闭 / 双指缩放 / 拖动
 * - 支持双击放大
 */
export function Lightbox({ images, initialIndex = 0, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // touch state
  const touchStart = useRef<{
    x: number;
    y: number;
    d?: number;
    startScale?: number;
    startOffset?: { x: number; y: number };
  } | null>(null);

  const total = images.length;

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const prev = useCallback(() => {
    resetZoom();
    setIndex((i) => (i - 1 + total) % total);
  }, [total, resetZoom]);

  const next = useCallback(() => {
    resetZoom();
    setIndex((i) => (i + 1) % total);
  }, [total, resetZoom]);

  // ESC / 方向键
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    // 锁滚动
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next]);

  // 双击放大
  const lastTap = useRef(0);
  function handleImgClick(e: React.MouseEvent) {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setScale((s) => (s > 1 ? 1 : 2));
      if (scale > 1) setOffset({ x: 0, y: 0 });
    }
    lastTap.current = now;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      touchStart.current = {
        x: 0,
        y: 0,
        d,
        startScale: scale,
        startOffset: offset,
      };
    } else {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        startOffset: offset,
      };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!touchStart.current) return;
    if (e.touches.length === 2 && touchStart.current.d) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const nextScale = Math.min(
        4,
        Math.max(1, (touchStart.current.startScale || 1) * (d / touchStart.current.d))
      );
      setScale(nextScale);
      if (nextScale === 1) setOffset({ x: 0, y: 0 });
    } else if (scale > 1) {
      // 单指 & 已放大 → 平移
      const dx = e.touches[0].clientX - touchStart.current.x;
      const dy = e.touches[0].clientY - touchStart.current.y;
      const base = touchStart.current.startOffset || { x: 0, y: 0 };
      setOffset({ x: base.x + dx, y: base.y + dy });
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    // 未放大状态下的单指横向滑动 → 切图
    if (scale === 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - touchStart.current.x;
      const dy = e.changedTouches[0].clientY - touchStart.current.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) prev();
        else next();
      } else if (Math.abs(dy) > 100 && Math.abs(dy) > Math.abs(dx)) {
        // 下拉关闭
        onClose();
      }
    }
    touchStart.current = null;
  }

  const img = images[index];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-6 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center z-10"
        aria-label="关闭"
      >
        <X className="w-5 h-5 text-white" />
      </button>

      {/* Counter */}
      {total > 1 && (
        <div className="absolute top-7 left-0 right-0 text-center text-white/80 text-sm font-medium">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm items-center justify-center z-10"
          aria-label="上一张"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm items-center justify-center z-10"
          aria-label="下一张"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Image */}
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={img.url}
          alt={img.title || ""}
          onClick={handleImgClick}
          className="max-w-full max-h-full object-contain select-none transition-transform"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center",
            transitionDuration: touchStart.current ? "0ms" : "200ms",
          }}
          draggable={false}
        />
      </div>

      {/* Title */}
      {img.title && (
        <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-sm px-8">
          {img.title}
        </div>
      )}
    </div>
  );
}
