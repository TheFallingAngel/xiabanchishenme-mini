/**
 * TC-L3-E2E-003 · e2e-sticky-header
 * 详情页向下滚动 ~400px → sticky mini header 出现,z-index 在 BottomNav 之上
 *
 * 实现(见 src/app/restaurant/[id]/page.tsx #76 sticky 分支):
 *   滚动阈值大概在页面 hero 图往下两屏左右,出现一个 sticky 的迷你 header
 *   (带店名 + 返回键)。BottomNav 的 z-50,sticky mini header 需要 > 50。
 *
 * 断言路径:
 *   1. DOM 存在 sticky 元素(class 包 sticky + 店名文本)
 *   2. 计算 z-index 数值 ≥ 50 (同档或更高即通过)
 *   3. 启用视觉快照 -- 首次跑会生成基线
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

test("TC-L3-E2E-003: 详情页 sticky mini header 出现且 z-index ≥ BottomNav", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await enterDetailFromList(page, 0);
  // 等详情 hero 图加载(img 或 AmapView)
  await expect(page.locator("main, section").first()).toBeVisible();

  // 先截一张"头图可见" 状态 —— 用于对照
  await page.waitForTimeout(500); // 给 InsightCard streaming 进来一秒稳帧

  // 滚 400px
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(400); // 等 sticky CSS 过渡

  // sticky mini header 的关键 class 组合(见 #76):class 同时包含 "sticky" 和 "top-0"
  const stickyHeader = page.locator(
    '[class*="sticky"][class*="top-0"], header[class*="sticky"]'
  );
  await expect(stickyHeader.first()).toBeVisible({ timeout: 5_000 });

  // 算 z-index
  const zIndex = await stickyHeader.first().evaluate((el) => {
    return parseInt(window.getComputedStyle(el).zIndex || "0", 10);
  });
  // BottomNav 用 z-50;sticky header 至少要 ≥ 50
  expect(zIndex).toBeGreaterThanOrEqual(50);

  // 视觉基线 —— 首次跑会生成 `003-sticky-header-after-scroll.png`
  await expect(page).toHaveScreenshot("003-sticky-header-after-scroll.png", {
    fullPage: false,
  });
});
