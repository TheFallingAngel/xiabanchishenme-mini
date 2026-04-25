import { useEffect, useState } from "react";
import { View, Text, Image, Button } from "@tarojs/components";
import type { RecommendationCard } from "@shared/types";
import { loadPrefs, savePrefs, toggleFavorite } from "@shared/storage";
import { pickHeroImage, emojiForCategory } from "@/lib/restaurant-image";
import "./ResultCard.scss";

interface ResultCardProps {
  card: RecommendationCard;
  attempt: number;
  maxAttempts: number;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * 骰子结果卡 —— 用户摇到一家店后看到的全屏大卡。
 * 1:1 对齐 H5 components/home/ResultCard.tsx 的视觉:
 *   · 头图 16:9 圆角 24px,右上角白色毛玻璃 ♡ 收藏按钮
 *   · 餐厅名 24px/700 + 评分/人均/步行三联次要信息
 *   · #FFF8F0 米黄底 AI 理由 bubble,Sparkles ✨ 前缀
 *   · 底部双按钮:再来一个 (灰底) + 看看详情 (深红渐变 CTA)
 *
 * H5 用 lucide-react 图标,小程序里换成 emoji + Unicode 字符:
 *   - Heart → ♡ / ♥
 *   - Star → ⭐
 *   - Footprints → 步行 X 分钟 (文字,不放图标)
 *   - Sparkles → ✨
 *   - X (再来一个) → ✕
 *   - ChevronRight → 文字 ›
 */
export function ResultCard({ card, onAccept, onReject }: ResultCardProps) {
  const [isFav, setIsFav] = useState(false);
  const [flash, setFlash] = useState<null | "added" | "removed">(null);
  const heroUrl = pickHeroImage(card.photos);
  const emoji = emojiForCategory(card.category, card.poiType);

  useEffect(() => {
    const p = loadPrefs();
    setIsFav(p.favorites.includes(card.id));
  }, [card.id]);

  function handleToggleFav() {
    const p = loadPrefs();
    const next = toggleFavorite(p, card.id, card.name, card.category, heroUrl || "");
    savePrefs(next);
    const nowFav = next.favorites.includes(card.id);
    setIsFav(nowFav);
    setFlash(nowFav ? "added" : "removed");
    setTimeout(() => setFlash(null), 1200);
  }

  return (
    <View className="result-card">
      {/* Hero 图片 + 收藏按钮 */}
      <View className="result-card__hero">
        {heroUrl ? (
          <Image className="result-card__img" src={heroUrl} mode="aspectFill" />
        ) : (
          <View className="result-card__placeholder">
            <Text className="result-card__placeholder-emoji">{emoji}</Text>
          </View>
        )}
        <Button
          className="result-card__fav-btn"
          onClick={handleToggleFav}
          hoverClass="result-card__fav-btn--pressed"
        >
          <Text
            className={`result-card__fav-icon ${isFav ? "result-card__fav-icon--active" : ""}`}
          >
            {isFav ? "♥" : "♡"}
          </Text>
        </Button>
        {flash && (
          <View className="result-card__flash">
            {flash === "added" ? "已收藏" : "已取消"}
          </View>
        )}
      </View>

      {/* 餐厅信息 */}
      <View className="result-card__info">
        <Text className="result-card__name">{card.name}</Text>
        <View className="result-card__meta">
          {card.rating > 0 && (
            <View className="result-card__meta-item">
              <Text className="result-card__star">⭐</Text>
              <Text>{card.rating}</Text>
            </View>
          )}
          {card.avgPrice > 0 && (
            <View className="result-card__meta-item">
              <Text>¥{card.avgPrice}/人</Text>
            </View>
          )}
          <View className="result-card__meta-item">
            <Text className="result-card__walk">步行 {card.walkMinutes} 分钟</Text>
          </View>
        </View>
      </View>

      {/* AI 推荐理由 */}
      <View className="result-card__reason">
        <Text className="result-card__reason-icon">✨</Text>
        <Text className="result-card__reason-text">{card.reason}</Text>
      </View>

      {/* 双按钮 */}
      <View className="result-card__actions">
        <Button
          className="result-card__btn result-card__btn--secondary"
          onClick={onReject}
          hoverClass="result-card__btn--pressed"
        >
          <Text className="result-card__btn-x">✕</Text>
          再来一个
        </Button>
        <Button
          className="result-card__btn result-card__btn--primary"
          onClick={onAccept}
          hoverClass="result-card__btn--pressed"
        >
          看看详情
          <Text className="result-card__btn-arrow">›</Text>
        </Button>
      </View>
    </View>
  );
}
