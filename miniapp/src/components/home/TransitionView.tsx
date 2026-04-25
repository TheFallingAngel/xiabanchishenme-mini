import { useEffect } from "react";
import { View, Text } from "@tarojs/components";
import "./TransitionView.scss";

interface TransitionViewProps {
  /** "swipe" 进入卡片堆叠 / "list" 进入列表;只影响文案 */
  target: "swipe" | "list";
  /** 过渡完成回调 (~600ms 后自动触发) */
  onComplete: () => void;
}

/**
 * 模式切换过渡画面 —— 给状态机的 TRANSITION_SWIPE / TRANSITION_LIST 相位用。
 * 600ms 后自动 onComplete,父组件 dispatch COMPLETE_TRANSITION_*
 * 让用户感知"系统在切换",而不是页面瞬间换内容。
 */
export function TransitionView({ target, onComplete }: TransitionViewProps) {
  useEffect(() => {
    const t = setTimeout(onComplete, 600);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <View className="transition-view">
      <View className="transition-view__spinner" />
      <Text className="transition-view__text">
        {target === "swipe" ? "进入卡片模式…" : "切到列表浏览…"}
      </Text>
    </View>
  );
}
