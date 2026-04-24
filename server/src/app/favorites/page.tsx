"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Heart, Search, X } from "lucide-react";
import { loadPrefs, savePrefs, toggleFavorite } from "@/lib/storage";
import { MOCK_RESTAURANTS } from "@/lib/mock-data";
import { getImageForCategory } from "@/lib/images";
import type { FavoriteRecord } from "@/lib/types";

interface DisplayItem {
  id: string;
  name: string;
  category: string;
  heroImage?: string;
}

export default function FavoritesPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteDetails, setFavoriteDetails] = useState<Record<string, FavoriteRecord>>({});
  // 搜索 —— 替代原先只是装饰用的 search 图标
  const [query, setQuery] = useState("");
  // 取消收藏成功后的 toast
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const prefs = loadPrefs();
    setFavorites(prefs.favorites);
    setFavoriteDetails(prefs.favoriteDetails || {});
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  }

  function handleUnfavorite(id: string, name: string) {
    const p = loadPrefs();
    const next = toggleFavorite(p, id, name);
    savePrefs(next);
    setFavorites(next.favorites);
    setFavoriteDetails(next.favoriteDetails || {});
    showToast(`已取消收藏 · ${name}`);
  }

  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = favorites.map((id) => {
      const mock = MOCK_RESTAURANTS.find((r) => r.id === id);
      const detail = favoriteDetails[id];
      return {
        id,
        name: detail?.restaurantName || mock?.name || id,
        category: detail?.category || mock?.category || "",
        heroImage: detail?.heroImage,
      };
    });
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
    );
  }, [favorites, favoriteDetails, query]);

  const totalFav = favorites.length;
  const filtered = displayItems.length;
  const hasQuery = query.trim().length > 0;

  return (
    <main className="min-h-screen bg-cream pb-safe animate-fade-in">
      {/* Header */}
      <div className="px-4 pt-14 pb-4">
        <h1 className="text-2xl font-bold text-secondary">收藏</h1>
        <p className="text-sm text-muted mt-1">找到美食的时候收藏起来</p>

        {/* 真实搜索框 —— 替换原来装饰用的 Search 图标 */}
        {totalFav > 0 && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索收藏的餐厅 / 菜系"
              className="w-full bg-white border border-gray-100 rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-deep-red focus:ring-1 focus:ring-deep-red/20"
            />
            {hasQuery && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-muted active:scale-90"
                aria-label="清空搜索"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {hasQuery && totalFav > 0 && (
          <p className="text-xs text-muted mt-2">
            共 {totalFav} 家收藏,匹配到 {filtered} 家
          </p>
        )}
      </div>

      <div className="px-4">
        {totalFav === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-gold-light rounded-full flex items-center justify-center mb-4">
              <Heart className="w-10 h-10 text-gold" />
            </div>
            <h2 className="text-lg font-semibold text-secondary mb-2">还没有收藏</h2>
            <p className="text-sm text-muted mb-6">在推荐页点击收藏，下次直接找到</p>
            <button
              onClick={() => router.push("/")}
              className="bg-deep-red text-white px-6 py-2.5 rounded-xl text-sm font-medium shadow-card active:scale-95 transition-transform"
            >
              去发现美食
            </button>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted">没有匹配的收藏</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-3 text-xs text-deep-red underline active:scale-95"
            >
              清空搜索
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {displayItems.map((item) => (
              <div
                key={item.id}
                className="relative"
              >
                <button
                  onClick={() => router.push(`/restaurant/${item.id}`)}
                  className="text-left active:scale-[0.98] transition-transform w-full"
                >
                  <div className="w-full h-36 rounded-2xl overflow-hidden bg-gray-100 mb-1.5">
                    <img
                      src={item.heroImage || getImageForCategory(item.category)}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-sm font-medium text-secondary truncate">{item.name}</p>
                </button>
                {/* 右上角已收藏 ❤ —— 独立按钮,stopPropagation 不触发跳转 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnfavorite(item.id, item.name);
                  }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/85 backdrop-blur-sm shadow flex items-center justify-center active:scale-90"
                  aria-label="取消收藏"
                  title="取消收藏"
                >
                  <Heart className="w-4 h-4 fill-deep-red text-deep-red" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-black/85 text-white text-xs px-4 py-2 rounded-full shadow-card z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </main>
  );
}
