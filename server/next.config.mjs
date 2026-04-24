/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 微信云托管 Docker 部署必须:
  // standalone 模式会把 server.js + 运行时依赖精简到 .next/standalone/,
  // 镜像大小从 ~800MB 降到 ~200MB,冷启动也快不少
  output: "standalone",
};

export default nextConfig;
