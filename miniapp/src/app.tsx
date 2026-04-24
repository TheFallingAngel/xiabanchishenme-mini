import { PropsWithChildren } from "react";
import { useLaunch } from "@tarojs/taro";
import Taro from "@tarojs/taro";
import "./app.scss";

/**
 * Taro app 根组件 —— 所有页面的顶层容器。
 *
 * 做三件事:
 * 1. 装一个 globalThis.localStorage 的 shim,让从 @shared/storage 直接 import 的
 *    loadPrefs/savePrefs 在小程序里能跑 (Taro.getStorageSync / Taro.setStorageSync).
 *    M4 以后如果要做适配器注入再重构。
 * 2. 初始化 wx.cloud (给 wx.cloud.callContainer 用,调云托管后端)。
 * 3. useLaunch 里打个日志,冷启动时能看到 app 跑起来。
 */

// ==== localStorage shim (shared/storage 里的 loadPrefs/savePrefs 用) ====
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => {
      try {
        const v = Taro.getStorageSync(key);
        return v || null;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        Taro.setStorageSync(key, value);
      } catch {
        // quota 超 / 权限拒,吞掉让业务继续
      }
    },
    removeItem: (key: string) => {
      try {
        Taro.removeStorageSync(key);
      } catch {}
    },
    clear: () => {
      try {
        Taro.clearStorageSync();
      } catch {}
    },
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

// ==== wx.cloud 初始化 —— 所有云托管 callContainer 依赖这个 ====
// 环境 ID: 小程序 → 云托管控制台右上 "环境 prod" 那个下拉,也能点进去看 envId
// TODO: 从云托管控制台拿到真实的环境 ID 填进来 (类似 "prod-xxxxxx")
const CLOUD_ENV_ID = "prod-d6gheyywp5f6848d7"; // ← 待替换

declare const wx: {
  cloud?: {
    init: (opts: { env: string; traceUser?: boolean }) => void;
  };
};

if (typeof wx !== "undefined" && wx.cloud) {
  try {
    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    });
  } catch (err) {
    console.warn("[app] wx.cloud.init failed:", err);
  }
}

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    console.log("[app] 下班吃什么 · 小程序已启动");
  });

  // children 是 Taro 编译时注入的当前页面组件
  return children;
}

export default App;
