/**
 * 高德 POI 图片 AI 打标 —— 用 MiniMax Token Plan 的 VLM 端点把每张图分类为:
 *   storefront  门脸/门头/外景          → 首图/hero 最优选
 *   interior    店内环境/桌椅/装修      → "店内实景" 网格
 *   dish        菜品/食物                → "招牌菜" 网格
 *   menu        菜单/价目表              → 详情辅助信息
 *   logo        logo/品牌标识            → 一般不展示,作为兜底
 *   other       其他/不确定              → 保留但不主动展示
 *
 * ✦ 为什么要打标:
 *   高德返回的 photos 顺序并不总是 "[0]=门脸 [1+]=菜品" —— 线上实际看到 80% 以上的店,
 *   第一张是菜品特写,卡片/详情 hero 位放了菜品会让用户困惑 "这是餐厅还是菜谱?"。
 *   打标后按用途挑图,UI 和用户预期能对上。
 *
 * ✦ 官方路径 (来自 MiniMax-Coding-Plan-MCP 源码):
 *     POST https://api.minimaxi.com/v1/coding_plan/vlm
 *     Headers:
 *       Authorization: Bearer ${MINIMAX_API_KEY}
 *       Content-Type: application/json
 *     Body:
 *       { "prompt": "...", "image_url": "data:image/jpeg;base64,..." }
 *     Resp:
 *       { "base_resp": { "status_code": 0, "status_msg": "" }, "content": "<模型输出>" }
 *
 *   这是 Token Plan / Coding Plan 的专有端点 (vlm = vision language model)。
 *   MiniMax 官方 OpenAI 兼容的 /v1/chat/completions 不接受图片入参 (文档写明 "Image and
 *   audio type inputs are not currently supported"),也不能直接填 MiniMax-VL-01 模型名 ——
 *   之前走 /v1/chat/completions 是错的,已修正。
 *
 *   参考: https://platform.minimaxi.com/docs/token-plan/mcp-guide
 *         https://github.com/MiniMax-AI/MiniMax-Coding-Plan-MCP/blob/main/minimax_mcp/server.py
 *
 * ✦ 前置要求 (部署时):
 *   - MINIMAX_API_KEY 对应账号需要开通 Token Plan / Coding Plan 订阅,
 *     否则这个端点会返回 1004 鉴权错或方案不足。
 *   - 没开/没配 key 不影响跑 —— classifyPhotos 会跳过 VL,上层按 photos[0] 展示。
 *
 * ✦ 图片处理:
 *   - 和官方 MCP 一致:先 fetch 下载原图,按 content-type 推断格式,转 base64 data URL,再 POST。
 *   - 高德 CDN 有时会拒绝直接把 url 喂给第三方,base64 能避开这个坑。
 *   - 单张 limit 不做(高德 url 返回的图都是 500KB 内,正常范围),失败兜底 "other"。
 *
 * ✦ 缓存 (三级):
 *   L1 浏览器 (image-tag-client.ts)  内存 Map + localStorage 7 天 —— 零网络
 *   L2 HTTP / CDN                    GET 响应 Cache-Control 1d / Edge 7d —— 一跳不到 KV
 *   L3 Vercel KV                     TTL 90 天,跨用户共享 (AMap URL 是 CDN 长链,稳定)
 *
 *   - cache key = `imgtag:<sha1(url 去 query)>` —— 前 20 字符够短够稳
 *   - 服务端进程内 Map 作 hot path (热实例内 ~0ms)
 *   - KV 不可用时退进程内 Map,不报错
 *
 * ✦ 并发与超时:
 *   - 单次 detail 页最多打 10 张,超过 slice 截断。
 *   - 并发 10,单张 25s 超时 (VLM 实测 p99 ~20s,给 5s 下载+余量)。
 *     —— 这是按 Vercel Hobby 60s maxDuration 的组合配;升到 Pro 可以降回 6 分两轮,峰值更稳。
 *   - 某张失败只影响那一张,整组打标继续。
 */

import crypto from "crypto";

export type PhotoTag = "storefront" | "interior" | "dish" | "menu" | "logo" | "other";

export const PHOTO_TAGS: PhotoTag[] = [
  "storefront",
  "interior",
  "dish",
  "menu",
  "logo",
  "other",
];

export interface TaggedPhoto {
  url: string;
  tag: PhotoTag;
}

