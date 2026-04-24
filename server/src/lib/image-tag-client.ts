/**
 * 图片打标的浏览器端缓存层 —— 把服务端 KV(90 天)再往前推一级,
 * 让重复进同一家餐厅 / 重复骰到同一张卡的时候完全不走网络。
 *
 * 为什么值得做:
 *   - 餐厅 AMap 图片 URL 是 CDN 长链,短期内不会变;tag 也不会变。
 *   - 详情页 + 首页卡片都会触发打标查询,同一会话同一图反复拉浪费网络。
 *   - 服务端 KV 查询也要 30-80ms,本地命中 ~0ms。
 *
 * 两级缓存:
 *   L1 内存 Map          —— 模块级,跨组件 / 跨路由,SPA 生命周期内共享
 *   L2 localStorage      —— 跨 tab / 跨刷新,TTL 7 天
 *     (服务端 KV 是 90 天,本地 7 天确保新识别结果有机会传下来)
 *
 * 请求层:
 *   - 进程内 in-flight Promise dedup: 同一 url 并发请求只发一次
 *   - splitLocalCache 把批量 url 拆成 (hit, miss),只把 miss 送到服务端
 *   - prefetchTags: 走 GET,只读服务端 KV,不触发 VLM (首页用)
 *   - classifyTags: 走 POST,服务端未命中会真打 VLM (详情页用)
 *
 * 降级:
 *   - SSR 环境没有 window —— isBrowser() 关掉 localStorage,只走内存
 *   - localStorage 配额满 / 禁用 —— 写失败静默,读继续
 *   - 网络失败 —— 返回已命中部分,不抛异常
 */

import type { PhotoTag } from "./image-tag";

const VALID_TAGS = new Set<PhotoTag>([
  "storefront",
  "interior",
  "dish",
  "menu",
  "logo",
  "other",
]);

// localStorage 结构: { [url]: { tag, t: unix-ms } }
const LS_KEY = "imgtag:v1";
const LS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000; // 防止 quota 被打爆(~100KB 级别,远离 5MB 上限)

// L1
const mem = new Map<string, PhotoTag>();

// 同一 url 并发请求合一,避免"首页骰到 → 快速进详情页"这种场景里重复发两次
const inflightBatch = new Map<string, Promise<Record<string, PhotoTag>>>();

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

type LsEntry = { tag: PhotoTag; t: number };
type LsData = Record<string, LsEntry>;

function loadLs(): LsData {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LsData) : {};
  } catch {
    return {};
  }
}

function saveLs(data: LsData) {
  if (!isBrowser()) return;
  try {
    // 简化 LRU: 超了按 t 从旧到新裁掉,保证不膨胀到爆 quota
    const keys = Object.keys(data);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys
        .map((k) => [k, data[k]?.t ?? 0] as const)
        .sort((a, b) => a[1] - b[1]);
      const dropCount = keys.length - MAX_ENTRIES;
      for (let i = 0; i < dropCount; i++) {
        delete data[sorted[i][0]];
      }
    }
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // quota / 隐私模式 —— 无所谓,下次命中服务端 KV 还是快的
  }
}

// 懒加载: 第一次访问时把 localStorage 灌进 mem,之后全走 mem
let hydrated = false;
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (!isBrowser()) return;
  const data = loadLs();
  const now = Date.now();
  for (const [url, entry] of Object.entries(data)) {
    if (!entry || !VALID_TAGS.has(entry.tag)) continue;
    if (now - entry.t > LS_TTL_MS) continue;
    mem.set(url, entry.tag);
  }
}

function writeThrough(tags: Record<string, PhotoTag>) {
  const entries = Object.entries(tags).filter(([, t]) => VALID_TAGS.has(t));
  if (entries.length === 0) return;
  for (const [url, tag] of entries) mem.set(url, tag);
  if (!isBrowser()) return;
  try {
    const data = loadLs();
    const now = Date.now();
    for (const [url, tag] of entries) {
      data[url] = { tag, t: now };
    }
    saveLs(data);
  } catch {
    /* noop */
  }
}

