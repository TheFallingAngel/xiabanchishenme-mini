import { NextRequest, NextResponse } from "next/server";
import type { ReviewRecord } from "@/lib/types";

/**
 * 评价 API —— 跨用户共享,用 Vercel KV (Upstash Redis) 托管。
 *
 * 数据结构:
 *   key: `reviews:{restaurantId}`  → List<ReviewRecord JSON>
 *   - LPUSH 新评价到表头 (最新的在前)
 *   - LRANGE 0 -1 读全量 (单店评价量不会太大,先不分页)
 *
 * 写入校验:
 *   · nickname   非空,≤ 12 字
 *   · rating     1-5 整数
 *   · text       ≤ 500 字 (可空,但和图片至少有一个)
 *   · imageUrls  ≤ 4 张
 *
 * 降级策略:
 *   · 若 KV 环境变量未配置 (本地开发 / 第一次部署前) → 返回 503 + 提示
 *     让前端优雅降级为"还没人写评价",而不是崩溃
 */

// 运行时校验 env —— 没配 KV 就返回 null,让上层走降级
// 惰性 import 的理由是:本地 dev 不配 KV_REST_API_URL 的时候,
// @vercel/kv 在 module 顶层 getter 会直接抛,走不到路由本身的降级逻辑。
async function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function reviewsKey(restaurantId: string) {
  return `reviews:${restaurantId}`;
}

// 简单 UUID —— 不依赖 node crypto subtle,够用
function genId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8)
  );
}

// KV lrange 可能返回 string[] 也可能返回 object[] (Upstash 会自动 parse),都兼容
function parseRecord(raw: unknown): ReviewRecord | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ReviewRecord;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as ReviewRecord;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { restaurantId: string } }
) {
  const restaurantId = params.restaurantId;
  if (!restaurantId) {
    return NextResponse.json({ reviews: [] });
  }

  const kv = await getKv();
  if (!kv) {
    // 未配 KV —— 返回空而不是报错,让页面"还没人写评价"
    return NextResponse.json({ reviews: [], kvDisabled: true });
  }

  try {
    const raw = await kv.lrange(reviewsKey(restaurantId), 0, -1);
    const reviews = (raw as unknown[])
      .map(parseRecord)
      .filter((r): r is ReviewRecord => !!r);
    return NextResponse.json({ reviews });
  } catch (err) {
    console.error("[reviews GET] KV error:", err);
    return NextResponse.json({ reviews: [], error: "KV error" }, { status: 200 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { restaurantId: string } }
) {
  const restaurantId = params.restaurantId;
  if (!restaurantId) {
    return NextResponse.json({ error: "Missing restaurantId" }, { status: 400 });
  }

  let body: Partial<ReviewRecord>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nickname = (body.nickname || "").trim().slice(0, 12);
  const rating = Number(body.rating);
  const text = (body.text || "").trim().slice(0, 500);
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((u) => typeof u === "string").slice(0, 4)
    : [];
  // deviceId 方案 A: 客户端自生成的匿名 ID,只做 ownership 标记不做鉴权
  // 校验 8-64 字符就认,防止 garbage 注入;缺失 (老客户端 / localStorage 禁用) 不拒绝
  const rawDeviceId =
    typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const deviceId =
    rawDeviceId.length >= 8 && rawDeviceId.length <= 64 ? rawDeviceId : undefined;

  if (!nickname) {
    return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "星级需要 1-5" }, { status: 400 });
  }
  if (!text && imageUrls.length === 0) {
    return NextResponse.json({ error: "写一句话或者传张图,总要留点什么" }, { status: 400 });
  }

  const record: ReviewRecord = {
    id: genId(),
    restaurantId,
    nickname,
    rating,
    text,
    imageUrls,
    createdAt: Date.now(),
    ...(deviceId ? { deviceId } : {}),
  };

  const kv = await getKv();
  if (!kv) {
    return NextResponse.json(
      {
        error: "评价后端还没开通,先在 Vercel 后台开 KV",
        kvDisabled: true,
      },
      { status: 503 }
    );
  }

  try {
    await kv.lpush(reviewsKey(restaurantId), JSON.stringify(record));
    return NextResponse.json({ review: record });
  } catch (err) {
    console.error("[reviews POST] KV error:", err);
    return NextResponse.json({ error: "保存失败,稍后重试" }, { status: 500 });
  }
}
