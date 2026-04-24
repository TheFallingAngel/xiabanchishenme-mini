/**
 * TC-L3-E2E-008 · e2e-history-manage
 * 足迹页管理:编辑金额写回 + 删除二次确认
 *
 * 前置:先从详情页点"吃过了"记一条(¥80),然后进足迹页:
 *   1. 点金额徽章 → 抽屉打开
 *   2. 把金额改成 150 → 保存 → 徽章显 "¥150"
 *   3. 再次点开 → 点删除(第一次变红色"再点确认")
 *   4. 再点一次 → 抽屉关闭 + 列表 -1 行
 *
 * 实现要点(src/app/history/page.tsx):
 *   · pendingDeleteKey 控制二次确认:第一次点 handleDelete 只 setPendingDeleteKey + toast "再点一次即删除"
 *   · editing 抽屉用 z-[60],盖过 BottomNav 的 z-50 (TC-009 验证视觉,本 case 只验逻辑)
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

test("TC-L3-E2E-008: 足迹编辑金额写回 + 删除二次确认", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await enterDetailFromList(page, 0);

  // 种一条足迹 —— "吃过了" → ¥80
  await page.getByRole("button", { name: /吃过了|今天吃过/ }).click();
  await expect(page.getByText(/改金额|吃了多少|今天花了|记一笔/).first()).toBeVisible({
    timeout: 5_000,
  });
  // 抽屉里"80"是快捷按钮之一
  await page.getByRole("button", { name: "80", exact: true }).click();
  const confirmBtn = page.getByRole("button", { name: /^确认$|保存|记一笔|提交/ });
  if (await confirmBtn.first().isVisible().catch(() => false)) {
    await confirmBtn.first().click();
  }

  // 跳(或手动跳)足迹页
  if (!page.url().includes("/history")) {
    await page.goto("/history");
  }
  await expect(page.getByRole("heading", { name: /足迹/ })).toBeVisible();

  // 最新一条 row
  const firstRow = page.locator("div.shadow-card.border-gray-50").first();
  await expect(firstRow.getByText(/¥80/)).toBeVisible({ timeout: 5_000 });

  // —— Step A: 编辑金额 80 → 150 ——
  // 金额徽章 aria-label="编辑已花金额"
  await firstRow.getByRole("button", { name: "编辑已花金额" }).click();

  // 抽屉打开 —— 标题"改金额 · {店名}"
  const drawer = page.locator("div.fixed.inset-0.z-\\[60\\]").last();
  await expect(drawer.getByText(/改金额/)).toBeVisible({ timeout: 5_000 });

  // 数字 input —— 清空后填 150
  const amountInput = drawer.locator('input[type="number"]');
  await amountInput.fill("150");
  await drawer.getByRole("button", { name: /保存/ }).click();

  // 抽屉关闭,徽章 = ¥150
  await expect(drawer).toBeHidden({ timeout: 3_000 });
  await expect(firstRow.getByText(/¥150/)).toBeVisible();

  // —— Step B: 删除二次确认 ——
  await firstRow.getByRole("button", { name: "编辑已花金额" }).click();
  const drawer2 = page.locator("div.fixed.inset-0.z-\\[60\\]").last();
  await expect(drawer2.getByText(/改金额/)).toBeVisible({ timeout: 5_000 });

  // 先数当前列表行数(待会断言 -1)
  const beforeCount = await page.locator("div.shadow-card.border-gray-50").count();

  // 第一次点"删除" → 文案变 "再点确认"
  await drawer2.getByRole("button", { name: "删除这条足迹" }).click();
  await expect(drawer2.getByRole("button", { name: "删除这条足迹" })).toContainText("再点确认");

  // 第二次点 → 真删
  await drawer2.getByRole("button", { name: "删除这条足迹" }).click();

  // 抽屉关闭 + 行数 -1
  await expect(drawer2).toBeHidden({ timeout: 3_000 });
  await expect(page.locator("div.shadow-card.border-gray-50")).toHaveCount(
    Math.max(0, beforeCount - 1),
    { timeout: 3_000 }
  );
});
