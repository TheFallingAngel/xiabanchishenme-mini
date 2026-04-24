/**
 * L1 单元测试 —— src/lib/health-tags.ts
 * 对应 TEST-CASES-v1.xlsx TC-L1-HLTH-001..006 (6 条)
 */
import { describe, expect, it } from "vitest";
import { inferHealthTags } from "./health-tags";

describe("health-tags.ts — L1 单元测试 (TC-L1-HLTH-001..006)", () => {
  it("TC-L1-HLTH-001: 空 category 返回空数组,不抛错", () => {
    expect(inferHealthTags("")).toEqual([]);
  });

  it("TC-L1-HLTH-002: 粤菜/日料 命中 清淡 + 少油", () => {
    const tags = inferHealthTags("粤菜");
    expect(tags).toEqual(expect.arrayContaining(["清淡", "少油"]));
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it("TC-L1-HLTH-003: 日料同时命中清淡/少油 + 高蛋白,截到 3 个", () => {
    const tags = inferHealthTags("日料");
    // 日料命中 清淡/少油/高蛋白 = 3 个
    expect(tags).toEqual(expect.arrayContaining(["清淡", "少油", "高蛋白"]));
    expect(tags.length).toBe(3);
  });

  it("TC-L1-HLTH-004: 面食类命中 暖胃 + 碳水为主", () => {
    const tags = inferHealthTags("兰州拉面");
    expect(tags).toEqual(expect.arrayContaining(["暖胃", "碳水为主"]));
  });

  it("TC-L1-HLTH-005: 川菜/火锅命中 油盐偏重", () => {
    expect(inferHealthTags("川菜")).toContain("油盐偏重");
    expect(inferHealthTags("重庆火锅")).toContain("油盐偏重");
  });

  it("TC-L1-HLTH-006: 未命中关键词的品类返回空 (保守兜底)", () => {
    expect(inferHealthTags("咖啡厅")).toEqual([]);
    expect(inferHealthTags("饮品店")).toEqual([]);
  });
});