// 中国区 host;全球版用 https://api.minimax.io。可通过 MINIMAX_API_HOST 覆盖。
const DEFAULT_MINIMAX_API_HOST = "https://api.minimaxi.com";
const VLM_ENDPOINT = "/v1/coding_plan/vlm";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 天 —— AMap 图片 URL 稳定,tag 就是稳定的,长一点省成本
const MAX_PHOTOS_PER_CALL = 10;
// 单张 = 下载(~1s) + VLM 推理(5-22s, 实测 p99 在 20s 附近),给 25s 才不会误杀长尾
const PER_PHOTO_TIMEOUT_MS = 25_000;
// 并发 10 (= MAX_PHOTOS_PER_CALL): 10 张一轮打完,最坏 25s 就在 route 的 60s Hobby 窗口内。
// 升级到 Vercel Pro (maxDuration 300s) 可以把这里降回 6 以减少瞬时并发峰值,压力更稳。
const CONCURRENCY = 10;

const VL_CLASSIFY_PROMPT = `你是餐厅图片分类助手。请对当前这张图只输出下列 6 个英文关键词之一(全部小写,不要标点、不要解释、不要引号):
storefront — 餐厅外景、门头、招牌、门口(整栋建筑外观或店面招牌是主体)
interior   — 店内环境、用餐区、桌椅、装修、大堂、包间
dish       — 菜品、食物特写、一盘菜、一碗饭、一杯饮品
menu       — 菜单、点餐单、价目表(文字为主体的图)
logo       — 品牌 logo、单独的标志图形
other      — 都不符合时(如人像、抽象图、优惠海报)

规则:
- 只输出一个关键词。
- 菜品和店内有重叠时,优先看主体:盘子占画面大部分 → dish;桌椅/环境占主要 → interior。
- 门头+招牌+店名的外景 → storefront,即使有菜品 banner 也算。`;

/** URL → cache key */
function urlHash(url: string): string {
  // 去掉 query 部分让同图不同 token 命中同一个 key (高德 CDN 有时带 v= 参数)
  const stripped = url.split("?")[0];
  return crypto.createHash("sha1").update(stripped).digest("hex").slice(0, 20);
}

function cacheKey(url: string): string {
  return `imgtag:${urlHash(url)}`;
}

/** Vercel KV lazy import —— 本地未配 KV 就返回 null */
async function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    const mod = await import("@vercel/kv");
    return mod.kv;
  } catch {
    return null;
  }
}

/** 进程内兜底缓存 —— Vercel 冷启动时会丢,但 serverless 热实例能撑一阵 */
const memoryCache = new Map<string, PhotoTag>();

async function readCache(url: string): Promise<PhotoTag | null> {
  const key = cacheKey(url);
  const mem = memoryCache.get(key);
  if (mem) return mem;

  const kv = await getKv();
  if (!kv) return null;
  try {
    const v = (await kv.get<string>(key)) as PhotoTag | string | null;
    if (v && PHOTO_TAGS.includes(v as PhotoTag)) {
      memoryCache.set(key, v as PhotoTag);
      return v as PhotoTag;
    }
  } catch (err) {
    console.warn("[image-tag] KV read error:", err);
  }
  return null;
}

