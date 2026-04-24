# 微信云托管部署手册 (M1)

把 `server/` 目录部署到微信云托管,拿到一个可被小程序 (和未来 H5) 调用的 HTTPS 后端。

**前置条件**:
- ✅ 已申请微信小程序 AppID (`wxccf99d55946fb219`)
- ✅ 已在微信公众平台开通云托管 (未开的去:小程序后台 → 开发 → 云开发 / 云托管)
- ✅ 本机装好 Docker (**本地验证镜像用**,直接云托管部署可不装)
- ⏳ 个体工商户营业执照 + ICP 备案 (并行办,绑自定义域名时才需要)

---

## 一、本地 Docker 验证 (可选但强推)

省得云托管构建失败浪费时间。在 `server/` 目录下:

```bash
# 先补一个 .env.local (云托管部署不需要,本地测需要)
cp .env.example .env.local
# 然后编辑 .env.local 填:
#   AMAP_API_KEY=xxx
#   NEXT_PUBLIC_AMAP_JS_KEY=xxx
#   NEXT_PUBLIC_AMAP_JS_SECURITY_CODE=xxx
#   MINIMAX_API_KEY=xxx
#   KV_REST_API_URL=xxx      (Vercel KV,暂时继续用;M2 迁走)
#   KV_REST_API_TOKEN=xxx
#   BLOB_READ_WRITE_TOKEN=xxx

# 构建 (第一次 3-5 分钟)
docker build -t xbcsm-server .

# 跑起来
docker run --rm -p 3000:3000 --env-file .env.local xbcsm-server

# 另开一个 terminal 验证
curl "http://localhost:3000/api/restaurants?lng=113.32&lat=23.12&maxWalkMinutes=25&radius=2000"
# 应返回一批 POI 或 mock 数据 JSON
```

镜像大小应该在 **180-250 MB** 之间。超过 500MB 说明 `output: "standalone"` 没生效,检查 `next.config.mjs`。

---

## 二、微信云托管控制台配置

### 1. 进入云托管

