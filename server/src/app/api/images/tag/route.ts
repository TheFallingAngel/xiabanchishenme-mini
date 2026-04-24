import { NextRequest, NextResponse } from "next/server";
import { classifyPhotos, readCachedTags } from "@/lib/image-tag";

export const runtime = "nodejs";
// Vercel Hobby serverless function 上限 60s —— 写得再高也会被平台截断。
// 搭配 image-tag.ts 的 CONCURRENCY=10: 10 张一轮打完,单张 p99 ~22s,实际最坏约 25s,60s 窗口内留 30s 余量给下载 + 缓存写。
// 升级到 Pro (上限 300s) 后可以把 maxDuration 提到 90,同时把 CONCURRENCY 降回 6 以减少瞬时并发峰值。
export const maxDuration = 60;

/**
 * 图片 AI 打标接口。
 *
 * 设计:
 *   - POST { urls: string[] } → 200 { tags: Record<url, PhotoTag> }
 *   - GET  ?urls=url1,url2  → 只读缓存,不触发 VL (用于轻量 prefetch 场景)
 *
 * 详情页加载完 POI 后,前端会调一次 POST 把所有图片丢进来打标。
 * 没命中的图才会打到 MiniMax VL,命中缓存的直接从 KV 拿。
 */

export async function POST(req: NextRequest) {
  let body: { urls?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  const urls = raw.filter((u): u is string => typeof u === "string" && u.length > 0);
  if (urls.length === 0) {
    return NextResponse.json({ tags: {} });
  }

  try {
    const tags = await classifyPhotos(urls);
    return NextResponse.json({ tags });
  } catch (err) {
    console.error("[api/images/tag POST]", err);
    // 整体 classifyPhotos 已经对每张单独兜底,进到这里说明更底层挂了 —— 返回空 map
    return NextResponse.json({ tags: {}, error: "classification failed" }, { status: 200 });
  }
}

// GET 响应加缓存 headers —— 同一组 url 在浏览器 HTTP 缓存 (1 天) 和 Vercel Edge CDN (7 天) 都能命中,
// 即使前端没挂 image-tag-client 也能省一圈 KV 查询。
// stale-while-revalidate: 过期后仍先返旧值,后台悄悄刷新,用户无感知。
const GET_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

export async function GET(req: NextRequest) {
  const urlsParam = req.nextUrl.searchParams.get("urls") || "";
  const urls = urlsParam
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    return NextResponse.json({ tags: {} }, { headers: GET_CACHE_HEADERS });
  }
  try {
    const tags = await readCachedTags(urls);
    return NextResponse.json({ tags }, { headers: GET_CACHE_HEADERS });
  } catch (err) {
    console.error("[api/images/tag GET]", err);
    // 错误也给一点点 CDN 缓存(短),避免瞬时问题把 KV/VLM 打穿
    return NextResponse.json(
      { tags: {} },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=60" },
      }
    );
  }
}
