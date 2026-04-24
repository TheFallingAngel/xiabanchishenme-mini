# 下班吃什么 — MVP H5

> 下班后 1 分钟搞定晚饭决策

## 快速启动

```bash
cd app
npm install
npm run dev
```

打开 http://localhost:3000

## 开发注意事项

- **不要在同一目录同时跑 `npm run dev` 和 `npm run build`**：本轮实测会把 `.next` 开发缓存打脏，触发 `Cannot find module './xxx.js'` 这类热更新错误。
- 如果已经出现上述问题，先停掉 dev 进程，再执行：

```bash
rm -rf .next
npm run dev
```

## 环境变量

复制 `.env.example` 到 `.env.local` 并填入高德 API Key：

```bash
cp .env.example .env.local
```

**没有 API Key 也能跑**：会自动使用演示数据（12 家模拟餐厅）。

## 功能

### 已实现（MVP v0.1）
- ✅ 位置选择（当前定位 + 手动搜索 + 最近使用）
- ✅ 附近餐厅搜索（高德 POI，无 Key 时用 mock）
- ✅ 步行时间计算（高德步行路径）
- ✅ 推荐卡片（3~5 张，带推荐理由）
- ✅ 换一批（不重复上一批）
- ✅ 反馈闭环：不想吃（7天屏蔽）/ 今天去了（3天降权+记录历史）/ 收藏
- ✅ 历史记录页
- ✅ 收藏页
- ✅ localStorage 持久化

### 不做（强约束）
- ❌ 大众点评/美团评论
- ❌ 外卖下单
- ❌ 账号登录
- ❌ LLM 主推荐链
- ❌ 复杂后端数据库

## 技术栈

- **框架**: Next.js 14 (App Router)
- **样式**: Tailwind CSS
- **外部 API**: 高德地图 Web 服务（POI + 步行路径 + 输入提示）
- **存储**: localStorage
- **推荐引擎**: 规则排序（距离 × 评分 × 历史去重 × 随机因子）

## 页面结构

```
/ ............... 首页（位置选择 + 推荐列表）
/history ........ 用餐历史
/favorites ...... 收藏夹
```

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── restaurants/route.ts  ← 餐厅搜索 BFF
│   │   └── location/search/route.ts ← 地点搜索 BFF
│   ├── history/page.tsx
│   ├── favorites/page.tsx
│   ├── layout.tsx
│   ├── page.tsx ← 主推荐页
│   └── globals.css
├── lib/
│   ├── types.ts ← 数据类型定义
│   ├── amap.ts ← 高德 API 封装
│   ├── mock-data.ts ← 演示数据
│   ├── storage.ts ← localStorage 持久化
│   └── recommend.ts ← 推荐排序引擎
```
