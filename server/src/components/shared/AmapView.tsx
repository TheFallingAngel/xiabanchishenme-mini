"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

interface AmapViewProps {
  lng: number;
  lat: number;
  title: string;
  /** 用户当前位置,可选,用于同时绘制步行路径 */
  origin?: { lng: number; lat: number } | null;
  /** 点击地图后打开高德原生/网页 */
  onTapThrough?: () => void;
}

/**
 * 详情页位置卡片：高德 JS API 交互地图。
 * - 定高,内部支持拖动、双指缩放
 * - 缩略预览,不提供导航控件,点击跳转高德
 * - Key 缺失或加载失败时降级为静态图
 */
/**
 * 把高德/自己抛出的错误归类 —— 只有分类后,才能在 fallback 里给出"查 securityCode"之类
 * 的可行建议。不做翻译,只看关键字,因为不同版本高德 SDK 返回的字段名会变化。
 */
type AmapFailReason =
  | "no-key"            // env 里压根没配 NEXT_PUBLIC_AMAP_JS_KEY
  | "missing-security"  // 有 key 但没配 securityJsCode —— 瓦片会返 INVALID_USER_SCODE
  | "invalid-scode"     // 运行时 INVALID_USER_SCODE (key 和 securityCode 不配套)
  | "domain-mismatch"   // 控制台白名单没加当前域名
  | "timeout"           // 3s 内没 complete 事件
  | "unknown";          // JS 异常但未命中上述模式

function classifyAmapError(raw: unknown): AmapFailReason {
  const msg = String((raw as { message?: string } | undefined)?.message || raw || "").toLowerCase();
  if (msg.includes("invalid_user_scode") || msg.includes("user_scode")) return "invalid-scode";
  if (msg.includes("user_domain") || msg.includes("domain") || msg.includes("referer")) return "domain-mismatch";
  if (msg.includes("invalid_user_key") || msg.includes("user_key")) return "no-key";
  return "unknown";
}

const REASON_HINT: Record<AmapFailReason, string> = {
  "no-key": "未配置 NEXT_PUBLIC_AMAP_JS_KEY",
  "missing-security": "缺少安全密钥,已降级静态图",
  "invalid-scode": "安全密钥与 Key 不匹配",
  "domain-mismatch": "当前域名不在白名单",
  "timeout": "地图加载超时,已降级静态图",
  "unknown": "地图加载失败,已降级静态图",
};

