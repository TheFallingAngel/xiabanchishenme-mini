import { NextRequest, NextResponse } from "next/server";
import type { DishPhotoRecord } from "@/lib/types";

/**
 * 招牌菜 UGC 照片 API —— 和 reviews 对称,存 Vercel KV (Upstash Redis)。
 *
 * 数据结构:
 *   key: `dish-photos:{restaurantId}` → List<DishPhotoRecord JSON>
 *   - LPUSH 新照片到表头 (最新的在前)
 *   - LRANGE 0 -1 读全量 (单店上限 50 条,满了再 ltrim;先放着)
 *
 * 写入校验:
 *   · nickname   非空,≤ 12 字 (复用用户评价昵称)
 *   · dishName   非空,≤ 16 字 (前端从 POI 菜名列表里选)
 *   · imageUrl   必须是 https (Vercel Blob 公开 URL)
 *
 * 降级策略:
 *   · 若 KV 环境变量未配置 → 返回 503,前端提示"上传后端还没开通"
 *   · GET 在 KV 缺失时返回空数组,让详情页继续渲染 POI 原图
 */

async function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function dishPhotosKey(restaurantId: string) {
  return `dish-photos:${restaurantId}`;
}

function genId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8)
  );
}

function parseRecord(raw: unknown): DishPhotoRecord | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DishPhotoRecord;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as DishPhotoRecord;
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { restaurantId: string } }
) {
  const restaurantId = params.restaurantId;
  if (!restaurantId) {
    return NextResponse.json({ photos: [] });
  }

  const kv = await getKv();
  if (!kv) {
    return NextResponse.json({ photos: [], kvDisabled: true });
  }

  try {
    const raw = await kv.lrange(dishPhotosKey(restaurantId), 0, -1);
    const photos = (raw as unknown[])
      .map(parseRecord)
      .filter((r): r is DishPhotoRecord => !!r);
    return NextResponse.json({ photos });
  } catch (err) {
    console.error("[dish-photos GET] KV error:", err);
    return NextResponse.json({ photos: [], error: "KV error" }, { status: 200 });
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

  let body: Partial<DishPhotoRecord>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nickname = (body.nickname || "").trim().slice(0, 12);
  const dishName = (body.dishName || "").trim().slice(0, 16);
  const imageUrl = (body.imageUrl || "").trim();
  // deviceId 方案 A: 同 /api/reviews,校验 8-64 字符
  const rawDeviceId =
    typeof (body as { deviceId?: unknown }).deviceId === "string"
      ? (body as { deviceId: string }).deviceId.trim()
      : "";
  const deviceId =
    rawDeviceId.length >= 8 && rawDeviceId.length <= 64 ? rawDeviceId : undefined;

  if (!nickname) {
    return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
  }
  if (!dishName) {
    return NextResponse.json({ error: "要给哪道菜配图?先选个菜名" }, { status: 400 });
  }
  if (!imageUrl || !imageUrl.startsWith("https://")) {
    return NextResponse.json({ error: "图片链接不合法" }, { status: 400 });
  }

  const record: DishPhotoRecord = {
    id: genId(),
    restaurantId,
    dishName,
    imageUrl,
    nickname,
    createdAt: Date.now(),
    ...(deviceId ? { deviceId } : {}),
  };

  const kv = await getKv();
  if (!kv) {
    return NextResponse.json(
      {
        error: "UGC 后端还没开通,先在 Vercel 后台开 KV",
        kvDisabled: true,
      },
      { status: 503 }
    );
  }

  try {
    await kv.lpush(dishPhotosKey(restaurantId), JSON.stringify(record));
    // 单店 UGC 上限 50 条,超过的头部/尾部裁掉老记录,避免列表无界增长
    await kv.ltrim(dishPhotosKey(restaurantId), 0, 49);
    return NextResponse.json({ photo: record });
  } catch (err) {
    console.error("[dish-photos POST] KV error:", err);
    return NextResponse.json({ error: "保存失败,稍后重试" }, { status: 500 });
  }
}
