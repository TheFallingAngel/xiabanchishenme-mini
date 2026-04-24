# miniapp/ — Taro 3 微信小程序前端

## 首次启动步骤

### 1. 装依赖

```bash
cd miniapp
pnpm install
```

**Node 25 注意**:Taro 官方推荐 Node 18/20 LTS。如果 `pnpm install` 过程或后续 build 报奇怪的错 (比如 fsevents / webpack 某层模块 not found),用 nvm 切到 20:

```bash
brew install nvm
nvm install 20
nvm use 20
pnpm install
```

### 2. 更新环境 ID

打开 `src/app.tsx`,找到:

```ts
const CLOUD_ENV_ID = "prod"; // ← 待替换
```

填微信云托管的**真实环境 ID** (类似 `prod-0a1b2c3d`)。在云托管控制台右上角下拉"环境 prod"→ 点进去能看到。

同时确认 `src/lib/request.ts` 里的 `CLOUD_SERVICE_NAME` 是 `xiaban-chishenme`,和你云托管服务名一致。

### 3. 编译到小程序

开发模式(监听文件改动,自动重编译):

```bash
pnpm dev:weapp
```

首次编译需要 30-60 秒。完成后 `dist/weapp/` 下会生成一套微信小程序代码。

### 4. 用微信开发者工具打开

1. 打开 **微信开发者工具** (还没装?[下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html))
2. 登录 (用绑定这个 AppID 的微信号)
3. **导入项目** → **项目目录**选 `/Volumes/Zee/.openclaw/workspace/projects/xiabanchishenme-mini/miniapp/` (本仓库的 miniapp 根,不是 dist/weapp,因为 project.config.json 已经指好了 miniprogramRoot)
4. **AppID** 字段自动识别为 `wxccf99d55946fb219`
5. 打开项目,左侧默认能看到首页,调云托管返回餐厅列表

### 5. 验证端到端

首页应该显示:
- "下班吃什么" 标题
- "拉到 N 家餐厅" 计数
- N 张餐厅卡片 (来自珠江新城 2km 范围)

看不到餐厅的可能原因:
- **`network error` / `errCode: -1`** → `CLOUD_ENV_ID` 没换;或 `wx.cloud.init` 抛异常
- **`HTTP 500`** → 云托管服务没起来,回云托管控制台看运行日志
- **`status: 404`** → 云托管服务名不匹配 (`CLOUD_SERVICE_NAME`)

## 目录结构

```
miniapp/
├── config/               ← Taro 构建配置 (dev/prod)
├── src/
│   ├── app.tsx           ← 全局入口 (含 localStorage shim + wx.cloud.init)
│   ├── app.config.ts     ← 小程序 app.json (pages 列表 / window / permission)
│   ├── app.scss          ← 全局样式
│   ├── lib/
│   │   └── request.ts    ← wx.cloud.callContainer 封装
│   └── pages/
│       └── index/        ← M3 首页骨架
├── types/
│   └── global.d.ts       ← defineAppConfig/definePageConfig 类型声明
├── project.config.json   ← 微信开发者工具的项目配置 (AppID 在这里)
├── tsconfig.json         ← path alias 指向 ../shared/
├── babel.config.js
└── package.json
```

## path alias

- `@/*` → `miniapp/src/*`
- `@shared/*` → `../shared/*` (业务纯函数库,跨平台共享)

所以任何页面都可以:
```ts
import { calculateMatchScore } from "@shared/match-score";
import { request } from "@/lib/request";
```

## 当前进度

M3 只做了"首页骨架 + 云托管调通"。页面数只有 1 个,内容是调试级的。
M4 才是真正的视觉迁移 (骰子卡片 / 列表 / 详情页 / 收藏 / 足迹 / 我的)。
