/**
 * L2 API 路由测试 —— /api/reviews/[restaurantId]
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIRV-001..008 (8 条)
 *
 * 路由注意:
 *   - 运行时 require("@vercel/kv") 惰性取,当 KV env 变量缺失时直接返 null
 *   - GET:无 KV -> 200 {reviews:[], kvDisabled:true}
 *   - POST:无 KV -> 503;校验失败 -> 400;KV 抛错 -> 500
 *   - nickname ≤12 / rating 1-5 int / text ≤500 / imageUrls ≤4 / text+images 至少一个
 *
 * 用 vi.mock("@vercel/kv") 直接替换成 in-memory mock,避开真连接。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resetKv, mockKv, kvStore, makeFailingKv } from "../mocks/kv";
import { makeGet, makePostJson } from "../helpers/request";

// ⚠️ vi.mock 必须 top-level 且 hoist 到 import 之前
vi.mock("@vercel/kv", () => ({ kv: mockKv }));

// route 里有 `require("@vercel/kv")`,vi.mock 会同时拦 require
import { GET, POST } from "@/app/api/reviews/[restaurantId]/route";

const origEnv = { ...process.env };

describe("/api/reviews/[restaurantId] — L2 (TC-L2-APIRV-001..008)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.KV_REST_API_URL = "https://kv.mock";
    process.env.KV_REST_API_TOKEN = "tok";
    resetKv();
  });
  afterEach(() => {
    process.env = origEnv;
    // 把 mockKv 的 lrange/lpush 还原(有用例会替换)
    Object.assign(mockKv, originalMockKv);
  });

  // 保留原始引用,便于"被替换后"恢复
  const originalMockKv = { ...mockKv };

  // 小工具:带 params 地调
  async function getWith(id: string) {
    return GET(makeGet(`http://test/api/reviews/${id}`), { params: { restaurantId: id } });
  }
  async function postWith(id: string, body: unknown) {
    return POST(makePostJson(`http://test/api/reviews/${id}`, body), { params: { restaurantId: id } });
  }

  // ---- 001: GET 空表 ----
  it("TC-L2-APIRV-001: GET 未写过评价 -> 200 reviews:[]", async () => {
    const res = await getWith("R1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toEqual([]);
    expect(body.kvDisabled).toBeUndefined();
  });

  // ---- 002: POST happy + GET 能读回来 ----
  it("TC-L2-APIRV-002: POST 合法评价 -> 200 review; GET 读回 1 条", async () => {
    const res = await postWith("R1", {
      nickname: "小吃货",
      rating: 5,
      text: "好吃",
      imageUrls: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review).toBeTruthy();
    expect(body.review.id).toBeTypeOf("string");
    expect(body.review.rating).toBe(5);

    const g = await getWith("R1");
    const gb = await g.json();
    expect(gb.reviews.length).toBe(1);
    expect(gb.reviews[0].text).toBe("好吃");
  });

  // ---- 003: 昵称为空 -> 400 ----
  it("TC-L2-APIRV-003: POST 空昵称 -> 400", async () => {
    const res = await postWith("R1", { nickname: "   ", rating: 5, text: "ok" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/昵称/);
  });

  // ---- 004: 星级非 1-5 整数 -> 400 ----
  it("TC-L2-APIRV-004: POST rating=6 -> 400;rating=3.5 -> 400", async () => {
    const r1 = await postWith("R1", { nickname: "a", rating: 6, text: "x" });
    expect(r1.status).toBe(400);
    const r2 = await postWith("R1", { nickname: "a", rating: 3.5, text: "x" });
    expect(r2.status).toBe(400);
  });

  // ---- 005: text 和 imageUrls 同时为空 -> 400 ----
  it("TC-L2-APIRV-005: POST 无 text 无图 -> 400", async () => {
    const res = await postWith("R1", { nickname: "a", rating: 4, text: "", imageUrls: [] });
    expect(res.status).toBe(400);
  });

  // ---- 006: nickname >12 字 / text >500 字被截断 (不报错,存入截断后内容) ----
  it("TC-L2-APIRV-006: nickname>12 / text>500 -> 截断但成功", async () => {
    const long = "很".repeat(600);
    const nick = "一二三四五六七八九十ABCDE"; // 15 char
    const res = await postWith("R1", { nickname: nick, rating: 3, text: long });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review.nickname.length).toBe(12);
    expect(body.review.text.length).toBe(500);
  });

  // ---- 007: 无 KV 环境 -> GET 200 kvDisabled, POST 503 ----
  it("TC-L2-APIRV-007: 缺 KV env -> GET 200 kvDisabled:true, POST 503", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const g = await getWith("R1");
    expect(g.status).toBe(200);
    const gb = await g.json();
    expect(gb.kvDisabled).toBe(true);

    const p = await postWith("R1", { nickname: "a", rating: 5, text: "x" });
    expect(p.status).toBe(503);
  });

  // ---- 008: KV lpush 抛错 -> 500 ----
  it("TC-L2-APIRV-008: KV lpush 抛错 -> POST 500", async () => {
    const failing = makeFailingKv("write");
    mockKv.lpush = failing.lpush as typeof mockKv.lpush;
    const res = await postWith("R1", { nickname: "a", rating: 5, text: "ok" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/保存失败/);
    // 确认没写入
    expect(kvStore.lists.get("reviews:R1") ?? []).toEqual([]);
  });
});
