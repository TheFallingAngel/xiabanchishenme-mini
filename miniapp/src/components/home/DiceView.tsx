import { useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import "./DiceView.scss";

interface DiceViewProps {
  onRoll: () => void;
  onSkipToSwipe: () => void;
}

/**
 * 大骰子主入口 —— 用户进首页就看到的视觉锚点。
 * H5 用 lucide 图标 (Soup/ChefHat/UtensilsCrossed) 摆三联,小程序里没法用 lucide,
 * 用 emoji 等价代替 (🍲 / 👨‍🍳 / 🍴),既复古又轻量。
 *
 * 摇动动画用 CSS keyframe (@keyframes dice-shake),touch start 时加 class,
 * 600ms 后回调 onRoll 让父组件 dispatch ROLL_DICE。
 */
export function DiceView({ onRoll }: DiceViewProps) {
  const [shaking, setShaking] = useState(false);

  function handleRoll() {
    if (shaking) return;
    setShaking(true);
    setTimeout(() => {
      setShaking(false);
      onRoll();
    }, 600);
  }

  return (
    <View className="dice-view">
      <Button
        className={`dice-view__cube ${shaking ? "dice-view__cube--shaking" : ""}`}
        onClick={handleRoll}
        disabled={shaking}
        hoverClass="dice-view__cube--pressed"
      >
        <View className="dice-view__cube-row">
          <Text className="dice-view__emoji">🍲</Text>
          <Text className="dice-view__emoji">👨‍🍳</Text>
        </View>
        <Text className="dice-view__emoji dice-view__emoji--single">🍴</Text>
      </Button>

      <Text className="dice-view__title">摇一摇,找灵感</Text>
      <Text className="dice-view__desc">不知道吃什么?交给骰子吧</Text>
    </View>
  );
}
