import path from "node:path";
import { defineConfig } from "@tarojs/cli";
import devConfig from "./dev";
import prodConfig from "./prod";

export default defineConfig(async (merge, { command, mode }) => {
  const baseConfig = {
    projectName: "xiabanchishenme-mini",
    date: "2026-04-25",
    designWidth: 750, // Taro 默认 iPhone6 (750rpx = 375px)
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: "src",
    outputRoot: `dist/${process.env.TARO_ENV}`,
    // path alias,和 tsconfig.json paths 保持一致
    alias: {
      "@": path.resolve(__dirname, "..", "src"),
      "@shared": path.resolve(__dirname, "..", "..", "shared"),
    },
    plugins: ["@tarojs/plugin-framework-react", "@tarojs/plugin-platform-weapp"],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {},
    },
    framework: "react" as const,
    compiler: "webpack5" as const,
    cache: {
      enable: true, // Taro 项目编译缓存,大幅缩短第二次 build 时间
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false, // 默认关 CSS Modules,小程序样式用普通 .scss
        },
      },
    },
    h5: {
      publicPath: "/",
      staticDirectory: "static",
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
    },
  };

  if (process.env.NODE_ENV === "development") {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
