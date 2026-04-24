import { NextRequest, NextResponse } from "next/server";
import { getPoiDetail } from "@/lib/amap";

export const runtime = "nodejs";
// 单店详情走高德 POI 详情接口,命中缓存时直接返回
export const revalidate = 3600; // 1h

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  try {
    const detail = await getPoiDetail(id);
    if (!detail) {
      return NextResponse.json({ detail: null }, { status: 200 });
    }
    return NextResponse.json({ detail });
  } catch (err) {
    console.error("[api/restaurant/[id]]", err);
    return NextResponse.json({ detail: null }, { status: 200 });
  }
}
