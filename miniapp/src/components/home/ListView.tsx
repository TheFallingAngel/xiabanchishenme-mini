import { View, Text, Image, Button, ScrollView } from "@tarojs/components";
import type { RecommendationCard } from "@shared/types";
import { pickHeroImage, emojiForCategory } from "@/lib/restaurant-image";
import "./ListView.scss";

interface ListViewProps {
  cards: RecommendationCard[];
  onSelect: (card: RecommendationCard) => void;
  onNotInterested?: (card: RecommendationCard) => void;
}

/**
 * 列表模式 —— 1:1 复刻 H5 ListView.tsx。
 * 单列卡片,左图 80x80 圆角 + 右文字 (店名/类别/匹配度/AI 理由)。
 * 右上角红色匹配度徽章,右下角圆形 EyeOff 按钮做"不想吃"屏蔽。
 *
 * H5 用 lucide-react 的 Star/Sparkles/EyeOff 图标,小程序换 emoji:
 *   ⭐ 评分 / ✨ AI 理由 / ⊘ 不想吃 (用 Unicode)
 */
export function ListView({ cards, onSelect, onNotInterested }: ListViewProps) {
  if (cards.length === 0) {
    return (
      <View className="list-view__empty">
        <Text className="list-view__empty-text">暂无推荐</Text>
      </View>
    );
  }

  // 按 matchScore 降序
  const sorted = [...cards].sort(
    (a, b) => (b.matchScore || 0) - (a.matchScore || 0)
  );

  return (
    <ScrollView scrollY className="list-view" enhanced showScrollbar={false}>
      <View className="list-view__header">
        <Text className="list-view__title">为你精选</Text>
        <Text className="list-view__subtitle">按匹配度排序 ▾</Text>
      </View>

      <View className="list-view__items">
        {sorted.map((card, index) => {
          const matchScore = card.matchScore || 0;
          const heroUrl = pickHeroImage(card.photos);
          const emoji = emojiForCategory(card.category, card.poiType);

          return (
            <View
              key={card.id}
              className="card"
              onClick={() => onSelect(card)}
              hoverClass="card--hover"
            >
              {/* 顶部:图 + 文字 + 不想吃按钮 */}
              <View className="card__top">
                <View className="card__img-wrap">
                  {heroUrl ? (
                    <Image className="card__img" src={heroUrl} mode="aspectFill" />
                  ) : (
                    <View className="card__img-placeholder">
                      <Text className="card__img-emoji">{emoji}</Text>
                    </View>
                  )}
                  {index === 0 && <View className="card__top1">TOP1</View>}
                </View>

                <View className="card__info">
                  <View className="card__name-row">
                    <Text className="card__name">{card.name}</Text>
                    {matchScore > 0 && (
                      <View className="card__match">
                        {matchScore}%<Text className="card__match-fire">🔥</Text>
                      </View>
                    )}
                  </View>

                  <View className="card__meta">
                    <Text>{card.category.split(";")[0]}</Text>
                    {card.avgPrice > 0 && <Text> · ¥{card.avgPrice}/人</Text>}
                    <Text> · {card.walkMinutes} 分钟</Text>
                  </View>

                  <View className="card__rating-row">
                    {card.rating > 0 && (
                      <View className="card__rating">
                        <Text className="card__star">⭐</Text>
                        <Text>{card.rating}</Text>
                      </View>
                    )}
                    {card.matchedTastes && card.matchedTastes.length > 0 && (
                      <View className="card__taste-hit">
                        中:{card.matchedTastes.slice(0, 2).join("·")}
                        {card.matchedTastes.length > 2 ? "·+" : ""}
                      </View>
                    )}
                  </View>
                </View>

                {/* 右下"不想吃" —— H5 那边右下角小灰按钮 */}
                {onNotInterested && (
                  <Button
                    className="card__not-interested"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotInterested(card);
                    }}
                    hoverClass="card__not-interested--pressed"
                  >
                    <Text className="card__eye-off">⊘</Text>
                  </Button>
                )}
              </View>

              {/* AI 理由 */}
              {card.reason && (
                <View className="card__reason">
                  <Text className="card__reason-icon">✨</Text>
                  <Text className="card__reason-text">{card.reason}</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <View className="list-view__footer">
        <Text>今天就这些啦,明天见 ✨</Text>
      </View>
    </ScrollView>
  );
}
