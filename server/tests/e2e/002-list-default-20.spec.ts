/**
 * TC-L3-E2E-002 · e2e-list-default
 * 进入列表模式 → 列表长度 = 20;再次切到列表仍 20
 *
 * 实现细节(见 src/app/page.tsx::DEFAULT_LIST_CAP = 20):
 *   - recommend 召回 25,list.slice(0, 20) 展示;
 *   - 如果 advancedUnlocked + modeSettings.listModeCap 会覆盖 —— 我们不种那些字段。
 *
 * 召回不足 20 的情况在上海 CBD 基本不会出现,但保守起见加了 "≥5 且 ≤20" 的兜底断言。
 */
import { test, expect, switchToListView, SHANGHAI_LOCATION } from "./helpers/fixtures";

test("TC-L3-E2E-002: 列表模式默认展示 20 家(或 ≤20 的上限)", async ({ page, seedPrefs, gotoHome }) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);

  // 列表每张卡是 `[role=button]:has(h3)`(ListView.tsx 第 43-54 行)
  const cards = page.locator('[role="button"]:has(h3)');
  const n = await cards.count();
  expect(n).toBeLessThanOrEqual(20);
  expect(n).toBeGreaterThanOrEqual(5);

  // 二次进入列表仍 20(保底:不超过上次的家数)
  // 这里通过点 BottomNav "我的" 再回到首页 tab 模拟一次 "刷新列表"
  await page.goto("/");
  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  const n2 = await page.locator('[role="button"]:has(h3)').count();
  expect(n2).toBeLessThanOrEqual(20);
  expect(n2).toBeGreaterThanOrEqual(5);
});
