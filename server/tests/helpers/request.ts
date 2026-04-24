/**
 * NextRequest / Response 测试辅助工具。
 *
 * 直接用 `new NextRequest(url, init)` 造请求;读 JSON/text 响应用
 * res.json() / res.text(),和 Next.js 运行时一致。
 */
import { NextRequest } from "next/server";

export function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

export function makePostJson(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function makePostRaw(url: string, raw: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

/** 造一个带 file 字段的 multipart 请求 —— 用于 /api/reviews/upload。 */
export function makePostFormData(
  url: string,
  fields: Record<string, string | File | Blob>
): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v as Blob | string);
  }
  return new NextRequest(url, { method: "POST", body: form });
}

/** SSE 响应解析:读完 body,按 `data: ...\n\n` 切块,每块 JSON.parse。 */
export async function readSseEvents(
  res: Response | { body: ReadableStream<Uint8Array> | null }
): Promise<unknown[]> {
  const body = (res as Response).body;
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: unknown[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      try {
        events.push(JSON.parse(payload));
      } catch {
        events.push({ raw: payload });
      }
    }
  }
  return events;
}
