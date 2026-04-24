/**
 * L1 单元测试 —— src/lib/amap.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-AMAP-001..010 (10 条)
 *
 * 覆盖:
 *   - searchRestaurants: 无 key 抛错 / 成功解析 POI / 失败返回 []
 *   - getWalkingTime: 无 key 走直线估算 / 成功拿接口值 / 异常兜底
 *   - getPoiDetail: 无 key 返 null / 成功解析 / 异常兜底
 *   - fillWalkingTimes: 仅处理前 20 家, 透传 walkMinutes
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  searchRestaurants,
  getWalkingTime,
  getPoiDetail,
  fillWalkingTimes,
} from "./amap";
import type { Restaurant } from "./types";

const originalEnv = { ...process.env };

describe("amap.ts — L1 单元测试 (TC-L1-AMAP-001..010)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  // ---- searchRestaurants ----

  it("TC-L1-AMAP-001: searchRestaurants 无 key 抛 'AMAP_API_KEY not configured'", async () => {
    delete process.env.AMAP_API_KEY;
    await expect(searchRestaurants(113, 23)).rejects.toThrow("AMAP_API_KEY");
  });

  it("TC-L1-AMAP-002: searchRestaurants 成功 -> 标准化 Restaurant[]", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "1",
        pois: [
          {
            id: "p1",
            name: "湘村馆",
            type: "餐饮服务;中餐厅",
            address: "北京路 1 号",
            biz_ext: { cost: "45", rating: "4.6" },
            tel: "10086",
            photos: [{ url: "https://a.jpg" }],
            location: "113.5,23.1",
            distance: "600",
          },
        ],
      }),
    }) as unknown as typeof fetch;
    const out = await searchRestaurants(113, 23, "川菜", 2000, "test-key");
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("p1");
    expect(out[0].category).toBe("餐饮服务"); // type 用 ";" 分割取第一段
    expect(out[0].avgPrice).toBe(45);
    expect(out[0].rating).toBe(4.6);
    expect(out[0].distanceMeters).toBe(600);
    expect(out[0].walkMinutes).toBe(0); // 未填充
    expect(out[0].location).toEqual({ lng: 113.5, lat: 23.1 });
    expect(out[0].photos).toEqual(["https://a.jpg"]);
  });

  it("TC-L1-AMAP-003: searchRestaurants status 非 '1' -> 空数组", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: "0", info: "INVALID_PARAM" }),
    }) as unknown as typeof fetch;
    expect(await searchRestaurants(113, 23, undefined, 2000, "k")).toEqual([]);
  });

  it("TC-L1-AMAP-004: searchRestaurants POI 字段不全时用兜底值", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "1",
        pois: [
          {
            id: "p2",
            name: "无 biz_ext 店",
            type: "",
            address: "",
            location: "113,23",
          },
        ],
      }),
    }) as unknown as typeof fetch;
    const out = await searchRestaurants(113, 23, undefined, 2000, "k");
    expect(out[0].category).toBe("餐饮");
    expect(out[0].avgPrice).toBe(0);
    expect(out[0].rating).toBe(0);
    expect(out[0].distanceMeters).toBe(0);
    expect(out[0].photos).toBeUndefined();
  });

  // ---- getWalkingTime ----

  it("TC-L1-AMAP-005: getWalkingTime 无 key 走直线 × 111000 / 80 估算", async () => {
    delete process.env.AMAP_API_KEY;
    // 两点经纬度差 0.001 -> 约 111m -> 约 1.4 分钟
    const m = await getWalkingTime(113.0, 23.0, 113.001, 23.0);
    // 距离 ≈ 0.001 * 111000 = 111m / 80 = 1.3875 -> round(1.3875) = 1
    expect(m).toBe(1);
  });

  it("TC-L1-AMAP-006: getWalkingTime 成功 -> 用接口 duration (秒)/60 取整分钟", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "1",
        route: { paths: [{ duration: "480" }] }, // 480 秒 = 8 分钟
      }),
    }) as unknown as typeof fetch;
    expect(await getWalkingTime(113, 23, 113.01, 23.01, "key")).toBe(8);
  });

  it("TC-L1-AMAP-007: getWalkingTime 接口异常 -> 回到直线估算", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const m = await getWalkingTime(113, 23, 113.001, 23, "key");
    expect(m).toBe(1);
  });

  // ---- getPoiDetail ----

  it("TC-L1-AMAP-008: getPoiDetail 无 key 返 null", async () => {
    delete process.env.AMAP_API_KEY;
    expect(await getPoiDetail("p1")).toBeNull();
  });

  it("TC-L1-AMAP-009: getPoiDetail 成功解析 (photos/tags/recommend)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "1",
        pois: [
          {
            id: "p1",
            name: "湘村馆",
            type: "中餐厅",
            address: "北京路",
            tel: "10086",
            biz_ext: {
              cost: "45",
              rating: "4.6",
              open_time_week: "周一至周日 10:00-22:00",
              meal_ordering: "1",
              seat_ordering: "1",
              recommend: "小炒黄牛肉;剁椒鱼头",
            },
            tag: "湘菜;家常;小炒",
            photos: [
              { url: "https://a.jpg", title: "门面" },
              { url: "https://b.jpg" },
              { url: "" }, // 应被过滤
            ],
            alias: "湘村小馆",
            location: "113,23",
          },
        ],
      }),
    }) as unknown as typeof fetch;
    const d = await getPoiDetail("p1", "k");
    expect(d).not.toBeNull();
    expect(d!.name).toBe("湘村馆");
    expect(d!.avgPrice).toBe(45);
    expect(d!.rating).toBe(4.6);
    expect(d!.photos.length).toBe(2); // 空 url 被过滤
    expect(d!.tags).toEqual(expect.arrayContaining(["湘菜", "家常", "小炒", "在线点餐", "在线订位"]));
    expect(d!.recommend).toBe("小炒黄牛肉;剁椒鱼头");
    expect(d!.openTime).toBe("周一至周日 10:00-22:00");
    expect(d!.location).toEqual({ lng: 113, lat: 23 });
  });

  // ---- fillWalkingTimes ----

  it("TC-L1-AMAP-010: fillWalkingTimes 只对前 20 家算 walking, 其余原样返回", async () => {
    delete process.env.AMAP_API_KEY; // 强制走直线估算,避免 mock fetch
    const restaurants: Restaurant[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      name: `店${i}`,
      category: "川菜",
      address: "",
      avgPrice: 0,
      rating: 0,
      walkMinutes: 0,
      distanceMeters: 0,
      location: { lng: 113 + i * 0.001, lat: 23 },
    }));
    const out = await fillWalkingTimes(restaurants, 113, 23);
    // top 函数 .slice(0, 20) -> 返回 20 家
    expect(out.length).toBe(20);
    // 首家距离小, walkMinutes = round(0) = 0 (自身点)
    expect(out[0].walkMinutes).toBe(0);
    // 第 19 家 (i=19) 经度差 0.019 -> 距离 ≈ 2100m / 80 = 26 分钟
    expect(out[19].walkMinutes).toBeGreaterThan(20);
  });
});
