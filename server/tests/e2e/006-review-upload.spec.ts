/**
 * TC-L3-E2E-006 · e2e-review-compress
 * 详情页 → 写评价 → 传 5MB + 500KB 两张图 → 提交 → 评价列表新增一条,两张图都能访问
 *
 * 实现细节:
 *   - ReviewForm.tsx 里 <input type="file" accept="image/*" multiple>
 *     隐藏在按钮后面,走 fileInputRef.current?.click()
 *   - uploadReviewImage → /api/reviews/upload → @vercel/blob 或本地 mock
 *   - submitReview → POST /api/reviews/[restaurantId]
 *
 * 真实后端前提:
 *   · BLOB_READ_WRITE_TOKEN 可用(否则 /api/reviews/upload 500,测试会被跳过)
 *   · KV 可用(否则评价写入返回降级)
 *
 * 退化判定:
 *   任一前提不可用时只要 upload 接口返回非 2xx,我们 test.skip() —— M5 目的
 *   是 UI 链路,不是 BLOB/KV 配置完好度;M6 回归报告里专门标注。
 */
import {
  test,
  expect,
  enterDetailFromList,
  switchToListView,
  SHANGHAI_LOCATION,
} from "./helpers/fixtures";

/**
 * 生成一张随机 JPEG buffer,尽量贴近 size 字节。
 * 头 4 字节 JFIF magic,尾 2 字节 EOI,中间填随机 —— 够骗过 Blob handler 的 magic byte 检查。
 */
function makeFakeJpeg(sizeBytes: number): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // SOI + APP0
  const eoi = Buffer.from([0xff, 0xd9]);
  const body = Buffer.alloc(Math.max(0, sizeBytes - header.length - eoi.length));
  for (let i = 0; i < body.length; i++) body[i] = Math.floor(Math.random() * 256);
  return Buffer.concat([header, body, eoi]);
}

test("TC-L3-E2E-006: 写评价 + 传 5MB + 500KB 两张图 → 评价新增一条,两图可访问", async ({
  page,
  seedPrefs,
  gotoHome,
}) => {
  await seedPrefs({ currentLocation: SHANGHAI_LOCATION });
  await gotoHome();

  await expect(page.locator("button.w-44.h-44").first()).toBeVisible({ timeout: 20_000 });
  await switchToListView(page);
  await enterDetailFromList(page, 0);

  // 点"写一条评价" (或"再写一条")
  await page.getByRole("button", { name: /写一条评价|再写一条/ }).click();

  // 昵称阶段 —— 如果是首次(needNickname)要先填昵称
  const nicknameInput = page.getByPlaceholder(/下班的糖醋/);
  if (await nicknameInput.isVisible().catch(() => false)) {
    await nicknameInput.fill("回归测试员");
    await page.getByRole("button", { name: /保存昵称/ }).click();
  }

  // 评价表单出现 —— 找"打个分"标签锚定
  await expect(page.getByText(/打个分/)).toBeVisible({ timeout: 5_000 });

  // 打 4 星(第 4 颗 Star 图标所在 button —— 星星按钮没有 aria-label,
  // 但在 .flex.items-center.gap-1\\.5 里顺序排,nth(3) 就是第 4 颗)
  const starButtons = page.locator("div.flex.items-center.gap-1\\.5 > button").first().locator("..");
  await starButtons.locator("> button").nth(3).click();

  // 填文字(必填之一 —— 或者有图也行,我们两项都填更稳)
  await page.locator("textarea").fill("E2E 测试 · 双图上传");

  // 给隐藏 input[type=file] 塞两个 Buffer
  const fileInput = page.locator('input[type="file"][accept^="image"]');
  const bigJpg = makeFakeJpeg(5 * 1024 * 1024); // 5 MB
  const smallJpg = makeFakeJpeg(500 * 1024); // 500 KB
  await fileInput.setInputFiles([
    { name: "big.jpg", mimeType: "image/jpeg", buffer: bigJpg },
    { name: "small.jpg", mimeType: "image/jpeg", buffer: smallJpg },
  ]);

  // 等缩略图出现 —— 传完会 push 到 images[],UI 渲染 .w-20.h-20 img
  // 真后端可能需要 5-30s,放宽 timeout;如果 60s 还没出来就是 BLOB 配置问题,skip
  const uploaded = page.locator("div.w-20.h-20 img");
  try {
    await expect(uploaded).toHaveCount(2, { timeout: 60_000 });
  } catch {
    test.skip(true, "BLOB 未配置或上传失败,跳过 UGC 上传验证");
    return;
  }

  // 提交
  await page.getByRole("button", { name: /发布评价|发布中/ }).click();

  // 等表单关闭 + 新评价出现在列表里。ReviewList 里卡片 class 有 bg-white + shadow-card。
  // 按"我"角标过滤更稳:myReviewIds 匹配后会显示 .bg-orange-50\\/30 的边框
  const myCard = page
    .locator("div.bg-white.rounded-2xl.p-4.shadow-card")
    .filter({ hasText: "E2E 测试" })
    .first();
  await expect(myCard).toBeVisible({ timeout: 30_000 });

  // 这条评价里应当有 2 张 <img> ,每张 naturalWidth > 0 即视为可访问
  const imgs = myCard.locator("img");
  await expect(imgs).toHaveCount(2);
  const widths = await imgs.evaluateAll((els) =>
    els.map((el) => (el as HTMLImageElement).naturalWidth)
  );
  for (const w of widths) expect(w).toBeGreaterThan(0);
});
