# 下班吃什么｜Dinner Recommendation Purity Fix Validation（2026-04-07）

> Intended path: `/Users/aa/.openclaw/workspace/company/projects/xiaban-chishenme/eval/recommendation-purity-fix-2026-04-07.md`
> Actual path: current sandbox only allows writes under `app/`, so this report is stored in `app/eval/`.

## 结论
- 本次修复命中根因：推荐层原本只看 `category`，但 Amap 映射时把 `poi.type` 截成首段，导致咖啡/茶饮/甜品细分类在进推荐池前已丢失，晚餐黑名单几乎失效。
- 现在改成：Amap 映射保留 `categoryPath` + `typecode`，API 候选池先过滤一次，推荐层再复用同一 helper 兜底过滤。
- 这能同时覆盖首批推荐和“换一批”，因为两者都共用 `generateRecommendations(...)`。

## 已验证
### 1. 构建
- `npm run build`
- 结果：通过

### 2. 真实 API 验证尝试
- 尝试方式 A：`npm run start -- --port 3090`
- 结果：失败，沙箱禁止监听端口，报错 `listen EPERM`
- 尝试方式 B：脚本直连 Amap（`restapi.amap.com`）
- 结果：失败，沙箱网络/DNS 受限，报错 `getaddrinfo ENOTFOUND restapi.amap.com`

### 3. 代码级合成验证（使用实际编译后的 helper 与推荐逻辑）
- 验证样本覆盖 Stage 5 报告里出现过的污染类型与正餐样本：
  - 被拦截：`CHALI茶里(体育西店)` / `谁的咖啡 WHOS COFFEE` / `瑞幸咖啡（广州高德置地冬广场店）` / `椰语甜品`
  - 被保留：`湘里土菜馆` / `喜鹊饭堂` / `水濑·日料放题(天河店)` / `牛很鲜潮汕牛肉火锅`
- 结果：
  - 非晚餐样本 eligibility 全为 `false`
  - 正餐样本 eligibility 全为 `true`
  - 第一批推荐仅返回正餐
  - 第二批（传入第一批 `excludeIds`）仍仅返回正餐，没有回落到咖啡/甜品池

## 剩余风险
- 由于沙箱无法访问 Amap，今天没法在真实体育西路 / 珠江新城数据上复跑一次，所以“线上真实商圈纯度提升幅度”仍待外网环境二次确认。
- 当前过滤主要基于 `typecode` 前缀和名称/分类关键词，若 Amap 某些门店被错误标成正餐类型且名称也不含明显饮品词，仍可能漏进池子；不过相比改前，晚餐纯度已经显著收紧。
