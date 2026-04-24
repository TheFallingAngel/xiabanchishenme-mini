/**
 * TC-L3-E2E-005 · e2e-not-interested
 * 列表中点 A 的 "不想吃" → 刷新列表 → A 不再出现
 *
 * 实现(src/app/page.tsx::handleNotInterestedFromList):
 *   ListView 每张卡右上角有一个 aria-label="不想吃这家" 的 ThumbsDown icon button。
 *   点一下会:
 *     - markNotInterested(prefs, id, name, ...)  —— 写入 7 天屏蔽
 *     - SWIPE_LEFT dispatch 把它从 allCandidates 过滤掉
 *   刷新(location.reload)后 recommend 会读 notInterested 再做一次硬过滤
 */
import { test, expect, switchToListView, SHANGHAI_LOCATION } from "./helpers/fixtures";

test("TC-L3-E2E-005: 列表里点 '不想吃' → 刷新 → 该店不再出现", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);

  // 第一张卡的店名 —— ListView.tsx 里卡片根是 [role=button]:has(h3)
  const firstCard = page.locator('[role="button"]:has(h3)').first();
  const targetName = ((await firstCard.locator("h3").first().textContent()) || "").trim();
  expect(targetName.length).toBeGreaterThan(0);

  // 点它的 "不想吃" 按钮(aria-label="不想吃这家")
  await firstCard.getByRole("button", { name: "不想吃这家" }).click();

  // 本次列表应立即少一条 target —— target 不应在当前可见卡片里
  await expect(page.locator(`[role="button"]:has(h3:text-is("${targetName}"))`)).toHaveCount(0, {
    timeout: 5_000,
  });

  // 刷新 + 再切到列表模式,还是不应出现
  await page.goto("/");
  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await expect(
    page.locator(`[role="button"]:has(h3:text-is("${targetName}"))`)
  ).toHaveCount(0);
});
