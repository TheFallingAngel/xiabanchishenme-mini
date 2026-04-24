"use client";

import { useState } from "react";
import { UtensilsCrossed, Soup, ChefHat } from "lucide-react";

interface DiceViewProps {
  attempt: number;
  maxAttempts: number;
  onRoll: () => void;
  onSkipToSwipe: () => void;
}

export function DiceView({ attempt, maxAttempts, onRoll, onSkipToSwipe }: DiceViewProps) {
  const [shaking, setShaking] = useState(false);

  function handleRoll() {
    setShaking(true);
    setTimeout(() => {
      setShaking(false);
      onRoll();
    }, 600);
  }

  return (
    <div className="flex flex-col items-center px-4 animate-fade-in">
      {/* Dice card — large tappable red/brown rounded square */}
      <button
        onClick={handleRoll}
        disabled={shaking}
        className={`w-44 h-44 rounded-[2.5rem] bg-gradient-to-br from-[#B83A2A] to-[#8B2D1F] shadow-float flex flex-col items-center justify-center gap-3 mt-4 mb-6 active:scale-95 transition-transform disabled:opacity-80 ${
          shaking ? "animate-bounce" : ""
        }`}
      >
        <div className="flex items-center gap-4">
          <Soup className="w-8 h-8 text-white/80" strokeWidth={1.5} />
          <ChefHat className="w-8 h-8 text-white/80" strokeWidth={1.5} />
        </div>
        <UtensilsCrossed className="w-8 h-8 text-white/80" strokeWidth={1.5} />
      </button>

      {/* Main text */}
      <h2 className="text-xl font-bold text-secondary mb-1.5">摇一摇，找灵感</h2>
      <p className="text-sm text-muted">不知道吃什么？交给骰子吧</p>

    </div>
  );
}
