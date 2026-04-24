# shared/ — 跨平台纯函数业务库

这里的 `.ts` 文件从 H5 仓库 (`xiaban-chishenme/app/src/lib/`) 复制过来,**保持和 H5 同步**。所有函数都是纯的 (input → output, 无副作用),因此可以在:

- `server/` — Next.js API 路由里跑 (Node 环境)
- `miniapp/` — Taro 编译到微信小程序后跑 (小程序 JS 运行时)

## 文件清单

| 文件 | 作用 | 平台兼容 |
|---|---|---|
| `types.ts` | 业务类型定义 (Restaurant / UserPreferences / ReviewRecord 等) | ✅ |
| `match-score.ts` | 餐厅匹配度评分 (口味/距离/预算/评分/新鲜度 5 维) | ✅ |
| `budget.ts` | 预算计算 (日均 / 月剩余 / 状态档位) | ✅ |
| `reason-context.ts` | LLM 推荐理由的上下文信号构建 | ✅ |
| `user-profile.ts` | 从历史数据推导用户画像 | ✅ |
| `recommend.ts` | 推荐算法主体 (打分 + 过滤 + 排序) | ✅ |
| `health-tags.ts` | 从 category 推断健康标签 | ✅ |
| `mock-data.ts` | 无 AMAP_API_KEY 时的演示餐厅 | ✅ |
| `storage.ts` | 用户偏好读写 + 业务动作 (markAteToday 等) | ⚠️ |

## ⚠️ storage.ts 的特殊性

`storage.ts` 里除了一堆**纯函数** (markAteToday / markNotInterested / recentlyAte 等,输入
`UserPreferences` 返回新 `UserPreferences`),还有两个**平台相关**函数:

- `loadPrefs()` — 用 `localStorage.getItem` 读
- `savePrefs(prefs)` — 用 `localStorage.setItem` 写

这两个在浏览器 H5 里直接可用;在 Taro/微信小程序里 **`localStorage` 不存在**。

**当前的应对** (M3 scope):
- miniapp 端在 app 入口装一个 globalThis.localStorage 的 shim (映射到 `Taro.getStorageSync`)
- 这样 shared 里任何 `loadPrefs`/`savePrefs` 调用都能跑

**未来 (M4 或以后) 的正式方案**:
- 改成适配器注入模式: `configureStorage(adapter: StorageAdapter)`
- 各平台提供各自的 adapter
- 去掉 localStorage 全局依赖

在 M4 开始迁复杂页面、发现 shim 有 bug 之前,shim 足够用。

## 和 H5 同步

这些文件改动后要同步回 H5 仓库 (或反过来)。未来可以用 pnpm workspace 或 git subtree 来真
正共用一份代码。目前阶段**两边各自维护一份**,commit message 里提一下"(sync from H5 xxxx)"
方便追踪。
