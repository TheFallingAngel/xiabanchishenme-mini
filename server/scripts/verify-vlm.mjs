// 端到端验证 MiniMax VLM 接口 —— 读 .env.local 拿 MINIMAX_API_KEY,下载两张已知类别的图,
// POST /v1/coding_plan/vlm,打印 status_code / content / 归一化后的 PhotoTag。
//
// 用法: node scripts/verify-vlm.mjs

import fs from "node:fs";
import path from "node:path";

// 手动读 .env.local (避免引入新依赖)
const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error(".env.local not found");
  process.exit(1);
}
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const apiKey = process.env.MINIMAX_API_KEY;
const apiHost = process.env.MINIMAX_API_HOST || "https://api.minimaxi.com";
if (!apiKey) {
  console.error("MINIMAX_API_KEY missing");
  process.exit(1);
}
console.log(`key prefix: ${apiKey.slice(0, 8)}..., len=${apiKey.length}`);
console.log(`host: ${apiHost}`);

// 复刻 image-tag.ts 的 prompt
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

const PHOTO_TAGS = ["storefront", "interior", "dish", "menu", "logo", "other"];
function parseTag(raw) {
  const lower = String(raw || "").toLowerCase().replace(/[^a-z]/g, "").trim();
  if (!lower) return "other";
  for (const t of PHOTO_TAGS) {
    if (lower === t || lower.startsWith(t)) return t;
    if (lower.includes(t)) return t;
  }
  return "other";
}

async function downloadToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let fmt = "jpeg";
  if (ct.includes("png")) fmt = "png";
  else if (ct.includes("gif")) fmt = "gif";
  else if (ct.includes("webp")) fmt = "webp";
  return { dataUrl: `data:image/${fmt};base64,${buf.toString("base64")}`, bytes: buf.length, ct };
}

async function classify(url) {
  const t0 = Date.now();
  const { dataUrl, bytes, ct } = await downloadToDataUrl(url);
  const tDl = Date.now() - t0;
  const t1 = Date.now();
  const res = await fetch(`${apiHost}/v1/coding_plan/vlm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "MM-API-Source": "xiaban-chishenme-verify",
    },
    body: JSON.stringify({
      prompt: VL_CLASSIFY_PROMPT,
      image_url: dataUrl,
    }),
  });
  const tApi = Date.now() - t1;
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return {
    url,
    httpStatus: res.status,
    download: { ms: tDl, bytes, ct },
    vlm: { ms: tApi, body: data ?? text.slice(0, 500) },
    content: data?.content,
    baseResp: data?.base_resp,
    tag: data?.content ? parseTag(data.content) : null,
  };
}

// 用几张明显不同类别的图测
const samples = [
  {
    // 项目 FOOD_IMAGES.noodles,一碗面特写
    label: "dish (一碗面)",
    url: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&fit=crop",
    expect: "dish",
  },
  {
    // 项目 FOOD_IMAGES.dimsum,蒸笼里的点心
    label: "dish (点心)",
    url: "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&fit=crop",
    expect: "dish",
  },
  {
    // 典型餐厅霓虹门头
    label: "storefront (霓虹门头)",
    url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&fit=crop",
    expect: "storefront",
  },
  {
    // 店内桌椅
    label: "interior (店内桌椅)",
    url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&fit=crop",
    expect: "interior",
  },
];

console.log("---");
for (const s of samples) {
  console.log(`\n[${s.label}]`);
  console.log(`  url: ${s.url}`);
  try {
    const r = await classify(s.url);
    console.log(`  http: ${r.httpStatus}, dl=${r.download.ms}ms (${r.download.bytes}B ${r.download.ct}), vlm=${r.vlm.ms}ms`);
    if (r.baseResp) {
      console.log(`  base_resp: status_code=${r.baseResp.status_code}, status_msg="${r.baseResp.status_msg ?? ""}"`);
    }
    if (r.content != null) {
      console.log(`  content: "${r.content}"`);
      console.log(`  parsed tag: ${r.tag}   (expected: ${s.expect}, ${r.tag === s.expect ? "MATCH ✓" : "DIFF"})`);
    } else {
      console.log(`  RAW BODY: ${JSON.stringify(r.vlm.body).slice(0, 500)}`);
    }
  } catch (err) {
    console.error(`  ERROR: ${err?.message || err}`);
  }
}

console.log("\n---");
console.log("done");
