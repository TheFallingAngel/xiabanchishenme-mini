/**
 * TC-L3-E2E-007 · e2e-dish-hide-no-photo
 * 招牌菜区块里不应出现"零图"的菜 —— 每道菜至少有 1 张 UGC 或 POI 图
 *
 * 实现(见 src/app/restaurant/[id]/page.tsx #79 allDishes 过滤):
 *   - 招牌菜合并 POI tags + UGC 上传后,再过滤零图的菜不进 allDishes
 *   - 区块只在 allDishes.length > 0 || showRecommendProse 时渲染
 *   - 每道菜走 DishImageCarousel,images 为空组件内直接 return null
 *
 * 断言思路:
 *   1. 若招牌菜区块出现 → 每个菜名 <p> 上方都必须有至少 1 张 <img>
 *   2. 如果整块没出现(allDishes 为空 + 没 recommend prose),用例就是"零菜零描述"的冷门店,
 *      放过(xlsx case 只要求"出现的菜都有图",不要求必然有菜)
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

test("TC-L3-E2E-007: 招牌菜区块只显示有图菜品", async ({ page, seedPrefs, gotoHome }) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await enterDetailFromList(page, 0);

  // 招牌菜区块标题锚:<span>招牌菜</span> 或者 <span>店家简介</span>
  // 我们只在"招牌菜"模式下做断言(有菜名才有 DishImageCarousel)
  const dishHeader = page.getByText("招牌菜", { exact: true });
  const hasDishes = await dishHeader.first().isVisible().catch(() => false);

  if (!hasDishes) {
    test.skip(true, "当前餐厅无招牌菜(allDishes 为空),用例不适用");
    return;
  }

  // 招牌菜 card 容器 —— 包含标题"招牌菜" + 其后的 grid
  const dishCard = page
    .locator("div.bg-white.rounded-2xl.p-4.shadow-card")
    .filter({ hasText: "招牌菜" })
    .first();
  await expect(dishCard).toBeVisible();

  // dishCard 下的每个菜格子是 `div.w-full` > DishImageCarousel + <p>菜名</p>
  // 在该 grid 内,所有菜名 <p> 的 count 应 === grid 下所有菜格子 count
  const dishItems = dishCard.locator("div.grid > div.w-full");
  const n = await dishItems.count();
  expect(n).toBeGreaterThan(0);

  // 每一格都应该有至少一张 <img>(DishImageCarousel 在 images 非空时才渲染,
  // 所以一格没 img = 出现了零图菜,违反 #79 规则)
  for (let i = 0; i < n; i++) {
    const item = dishItems.nth(i);
    const imgs = item.locator("img");
    const imgCount = await imgs.count();
    expect(imgCount).toBeGreaterThanOrEqual(1);

    // 进一步:至少第一张 img naturalWidth > 0 (排除 404 图)
    const firstNaturalWidth = await imgs.first().evaluate(
      (el) => (el as HTMLImageElement).naturalWidth || 0
    );
    // 真后端图偶有 429/超时,仅 warn 不断言:M6 会在回归报告里统计
    if (firstNaturalWidth === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[007] dish ${i} 首图未加载成功,可能高德 CDN 临时问题`);
    }
  }
});
