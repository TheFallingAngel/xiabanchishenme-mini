import Taro from "@tarojs/taro";

/**
 * 请求封装 —— 调用微信云托管部署的 Next.js 后端。
 *
 * 设计优先级:
 *   1. **wx.cloud.callContainer** (推荐) —— 不需要 ICP 备案、走微信内部通道、速度快。
 *      需要 app.config.ts 里 cloud: true,且 wx.cloud.init 已在 app.tsx 跑过。
 *   2. **wx.request** (回退) —— 需要后端域名在小程序 "request 合法域名" 白名单里。
 *      只有在备案 + 绑自定义域名之后才建议切到这条路。
 *
 * 当前 (M3) 默认走 callContainer。M5 之后如果需要性能对比或域名策略改变,
 * 把 USE_CLOUD_CONTAINER 改 false 并填 BASE_URL 即可。
 */

// ==== 配置项,发布时改这两个 ====

/** 微信云托管服务名,对应云托管控制台 → 服务列表里那个名字 */
const CLOUD_SERVICE_NAME = "xiaban-chishenme";

/** 是否走云托管专用通道 (否则走公网 HTTPS) */
const USE_CLOUD_CONTAINER = true;

/** 走 wx.request 时用的公网 BaseURL (云托管默认域名 / 备案后的自定义域名都可) */
const PUBLIC_BASE_URL =
  "https://xiaban-chishenme-250670-6-1425715947.sh.run.tcloudbase.com";

// ==== 类型 ====

export interface RequestOptions<TBody = unknown> {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: TBody;
  /** 查询字符串参数,会 URL-encode 拼到 path 后 */
  query?: Record<string, string | number | undefined | null>;
  /** 请求超时,毫秒;默认 15000 */
  timeout?: number;
}

export interface RequestError {
  status: number;
  message: string;
  body?: unknown;
}

// ==== 核心工具 ====

/** 把 query 对象拼成 ?a=1&b=2 形式,自动过滤 undefined/null */
function buildQueryString(query?: Record<string, unknown>): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// wx.cloud.callContainer 的返回类型声明 (Taro 没导出,自己写)
interface CloudCallContainerResult {
  statusCode: number;
  data: unknown;
  header: Record<string, string>;
  errMsg?: string;
}

declare const wx: {
  cloud?: {
    callContainer(opts: {
      config?: { env: string };
      path: string;
      method?: string;
      header?: Record<string, string>;
      data?: unknown;
      timeout?: number;
    }): Promise<CloudCallContainerResult>;
  };
};

/**
 * 统一请求入口 —— 所有业务调用都走这里。
 *
 * 返回 Promise<T> 泛型,失败会 throw RequestError (.status, .message, .body)。
 * 超时、网络中断、HTTP 非 2xx 统一归为错误,业务层 try/catch 就行。
 */
export async function request<T = unknown>(
  opts: RequestOptions
): Promise<T> {
  const { path, method = "GET", body, query, timeout = 15000 } = opts;
  const fullPath = `${path}${buildQueryString(query)}`;

  // ---- 走 wx.cloud.callContainer ----
  if (USE_CLOUD_CONTAINER && typeof wx !== "undefined" && wx.cloud) {
    const res = await wx.cloud.callContainer({
      path: fullPath,
      method,
      header: {
        "X-WX-SERVICE": CLOUD_SERVICE_NAME,
        "Content-Type": "application/json",
      },
      data: body,
      timeout,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const err: RequestError = {
        status: res.statusCode,
        message:
          typeof res.data === "object" && res.data && "error" in res.data
            ? String((res.data as { error: unknown }).error)
            : `HTTP ${res.statusCode}`,
        body: res.data,
      };
      throw err;
    }
    return res.data as T;
  }

  // ---- 回退走公网 wx.request ----
  const res = await Taro.request({
    url: `${PUBLIC_BASE_URL}${fullPath}`,
    method,
    header: { "Content-Type": "application/json" },
    data: body,
    timeout,
  });

  const statusCode = res.statusCode ?? 0;
  if (statusCode < 200 || statusCode >= 300) {
    const err: RequestError = {
      status: statusCode,
      message:
        typeof res.data === "object" && res.data && "error" in res.data
          ? String((res.data as { error: unknown }).error)
          : `HTTP ${statusCode}`,
      body: res.data,
    };
    throw err;
  }
  return res.data as T;
}
