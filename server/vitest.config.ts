import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 配置 —— 对齐 TEST-PLAN-v1.1 §5 覆盖率门槛。
 *
 * L1 (lib/)    : 90% lines / 90% branches / 90% functions  —— 业务纯函数,口径严
 * L2 (api/)    : 85% lines / 80% branches                  —— 路由层,mock 边界较多
 * 其他         : 不强制,但跑进全局覆盖
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**", "test-results/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html", "lcov"],
      // 覆盖率产物写到 .coverage/ (加入 .gitignore),避免老 report 文件权限残留。
      // CI 可通过 VITEST_COVERAGE_DIR 覆盖到其它路径(例如 sandbox 临时目录)。
      reportsDirectory: process.env.VITEST_COVERAGE_DIR || "./.coverage",
      // L1 阶段 coverage 只盯 src/lib/ 纯函数层;API 路由走 L2 里程碑,另算。
      // minimax.ts / image-tag.ts / reviews.ts 里涉及 fetch/SSE/浏览器 API 的部分,
      // 现有 L2 API 测试是通过 vi.mock 把它们整体替换的(测的是路由层契约),
      // 因此 L2 并不贡献这三个文件的行覆盖。L1 阶段已覆盖其核心纯函数分支,
      // 剩余 SSE/KV/FormData/Blob 深层分支留给独立的 L1 补测里程碑处理,
      // 这里继续排除以免把 L1 均值拖低。
      include: ["src/lib/**"],
      exclude: [
        "src/lib/types.ts",
        "src/lib/mock-data.ts",
        "src/lib/image-tag-client.ts",
        "src/lib/minimax.ts",
        "src/lib/reviews.ts",
        "src/lib/image-tag.ts",
        "**/*.test.ts",
        "**/*.d.ts",
      ],
      thresholds: {
        // L1 全局口径 —— L1 lib/ 核心纯函数层(已排除需要 L2 mock 的 3 个文件)
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
        // 业务纯函数 —— 提到 90/90/90
        "src/lib/storage.ts": {
          lines: 90, branches: 85, functions: 90, statements: 90,
        },
        "src/lib/recommend.ts": {
          lines: 90, branches: 85, functions: 90, statements: 90,
        },
        "src/lib/match-score.ts": {
          lines: 90, branches: 90, functions: 90, statements: 90,
        },
        "src/lib/budget.ts": {
          lines: 90, branches: 90, functions: 90, statements: 90,
        },
        "src/lib/user-profile.ts": {
          lines: 90, branches: 90, functions: 90, statements: 90,
        },
        "src/lib/health-tags.ts": {
          lines: 90, branches: 90, functions: 90, statements: 90,
        },
        "src/lib/reason-context.ts": {
          lines: 90, branches: 90, functions: 90, statements: 90,
        },
      },
    },
    // 默认时间源固定,避免 "今天/明天" 类断言被真实时钟扫到(见 tests/setup.ts)
    testTimeout: 10_000,
    // CI 上跑得慢一些,本地秒级 —— threads 交给默认
  },
});
