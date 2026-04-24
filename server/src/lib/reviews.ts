"use client";

import type { ReviewRecord } from "./types";
import { getOrCreateDeviceId } from "./device-id";

/**
 * 评价系统的客户端封装 —— 统一对 /api/reviews/* 的 fetch,
 * 让组件层不用操心 URL 和错误格式。
 *
 * 所有方法都会在失败时抛出 Error(带文案),组件用 try/catch 接。
 */

export async function fetchReviews(restaurantId: string): Promise<ReviewRecord[]> {
  try {
    const res = await fetch(`/api/reviews/${encodeURIComponent(restaurantId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.reviews) ? data.reviews : [];
  } catch {
    return [];
  }
}

export async function submitReview(
  restaurantId: string,
  payload: {
    nickname: string;
    rating: number;
    text: string;
    imageUrls: string[];
  }
): Promise<ReviewRecord> {
  const deviceId = getOrCreateDeviceId();
  const res = await fetch(`/api/reviews/${encodeURIComponent(restaurantId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, deviceId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "提交失败");
  }
  return data.review as ReviewRecord;
}

/**
 * 前端图像压缩 —— iOS/Android 相机原图常在 4-10MB,会被后端 MAX_BYTES=4MB 卡死。
 *
 * 策略:
 *   · 长边缩到 ≤ 1600px (够食物照片看清细节,又不至于超大)
 *   · 直接重编码为 JPEG quality=0.82,比 HEIC 和高分辨率 JPEG 都小很多
 *   · 原文件 ≤ 1MB 直接放行不压 (小图再压只会损失质量不省空间)
 *   · 非图片类型 (video 等) 直接原样返回,交给服务端拒绝
 *   · 压不动 (Safari 私有相册/SVG 之类) 就 fallback 原文件,让服务端给确定的错
 *
 * 这是纯浏览器 API (Canvas + createImageBitmap),只在 client 跑。
 */
const COMPRESS_BYPASS_THRESHOLD = 1 * 1024 * 1024; // ≤1MB 不压
const COMPRESS_MAX_DIMENSION = 1600;
const COMPRESS_JPEG_QUALITY = 0.82;

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= COMPRESS_BYPASS_THRESHOLD) return file;
  if (typeof document === "undefined") return file; // SSR 兜底,正常不会走到

  try {
    // createImageBitmap 是标准 API,iOS 14+ / Chrome 50+ 都支持;
    // 它会自动解 HEIC/Orientation,比 <img>.onload 路径更可靠。
    const bitmap = await createImageBitmap(file);
    const { width: w0, height: h0 } = bitmap;
    const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_JPEG_QUALITY)
    );
    if (!blob) return file;

    // 压出来比原图还大就别折腾了 (少见,但 PNG 透明背景重编码可能这样)
    if (blob.size >= file.size) return file;

    // 文件名改成 .jpg,老名字里的 .heic/.png 已经不匹配真实格式了
    const renamed = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], renamed, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    // 压失败 → 原图上传,让服务端给"超过 4MB"这种确定错误
    return file;
  }
}

export async function uploadReviewImage(file: File): Promise<string> {
  // 先走一遍压缩,把 iOS 相机原图 (往往 4-8MB) 削到 ≤1MB 再上传
  const toSend = await compressImageForUpload(file);
  const fd = new FormData();
  fd.append("file", toSend);
  const res = await fetch("/api/reviews/upload", {
    method: "POST",
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "上传失败");
  }
  return data.url as string;
}

/** 给一条评价拿一个相对时间文案 —— "刚刚" / "3 小时前" / "昨天" / "3 天前" / "yyyy-mm-dd" */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
