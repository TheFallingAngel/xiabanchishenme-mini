"use client";

import { useEffect } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

interface TransitionViewProps {
  target: "swipe" | "list";
  onComplete: () => void;
}

export function TransitionView({ target, onComplete }: TransitionViewProps) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  if (target === "swipe") {
    return <SwipeTransition />;
  }
  return <ListTransition />;
}

/** Frame 3: Dice → Swipe transition — matches Figma 1:1114 */
function SwipeTransition() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 animate-fade-in relative overflow-hidden">
      {/* Minimized dice at 30% opacity — visual continuity from dice phase */}
      <div className="mb-8 opacity-30">
        <div className="w-[69px] h-[69px] rounded-2xl bg-gradient-to-br from-[#B83A2A] to-[#8B2D1F] flex items-center justify-center shadow-lg">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
          </div>
        </div>
      </div>

      {/* Main text — 24pt Bold deep red */}
      <h2 className="text-2xl font-bold text-deep-red mb-6">不如自己看看？</h2>

      {/* Swipe gesture indicator — matches Figma swipe icon cluster */}
      <div className="flex flex-col items-center gap-3 mb-6">
        {/* Horizontal line with center dot */}
        <div className="relative w-48 h-1 flex items-center">
          <div className="absolute inset-0 bg-gray-200 rounded-full" />
          <div className="absolute left-1/2 -translate-x-1/2 w-8 h-1 bg-deep-red rounded-full" />
        </div>
        {/* Left arrow + hand + right arrow */}
        <div className="flex items-center gap-6">
          <ChevronLeft className="w-5 h-5 text-muted animate-pulse" />
          <div className="text-2xl">👆</div>
          <ChevronRight className="w-5 h-5 text-muted animate-pulse" />
        </div>
      </div>

      {/* Subtitle — corrected copy */}
      <p className="text-sm text-muted text-center">向左跳过，向右选中</p>

      {/* Peek of next card on right side — visual hint */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-64 bg-white rounded-l-2xl shadow-card opacity-40 translate-x-4" />
    </div>
  );
}

/** Frame 5: Swipe → List transition — matches Figma 1:955 */
function ListTransition() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 animate-fade-in relative">
      {/* Main text — 24pt Bold deep red */}
      <h2 className="text-2xl font-bold text-deep-red mb-4">不藏了，全部给你</h2>

      {/* Down arrow — indicating scroll down to list */}
      <div className="mb-4 animate-bounce">
        <ChevronDown className="w-6 h-6 text-deep-red" />
      </div>

      {/* Subtitle — corrected copy */}
      <p className="text-sm text-muted text-center">按匹配度为你排好了</p>

      {/* Peek of first list card at bottom — visual hint */}
      <div className="mt-12 w-full max-w-sm">
        <div className="bg-white rounded-t-2xl shadow-card border border-gray-100 p-4 opacity-50 translate-y-4">
          <div className="flex gap-3">
            <div className="w-14 h-14 rounded-xl bg-gray-100 flex-shrink-0" />
            <div className="flex-1">
              <div className="w-32 h-4 bg-gray-100 rounded mb-2" />
              <div className="w-20 h-3 bg-gray-100 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
