"use client";

/**
 * 设备级匿名身份 (方案 A)
 *
 * 当前这个阶段不做账号系统,用一个稳定的 UUID (存 localStorage) 给每台设备一个身份。
 * 作用:
 *   1. 用户写评价 / 传菜品照片时,在服务端 KV 记录里打上 deviceId,
 *      将来"我的评价"/"我的菜图"能按 deviceId 过滤,也能支持精确删除。
 *   2. 跨设备迁移:用户可在 profile 页导出"设备码"(= 这个 UUID),
 *      在新设备上粘进去就能"变成同一个人",服务端数据立刻可见。
 *   3. 未来真正做账号系统 (手机号 / 微信) 时,deviceId → userId 的映射
 *      允许用户把已有数据绑定到正式账号上,不丢。
 *
 * 这不是安全凭证,只是一个匿名标识符:清浏览器数据会丢,但导出-导入一下就回来了。
 * 不做任何加密 / 签名,服务端 **不信任** deviceId 做鉴权,只用于 ownership 过滤。
 */

const STORAGE_KEY = "xcm_device_id";

/** RFC 4122 v4 兼容的 UUID (使用 crypto.randomUUID,fallback 到 Math.random) */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: 老 iOS / 旧 WebView 没有 crypto.randomUUID
  const hex = "0123456789abcdef";
  const out: string[] = [];
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out.push("-");
    } else if (i === 14) {
      out.push("4");
    } else if (i === 19) {
      out.push(hex[(Math.random() * 4) | 0 | 8]); // 8/9/a/b
    } else {
      out.push(hex[(Math.random() * 16) | 0]);
    }
  }
  return out.join("");
}

/** 读取当前设备 ID;没有就现场生成一个并持久化 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return ""; // SSR 兜底,正常不会调
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    // localStorage 被禁用 (无痕模式某些浏览器):临时生成一个不持久化的 id
    return generateUuid();
  }
  const fresh = generateUuid();
  try {
    localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // 写不进就写不进,下次再来会生成新 id —— 功能降级但不崩
  }
  return fresh;
}

/** 覆盖当前设备 ID —— 从另一台设备导入"设备码"时用 */
export function setDeviceId(id: string): void {
  if (typeof window === "undefined") return;
  const t = id.trim();
  if (!t || t.length < 8) throw new Error("设备码格式不对");
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch (err) {
    throw new Error(
      "localStorage 写入失败:" + (err instanceof Error ? err.message : String(err))
    );
  }
}

/** 读取当前设备 ID,不存在则返回空串 (用于非写入场景下不想副作用) */
export function peekDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
