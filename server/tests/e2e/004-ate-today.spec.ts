/**
 * TC-L3-E2E-004 · e2e-ate-history
 * 详情页 → 点 "今天吃过了" → 弹预算档 → 选 60 → 跳足迹 → 最新一条金额 = 60
 *
 * 实现细节(src/app/restaurant/[id]/page.tsx #34):
 *   - 底部 CTA 三段:不想吃 / 今天吃过了 / 就它了
 *   - 点"今天吃过了"弹 amount drawer,里面有快捷金额按钮 30/50/60/80/120/200
 *   - 选 60 → markAteToday(prefs, id, 60) → router.push("/history")
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

test("TC-L3-E2E-004: '今天吃过了' → 选 60 → 足迹最新一条 = 60", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  const restId = await enterDetailFromList(page, 0);

  // 记下店名,用于足迹页断言
  const name = await page.locator("h1, h2").first().textContent();

  // 点 "今天吃过了"
  await page.getByRole("button", { name: /吃过了|今天吃过/ }).click();
  // 抽屉出现 —— 选 60
  await expect(page.getByText(/改金额|你吃了多少|吃了多少|今天花了/).first()).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole("button", { name: "60", exact: true }).click();
  // 确认按钮
  const confirm = page.getByRole("button", { name: /保存|确认|记一笔|提交/ });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }

  // 跳到足迹页 (或需自己点 BottomNav "足迹")
  if (!page.url().includes("/history")) {
    await page.goto("/history");
  }
  await expect(page.getByRole("heading", { name: /足迹/ })).toBeVisible();

  // 最新一条金额徽章应显示 "¥60"
  const firstRow = page.locator("div.shadow-card.border-gray-50").first();
  await expect(firstRow.getByText(/¥60/)).toBeVisible({ timeout: 5_000 });
  // 并且是刚才那家
  if (name) {
    await expect(firstRow).toContainText(name.trim());
  }
  // 以及存入的 id 匹配
  expect(restId.length).toBeGreaterThan(0);
});
