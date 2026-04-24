import { NextRequest, NextResponse } from "next/server";

/**
 * 评价图片上传 API —— 转发到 Vercel Blob。
 *
 * 前端用 FormData 传 file 字段,返回 { url }。
 * 每张图限制 4MB,只接 image/*。
 *
 * 没配 BLOB_READ_WRITE_TOKEN 时返回 503,让前端提示"图床没开通,先传文字版"。
 */

const MAX_BYTES = 4 * 1024 * 1024;

async function getBlobPut() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  // 惰性 import —— 本地 dev 没配 BLOB token 时也能走路由的 503 降级
  const mod = await import("@vercel/blob");
  return mod.put;
}

export async function POST(req: NextRequest) {
  const put = await getBlobPut();
  if (!put) {
    return NextResponse.json(
      { error: "图片上传未开通,先在 Vercel 开 Blob Storage" },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "非法请求" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "没选图" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "只支持图片格式" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "图片超过 4MB,先压一压" }, { status: 400 });
  }

  // 生成一个大致唯一的文件名 —— reviews 前缀方便在 Blob 后台归类
  const ext = file.type.split("/")[1] || "jpg";
  const key = `reviews/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[reviews/upload] blob error:", err);
    return NextResponse.json({ error: "上传失败,稍后重试" }, { status: 500 });
  }
}