/**
 * 把入参 urls 拆成 {hit: 本地已缓存, miss: 还需要联网的},并做去重。
 * 供单元逻辑需要时独立调用。
 * 外层包 try —— localStorage 异常 / 数据损坏都不应把 React 树带崩,
 * 最坏情况下返回 {hit:{}, miss: 去重后的 urls},走网络就行。
 */
export function splitLocalCache(urls: string[]): {
  hit: Record<string, PhotoTag>;
  miss: string[];
} {
  try {
    hydrate();
  } catch {
    /* hydrate 失败继续 —— mem 还是空的,所有 url 都会 miss,走网络 */
  }
  const hit: Record<string, PhotoTag> = {};
  const miss: string[] = [];
  const seen = new Set<string>();
  const input = Array.isArray(urls) ? urls : [];
  for (const u of input) {
    if (!u || typeof u !== "string" || seen.has(u)) continue;
    seen.add(u);
    try {
      const cached = mem.get(u);
      if (cached) hit[u] = cached;
      else miss.push(u);
    } catch {
      miss.push(u);
    }
  }
  return { hit, miss };
}

async function doFetch(
  urls: string[],
  mode: "get" | "post"
): Promise<Record<string, PhotoTag>> {
  if (urls.length === 0) return {};
  try {
    const res =
      mode === "get"
        ? await fetch(`/api/images/tag?urls=${encodeURIComponent(urls.join(","))}`)
        : await fetch("/api/images/tag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls }),
          });
    if (!res.ok) return {};
    const data = await res.json();
    const tags = (data?.tags ?? {}) as Record<string, PhotoTag>;
    writeThrough(tags);
    return tags;
  } catch {
    return {};
  }
}

/**
 * 包一层 in-flight dedup: 对同一组 miss URL 并发请求会合一。
 * key 用已排序后 join,保证顺序无关命中。
 */
async function dedupedFetch(
  urls: string[],
  mode: "get" | "post"
): Promise<Record<string, PhotoTag>> {
  if (urls.length === 0) return {};
  const key = `${mode}:${[...urls].sort().join(",")}`;
  const existing = inflightBatch.get(key);
  if (existing) return existing;
  const p = doFetch(urls, mode).finally(() => {
    inflightBatch.delete(key);
  });
  inflightBatch.set(key, p);
  return p;
}

/**
 * 只读缓存: 先查本地,miss 的走 GET /api/images/tag(服务端只读 KV,不触发 VLM)。
 * 用于首页卡片 —— 没人为这张卡付过 VLM 账单前,本接口不会引入成本。
 * 外层 try —— 任何异常都返回 {},不会把 useEffect 里的 Promise 炸穿。
 */
export async function prefetchTags(
  urls: string[]
): Promise<Record<string, PhotoTag>> {
  try {
    const { hit, miss } = splitLocalCache(urls);
    if (miss.length === 0) return hit;
    const remote = await dedupedFetch(miss, "get");
    return { ...hit, ...remote };
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[prefetchTags] swallowed", err);
    return {};
  }
}

/**
 * 触发打标: 先查本地,miss 的走 POST /api/images/tag(服务端 KV 未命中会真打 VLM)。
 * 用于详情页 —— 这里能接受 VLM 的几秒延迟,目标是补齐所有图的 tag。
 * 外层 try —— 任何异常都返回 {},不会把 useEffect 里的 Promise 炸穿。
 */
export async function classifyTags(
  urls: string[]
): Promise<Record<string, PhotoTag>> {
  try {
    const { hit, miss } = splitLocalCache(urls);
    if (miss.length === 0) return hit;
    const remote = await dedupedFetch(miss, "post");
    return { ...hit, ...remote };
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[classifyTags] swallowed", err);
    return {};
  }
}

/** 纯本地缓存读取,不联网 —— 测试/调试或超敏感场景用 */
export function readLocalCacheOnly(
  urls: string[]
): Record<string, PhotoTag> {
  try {
    return splitLocalCache(urls).hit;
  } catch {
    return {};
  }
}
