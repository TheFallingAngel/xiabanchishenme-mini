/**
 * L2 API 路由测试 —— /api/dish-photos/[restaurantId]
 * 对应 TEST-CASES-v1.xlsx TC-L2-APIDP-001..005 (5 条)
 *
 * 和 reviews 路由对称:
 *   - lazy dynamic import @vercel/kv
 *   - POST 校验 nickname(≤12) / dishName(≤16) / imageUrl 必须 https
 *   - POST 成功会再调一次 ltrim 0,49 (上限 50 条)
 *   - 无 KV -> GET 200 kvDisabled / POST 503
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resetKv, mockKv } from "../mocks/kv";
import { makeGet, makePostJson } from "../helpers/request";

vi.mock("@vercel/kv", () => ({ kv: mockKv }));

import { GET, POST } from "@/app/api/dish-photos/[restaurantId]/route";

const origEnv = { ...process.env };

describe("/api/dish-photos/[restaurantId] — L2 (TC-L2-APIDP-001..005)", () => {
  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.KV_REST_API_URL = "https://kv.mock";
    process.env.KV_REST_API_TOKEN = "tok";
    resetKv();
  });
  afterEach(() => {
    process.env = origEnv;
  });

  async function getWith(id: string) {
    return GET(makeGet(`http://test/api/dish-photos/${id}`), { params: { restaurantId: id } });
  }
  async function postWith(id: string, body: unknown) {
    return POST(makePostJson(`http://test/api/dish-photos/${id}`, body), { params: { restaurantId: id } });
  }

  // ---- 001: GET 空表 ----
  it("TC-L2-APIDP-001: GET 空 -> 200 photos:[]", async () => {
    const res = await getWith("R1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual([]);
  });

  // ---- 002: POST 合法 + 回读 ----
  it("TC-L2-APIDP-002: POST 合法 -> 200 photo;GET 读回 1 条", async () => {
    const res = await postWith("R1", {
      nickname: "小明",
      dishName: "湘菜小炒",
      imageUrl: "https://blob-mock.test/abc.jpg",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photo).toBeTruthy();
    expect(body.photo.dishName).toBe("湘菜小炒");

    const g = await getWith("R1");
    const gb = await g.json();
    expect(gb.photos.length).toBe(1);
    expect(gb.photos[0].imageUrl).toMatch(/^https:\/\//);
  });

  // ---- 003: imageUrl 不是 https -> 400 ----
  it("TC-L2-APIDP-003: POST imageUrl=http:// -> 400", async () => {
    const res = await postWith("R1", {
      nickname: "x",
      dishName: "y",
      imageUrl: "http://evil.test/a.jpg",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/图片/);
  });

  // ---- 004: dishName 为空 -> 400 ----
  it("TC-L2-APIDP-004: POST 缺 dishName -> 400", async () => {
    const res = await postWith("R1", {
      nickname: "x",
      dishName: "",
      imageUrl: "https://blob-mock.test/a.jpg",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/菜名/);
  });

  // ---- 005: 无 KV -> POST 503 / GET kvDisabled ----
  it("TC-L2-APIDP-005: 无 KV env -> GET 200 kvDisabled, POST 503", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const g = await getWith("R1");
    expect(g.status).toBe(200);
    const gb = await g.json();
    expect(gb.kvDisabled).toBe(true);

    const p = await postWith("R1", {
      nickname: "x",
      dishName: "y",
      imageUrl: "https://blob-mock.test/a.jpg",
    });
    expect(p.status).toBe(503);
  });
});
