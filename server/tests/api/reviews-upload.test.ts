/**
 * L2 API 路由测试 —— /api/reviews/upload
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIUP-001..007 (7 条)
 *
 * 路由约束:
 *   - BLOB_READ_WRITE_TOKEN 未配 -> 503
 *   - formData() 抛错 -> 400
 *   - file 缺 / 非 Blob -> 400
 *   - file.type 不是 image/* -> 400
 *   - file.size > 4MB -> 400
 *   - put 抛错 -> 500
 *   - 正常 -> 200 { url }
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mockPut, resetBlob, setBlobPutToFail, getLastPutCall } from "../mocks/blob";
import { makePostFormData } from "../helpers/request";
import { NextRequest } from "next/server";

vi.mock("@vercel/blob", () => ({ put: mockPut }));

import { POST } from "@/app/api/reviews/upload/route";

const origEnv = { ...process.env };

describe("/api/reviews/upload — L2 (TC-L2-APIUP-001..007)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    resetBlob();
  });
  afterEach(() => {
    process.env = origEnv;
  });

  function makeImage(bytes: number, type = "image/jpeg"): File {
    const arr = new Uint8Array(bytes).fill(65);
    return new File([arr], "a.jpg", { type });
  }

  // ---- 001: happy path ----
  it("TC-L2-APIUP-001: 合法图 -> 200 url + Blob put 被调用", async () => {
    const req = makePostFormData("http://test/api/reviews/upload", {
      file: makeImage(1024),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/blob-mock\.test\/reviews\//);
    const call = getLastPutCall();
    expect(call?.contentType).toBe("image/jpeg");
    expect(call?.size).toBe(1024);
  });

  // ---- 002: 无 BLOB token -> 503 ----
  it("TC-L2-APIUP-002: 缺 BLOB token -> 503", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const req = makePostFormData("http://test/api/reviews/upload", {
      file: makeImage(1024),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  // ---- 003: 非 image/* -> 400 ----
  it("TC-L2-APIUP-003: 非 image 类型 -> 400", async () => {
    const req = makePostFormData("http://test/api/reviews/upload", {
      file: new File(["hi"], "a.txt", { type: "text/plain" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/图片/);
  });

  // ---- 004: 超 4MB -> 400 ----
  it("TC-L2-APIUP-004: 超 4MB -> 400", async () => {
    const req = makePostFormData("http://test/api/reviews/upload", {
      file: makeImage(4 * 1024 * 1024 + 1),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/4MB/);
  });

  // ---- 005: 没选图 -> 400 ----
  it("TC-L2-APIUP-005: 不带 file 字段 -> 400", async () => {
    const req = makePostFormData("http://test/api/reviews/upload", {
      notFile: "nothing",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/没选图/);
  });

  // ---- 006: formData 解析失败 -> 400 ----
  it("TC-L2-APIUP-006: 非 multipart body -> 400", async () => {
    const req = new NextRequest("http://test/api/reviews/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json-really",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ---- 007: put 抛错 -> 500 ----
  it("TC-L2-APIUP-007: Blob put 抛错 -> 500", async () => {
    setBlobPutToFail();
    const req = makePostFormData("http://test/api/reviews/upload", {
      file: makeImage(1024),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/上传失败/);
  });
});