浏览器打开:[https://cloud.weixin.qq.com/cloudrun](https://cloud.weixin.qq.com/cloudrun)

登录用**开通该小程序的微信号**。选择环境 (没有环境先新建一个,环境 ID 一般类似 `prod-xxxx`)。

### 2. 新建服务

**服务管理 → 新建服务** → 填:
- **服务名称**:`xbcsm-server`(小写字母/数字/连字符)
- **部署方式**:选择"代码仓库" 或 "本地上传"
  - 推荐**代码仓库**:让云托管自动从 GitHub / GitLab / 腾讯工蜂拉代码
  - 新仓库要先 push 到 GitHub,然后在云托管里授权读取
- **构建方式**:选 "Dockerfile 构建"
- **代码目录**:`server/` (Dockerfile 所在路径)
- 其他留默认,创建

### 3. 配置环境变量

**服务详情 → 服务设置 → 环境变量** (或在创建时一起填),**复制粘贴以下这组**:

| 变量名 | 值从哪里来 | 是否必填 |
|---|---|---|
| `AMAP_API_KEY` | 高德开放平台 → Web 服务 Key | ✅ 必填 |
| `NEXT_PUBLIC_AMAP_JS_KEY` | 高德 → Web 端(JSAPI) Key | ✅ 必填 |
| `NEXT_PUBLIC_AMAP_JS_SECURITY_CODE` | 高德 JSAPI Key 的安全密钥 | ✅ 必填 |
| `MINIMAX_API_KEY` | MiniMax 控制台 | ⚠️ 建议填,不填 LLM 降级为模板 |
| `KV_REST_API_URL` | Vercel KV 控制台 (过渡期复用) | 可选,M2 换 CloudBase 前先用 |
| `KV_REST_API_TOKEN` | 同上 | 可选 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 控制台 (过渡期复用) | 可选,M2 换 COS 前先用 |
| `NEXT_TELEMETRY_DISABLED` | `1` | 建议,关闭 Next.js 匿名上报 |

**注意**:云托管环境变量是**构建时 + 运行时都注入**。`NEXT_PUBLIC_*` 在 Next.js build 阶段 inline 进 bundle,**改完必须重新构建才生效**。

### 4. 资源规格 + 实例数

**服务设置 → 资源规格**:
- **CPU**:0.25 核 (最低档,Hobby 够用,每月免费 180,000 核秒)
- **内存**:0.5 GB (够 Next.js 运行)
- **最小实例数**:0 (无请求时缩容到 0,零成本;但冷启动 + 800ms)
- **最大实例数**:3 (小流量够用,看账单调)

**建议**:如果详情页延迟敏感 (LLM insight 已经要 3-5s,再加 800ms 冷启动很难看),改成**最小实例数 1**,常驻一个实例,预估 ¥30-50/月。M1 阶段可以先 0,看流量再调。

### 5. 触发部署

**服务详情 → 版本管理 → 新建版本**:
- 选刚才配好的代码仓库和 commit
- 点"构建并部署"
- 等 3-8 分钟:拉代码 → Dockerfile 构建 → 推镜像 → 启动容器

部署成功后,**服务详情页面会显示一个默认域名**,形如:
```
xbcsm-server-xxxx-xxxxxxx.ap-shanghai.run.tcloudbase.com
```

### 6. 验证部署

浏览器直接访问默认域名 + 健康检查路径:
```
https://xbcsm-server-xxxx.ap-shanghai.run.tcloudbase.com/api/restaurants?lng=113.32&lat=23.12&maxWalkMinutes=25&radius=2000
```

应返回 JSON 餐厅列表。同时看**服务详情 → 监控**,应看到 1 个运行中实例、QPS 曲线开始动。

---

## 三、小程序如何调用

有两种调用方式,**推荐方式 A (wx.cloud.callContainer)**,不需要 ICP 备案:

### 方式 A:wx.cloud.callContainer (推荐,无需备案)

```js
// 小程序前端代码
wx.cloud.init({ env: 'prod-xxxx' })  // 云托管环境 ID
wx.cloud.callContainer({
  config: { env: 'prod-xxxx' },
  path: '/api/restaurants?lng=113.32&lat=23.12',
  method: 'GET',
  header: {
    'X-WX-SERVICE': 'xbcsm-server',   // 服务名
  },
}).then(res => console.log(res.data))
```

**优势**:
- 不用 ICP 备案
- 不用在小程序管理后台配 "request 合法域名"
- 微信内部通道,速度比公网直连更快

### 方式 B:普通 wx.request (需备案后)

等 ICP 备案下来、自定义域名绑到云托管之后,可以用普通 `wx.request`:

```js
wx.request({
  url: 'https://api.yourdomain.com/api/restaurants?...',
})
```

前提:
- 域名 ICP 备案过 (以个体工商户主体)
- 域名在小程序管理后台 → 开发管理 → 开发设置 → **request 合法域名** 里添加
- 云托管服务绑定了该自定义域名

---

## 四、H5 过渡期也切云托管

M1 跑通后,现有 H5 (Vercel 上那个) 可以把 fetch 的 baseURL 指到云托管默认域名,国内用户延迟立即降低。**暂时不影响**,等 M2 迁完 KV/Blob、备案也下来,两边都切到云托管就稳了。

---

## 五、常见踩坑

| 症状 | 原因 | 修法 |
|---|---|---|
| Build 阶段 `Cannot find module 'xxx'` | node_modules 没 COPY 过来 | Dockerfile 里 `COPY --from=deps /app/node_modules ./node_modules` 检查 |
| 部署后 /api/* 返回 500 | 环境变量没注入 | 服务设置 → 环境变量 核对,改完触发**重新构建** (不是重启) |
| 第一次请求巨慢 (5-10s) | 最小实例数 = 0 的冷启动 | 改成最小 1 |
| `NEXT_PUBLIC_*` 改了不生效 | 这类变量是 **build time** 注入 | 必须重新**构建**版本,重启不行 |
| 镜像构建 out of memory | Next.js build 阶段内存峰值高 | 构建资源规格调到 2GB 内存 |

---

## 六、成本估算 (Hobby 档,小流量)

| 项 | 免费额度 | 超出单价 |
|---|---|---|
| CPU | 180,000 核秒/月 | ¥0.00009/核秒 |
| 内存 | 360,000 MB·秒/月 | ¥0.00002/MB·秒 |
| 流量 | 50 GB/月 | ¥0.8/GB |
| 镜像存储 | 0.5 GB 免费 | ¥0.1/GB/天 |

**真实估算** (DAU 100,每天 50 次详情页 API 调用):
- 请求总数 ~5000/天 = 150,000/月
- 预估 CPU 消耗 ≈ 30,000 核秒/月 (远低于免费额度)
- 预估流量 < 5 GB/月
- **实际账单:¥0 / 月**

即使 DAU 涨到 1000,也只是 **¥20-50/月** 的档。

---

## 里程碑推进

M1 完成 → 触发 M2 (KV/Blob 迁 CloudBase/COS) 和 M3 (Taro 脚手架) 可并行启动。

详见 [README.md](./README.md) 路线图。
