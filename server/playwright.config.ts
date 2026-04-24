/**
 * Playwright 配置 —— M5 里程碑 · 10 条主链路 E2E
 *
 * 设计取舍:
 *   1. 设备:iPhone 14 Pro(zh-CN),和 PRD §五 目标移动端一致
 *   2. baseURL:默认 http://localhost:3000(next dev),可用 E2E_BASE_URL 覆盖到
 *      Preview / 自建域名(例如 https://xxx.vercel.app)
 *   3. 浏览器:默认走 Playwright 自带 chromium;如用户本地已经开着 chromium
 *      + remote debugging 端口,设置 E2E_CDP_URL=http://localhost:9337 可以直连
 *      现有窗口(省一次启动 + 能复用登录态)
 *   4. 后端:**真实测试后端** —— 不做 route mock,直接打真的 /api/* 与
 *      AMap / MiniMax / Vercel KV / Blob。依赖 .env.local(或 Vercel Preview)里
 *      已经配好 key。第三方调用偶尔会慢,单用例超时拉到 60s,全局动作 10s
 *   5. 视觉:E2E-003/009 启用 toHaveScreenshot 基线;首次跑会自动生成,
 *      后续按 strict 对比;跨机器差异靠 threshold 控一档(见下)
 *
 * 本地运行:
 *   (sandbox 跑不了,必须在用户宿主机)
 *   npm run dev                  # 开一个 dev server(另一个 shell)
 *   npm run test:e2e             # headed + 真实 chromium
 *   E2E_CDP_URL=http://localhost:9337 npm run test:e2e
 *                                # 复用本地已打开的 chromium(带 --remote-debugging-port)
 *   npm run test:e2e -- --update-snapshots   # 刷新 003/009 的基线
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const USE_CDP = !!process.env.E2E_CDP_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // 视觉基线:跨平台字体渲染/DPR 会有 1~2% 像素差,开一点宽容度避免噪声翻车。
    // 严格值(pixel-level)留给 CI 里的 Linux runner,跟生成基线的机器一致。
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  // 真实后端 + 前端 dev server 都是"暖机状态"才稳,禁掉默认并行让第一次 KV/MiniMax
  // 冷启动不互相放大超时。M5 主链路只有 10 条,串行跑成本可以接受。
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./test-results/e2e-html", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    // 定位:上海人民广场附近(PRD §十 的上海主路线 city fixture),允许浏览器
    // geolocation API 直接返回这个值,绕过"请求定位权限" 弹窗
    geolocation: { latitude: 31.2304, longitude: 121.4737 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    permissions: ["geolocation"],
    // trace/video 只在 retry/failure 时留,省磁盘
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // 如果用户用 E2E_CDP_URL 接现有 chromium,Playwright 的 launch options 不生效,
    // 但 context 级设定(viewport/geolocation/locale)仍会套用到新 context。
    ...(USE_CDP
      ? {
          connectOptions: { wsEndpoint: process.env.E2E_CDP_URL! },
        }
      : {}),
  },
  projects: [
    {
      name: "iPhone-14-Pro",
      use: {
        ...devices["iPhone 14 Pro"],
        // devices 会覆盖 locale/timezoneId,这里重新把 zh-CN 锁回来
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
      },
    },
  ],
  // 如果 dev server 没开,Playwright 会自动拉起 `npm run dev`(仅本地,不在 CI)。
  // 关掉 reuseExistingServer 会每次强开新 server,会抢端口 —— 留 true 让用户自己
  // 手动 `npm run dev` 好 debug。
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        // Next.js 14 冷启动(含首次编译 /restaurant/[id] route)可能 90-120s,
        // 保险给到 180s。CI 上也不怕 —— 起来后就命中 cache
        timeout: 180_000,
      },
});