async function writeCache(url: string, tag: PhotoTag): Promise<void> {
  const key = cacheKey(url);
  memoryCache.set(key, tag);
  const kv = await getKv();
  if (!kv) return;
  try {
    await kv.set(key, tag, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn("[image-tag] KV write error:", err);
  }
}

/** 把 VLM 返回的 raw content 归一化到合法 PhotoTag,失败返回 "other" */
function parseTag(raw: string): PhotoTag {
  const lower = raw
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();
  if (!lower) return "other";
  for (const t of PHOTO_TAGS) {
    if (lower === t || lower.startsWith(t)) return t;
    // 防御: 模型有时会带前缀,如 "answer storefront"
    if (lower.includes(t)) return t;
  }
  return "other";
}

/** 下载高德图片并转 base64 data URL,和官方 MCP 的 process_image_url 行为一致 */
async function downloadToDataUrl(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let fmt = "jpeg";
  if (ct.includes("png")) fmt = "png";
  else if (ct.includes("gif")) fmt = "gif";
  else if (ct.includes("webp")) fmt = "webp";
  // 其余走 jpeg
  return `data:image/${fmt};base64,${buf.toString("base64")}`;
}

/** 单张图调用 MiniMax VLM 分类;失败抛出 */
async function classifySingle(
  url: string,
  apiKey: string,
  apiHost: string
): Promise<PhotoTag> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_PHOTO_TIMEOUT_MS);
  try {
    // 1. 下载 → base64 data URL
    const dataUrl = await downloadToDataUrl(url, controller.signal);

    // 2. POST /v1/coding_plan/vlm
    const res = await fetch(`${apiHost}${VLM_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "MM-API-Source": "xiaban-chishenme",
      },
      body: JSON.stringify({
        prompt: VL_CLASSIFY_PROMPT,
        image_url: dataUrl,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`VLM HTTP ${res.status}`);
    }
    const data = await res.json();

    // MiniMax 特有的 base_resp 错误结构
    const baseResp = data?.base_resp;
    if (baseResp && typeof baseResp.status_code === "number" && baseResp.status_code !== 0) {
      throw new Error(`VLM API ${baseResp.status_code}: ${baseResp.status_msg || "unknown"}`);
    }

    const content: unknown = data?.content;
    const text = typeof content === "string" ? content : "";
    return parseTag(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用 p-limit 风格的手搓并发调度,不引新依赖。
 * 每个 task 失败返回 "other",不会让一张坏图拖垮整组。
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<PhotoTag>
): Promise<PhotoTag[]> {
  const results: PhotoTag[] = new Array(items.length).fill("other");
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        console.warn(
          `[image-tag] classify failed for index ${i}:`,
          err instanceof Error ? err.message : err
        );
        results[i] = "other";
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** 从 env 读 host,带防呆 */
function resolveApiHost(): string {
  const raw = (process.env.MINIMAX_API_HOST || "").trim();
  if (!raw) return DEFAULT_MINIMAX_API_HOST;
  // 看起来像 key 就忽略
  if (raw.length > 100 || raw.startsWith("eyJ") || raw.startsWith("sk-") || /\s/.test(raw)) {
    console.warn(
      `[image-tag] MINIMAX_API_HOST env looks like a key, ignoring — using ${DEFAULT_MINIMAX_API_HOST}`
    );
    return DEFAULT_MINIMAX_API_HOST;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * 给一批图片打标。返回 url → tag 的映射。
 *
 * 流程:
 *   1. 先读缓存 (KV → 进程内 Map),命中的直接用。
 *   2. 未命中的批量去调 VLM 打标,并发上限 CONCURRENCY。
 *   3. 把结果写回 KV。
 *
 * 无 MINIMAX_API_KEY 时,步骤 2/3 直接跳过 —— 返回的 map 里只有缓存命中过的 url。
 * 上层 (getRestaurantImage) 对 map 里没有的 url 会按照 "photos[0]" 兜底顺序展示,不退化。
 *
 * @param urls 图片 URL 列表 (最多取前 10 张)
 * @returns Record<url, PhotoTag> —— 仅包含已知 tag 的 url (缓存命中 + 本次打标成功)
 */
export async function classifyPhotos(urls: string[]): Promise<Record<string, PhotoTag>> {
  // 去重 + 截断: Set 保证同一 url 只打一次,slice 挡住单次调用里超限的图 (10 张上限)
  const seen = new Set<string>();
  const list: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || u.length === 0) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    list.push(u);
    if (list.length >= MAX_PHOTOS_PER_CALL) break;
  }
  const out: Record<string, PhotoTag> = {};
  if (list.length === 0) return out;

  // 1. 先走缓存,命中的直接填 out
  const uncached: string[] = [];
  await Promise.all(
    list.map(async (url) => {
      const cached = await readCache(url);
      if (cached) {
        out[url] = cached;
      } else {
        uncached.push(url);
      }
    })
  );

  if (uncached.length === 0) return out;

  const apiKey = (process.env.MINIMAX_API_KEY || "").trim();
  if (!apiKey) {
    // 无 key —— 不写脏缓存,不强塞 "other",交还给上层按 photos[0] 兜底
    console.warn("[image-tag] MINIMAX_API_KEY not set; skipping VLM classification");
    return out;
  }

  const apiHost = resolveApiHost();

  // 2. VLM 并发打标,结果写回 KV
  const tags = await runWithConcurrency(uncached, CONCURRENCY, (url) =>
    classifySingle(url, apiKey, apiHost)
  );

  // 3. 写缓存 (失败不阻塞返回)
  await Promise.all(
    uncached.map(async (url, i) => {
      out[url] = tags[i];
      await writeCache(url, tags[i]);
    })
  );

  return out;
}

/**
 * 纯缓存读 —— 只查 cache,不调 VLM。用于轻量 prefetch 场景。
 * 未命中的 url 不会出现在返回 map 里。
 */
export async function readCachedTags(urls: string[]): Promise<Record<string, PhotoTag>> {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || !u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    deduped.push(u);
  }
  const out: Record<string, PhotoTag> = {};
  await Promise.all(
    deduped.map(async (url) => {
      const cached = await readCache(url);
      if (cached) out[url] = cached;
    })
  );
  return out;
}
