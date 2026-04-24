import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword");
  const type = searchParams.get("type"); // "regeo" for reverse geocoding

  if (!keyword) {
    return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
  }

  const apiKey = process.env.AMAP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      tips: [
        { name: keyword + "附近", address: "搜索结果", location: "113.325,23.125" },
      ],
      mock: true,
    });
  }

  try {
    // Reverse geocode: convert lng,lat to place name
    if (type === "regeo") {
      const [lng, lat] = keyword.split(",");
      const params = new URLSearchParams({
        key: apiKey,
        location: `${lng},${lat}`,
        output: "json",
      });
      const res = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`);
      const data = await res.json();
      if (data.status === "1" && data.regeocode) {
        const comp = data.regeocode.addressComponent;
        const poi = data.regeocode.pois?.[0];
        return NextResponse.json({
          name: poi?.name || comp?.township || comp?.neighborhood?.name || "当前位置",
          address: data.regeocode.formatted_address || "",
        });
      }
      return NextResponse.json({ name: "当前位置", address: "" });
    }

    // Normal: input tips search — no city restriction for broader results
    const params = new URLSearchParams({
      key: apiKey,
      keywords: keyword,
      datatype: "all",
    });
    const res = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?${params}`);
    const data = await res.json();

    if (data.status === "1") {
      // Filter out tips without valid coordinates
      const validTips = (data.tips || []).filter(
        (tip: { location?: string }) =>
          tip.location && typeof tip.location === "string" && tip.location.includes(",")
      );
      return NextResponse.json({ tips: validTips, mock: false });
    }
    return NextResponse.json({ tips: [], mock: false, error: data.info });
  } catch (err: unknown) {
    console.error("[location/search] Error:", err);
    return NextResponse.json({ tips: [], mock: false, error: "API error" });
  }
}
