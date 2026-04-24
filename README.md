# 下班吃什么 · 小程序

微信小程序版本的"下班吃什么"餐厅推荐应用。

## 和 H5 仓库的关系

| 仓库 | 用途 | 状态 |
|---|---|---|
| [**xiaban-chishenme**](https://github.com/TheFallingAngel/xiaban-chishenme) | H5 原型 / 开发验证 | ✅ 继续运行,不动 |
| **xiabanchishenme-mini** (本仓库) | 微信小程序 + 云托管后端 | 🚧 开发中 (方案 B) |

H5 那边已经趋于稳定,这边从那边复用:
- **业务逻辑**:纯函数 lib (匹配打分、预算、推荐、口味别名等) 直接 copy,见 `shared/`
- **API 路由**:基本照搬,改造成容器化部署 (`server/`)
- **UI 层**:**从零重写**,用 Taro 3 编译到小程序 (`miniapp/`,M3 后加入)

## 目录结构

```
xiabanchishenme-mini/
├── server/                    ← Next.js API-only 后端,部署到微信云托管 (M1)
│   ├── src/
│   │   ├── app/api/           ← 所有 /api/* 路由,和 H5 共用一致
│   │   └── lib/               ← 后端用到的 amap / minimax / 图像打标等
│   ├── Dockerfile             ← 微信云托管直接读这个文件构建镜像
│   └── .dockerignore
├── miniapp/                   ← Taro 3 小程序前端 (M3 以后建立)
├── shared/                    ← 前后端共用的纯函数 TS lib (M3 以后建立)
├── DEPLOY-CLOUDRUN.md         ← 云托管部署手册
├── README.md                  ← 本文件
└── .gitignore
```

## 部署路线图

按里程碑推进,M1 开跑:

| 里程碑 | 内容 | 预估 |
|---|---|---|
| **M1** | 后端容器化 + 微信云托管部署 | 2-3 天 |
| **M2** | KV/Blob 抽象层 + 腾讯 CloudBase/COS 迁移 | 2-3 天 |
| **M3** | Taro 脚手架 + 共享 lib 抽取 | 1-2 天 |
| **M4** | 5 个核心页面 Taro 迁移 | 1-1.5 周 |
| **M5** | 小程序专属 (wx.login / 定位 / 内容安全) | 3-5 天 |
| **M6** | 代码审核 + 上线 | 3-7 天 (含微信审核) |

总计 4 周全职。

## 相关资源

- **小程序 AppID**:`wxccf99d55946fb219`
- **主体类型**:个人 (1 个月后升级个体工商户)
- **ICP 备案**:待发起 (必须用个体工商户主体发起,避免重复迁移)
- **云托管后端域名**:TBD (M1 完成后定)

## 快速上手 (M1 后端本地测试)

```bash
cd server
npm ci
cp .env.example .env.local     # 然后填上各种 API key
npm run dev                    # http://localhost:3000
```

镜像构建验证:
```bash
cd server
docker build -t xbcsm-server .
docker run -p 3000:3000 --env-file .env.local xbcsm-server
```

详见 [DEPLOY-CLOUDRUN.md](./DEPLOY-CLOUDRUN.md)。
