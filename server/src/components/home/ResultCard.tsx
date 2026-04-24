"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight,
  X,
  Footprints,
  Wallet,
  Star,
  Sparkles,
  Heart,
} from "lucide-react";
import type { RecommendationCard } from "@/lib/types";
import type { PhotoTag } from "@/lib/image-tag";
import { prefetchTags, splitLocalCache } from "@/lib/image-tag-client";
import { getRestaurantImage } from "@/lib/images";
import { loadPrefs, savePrefs, toggleFavorite } from "@/lib/storage";

interface ResultCardProps {
  card: RecommendationCard;
  attempt: number;
  maxAttempts: number;
  onAccept: () => void;
  onReject: () => void;
}

export function ResultCard({ card, attempt, maxAttempts, onAccept, onReject }: ResultCardProps) {
  const remaining = maxAttempts - attempt;
  // 骰子结果卡右上角 ❤:从 prefs 读初始状态,toggle 后同步 localStorage。
  // 这里拿到的 card 是当下骰到的店,切换到下一家 (attempt/id 变) 时重算。
  const [isFav, setIsFav] = useState(false);
  const [flash, setFlash] = useState<null | "added" | "removed">(null);
  // 图片 AI 打标的缓存读 —— 首次展示 (无缓存) 用 photos[0],
  // 用户进过一次详情页之后 KV 就有记录,下次骰到同一家会按 storefront 重排。
  const [photoTags, setPhotoTags] = useState<Record<string, PhotoTag>>({});
  const imgSrc = getRestaurantImage(card.photos, card.category, "hero", photoTags);

  useEffect(() => {
    const p = loadPrefs();
    setIsFav(p.favorites.includes(card.id));
  }, [card.id]);

  // 骰到新卡片就顺手查一次 tag 缓存 (prefetchTags 只读,不触发 VL)。
  // client 模块内部两级缓存: L1 内存 Map / L2 localStorage(7 天),全命中则 0 网络。
  // 没有 photos 或打标失败时静默保持空 map,不影响 photos[0] 兜底。
  useEffect(() => {
    if (!card.photos || card.photos.length === 0) return;
    const photos = card.photos;
    // 先拿一次本地命中的部分,立刻同步喂给 state —— 这样 hero 图可以零延迟重排
    const { hit } = splitLocalCache(photos);
    if (Object.keys(hit).length > 0) {
      setPhotoTags((prev) => ({ ...prev, ...hit }));
    }
    let cancelled = false;
    (async () => {
      // miss 的交给服务端 KV,命中后合并到 state;miss=0 的 case 内部会直接跳过 fetch
      const tags = await prefetchTags(photos);
      if (!cancelled && Object.keys(tags).length > 0) {
        setPhotoTags((prev) => ({ ...prev, ...tags }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.id, card.photos]);

  function handleToggleFav(e: React.MouseEvent) {
    e.stopPropagation();
    const p = loadPrefs();
    // 把当前卡片头图一起存,收藏页就能显示真实餐厅图,而不是 category 占位
    const next = toggleFavorite(p, card.id, card.name, card.category, imgSrc);
    savePrefs(next);
    const nowFav = next.favorites.includes(card.id);
    setIsFav(nowFav);
    setFlash(nowFav ? "added" : "removed");
    setTimeout(() => setFlash(null), 1200);
  }

  return (
    <div className="px-4 animate-fade-in">
      {/* Hero food image with heart overlay */}
      <div className="relative w-full h-52 rounded-3xl overflow-hidden mb-4 bg-gray-100">
        <img src={imgSrc} alt={card.name} className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={handleToggleFav}
          aria-pressed={isFav}
          aria-label={isFav ? "取消收藏" : "收藏"}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
        >
          <Heart
            className={`w-5 h-5 transition-colors ${
              isFav ? "fill-deep-red text-deep-red" : "text-muted"
            }`}
          />
        </button>
        {flash && (
          <span className="absolute top-3 right-14 text-[11px] px-2 py-1 rounded-full bg-black/70 text-white animate-fade-in">
            {flash === "added" ? "已收藏" : "已取消"}
          </span>
        )}
      </div>

      {/* Restaurant info */}
      <div className="mb-3">
        <h2 className="text-2xl font-bold text-secondary mb-1">{card.name}</h2>
        <div className="flex items-center gap-3 text-sm text-muted">
          {card.rating > 0 && (
            <div className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-gold text-gold" />
              <span>{card.rating}</span>
            </div>
          )}
          {card.avgPrice > 0 && (
            <div className="flex items-center gap-1">
              <Wallet className="w-3.5 h-3.5" />
              <span>¥{card.avgPrice}/人</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Footprints className="w-3.5 h-3.5 text-deep-red" />
            <span>步行{card.walkMinutes}分钟</span>
          </div>
        </div>
      </div>

      {/* AI reason card */}
      <div className="bg-[#FFF8F0] rounded-2xl p-4 mb-5 border border-orange-100/60">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-gold mt-0.5 flex-shrink-0" />
          <p className="text-sm text-secondary/80 leading-relaxed">{card.reason}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-gray-100 text-muted font-medium active:scale-95 transition-transform"
        >
          <X className="w-4.5 h-4.5" />
          再来一个
        </button>
        <button
          onClick={onAccept}
          className="flex-[1.3] flex items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-gradient-to-r from-deep-red to-deep-red-dark text-white font-medium shadow-card active:scale-95 transition-transform"
        >
          看看详情
          <ChevronRight className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
}
