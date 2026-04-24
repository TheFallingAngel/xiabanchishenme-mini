/**
 * E2E fixtures —— 基础 test 装饰器
 *
 * 把"每条用例都要做一次"的三件事封进 fixture:
 *   1. 进页面前清掉 localStorage + sessionStorage (M5 用例默认要求"干净态")
 *   2. 提供 seedPrefs(prefs) 往 localStorage 注入用户偏好 —— 有些用例需要
 *      预置 history / favorites / acceptedCategory
 *   3. 统一的 iPhone 14 Pro viewport + 上海定位已在 playwright.config.ts 里设,
 *      这里只再 expose 一个 gotoHome() 方便每条用例一句话到首页
 *
 * 不在这里做的事:
 *   - page.route mock: M5 用真实后端
 *   - 视觉快照对齐:基线跟宿主机 chromium 走,不引 stylesheet hack
 */
import { test as base, expect, Page } from "@playwright/test";
import type { UserPreferences } from "../../../src/lib/types";

type Fixtures = {
  /**
   * 在 localStorage 写一份用户偏好,用于预置"已经去过 X 家"/"已收藏 Y" 等
   * 状态的用例。必须在 page.goto 之前调,因为 page.tsx 首帧会读 localStorage。
   */
  seedPrefs: (prefs: Partial<UserPreferences>) => Promise<void>;
  /** 一键到首页(/);已经处理好 localStorage/sessionStorage 清理 */
  gotoHome: () => Promise<void>;
};

export const test = base.extend<Fixtures>({
  seedPrefs: async ({ page }, use) => {
    // init script 会在每次 navigation 前注入(未来跳其他路由也会带,不丢状态)
    let seeded: Partial<UserPreferences> | null = null;
    await use(async (prefs: Partial<UserPreferences>) => {
      seeded = prefs;
      await page.addInitScript((p) => {
        // loadPrefs 读 DEFAULT 里没有的字段会报错 —— 宽一点,merge 到 DEFAULT
        const KEY = "restaurant_prefs_v1";
        const existingRaw = window.localStorage.getItem(KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        window.localStorage.setItem(KEY, JSON.stringify({ ...existing, ...p }));
      }, prefs);
    });
    void seeded;
  },
  gotoHome: async ({ page }, use) => {
    await use(async () => {
      // 首次访问先打空白页,清 storage,再真正导航 —— 避开 about:blank 下 localStorage SecurityError
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
        } catch {
          /* about:blank 下会 throw,忽略 */
        }
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
    });
  },
});

export { expect };

/**
 * 骰子模式:点大红按钮 → 等 RESULT 卡出现 → 返回卡片 h2 里的店名。
 *
 * DiceView 那个大红骰子按钮没有 data-testid,只能靠位置 + 附近的
 * "摇一摇，找灵感" 标题定位。一旦 RESULT 出现,会看到"看看详情"按钮。
 */
export async function rollDiceAndWaitResult(page: Page): Promise<string> {
  // 这个 button 是 page 上第一个 w-44 h-44 的按钮,selector 直接命中
  const dice = page.locator("button.w-44.h-44").first();
  await expect(dice).toBeVisible({ timeout: 15_000 });
  await dice.click();
  // RESULT 状态下会出现 "看看详情" 按钮
  const acceptBtn = page.getByRole("button", { name: /看看详情/ });
  await expect(acceptBtn).toBeVisible({ timeout: 10_000 });
  const name = await page.locator("h2.text-2xl").first().textContent();
  return (name || "").trim();
}

/**
 * 从首页进到列表模式。
 *
 * 实现上首页没有 "一步到 LIST" 的 URL,必须走 DICE → SWIPE → LIST。
 * SwipeMode 的右上角有 "直接看列表" 按钮(见 SwipeMode.tsx),点一下就跳。
 * 如果找不到那个按钮(比如只有一个候选,走了单次路径),fallback 去
 * 反复换一家耗尽候选,getNextCandidate 返 null 后自动 ENTER_LIST。
 */
export async function switchToListView(page: Page): Promise<void> {
  // 已经在结果页 → 先点"换一家"几次直到直接进列表 (> maxAttempts 次换一家后会进 swipe)
  // 或者 SwipeMode 的 "看列表" 按钮直接跳
  const listBtn = page.getByRole("button", { name: /看列表|直接看列表|列表/ });
  const maxTries = 10;
  for (let i = 0; i < maxTries; i++) {
    if (await listBtn.first().isVisible().catch(() => false)) {
      await listBtn.first().click();
      break;
    }
    const reject = page.getByRole("button", { name: /换一家/ });
    if (await reject.isVisible().catch(() => false)) {
      await reject.click();
    } else {
      // 再摇一次
      const dice = page.locator("button.w-44.h-44").first();
      if (await dice.isVisible().catch(() => false)) {
        await dice.click();
      } else {
        break;
      }
    }
  }
  // 列表模式的标题 "为你精选"
  await expect(page.getByText("为你精选")).toBeVisible({ timeout: 10_000 });
}

/**
 * 进入列表模式后点第 n 家(0-based)卡片,进详情页。
 * 返回进入的餐厅 id —— 从 URL 里提。
 */
export async function enterDetailFromList(page: Page, index = 0): Promise<string> {
  const cards = page.locator('[role="button"]:has(h3)');
  await expect(cards.first()).toBeVisible();
  await cards.nth(index).click();
  await page.waitForURL(/\/restaurant\/[^/]+$/);
  const id = page.url().split("/").pop() || "";
  return id;
}

/**
 * 标准"先选位置"的操作:首页右上角没位置时会弹 "选择位置";播种 prefs 时
 * 把 currentLocation 一起塞进去可以直接跳过这步。
 */
export const SHANGHAI_LOCATION = {
  name: "上海·人民广场",
  address: "黄浦区人民大道",
  lng: 121.4737,
  lat: 31.2304,
};
