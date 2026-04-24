"use client";

import type { DishPhotoRecord } from "./types";
import { getOrCreateDeviceId } from "./device-id";

/**
 * 招牌菜 UGC 照片 客户端封装 —— 对 /api/dish-photos/* 的 fetch / submit / upload
 * 共用 /api/reviews/upload 图床端点 (它只是在 Vercel Blob 里放一份 public 文件,
 * 不区分用途),所以没有专门的 dish-photos/upload 路由。
 */

export async function fetchDishPhotos(
  restaurantId: string
): Promise<DishPhotoRecord[]> {
  try {
    const res = await fetch(
      `/api/dish-photos/${encodeURIComponent(restaurantId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.photos) ? data.photos : [];
  } catch {
    return [];
  }
}

export async function submitDishPhoto(
  restaurantId: string,
  payload: {
    nickname: string;
    dishName: string;
    imageUrl: string;
  }
): Promise<DishPhotoRecord> {
  const deviceId = getOrCreateDeviceId();
  const res = await fetch(
    `/api/dish-photos/${encodeURIComponent(restaurantId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, deviceId }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "提交失败");
  }
  return data.photo as DishPhotoRecord;
}

/**
 * 把同一家店的 UGC 记录按 dishName 聚合成 Map<菜名, url[]>。
 * 同名菜合并,按 createdAt 倒序 —— 最新上传排前面,让详情页封面优先显示最新的。
 */
export function groupDishPhotosByName(
  records: DishPhotoRecord[]
): Map<string, string[]> {
  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const out = new Map<string, string[]>();
  for (const r of sorted) {
    const key = r.dishName.trim();
    if (!key) continue;
    const arr = out.get(key) || [];
    arr.push(r.imageUrl);
    out.set(key, arr);
  }
  return out;
}
