/// <reference types="@tarojs/taro" />

/**
 * Taro 提供的全局函数 (defineAppConfig / definePageConfig) 的类型声明。
 * Taro 运行时会把 config 文件里的调用替换成静态对象,编译阶段需要这个 .d.ts。
 */
declare function defineAppConfig<T extends Record<string, unknown>>(config: T): T;
declare function definePageConfig<T extends Record<string, unknown>>(config: T): T;

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: "weapp" | "h5" | "rn" | "swan" | "alipay" | "tt" | "qq" | "jd";
    NODE_ENV: "development" | "production";
  }
}
