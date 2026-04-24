import { afterEach, beforeEach, vi } from "vitest";

/**
 * 全局测试 setup —— 对齐 TEST-PLAN-v1.1 §9 环境准备。
 *
 * 关键约定:
 *   1) 系统时间固定 (FAKE_NOW),避免"今天/明天"类断言被真实时钟扫到
 *      —— 业务里 recentlyAte/markAteToday/isNotInterested/history trim 都依赖 new Date()
 *   2) localStorage 每个测试前清空 —— storage.test.ts 会反复读写同一个 key
 *   3) console.warn/error 的 spy 需要在每个文件自己开,setup 不全局 silence,
 *      否则调试会漏错误
 */

/** 把测试"今天"钉死在 2026-04-19 20:00 +08:00 —— 试用开始前一日的晚饭场景 */
export const FAKE_NOW = new Date("2026-04-19T12:00:00.000Z"); // = 20:00 GMT+8

beforeEach(() => {
  vi.useFakeTimers({ now: FAKE_NOW });
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});
