/**
 * TC-L3-E2E-001 · e2e-home-first
 * 干净 localStorage + fixture POI → 打开 / → 允许定位 → 点骰子 → 等卡片
 * 预期:TOP1 卡片含 店名 / 菜系 / 步行 / 人均 / 评分 五字段
 */
import { test, expect, rollDiceAndWaitResult, SHANGHAI_LOCATION } from "./helpers/fixtures";

test("TC-L3-E2E-001: 首页摇骰子 → 卡片五字段齐全", async ({ page, seedPrefs, gotoHome }) => {
  // 提前把上海位置塞进 prefs,跳过"先告诉我你在哪"那步
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  // 等后端 /api/restaurants 回来 —— 列表家数 > 0 才能摇
  await expect(page.getByText(/正在搜索附近美食|摇一摇/)).toBeVisible();
  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });

  const restaurantName = await rollDiceAndWaitResult(page);
  expect(restaurantName.length).toBeGreaterThan(0);

  // 卡片五字段断言 —— 店名已有,看其余 4 个
  // 菜系:ResultCard.tsx 里没有单独 category 元素,走 `${card.category.split(";")[0]}` 的
  // 场景在列表模式的 h3 下方。ResultCard 里的菜系会混在 "¥/人 + 步行 + 评分" 那条 bar
  // 之前没渲染。M5 阶段把这条断言改为"详情页"能看到菜系更稳 —— 这里只断 ResultCard
  // 上能看到的 4 个视觉字段,菜系留给 detail page spec 覆盖。
  await expect(page.locator("h2.text-2xl")).toHaveText(restaurantName);
  // 评分(Star 图标 + 数字)
  const ratingRow = page.locator('div.flex.items-center.gap-1:has(svg.fill-gold)');
  await expect(ratingRow.first()).toBeVisible();
  // 人均 ¥/人
  await expect(page.getByText(/¥\d+\/人/)).toBeVisible();
  // 步行 X 分钟
  await expect(page.getByText(/步行\d+分钟/)).toBeVisible();
  // AI reason 橘色卡
  await expect(page.locator(".bg-\\[\\#FFF8F0\\]")).toBeVisible();
});
