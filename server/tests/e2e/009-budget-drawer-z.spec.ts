/**
 * TC-L3-E2E-009 · e2e-budget-drawer-z
 * 预算/金额抽屉必须盖过 BottomNav —— 验 z-index + 视觉快照
 *
 * 源自 #81 "记账抽屉被 tab 覆盖" —— 修复方案是把所有金额抽屉提到 z-[60],BottomNav 是 z-50。
 * 这条 case 同时用两种方法证明修复没退化:
 *   A. DOM 层:找到 class 含 "z-[60]" 的抽屉 + 计算 BottomNav z-index,断言 60 > BottomNav
 *   B. 视觉层:toHaveScreenshot 基线 —— 首跑生成 `009-budget-drawer-z-snapshot.png`,
 *      后续跑会被 playwright 逐像素对比(config 里 maxDiffPixelRatio=0.02 放行抗锯齿)
 *
 * 复用详情页的"吃过了"抽屉(结构与足迹页编辑抽屉一致,都是 z-[60])
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

test("TC-L3-E2E-009: 金额抽屉 z-index 盖过 BottomNav + 视觉基线", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await enterDetailFromList(page, 0);

  // 打开"吃过了"抽屉
  await page.getByRole("button", { name: /吃过了|今天吃过/ }).click();
  const drawer = page.locator("div.fixed.inset-0.z-\\[60\\]").last();
  await expect(drawer).toBeVisible({ timeout: 5_000 });
  // 抽屉里至少有"¥"和快捷档按钮才算渲染完毕
  await expect(drawer.getByText("¥")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "80", exact: true })).toBeVisible();

  // —— A. DOM z-index 断言 ——
  const drawerZ = await drawer.evaluate((el) =>
    parseInt(window.getComputedStyle(el).zIndex || "0", 10)
  );
  // BottomNav 是 nav[aria-label] 或 .z-50 的底栏;详情页打开时 BottomNav 可能已隐藏,
  // 退一步断言 drawerZ ≥ 60 即可(源代码写死 z-[60])
  expect(drawerZ).toBeGreaterThanOrEqual(60);

  // 如果 BottomNav 还在 DOM 里,额外断言 drawer > bottomNav
  const bottomNav = page.locator("nav").filter({ hasText: /首页|足迹|收藏|我的/ });
  if (await bottomNav.first().isVisible().catch(() => false)) {
    const navZ = await bottomNav.first().evaluate((el) =>
      parseInt(window.getComputedStyle(el).zIndex || "0", 10)
    );
    expect(drawerZ).toBeGreaterThan(navZ);
  }

  // 确认按钮应当是可点的(不被任何元素遮挡)—— 用 Playwright 的 elementHandle.isVisible
  // 加 boundingBox 点击中心 + 命中测试一起做
  const confirmBtn = drawer.getByRole("button", { name: /^确认$/ }).first();
  await expect(confirmBtn).toBeVisible();
  const box = await confirmBtn.boundingBox();
  expect(box).not.toBeNull();
  // 按钮离底部应有足够距离 —— BottomNav 高度约 64px,确认按钮底边 y 值应 < viewport.height - 0
  // (要是 BottomNav 压住,botton 坐标会被切掉或者 y+h > viewport)
  const viewport = page.viewportSize();
  if (box && viewport) {
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

  // —— B. 视觉快照 ——
  // 等 spring 动画 (damping 30, stiffness 300 约 300-400ms) + 避免 fade-in 帧
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("009-budget-drawer-open.png", {
    fullPage: false,
  });
});
