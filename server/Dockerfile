# syntax=docker/dockerfile:1.6
#
# 微信云托管 Next.js 部署镜像
# 三阶段构建:deps → builder → runner,最终镜像 ~180MB
#
# 本地构建验证:
#   cd server
#   docker build -t xbcsm-server .
#   docker run -p 3000:3000 --env-file .env.local xbcsm-server
#   curl http://localhost:3000/api/restaurants?lng=113.32&lat=23.12
#
# 云托管部署:
#   直接把 server/ 目录上传或绑 Git,云托管自动识别这个 Dockerfile 构建
#
# ARG + 默认 node 版本:Next.js 14 官方推荐 20.x
ARG NODE_VERSION=20.18.1

# ============================================================
# Stage 1: deps —— 只装 prod 依赖,利用 Docker 层缓存避免每次重装
# ============================================================
FROM node:${NODE_VERSION}-alpine AS deps

# alpine 上 sharp (Next.js image opt) 需要 libc6-compat
RUN apk add --no-cache libc6-compat

WORKDIR /app

# 只 copy lock + package,代码变了但依赖没变时这一层命中缓存
COPY package.json package-lock.json ./

# --include=dev 是因为 build 阶段 tsc / next build 还需要 devDeps
# npm ci 比 npm install 稳定:严格按 lock 装、装前清 node_modules
RUN npm ci --include=dev

# ============================================================
# Stage 2: builder —— 跑 next build,产出 .next/standalone/
# ============================================================
FROM node:${NODE_VERSION}-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# 拉上一阶段装好的依赖
COPY --from=deps /app/node_modules ./node_modules

# 再 copy 业务源代码
COPY . .

# Next.js 14 build —— 依赖 next.config.mjs 里 output: "standalone"
# 这会在 .next/standalone/ 下生成一个独立可跑的 Node server,不再依赖 node_modules 全量
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============================================================
# Stage 3: runner —— 最小运行镜像
# ============================================================
FROM node:${NODE_VERSION}-alpine AS runner

WORKDIR /app

# 非 root 用户运行,云托管安全基线
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 云托管默认期望 3000 端口,也允许 env 覆盖
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 只搬 standalone 产物 + public + .next/static,不搬 node_modules 全量
# Next.js standalone 会把跑起来必需的 node_modules 子集内嵌到 .next/standalone/
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Next.js standalone 产物的启动脚本就是根目录的 server.js
CMD ["node", "server.js"]