export function AmapView({ lng, lat, title, origin, onTapThrough }: AmapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [reason, setReason] = useState<AmapFailReason>("unknown");
  const [ready, setReady] = useState(false);

  const jsKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
  // 高德 JS API 2.0 新增的安全密钥。没配 securityJsCode 会出现:
  // ① 部分 tile 返回 INVALID_USER_SCODE; ② 道路/POI 文字空缺(只显示底图色块);
  // 这两种都是用户反馈"有地图但没门牌/街道名字"的典型症状。
  const securityCode = process.env.NEXT_PUBLIC_AMAP_JS_SECURITY_CODE;

  // 把 origin 拍成两个 primitive,避免父组件每次渲染传一个新对象引用
  // (即使值没变) 导致本 effect 不断重 init,引发 destroy → re-create 的 race:
  // 老实例还没 destroy 干净,新实例又抢进 DOM,ready 反复重置, 3s/8s 超时倒计时也反复重启。
  const originLng = origin?.lng ?? null;
  const originLat = origin?.lat ?? null;

  useEffect(() => {
    if (!jsKey || !containerRef.current) {
      setReason("no-key");
      setError(true);
      return;
    }

    // #69 灰屏根因: Key 存在但 securityCode 缺失 → 瓦片 INVALID_USER_SCODE → 只剩底色
    // 这种情况下不要再跑 JSAPI,直接降级成静态图,避免用户看到 3 秒加载圈 + 灰屏。
    if (!securityCode) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[AmapView] NEXT_PUBLIC_AMAP_JS_SECURITY_CODE 未配置。高德 JS API 2.0 从 2021-12-02 起强制要求安全密钥,缺失时瓦片会返回 INVALID_USER_SCODE 导致底图灰屏。已降级为静态图。获取方式:高德控制台 → 应用管理 → 你的 JS Key → 右侧「安全密钥」。"
        );
      }
      setReason("missing-security");
      setError(true);
      return;
    }

    let map: unknown;
    let destroyed = false;
    // 8 秒保底超时:有些场景下高德 JS API 会卡在 tile 请求阶段 —— 不抛异常、不触发 catch,
    // 导致 ready=false 一直挂着,用户只看到灰网格 + 比例尺这种"半残地图"。
    // 超时后直接翻到 error 分支,用静态图替代,至少是张正常能看的地图。
    //
    // 为什么是 8s 而不是 3s: 首次冷启动要串行走 DNS + loader 下载 + JSAPI bundle 下载 +
    // 首屏 tile + complete 事件,国内 4G 或回源慢的链路上 4-7s 是常态。3s 会在冷启动时
    // 大概率误伤,表现为"时好时坏" —— 首次进详情页超时→静态图, 第二次走缓存→秒开。
    const readyTimer = setTimeout(() => {
      if (destroyed) return;
      // 进入这里说明 setReady(true) 还没被调 —— JS API 卡住了
      setReason("timeout");
      setError(true);
    }, 12000);

    async function init() {
      try {
        // 必须在 AMapLoader.load 之前注入 _AMapSecurityConfig,顺序错了会直接报错。
        if (typeof window !== "undefined") {
          /* eslint-disable @typescript-eslint/no-explicit-any */
          (window as any)._AMapSecurityConfig = { securityJsCode: securityCode };
          /* eslint-enable @typescript-eslint/no-explicit-any */
        }
        const AMapLoader = (await import("@amap/amap-jsapi-loader")).default;
        const AMap = await AMapLoader.load({
          key: jsKey!,
          version: "2.0",
          // 只留 AMap.Scale —— ToolBar 没用到,多拉一次还会触发 "Unimplemented type 3" 告警
          plugins: ["AMap.Scale"],
        });
        if (destroyed || !containerRef.current) return;

        // 用 any 避免引入高德完整类型
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const A = AMap as any;
        const _map = new A.Map(containerRef.current, {
          zoom: 16,
          center: [lng, lat],
          viewMode: "2D",
          // 强制开启 4 类图层 —— 默认下有些设备/样式会丢失 road / point 导致"没有街道文字/门牌"
          features: ["bg", "road", "building", "point"],
          mapStyle: "amap://styles/normal",
          resizeEnable: true,
          dragEnable: true,
          zoomEnable: true,
          doubleClickZoom: true,
          scrollWheel: false,
        });

        // 餐厅 marker
        new A.Marker({
          position: [lng, lat],
          title,
          map: _map,
          anchor: "bottom-center",
        });

        // 用户位置 marker + 连线 (origin 拍平后用 primitive 判空)
        if (originLng !== null && originLat !== null) {
          new A.Marker({
            position: [originLng, originLat],
            title: "我的位置",
            map: _map,
            content:
              '<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.3)"></div>',
            offset: new A.Pixel(-8, -8),
          });

          // 视野同时框住起终点
          _map.setFitView(undefined, false, [40, 40, 40, 40], 17);
        }

        _map.addControl(new A.Scale());
        /* eslint-enable @typescript-eslint/no-explicit-any */

        map = _map;
        // 等第一次 complete 事件再放行 ready —— 真正的 tile 画完才算成功,
        // 否则 3s 超时触发后还是会翻去静态图
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (_map as any).on?.("complete", () => {
          if (destroyed) return;
          clearTimeout(readyTimer);
          setReady(true);
        });
        /* eslint-enable @typescript-eslint/no-explicit-any */
      } catch (err) {
        console.error("[AmapView] load failed:", err);
        clearTimeout(readyTimer);
        const cls = classifyAmapError(err);
        setReason(cls);
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(`[AmapView] 分类结果: ${cls} —— ${REASON_HINT[cls]}`);
        }
        setError(true);
      }
    }

    init();

    return () => {
      destroyed = true;
      clearTimeout(readyTimer);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any)?.destroy?.();
      } catch {}
    };
  }, [jsKey, lng, lat, title, originLng, originLat, securityCode]);

  // 降级：没有 JS Key 时用高德静态图(仍然是真实地图)
  if (error || !jsKey) {
    // 注意: 高德的 restapi.amap.com/v3/staticmap 用的是 Web 服务端 Key,
    // 不是 JS API Key; 但实际经验里很多用户的"JSAPI Key"开通了 Web 服务权限,也能过。
    // 如果两把 Key 分开管理,静态图 URL 用 AMAP_API_KEY 更稳 —— 但那是 server-only,
    // 前端拿不到。这里继续沿用 JSAPI Key,失败时 onError 会抛到 no-image 分支。
    const staticKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
    const staticUrl = staticKey
      ? `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=16&size=600*300&markers=mid,,A:${lng},${lat}&key=${staticKey}`
      : "";
    const isDev = process.env.NODE_ENV !== "production";
    return (
      <button
        onClick={onTapThrough}
        className="w-full h-40 rounded-xl overflow-hidden relative bg-gray-100 flex items-center justify-center group"
      >
        {staticUrl ? (
          <img
            src={staticUrl}
            alt={title}
            className="w-full h-full object-cover"
            onError={() => setError(true)}
          />
        ) : (
          <div className="text-center">
            <MapPin className="w-8 h-8 text-muted mx-auto mb-1" />
            <p className="text-xs text-muted">点击查看高德地图</p>
          </div>
        )}
        {/* dev 模式下把失败分类亮出来,方便线上排查;prod 用户看不到这个 badge */}
        {isDev && reason !== "unknown" && (
          <div className="absolute top-2 left-2 bg-amber-500/95 text-white rounded-md px-2 py-0.5 text-[10px] font-medium shadow">
            {REASON_HINT[reason]}
          </div>
        )}
        <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-secondary shadow">
          打开高德
        </div>
      </button>
    );
  }

  // 给正常态也准备一张静态图 URL —— JSAPI 加载期间盖在容器上当占位,
  // 避免"灰底 + 转圈"。JSAPI ready 之后 <img> 会被条件渲染摘掉,交互 canvas 暴露。
  // 这样即使 JSAPI 要 5-8s 才 ready,用户从 t=0 就看到一张真地图,感知上"不慢也不灰"
  const loadingStaticKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || "";
  const loadingStaticUrl = loadingStaticKey
    ? `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=16&size=600*300&markers=mid,,A:${lng},${lat}&key=${loadingStaticKey}`
    : "";

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="w-full h-40 rounded-xl overflow-hidden bg-gray-100"
      />
      {/* 占位: JSAPI 没 ready 之前,用静态图填满容器 (绝对定位盖在 containerRef 之上)。
          ready 翻 true 后 <img> 立即 unmount,暴露下面 JSAPI 画的 canvas */}
      {!ready && loadingStaticUrl && (
        <img
          src={loadingStaticUrl}
          alt={title}
          className="absolute inset-0 w-full h-40 object-cover rounded-xl pointer-events-none"
          // 静态图本身也可能失败 (JSAPI Key 没开 Web 服务权限等),失败时悄悄隐藏
          // 不要 setError(true),否则会打断 JSAPI 初始化
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {!ready && (
        <div className="absolute top-2 left-2 bg-white/85 backdrop-blur-sm rounded-full px-2 py-0.5 text-[10px] text-muted flex items-center gap-1 shadow-sm pointer-events-none">
          <div className="w-2 h-2 border border-deep-red border-t-transparent rounded-full animate-spin" />
          加载交互地图
        </div>
      )}
      <button
        onClick={onTapThrough}
        className="absolute bottom-2 right-2 bg-white/95 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-secondary shadow font-medium active:scale-95 transition-transform"
      >
        打开高德导航
      </button>
    </div>
  );
}
