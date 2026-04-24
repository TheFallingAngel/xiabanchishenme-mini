"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Footprints,
  Wallet,
  ChefHat,
  Heart,
  MessageCircle,
  Navigation,
  Phone,
  Images,
  PencilLine,
  X,
  Utensils,
  ThumbsDown,
  Check,
  Camera,
  Loader2,
  Plus,
} from "lucide-react";
import type { Restaurant, ReviewRecord, DishPhotoRecord } from "@/lib/types";
import type { PhotoTag } from "@/lib/image-tag";
import { classifyTags, splitLocalCache } from "@/lib/image-tag-client";
import { MOCK_RESTAURANTS } from "@/lib/mock-data";
import {
  loadPrefs,
  savePrefs,
  toggleFavorite,
  markAteToday,
  markNotInterested,
  updateNickname,
  addMyReviewId,
} from "@/lib/storage";
import { calculateMatchScore, scoreLabel } from "@/lib/match-score";
import {
  getRestaurantImage,
  getInteriorPhotos,
} from "@/lib/images";
// 注: 不再使用 MOCK_DISHES 占位; 招牌必点只根据真实 POI 数据 (photos.title + biz_ext.recommend) 渲染。
import { Lightbox } from "@/components/shared/Lightbox";
import { AmapView } from "@/components/shared/AmapView";
import { InsightCard } from "@/components/restaurant/InsightCard";
import { DishImageCarousel } from "@/components/restaurant/DishImageCarousel";
import { ReviewList } from "@/components/restaurant/ReviewList";
import { ReviewForm } from "@/components/restaurant/ReviewForm";
import { buildUserContextSignals } from "@/lib/reason-context";
import { inferHealthTags } from "@/lib/health-tags";
import { fetchReviews, uploadReviewImage } from "@/lib/reviews";
import {
  fetchDishPhotos,
  submitDishPhoto,
  groupDishPhotosByName,
} from "@/lib/dish-photos";

// 过滤掉这些 photo.title —— 它们不是菜名,是店面/环境照片
const NON_DISH_TITLE_WORDS = [
  "门店",
  "店内",
  "店外",
  "门面",
  "店面",
  "环境",
  "外景",
  "外观",
  "招牌",
  "logo",
  "LOGO",
  "大堂",
  "前台",
  "包间",
];

function looksLikeDishName(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // 太短或太长都不像菜名
  if (t.length < 2 || t.length > 12) return false;
  // 命中环境词 → 丢
  if (NON_DISH_TITLE_WORDS.some((w) => t.includes(w))) return false;
  // 纯数字 / 纯英文短码也不要
  if (/^[\d\s\-]+$/.test(t)) return false;
  // 含分隔符 (逗号/顿号/分号/斜杠) → 这是"菜名列表",不是单道菜名
  // 避免高德把 "蛋挞,叉烧" 这种短 merged 串 (长度 ≤12) 被误判成单个菜名
  // 塞进结果里,界面上就看到一张大卡片合并了好几道菜
  if (/[,，、;；/]/.test(t)) return false;
  return true;
}

interface PoiDish {
  name: string;
  photo?: string;
}

/** 按中英文常见分隔拆 token,去空 —— 供 recommend / tags 两路公用 */
function splitTokens(s: string): string[] {
  return s.split(/[,，、;；\n\r\/\s]+/).map((x) => x.trim()).filter(Boolean);
}

/** 这组 token 看起来像不像 "菜名列表" —— 数量 ≥2 且每个都短且长度合理 */
function isDishListTokens(tokens: string[]): boolean {
  if (tokens.length < 2) return false;
  return tokens.every((t) => t.length >= 2 && t.length <= 12);
}

/**
 * 拿菜名去 extra.photos[].title 里做子串匹配,找一张真实菜品照。
 * 高德 POI 的 photos[].title 有时是 "红烧肉(招牌)" 这种带后缀的格式,
 * 所以双向 includes 都试,命中就返回 url。
 * used 集合用来跨菜名去重 —— 一张图只挂给第一个命中它的菜,避免 6 张图都长一个样。
 */
function findPhotoByDishName(
  name: string,
  photos: { url: string; title?: string }[] | undefined,
  used: Set<string>
): string | undefined {
  if (!photos || !name) return undefined;
  const q = name.trim();
  if (q.length < 2) return undefined;
  for (const p of photos) {
    if (used.has(p.url)) continue;
    const t = typeof p.title === "string" ? p.title.trim() : "";
    if (!t) continue;
    if (t.includes(q) || q.includes(t)) {
      used.add(p.url);
      return p.url;
    }
  }
  return undefined;
}

/**
 * 只用真实 POI 数据拼招牌菜:
 * - extra.photos[].title 里看起来像菜名的
 * - extra.recommend 如果是逗号/顿号分隔的短 token,按菜名列表解析
 * - extra.tags 里单独出现的短词 / 内部用分隔符分开的短菜名列表也补进来
 *   (高德 tags 常见形态: ["红烧肉","糖醋里脊","本帮菜"] 或 ["招牌菜:红烧肉,糖醋里脊"])
 * 拼不出任何菜名时返回空数组,上层据此隐藏整块。
 */
function extractDishesFromPoi(extra: PoiExtra | null): PoiDish[] {
  if (!extra) return [];
  const out: PoiDish[] = [];
  const seen = new Set<string>();
  // 跨 3 条数据源共享: 一张 POI 照片只挂给第一个命中它的菜名,避免 6 张图长一个样
  const usedPhotoUrls = new Set<string>();

  // 1. 从 POI 照片 title 挖菜名 —— 天然自带照片
  // 高德偶尔返回非 string 的 title (空数组 [] / 对象),直接 .trim 会炸 —— 强制转 string 再处理
  for (const p of extra.photos || []) {
    const rawTitle = typeof p?.title === "string" ? p.title : "";
    const t = rawTitle.trim();
    if (!looksLikeDishName(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    usedPhotoUrls.add(p.url);
    out.push({ name: t, photo: p.url });
  }

  // 2. 如果 recommend 是 "水煮鱼,麻婆豆腐,回锅肉" 这种短 token 列表,解析成菜名
  //    — 挖出来后再顺手用菜名去 photos[].title 模糊匹配一张真实菜品照
  if (extra.recommend) {
    const tokens = splitTokens(extra.recommend);
    if (isDishListTokens(tokens)) {
      for (const t of tokens) {
        if (seen.has(t)) continue;
        if (!looksLikeDishName(t)) continue;
        seen.add(t);
        const photo = findPhotoByDishName(t, extra.photos, usedPhotoUrls);
        out.push({ name: t, photo });
      }
    }
  }

  // 3. 从 extra.tags 再挖一遍 —— 同样用菜名匹配补照片
  // 单 tag 就是菜名 (最常见) 直接收;单 tag 里再带分隔符 (像 "招牌:红烧肉,糖醋里脊") 再 split 一层
  if (Array.isArray(extra.tags)) {
    for (const raw of extra.tags) {
      const r = typeof raw === "string" ? raw.trim() : "";
      if (!r) continue;
      if (looksLikeDishName(r) && !seen.has(r)) {
        seen.add(r);
        const photo = findPhotoByDishName(r, extra.photos, usedPhotoUrls);
        out.push({ name: r, photo });
        continue;
      }
      const tokens = splitTokens(r);
      if (isDishListTokens(tokens)) {
        for (const t of tokens) {
          if (seen.has(t)) continue;
          if (!looksLikeDishName(t)) continue;
          seen.add(t);
          const photo = findPhotoByDishName(t, extra.photos, usedPhotoUrls);
          out.push({ name: t, photo });
        }
      }
    }
  }

  return out.slice(0, 6);
}

/** recommend 字段是否是散文/介绍,而不是被 extractDishesFromPoi 当成菜名列表吃掉了 */
function recommendIsProse(extra: PoiExtra | null): boolean {
  if (!extra?.recommend) return false;
  const tokens = splitTokens(extra.recommend);
  return !isDishListTokens(tokens);
}

// 来自高德 POI 的额外详情
interface PoiExtra {
  photos: { url: string; title?: string }[];
  openTime: string;
  tel: string;
  tags?: string[];
  alias?: string;
  recommend?: string;
}

export default function RestaurantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [extra, setExtra] = useState<PoiExtra | null>(null);
  const [userLoc, setUserLoc] = useState<{ lng: number; lat: number } | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: { url: string; title?: string }[];
    index: number;
  } | null>(null);

  // 详情页 "为什么是这家" LLM 段落
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  // 从卡片带来的短 reason,作为 LLM 失败时的降级文案
  const [cardReason, setCardReason] = useState<string | undefined>(undefined);

  // 评价系统 —— 用户上传 + Vercel KV 沉淀
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [nickname, setNickname] = useState<string | undefined>(undefined);
  const [myReviewIds, setMyReviewIds] = useState<string[]>([]);

  // 招牌菜 UGC 照片 —— 用户给某道菜上传自己的照片,跨用户共享
  // 拿到 list 后按 dishName 聚合,渲染时把 UGC 和 POI 原图合并进轮播
  const [dishPhotos, setDishPhotos] = useState<DishPhotoRecord[]>([]);
  // 新版交互:从标题栏点「我来补一道」打开,用户自己填菜名 (可以是 POI 已有的也可以是全新的)
  // 不再挂在每张图右上角的相机按钮 —— 语义从"替换第 i 张图"变成"加一张菜品照片"
  const [dishUploadOpen, setDishUploadOpen] = useState(false);
  const [newDishNameInput, setNewDishNameInput] = useState("");
  const [dishUploading, setDishUploading] = useState(false);
  const [dishUploadError, setDishUploadError] = useState<string | null>(null);

  // Hero 是否还在视口内 —— 离开后 sticky mini header 出现,让长页也能一键返回
  // 首屏是 true (Hero 可见),IntersectionObserver 监控到 Hero 滚出后置为 false
  const [heroInView, setHeroInView] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);

  // "吃过了" 金额抽屉 —— 输入实际花费,写入 history,让预算条闭环
  const [ateDrawerOpen, setAteDrawerOpen] = useState(false);
  const [ateAmountStr, setAteAmountStr] = useState("");
  // 轻提示,用于"吃过了"/"不想吃" 的反馈
  const [toast, setToast] = useState<string | null>(null);

  // 天气描述给 insight 调用,失败就空
  const [weatherNote, setWeatherNote] = useState<string>("");

  // 图片 AI 打标结果 —— url → PhotoTag,影响 hero / 店内实景 / 招牌菜三处选图
  // 未命中 / VL 失败时是空对象,走原有 photos[0]/photos[1+] 兜底逻辑
  const [photoTags, setPhotoTags] = useState<Record<string, PhotoTag>>({});

  useEffect(() => {
    const id = params.id as string;
    let cancelled = false;

    // 进来先把收藏状态拿出来,三级降级哪一级命中都用得上
    const prefs = loadPrefs();
    setIsFavorite(prefs.favorites.includes(id));

    // 第一级: sessionStorage —— 从首页卡片点进来时带过来的完整数据 (含 walkMinutes / reason)
    const stored = sessionStorage.getItem("selected_restaurant");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.id === id) {
          setRestaurant(parsed as Restaurant);
          if (parsed.reason) setCardReason(parsed.reason as string);
          return;
        }
      } catch {}
    }

    // 第二级: MOCK (演示数据场景)
    const found = MOCK_RESTAURANTS.find((r) => r.id === id);
    if (found) {
      setRestaurant(found);
      return;
    }

    // 第三级: 网络兜底 —— 从收藏 / 足迹进来时只有 id,走 /api/restaurant/[id] (高德 POI 详情)
    // 这解决"发版后点收藏/足迹 → 未找到餐厅":sessionStorage 在刷新后空、MOCK 又没这家店
    (async () => {
      try {
        const res = await fetch(`/api/restaurant/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const d = data?.detail;
        if (!d) {
          setNotFound(true);
          return;
        }
        // 从当前定位估算直线距离和步行分钟 (跟 amap.ts fillWalkingTimes 的降级算法一致)
        // 有 currentLocation 时按经纬度差做欧氏近似 × 111km/度 ÷ 80m/min
        // 没定位就写 0,UI 会显式显示 "0m / 步行约 0 分钟" —— 聊胜于无,用户看到会点
        // "打开高德导航"看真实路径
        const poiLng = d.location?.lng ?? 0;
        const poiLat = d.location?.lat ?? 0;
        let distanceMeters = 0;
        let walkMinutes = 0;
        if (prefs.currentLocation && poiLng && poiLat) {
          const { lng: uLng, lat: uLat } = prefs.currentLocation;
          const rawMeters = Math.sqrt((uLng - poiLng) ** 2 + (uLat - poiLat) ** 2) * 111000;
          distanceMeters = Math.round(rawMeters);
          walkMinutes = Math.max(1, Math.round(rawMeters / 80));
        }
        const restaurantFromPoi: Restaurant = {
          id: d.id,
          name: d.name,
          category: (d.type || "").split(";")[0] || "餐饮",
          address: d.address || "",
          avgPrice: Number(d.avgPrice) || 0,
          rating: Number(d.rating) || 0,
          walkMinutes,
          distanceMeters,
          tel: d.tel || undefined,
          photos: Array.isArray(d.photos)
            ? d.photos.map((p: { url: string }) => p.url).filter(Boolean)
            : [],
          location: { lng: poiLng, lat: poiLat },
        };
        setRestaurant(restaurantFromPoi);
      } catch (err) {
        if (cancelled) return;
        console.warn("[detail] 网络兜底拉 POI 详情失败:", err);
        setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // 拉 LLM 详情段落 — 在餐厅信息就位后异步发起,用骨架占位,不阻塞其余内容
  // deps 含 extra: extra 到位后 (含 tags/alias/recommend) 会重新发起一次,
  // 用带 highlight 的更好版本覆盖。LLM 路由里 cache key 含 highlightSig,所以不会互相命中。
  // deps 含 weatherNote: 天气晚到也会重新发起一次,让 LLM 补上"下雨凉"这种钩子。
  useEffect(() => {
    if (!restaurant) return;
    let cancelled = false;
    (async () => {
      setInsightLoading(true);
      try {
        const prefs = loadPrefs();
        const signals = buildUserContextSignals(prefs, restaurant.category, new Date(), {
          avgPrice: restaurant.avgPrice,
          walkMinutes: restaurant.walkMinutes,
          rating: restaurant.rating,
          name: restaurant.name,
          amapTags: extra?.tags,
          alias: extra?.alias,
          recommend: extra?.recommend,
        });
        const healthTags = inferHealthTags(restaurant.category);
        const res = await fetch("/api/llm/insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            restaurantName: restaurant.name,
            category: restaurant.category,
            avgPrice: restaurant.avgPrice,
            walkMinutes: restaurant.walkMinutes,
            rating: restaurant.rating,
            highlight: signals.highlight,
            weekday: signals.weekday,
            timeOfDay: signals.timeOfDay,
            daysSinceCategory: signals.daysSinceCategory,
            recentHistory: signals.recentHistory,
            tastePreferences: signals.tastePreferences,
            tasteHit: signals.tasteHit,
            priceTier: signals.priceTier,
            walkTier: signals.walkTier,
            ratingTier: signals.ratingTier,
            budgetRemaining: signals.budgetRemaining,
            budgetStatus: signals.budgetStatus,
            weather: weatherNote || undefined,
            healthTags: healthTags.length ? healthTags : undefined,
            // SSE 流式开关 —— 服务器剥 <think> 后一 token 一 token 推过来,
            // 首字可见 < 1s,观感"LLM 在写字",总时长不变但不再黑屏等整段
            stream: true,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentType = res.headers.get("Content-Type") || "";
        if (!contentType.includes("text/event-stream")) {
          // 降级分支:服务器返回 JSON (预热命中 / 老服务器) — 按老流程处理
          const data = await res.json();
          if (!cancelled && data.insight) setInsight(data.insight);
          return;
        }

        // —— SSE 分支 ——
        // 缓存未命中时,服务端会一行行推 { type:"chunk", text } ,最后一条 { type:"done", insight }
        // 缓存命中时只推一条 done。
        //
        // 防御策略 (解决两类 bug):
        //   A. "CoT 泄露" — 模型没按契约走,裸输出思考过程 ("(很近) 3. 评分 4.4 4. 亮点..." / "考虑到用户...")
        //      → 累到一定字数后做一次启发式判断,像 CoT 的就标记,后续 chunk 不再显示、done 时 null 也不覆盖
        //   B. "好内容被吃掉" — 服务端 finalize 偶尔过严,把用户已经看到的正常段落判 null 回来,
        //      导致屏幕上的好内容瞬间变回降级话术
        //      → done 带 null 时,只有在 preview 本身就像 CoT / 太短 / 空的情况下才清空;
        //         否则保留当前 preview,不让好东西被回收
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let streamAccum = "";
        let streamLooksBad = false; // CoT 泄露嫌疑标记,一旦 set 后续就不再 setInsight
        const PREVIEW_CAP = 140;

        // 启发式识别 CoT 泄露 —— 命中任意一条就判脏:
        //   · 列表编号: 开头像 "1. xx" / "2、" / "(1)" / "·" / "-"
        //   · 大纲标签: "亮点:" / "步骤:" / "分析:" / "考虑:" 等冒号领起的分段词
        //   · 元话术:    "用户" "考虑到" "根据" "因此" "综上" "首先" 等写给自己看的连接词
        //   · 数据堆砌:  连续出现 "评分 x.x" / "¥xx" / "xx分钟" 中的两个以上原始信号
        function looksLikeCoT(s: string): boolean {
          if (!s) return false;
          if (/(?:^|[\s\n])\(?[1-9]\)?[\.、)]\s*\S/.test(s)) return true;
          if (/[【\[]?(?:亮点|步骤|分析|考虑|要点|理由|信号|总结|综上)[】\]]?[:：]/.test(s)) return true;
          if (/(?:考虑到|用户(?:偏好|标签|信号|最近|喜欢|爱吃)|根据(?:以上|用户|历史)|因此|综上|首先[,，]|其次[,，])/.test(s)) return true;
          // 数据原样堆列 (两个及以上信号并列) —— 例如 "人均35 步行8分钟 评分4.4"
          let sig = 0;
          if (/评分\s*\d/.test(s)) sig++;
          if (/¥\s*\d|人均\s*\d/.test(s)) sig++;
          if (/\d+\s*分钟|步行\s*\d/.test(s)) sig++;
          if (sig >= 2) return true;
          return false;
        }

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          try {
            const evt = JSON.parse(payload) as
              | { type: "chunk"; text: string }
              | { type: "done"; insight: string | null; cached?: boolean };
            if (cancelled) return;
            if (evt.type === "chunk" && typeof evt.text === "string") {
              // 带 tag 字符的 chunk 直接丢 —— 服务端理论上剥干净了,但 max_tokens 撞到时
              // <think> 没闭合会有残片漏过来
              if (/[<>]/.test(evt.text)) return;
              if ([...streamAccum].length >= PREVIEW_CAP) return;
              streamAccum += evt.text;
              const preview = streamAccum.replace(/\r?\n+/g, " ").trim();
              // 前 18 字还没攒够,暂不做 CoT 检查 —— 太短容易误杀
              // 攒够之后只检查一次 (第一次命中后 streamLooksBad 锁死),
              // 命中就冻结 preview,前端卡片回到"升级中 + fallback"状态
              if (!streamLooksBad && [...preview].length >= 18 && looksLikeCoT(preview)) {
                streamLooksBad = true;
                setInsight(null); // 把已经露出来的 CoT 片段擦掉,让 fallback 接管
                return;
              }
              if (streamLooksBad) return;
              if (preview) setInsight(preview);
            } else if (evt.type === "done") {
              if (evt.insight) {
                // 服务端过了 gate,用 finalize 后的版本覆盖 preview (更短/更干净)
                setInsight(evt.insight);
              } else {
                // 服务端 gate 拒了。
                // 如果 preview 自己就像 CoT 或太短/为空 → 清空走 fallback
                // 否则保留 preview —— 不能把用户已经看到的正常段落吞回去
                const shown = streamAccum.replace(/\r?\n+/g, " ").trim();
                if (streamLooksBad || !shown || [...shown].length < 20 || looksLikeCoT(shown)) {
                  setInsight(null);
                  streamAccum = "";
                }
                // else: 什么都不做,让用户看到的 preview 继续挂在那儿
              }
            }
          } catch {
            // 忽略单行 parse 失败
          }
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          let nlIdx: number;
          while ((nlIdx = sseBuffer.indexOf("\n")) >= 0) {
            const line = sseBuffer.slice(0, nlIdx);
            sseBuffer = sseBuffer.slice(nlIdx + 1);
            processLine(line);
          }
        }
        if (sseBuffer.trim()) processLine(sseBuffer);
      } catch {
        if (!cancelled) setInsight((prev) => prev ?? null);
      } finally {
        if (!cancelled) setInsightLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.id, extra, weatherNote]);

  // 天气拉取 —— 用餐厅所在地 (更准,detail 页可能和用户当前位置隔几公里)
  // 失败保持空字符串,不阻塞 insight。拿到值会触发上面 insight effect 重新跑。
  useEffect(() => {
    if (!restaurant?.location) return;
    const { lng, lat } = restaurant.location;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/weather?lng=${lng}&lat=${lat}`);
        if (!res.ok) return;
        const data = await res.json();
        const note: string = data?.weather?.note || "";
        if (!cancelled && note) setWeatherNote(note);
      } catch {
        // 忽略,保留空
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.location?.lng, restaurant?.location?.lat]);

  // 拉取 POI 详情(图片/营业时间/电话等),只在确认餐厅后发起
  useEffect(() => {
    if (!restaurant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/restaurant/${restaurant.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.detail) {
          const d = data.detail;
          setExtra({
            photos: Array.isArray(d.photos) ? d.photos : [],
            openTime: d.openTime || "",
            tel: d.tel || "",
            tags: d.tags || [],
            alias: d.alias,
            recommend: d.recommend,
          });
        }
      } catch {
        // 忽略,保留占位
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.id]);

  // 图片 AI 打标 —— 详情页首屏不阻塞,POI 详情到齐后再异步打标,结果回来时
  // hero / 店内实景 / 招牌菜 会重新挑图。
  // 两级缓存走 classifyTags:
  //   - 先把本地 L1/L2 命中的部分立即 setState (重进同一家店零延迟)
  //   - miss 的送 POST 走服务端 KV → VLM,拿到再 merge
  useEffect(() => {
    if (!restaurant) return;
    // 合并餐厅列表里自带的 photos 和详情返回的 extra.photos,去重后一起送打标
    const urlSet = new Set<string>();
    for (const u of restaurant.photos || []) urlSet.add(u);
    for (const p of extra?.photos || []) if (p?.url) urlSet.add(p.url);
    const urls = Array.from(urlSet);
    if (urls.length === 0) return;

    // 先拿本地命中的那部分,立刻喂给 state —— 用户看到的 hero / 店内实景会立即重排
    const { hit } = splitLocalCache(urls);
    if (Object.keys(hit).length > 0) {
      setPhotoTags((prev) => ({ ...prev, ...hit }));
    }

    let cancelled = false;
    (async () => {
      // miss 部分走服务端 (KV 命中 < 100ms; VLM 打标 ~3-8s)。
      // classifyTags 里有 in-flight dedup,多 useEffect 同一会话并发也只打一次。
      const tags = await classifyTags(urls);
      if (!cancelled && Object.keys(tags).length > 0) {
        setPhotoTags((prev) => ({ ...prev, ...tags }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // extra 到位后重跑一次: 把 extra.photos 也补进去打标
  }, [restaurant?.id, extra?.photos?.length]);

  // Hero 可见性观察 —— 离开视口后显示 sticky mini header,解决长页用户"滚到底没法返回"的问题
  // rootMargin: -56px 让 mini header 提前一个 header 高度出现,视觉不突兀
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setHeroInView(entry.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [restaurant?.id]);

  // 用户位置(给地图画起终点)+ 昵称 / 本地评价 id 一次性加载
  useEffect(() => {
    try {
      const prefs = loadPrefs();
      if (prefs.currentLocation) {
        setUserLoc({
          lng: prefs.currentLocation.lng,
          lat: prefs.currentLocation.lat,
        });
      }
      setNickname(prefs.nickname);
      setMyReviewIds(prefs.myReviewIds || []);
    } catch {}
  }, []);

  // 拉评价列表 —— 每次切餐厅重新拉,不加前端缓存 (KV 端响应已足够快)
  useEffect(() => {
    if (!restaurant?.id) return;
    let cancelled = false;
    (async () => {
      setReviewsLoading(true);
      const list = await fetchReviews(restaurant.id);
      if (!cancelled) {
        setReviews(list);
        setReviewsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.id]);

  // 拉招牌菜 UGC 照片 —— 和评价并行,失败静默 (没开 KV 时返回空,继续走 POI 原图)
  useEffect(() => {
    if (!restaurant?.id) return;
    let cancelled = false;
    (async () => {
      const list = await fetchDishPhotos(restaurant.id);
      if (!cancelled) setDishPhotos(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.id]);

  // 菜名 → 用户上传的 URL 列表 (最新在前); 渲染时取 [0] 顶替原图
  const ugcPhotosByDish = useMemo(
    () => groupDishPhotosByName(dishPhotos),
    [dishPhotos]
  );

  // 只拿真菜名; 没有就是空数组,由 JSX 判空隐藏整块
  const poiDishes = useMemo<PoiDish[]>(() => extractDishesFromPoi(extra), [extra]);
  const showRecommendProse = useMemo(() => recommendIsProse(extra), [extra]);

  // 合并 POI 菜 + UGC 独家菜 (用户补了一道 POI 里没有的菜 —— 那也得显示)
  // 原始次序: POI 菜在前 (有官方照片打底),UGC-only 菜在后 (靠用户照片撑场子)
  //
  // 原 #79 策略是"没照片的菜整条丢掉",但这样会把高德识别出的菜名也屏蔽,
  // 用户连个上传入口都看不到。现调整为"保留所有菜,无图的排到末尾 + 占位图可点击补图";
  // 稳定排序 (不是 Array.sort,避开 V8 非 stable 行为) —— 依次过 merged,
  // 有图的丢 withPhoto,没图的丢 withoutPhoto,最后拼起来。
  const allDishes = useMemo(() => {
    const seen = new Set(poiDishes.map((d) => d.name));
    const extras: PoiDish[] = [];
    for (const name of ugcPhotosByDish.keys()) {
      if (!seen.has(name)) {
        extras.push({ name });
        seen.add(name);
      }
    }
    const merged = [...poiDishes, ...extras];
    const withPhoto: PoiDish[] = [];
    const withoutPhoto: PoiDish[] = [];
    for (const d of merged) {
      const hasUgc = (ugcPhotosByDish.get(d.name)?.length || 0) > 0;
      const hasPoi = !!d.photo;
      (hasUgc || hasPoi ? withPhoto : withoutPhoto).push(d);
    }
    return [...withPhoto, ...withoutPhoto];
  }, [poiDishes, ugcPhotosByDish]);

  // 首图 + POI 返回的照片合并去重
  // hero 按 tag 优先级 (storefront>interior>...) 挑选,gallery 把首图排第一,其余 POI 图追加
  const galleryImages = useMemo(() => {
    if (!restaurant) return [];
    const list: { url: string; title?: string }[] = [];
    const heroUrl = getRestaurantImage(
      restaurant.photos,
      restaurant.category,
      "hero",
      photoTags
    );
    list.push({ url: heroUrl, title: restaurant.name });
    if (extra?.photos?.length) {
      for (const p of extra.photos) {
        if (!list.some((x) => x.url === p.url)) list.push(p);
      }
    }
    return list;
  }, [restaurant, extra, photoTags]);

  // "店内实景" 网格只挑 storefront / interior 标签 (AI 识别后去掉纯菜品/菜单)
  const interiorGallery = useMemo(() => {
    const rawPhotos = (extra?.photos || []).map((p) => p.url);
    const picked = getInteriorPhotos(rawPhotos, photoTags);
    // 保留 title 信息,方便 Lightbox 展示
    return picked
      .map((url) => extra?.photos?.find((p) => p.url === url))
      .filter((p): p is { url: string; title?: string } => !!p);
  }, [extra?.photos, photoTags]);

  if (notFound) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center px-4">
          <p className="text-lg font-semibold text-secondary mb-2">未找到餐厅</p>
          <p className="text-sm text-muted mb-4">该餐厅信息不存在或已过期</p>
          <button
            onClick={() => router.push("/")}
            className="bg-gradient-to-r from-deep-red to-deep-red-dark text-white px-6 py-2.5 rounded-xl text-sm font-medium shadow-card active:scale-95 transition-transform"
          >
            返回首页
          </button>
        </div>
      </main>
    );
  }

  if (!restaurant) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-deep-red border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted">加载中...</p>
        </div>
      </main>
    );
  }

  const prefs = loadPrefs();
  const matchResult = calculateMatchScore(restaurant, prefs);
  // hero 图按 AI 打标优先级挑 (storefront > interior > ...),没打标时落回 photos[0]
  const heroImg = getRestaurantImage(
    restaurant.photos,
    restaurant.category,
    "hero",
    photoTags
  );
  const tel = extra?.tel || restaurant.tel;
  const openTime = extra?.openTime;
  // 店内实景网格用 interiorGallery (已经按 tag 过滤),未打标时会回退到全部 POI 图
  const extraPhotos = interiorGallery;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // "就它了" —— 仅记录一条 history(不含金额, 占位, 金额等"吃过了"那步再补)
  // 然后直接打开外部导航,默认不算已花
  function handleChoose() {
    const p = loadPrefs();
    // 用当前 heroImg(getRestaurantImage 已经在上面算过)保存,
    // 足迹 / 收藏列表从此就有真实头图,不再全走 category 占位。
    const next = markAteToday(
      p,
      restaurant!.id,
      restaurant!.name,
      restaurant!.category,
      undefined,
      heroImg
    );
    savePrefs(next);
    openNavigation(restaurant!);
  }

  // "吃过了" —— 打开金额抽屉,默认填人均,确认后 history 带 amount 写入
  function openAteDrawer() {
    const suggested = restaurant?.avgPrice ? String(restaurant.avgPrice) : "";
    setAteAmountStr(suggested);
    setAteDrawerOpen(true);
  }

  function handleConfirmAte() {
    if (!restaurant) return;
    const raw = ateAmountStr.trim();
    const n = raw === "" ? undefined : Number(raw);
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 9999)) {
      showToast("请输入 0 - 9999 的金额");
      return;
    }
    const p = loadPrefs();
    const next = markAteToday(
      p,
      restaurant.id,
      restaurant.name,
      restaurant.category,
      n,
      heroImg
    );
    savePrefs(next);
    setAteDrawerOpen(false);
    showToast(n !== undefined ? `已记一笔 ¥${n}` : "已记一次到访");
  }

  // "不想吃" —— 写 7 天屏蔽,回首页,让推荐列表跳过
  // 带上名字/分类/头图,让"我的"页面的可管理列表有数据可渲染
  function handleNotInterested() {
    if (!restaurant) return;
    const p = loadPrefs();
    const next = markNotInterested(
      p,
      restaurant.id,
      restaurant.name,
      restaurant.category,
      heroImg
    );
    savePrefs(next);
    showToast("7 天内不再推荐这家");
    setTimeout(() => router.back(), 700);
  }

  function openNavigation(r: Restaurant) {
    const { lat, lng } = r.location;
    const name = encodeURIComponent(r.name);

    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);

    if (isIOS) {
      const amapUrl = `iosamap://path?sourceApplication=xiaban&dname=${name}&dlat=${lat}&dlon=${lng}&dev=0&t=2`;
      const appleMapsUrl = `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w&q=${name}`;

      const start = Date.now();
      window.location.href = amapUrl;
      setTimeout(() => {
        if (Date.now() - start < 1500) {
          window.location.href = appleMapsUrl;
        }
      }, 500);
    } else {
      const webNavUrl = `https://uri.amap.com/navigation?to=${lng},${lat},${name}&mode=walk&coordinate=gaode`;
      window.open(webNavUrl, "_blank");
    }
  }

  function handleToggleFavorite() {
    const p = loadPrefs();
    const next = toggleFavorite(
      p,
      restaurant!.id,
      restaurant!.name,
      restaurant!.category,
      heroImg
    );
    savePrefs(next);
    setIsFavorite(next.favorites.includes(restaurant!.id));
  }

  function handleNicknameSet(nick: string) {
    const p = loadPrefs();
    const next = updateNickname(p, nick);
    savePrefs(next);
    setNickname(next.nickname);
  }

  function handleReviewSubmitted(review: ReviewRecord) {
    // 新评价顶到最上面
    setReviews((prev) => [review, ...prev]);
    const p = loadPrefs();
    const next = addMyReviewId(p, review.id);
    savePrefs(next);
    setMyReviewIds(next.myReviewIds || []);
  }

  /**
   * 上传一张菜品 UGC 照片 —— 先过 /api/reviews/upload (共用图床),
   * 拿到 public URL 再 POST 给 /api/dish-photos,成功后把记录顶到 state 表头。
   *
   * 新交互:菜名是用户自己填的 (newDishNameInput),不再预设成某道 POI 菜。
   * 这样语义变成"给这家加一道菜品照片",既能给已有菜补图,也能加 POI 漏收录的新菜。
   *
   * 没有昵称时就用 "吃货小助手" 兜底 —— 菜品照不像评价那样强调署名,
   * 不弹昵称弹窗,避免打断用户上传动作。
   */
  async function handleDishPhotoUpload(file: File) {
    if (!restaurant?.id) return;
    const dishName = newDishNameInput.trim();
    // 基本校验:2-12 字 (和 looksLikeDishName 一致),中英数都算
    if (dishName.length < 2) {
      setDishUploadError("菜名至少 2 个字");
      return;
    }
    if (dishName.length > 12) {
      setDishUploadError("菜名最多 12 个字");
      return;
    }
    setDishUploading(true);
    setDishUploadError(null);
    try {
      const url = await uploadReviewImage(file);
      const record = await submitDishPhoto(restaurant.id, {
        nickname: (nickname || "吃货小助手").slice(0, 12),
        dishName,
        imageUrl: url,
      });
      setDishPhotos((prev) => [record, ...prev]);
      setDishUploadOpen(false);
      setNewDishNameInput("");
      showToast("已添加一张菜品照片");
    } catch (err) {
      setDishUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setDishUploading(false);
    }
  }

  function openLightbox(images: { url: string; title?: string }[], index: number) {
    if (!images.length) return;
    setLightbox({ images, index });
  }

  return (
    <main className="min-h-screen bg-cream animate-fade-in">
      {/* Sticky mini header — 只在 Hero 滚出视口后出现,长页也能一键返回
          · 左:返回 · 中:餐厅名 (单行截断) · 右:收藏
          · max-w 跟 H5 容器一致 (393px),居中;backdrop-blur 避免遮挡感太重 */}
      <div
        className={
          "fixed top-0 left-0 right-0 z-30 max-w-[393px] mx-auto bg-white/95 backdrop-blur-md border-b border-gray-100 transition-all duration-200 " +
          (heroInView
            ? "opacity-0 -translate-y-full pointer-events-none"
            : "opacity-100 translate-y-0")
        }
      >
        <div className="flex items-center gap-2 px-3 h-12">
          <button
            onClick={() => router.back()}
            aria-label="返回"
            className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-secondary truncate">
            {restaurant.name}
          </h2>
          <button
            onClick={handleToggleFavorite}
            aria-label={isFavorite ? "取消收藏" : "收藏"}
            className="w-9 h-9 rounded-full flex items-center justify-center active:bg-gray-100"
          >
            <Heart
              className={`w-5 h-5 ${isFavorite ? "fill-deep-red text-deep-red" : "text-muted"}`}
            />
          </button>
        </div>
      </div>

      {/* Hero Section — 点击首图看大图 */}
      <div ref={heroRef} className="relative">
        <button
          onClick={() => openLightbox(galleryImages, 0)}
          className="w-full h-56 bg-gray-100 block relative active:opacity-90"
        >
          <img src={heroImg} alt={restaurant.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          {galleryImages.length > 1 && (
            <div className="absolute bottom-4 right-4 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1">
              <Images className="w-3.5 h-3.5 text-white" />
              <span className="text-xs text-white font-medium">{galleryImages.length}</span>
            </div>
          )}
        </button>

        {/* 返回 */}
        <button
          onClick={() => router.back()}
          className="absolute top-12 left-4 w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-card"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        {/* 收藏 */}
        <button
          onClick={handleToggleFavorite}
          className="absolute top-12 right-4 w-9 h-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-card"
        >
          <Heart className={`w-5 h-5 ${isFavorite ? "fill-deep-red text-deep-red" : "text-muted"}`} />
        </button>
        {/* 名称 + 地址 */}
        <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
          <h1 className="text-2xl font-bold text-white mb-1">{restaurant.name}</h1>
          <p className="text-white/80 text-sm line-clamp-1">{restaurant.address}</p>
        </div>
      </div>

      <div className="px-4 -mt-3 relative z-10">
        {/* Info Card */}
        <div className="bg-white rounded-2xl p-4 shadow-card mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-gold text-gold" />
                <span className="font-bold text-secondary">{restaurant.rating || "暂无"}</span>
                <span className="text-xs text-muted">高德扫街榜</span>
              </div>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center gap-1 text-sm text-muted">
                <Wallet className="w-4 h-4" />
                <span>¥{restaurant.avgPrice || "—"}/人</span>
              </div>
            </div>
            <div className="bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-xs font-medium px-3 py-1 rounded-full">
              {matchResult.total}% {scoreLabel(matchResult.total)}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted flex-wrap">
            <div className="flex items-center gap-1">
              <Footprints className="w-4 h-4 text-deep-red" />
              <span className="text-deep-red font-medium">{restaurant.walkMinutes}分钟</span>
              <span>步行</span>
            </div>
            <div className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              <span>{restaurant.distanceMeters}m</span>
            </div>
            {openTime && (
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span className="truncate max-w-[10rem]">{openTime}</span>
              </div>
            )}
            {tel && (
              <a
                href={`tel:${tel}`}
                className="flex items-center gap-1 text-deep-red"
              >
                <Phone className="w-4 h-4" />
                <span>电话</span>
              </a>
            )}
          </div>

          {/* 高德返回的标签 */}
          {extra?.tags && extra.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {extra.tags.slice(0, 6).map((t, i) => (
                <span
                  key={i}
                  className="text-xs bg-cream text-secondary/80 px-2 py-0.5 rounded-full border border-gray-100"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* "为什么是这家" — LLM 个性化段落 */}
        <InsightCard
          loading={insightLoading}
          insight={insight}
          fallback={cardReason}
        />

        {/* Map — 高德 JS 交互地图 */}
        <div className="bg-white rounded-2xl p-4 shadow-card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Navigation className="w-5 h-5 text-deep-red" />
            <span className="font-medium text-secondary text-sm">位置</span>
            <span className="ml-auto text-xs text-muted">
              拖动 / 双指缩放，点按钮打开高德
            </span>
          </div>

          <AmapView
            lng={restaurant.location.lng}
            lat={restaurant.location.lat}
            title={restaurant.name}
            origin={userLoc}
            onTapThrough={() => openNavigation(restaurant)}
          />

          <p className="text-sm text-secondary mt-3">{restaurant.address}</p>
          <div className="flex items-center gap-2 mt-1 text-sm">
            <Clock className="w-4 h-4 text-deep-red" />
            <span className="text-secondary">步行约 {restaurant.walkMinutes} 分钟</span>
            <span className="text-muted">（高德估算，以实际为准）</span>
            <span className="text-muted">· {restaurant.distanceMeters}米</span>
          </div>
        </div>

        {/* 店内照片 —— 只有当高德返回多张照片时才显示 */}
        {extraPhotos.length > 1 && (
          <div className="bg-white rounded-2xl p-4 shadow-card mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Images className="w-5 h-5 text-deep-red" />
              <span className="font-medium text-secondary text-sm">店内实景</span>
              <span className="ml-auto text-xs text-muted">
                点击放大 · 高德 POI
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {extraPhotos.slice(0, 9).map((p, i) => (
                <button
                  key={i}
                  onClick={() =>
                    openLightbox(
                      extraPhotos,
                      i
                    )
                  }
                  className="aspect-square rounded-lg overflow-hidden bg-gray-100 active:opacity-80"
                >
                  <img
                    src={p.url}
                    alt={p.title || restaurant.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 招牌菜 / 店家简介 ——
            渲染条件:POI 有菜、或有散文简介、或用户补过 UGC-only 菜;
            三者皆空才整块隐藏。
            交互变化 (#74):
             · 入口从"每张图右上角相机"移到"卡片标题栏的『+ 我来补一道』"
             · 语义从"替换第 i 张图"改为"加一道菜",菜名自己填
             · 多图菜用 DishImageCarousel 左右滑,右上角 N/M 指示
        */}
        {(allDishes.length > 0 || showRecommendProse) && (
          <div className="bg-white rounded-2xl p-4 shadow-card mb-4">
            <div className="flex items-center gap-2 mb-1">
              <ChefHat className="w-5 h-5 text-deep-red" />
              <span className="font-medium text-secondary text-sm">
                {allDishes.length > 0 ? "招牌菜" : "店家简介"}
              </span>
              <span className="text-[10px] bg-gold-light text-gold px-2 py-0.5 rounded-full">
                高德 POI
              </span>
              {/* 标题栏右侧入口:主动,清晰,不再遮挡菜品图 */}
              <button
                type="button"
                onClick={() => {
                  setDishUploadError(null);
                  setNewDishNameInput("");
                  setDishUploadOpen(true);
                }}
                className="ml-auto flex items-center gap-1 text-[11px] text-deep-red border border-deep-red/40 rounded-full px-2 py-0.5 active:scale-95 transition-transform"
              >
                <Plus className="w-3 h-3" />
                我来补一道
              </button>
            </div>
            {allDishes.length > 0 && (
              <p className="text-[11px] text-muted mb-3 leading-relaxed">
                菜名多来自高德 POI + 食客补充,实际菜单/价格以餐厅为准
              </p>
            )}
            {showRecommendProse && extra?.recommend && (
              <p className="text-xs text-secondary bg-[#FFF8F0] rounded-lg px-3 py-2 mb-3 border border-orange-100/60 leading-relaxed">
                {extra.recommend}
              </p>
            )}
            {allDishes.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {allDishes.map((dish, i) => {
                  // 该道菜所有可用图: UGC 最新 → POI title 匹配。
                  // 无图菜走占位卡分支,不再按品类 stock 图硬塞 (避免"面包配面条"的错配)。
                  const ugc = ugcPhotosByDish.get(dish.name) || [];
                  const poiImg = dish.photo;
                  const images: string[] = [];
                  for (const u of ugc) if (!images.includes(u)) images.push(u);
                  if (poiImg && !images.includes(poiImg)) images.push(poiImg);

                  // Lightbox 打开后,沿用当前菜的所有图,index = 点中的那张
                  const lightboxImages = images.map((url) => ({
                    url,
                    title: dish.name,
                  }));

                  const badge =
                    ugc.length > 0
                      ? ugc.length > 1
                        ? `食客图 ${ugc.length}`
                        : "食客图"
                      : undefined;

                  return (
                    <div key={`${dish.name}-${i}`} className="w-full">
                      {images.length > 0 ? (
                        <DishImageCarousel
                          images={images}
                          badge={badge}
                          onImageClick={(idx) =>
                            openLightbox(lightboxImages, idx)
                          }
                        />
                      ) : (
                        // 无图菜占位: 中性 SVG (盘子 + 刀叉) + "轻点补图" CTA,
                        // 点击预填菜名,直接进上传流程 (handleDishPhotoUpload 复用)
                        <button
                          type="button"
                          onClick={() => {
                            setDishUploadError(null);
                            setNewDishNameInput(dish.name);
                            setDishUploadOpen(true);
                          }}
                          aria-label={`补一张 ${dish.name} 的照片`}
                          className="group w-full aspect-square rounded-xl overflow-hidden relative bg-cream border border-dashed border-orange-200 flex items-center justify-center active:scale-[0.98] transition-transform"
                        >
                          <svg
                            viewBox="0 0 64 64"
                            className="w-10 h-10 text-orange-300"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            {/* 盘子外圈 */}
                            <circle cx="32" cy="36" r="15" />
                            {/* 盘子内圈 (虚线) */}
                            <circle
                              cx="32"
                              cy="36"
                              r="9"
                              strokeDasharray="2 3"
                              opacity="0.5"
                            />
                            {/* 叉子 (左) */}
                            <path d="M14 14v9a3 3 0 0 0 3 3v21" />
                            <path d="M17 14v9M20 14v9" />
                            {/* 刀 (右) */}
                            <path d="M48 14c-3 2-4 6-4 10s2 6 4 6v17" />
                          </svg>
                          <span className="absolute bottom-1 right-1 bg-white/95 text-deep-red text-[10px] px-1.5 py-0.5 rounded-md shadow-sm font-medium pointer-events-none">
                            轻点补图
                          </span>
                        </button>
                      )}
                      <p className="text-xs font-medium text-secondary truncate mt-1.5 text-center">
                        {dish.name}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 食客评价 —— 产品自己沉淀的数据,存在 Vercel KV */}
        <div className="bg-white rounded-2xl p-4 shadow-card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-5 h-5 text-deep-red" />
            <span className="font-medium text-secondary text-sm">食客评价</span>
            {reviews.length > 0 && (
              <span className="text-[11px] text-muted">{reviews.length} 条</span>
            )}
            <span className="ml-auto text-[10px] bg-gold-light text-gold px-2 py-0.5 rounded-full">
              用户沉淀
            </span>
          </div>
          <p className="text-[11px] text-muted mb-3 leading-relaxed">
            这里只看同样用过这个 App 的人留下的评价,吃完也欢迎留两句。
          </p>
          <ReviewList
            reviews={reviews}
            loading={reviewsLoading}
            myReviewIds={myReviewIds}
          />
          <button
            type="button"
            onClick={() => setReviewFormOpen(true)}
            className="w-full mt-3 py-2.5 rounded-xl border border-dashed border-orange-300 text-deep-red text-sm font-medium flex items-center justify-center gap-1.5 active:bg-orange-50 transition-colors"
          >
            <PencilLine className="w-4 h-4" />
            {myReviewIds.length > 0 ? "再写一条" : "写一条评价"}
          </button>
        </div>

        {/* Spacer */}
        <div className="h-24" />
      </div>

      {/* Bottom CTA — 三段式:不想吃 / 吃过了 / 就它了
          - 不想吃: 7 天屏蔽,不再推荐
          - 吃过了: 弹金额抽屉,默认人均,写入 history 让预算条走起来
          - 就它了: 记一次到访并打开高德导航 (金额由返回后或"吃过了"再补) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-4 py-3 max-w-[393px] mx-auto">
        <div className="flex gap-2">
          <button
            onClick={handleNotInterested}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border border-gray-200 text-muted text-xs font-medium active:scale-95 transition-transform"
          >
            <ThumbsDown className="w-4 h-4" />
            <span>不想吃</span>
          </button>
          <button
            onClick={openAteDrawer}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border border-gold/60 bg-gold-light text-gold text-xs font-medium active:scale-95 transition-transform"
          >
            <Utensils className="w-4 h-4" />
            <span>吃过了</span>
          </button>
          <button
            onClick={handleChoose}
            className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-sm font-bold shadow-card active:scale-95 transition-transform"
          >
            <Navigation className="w-4 h-4" />
            就它了,导航过去
          </button>
        </div>
      </div>

      {/* "吃过了" 金额抽屉 —— z-[60] 与全站抽屉口径保持一致 (盖过 z-50 的 BottomNav) */}
      {ateDrawerOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setAteDrawerOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 max-w-[393px] mx-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-secondary">记一笔 · {restaurant.name}</h3>
              <button
                type="button"
                onClick={() => setAteDrawerOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-muted active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              填写这顿实际花了多少,用于更新今天 / 本月的预算条。留空也行,就算一次到访。
            </p>

            <div className="flex items-center gap-2 bg-cream rounded-xl px-3 py-3 mb-4">
              <span className="text-lg font-semibold text-deep-red">¥</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                autoFocus
                value={ateAmountStr}
                onChange={(e) => setAteAmountStr(e.target.value)}
                placeholder={restaurant.avgPrice ? `默认人均 ${restaurant.avgPrice}` : "0"}
                className="flex-1 bg-transparent outline-none text-lg font-semibold text-secondary placeholder:text-muted/60"
              />
              {restaurant.avgPrice && (
                <button
                  type="button"
                  onClick={() => setAteAmountStr(String(restaurant.avgPrice))}
                  className="text-[11px] text-deep-red px-2 py-1 rounded-full border border-deep-red/40 active:scale-95"
                >
                  取人均
                </button>
              )}
            </div>

            <div className="flex gap-2 mb-4">
              {[30, 50, 80, 120, 200].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAteAmountStr(String(v))}
                  className="flex-1 py-1.5 text-xs rounded-full border border-gray-200 text-secondary active:scale-95"
                >
                  {v}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleConfirmAte}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-sm font-bold active:scale-95"
            >
              <span className="inline-flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                确认
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-black/85 text-white text-xs px-4 py-2 rounded-full shadow-card z-50 animate-fade-in">
          {toast}
        </div>
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      <ReviewForm
        open={reviewFormOpen}
        restaurantId={restaurant.id}
        nickname={nickname}
        onClose={() => setReviewFormOpen(false)}
        onSubmitted={handleReviewSubmitted}
        onNicknameSet={handleNicknameSet}
      />

      {/*
        招牌菜 UGC 上传弹窗 (新版, #74)
        语义变化:"补一张照片" → "新增一道菜品"
        用户自己填菜名,能给已有 POI 菜补图,也能加 POI 漏收录的菜。

        流程:
         1. 用户输入菜名 (2-12 字,参考 looksLikeDishName 范围)
         2. 点"选图拍照",唤起相册/相机 (移动端 capture=environment 直接后置摄像头)
         3. 走 handleDishPhotoUpload: 上传图 → 提交记录 → toast 成功 → 关弹窗
      */}
      {dishUploadOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-4 animate-fade-in"
          onClick={() => {
            if (!dishUploading) {
              setDishUploadOpen(false);
              setDishUploadError(null);
              setNewDishNameInput("");
            }
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <ChefHat className="w-5 h-5 text-deep-red" />
              <h3 className="font-medium text-secondary">新增一道菜品照片</h3>
            </div>
            <p className="text-xs text-muted mb-4 leading-relaxed">
              填菜名 + 来张图,下一个想点这道菜的人就看得到真实卖相。菜名已有也可以再加,多图会自动聚到一起。
            </p>

            {/* 菜名输入 */}
            <div className="mb-3">
              <label className="block text-[11px] text-muted mb-1">菜名</label>
              <input
                type="text"
                value={newDishNameInput}
                onChange={(e) => {
                  setNewDishNameInput(e.target.value);
                  if (dishUploadError) setDishUploadError(null);
                }}
                maxLength={12}
                placeholder="例如:糖醋里脊"
                disabled={dishUploading}
                className="w-full bg-cream rounded-xl px-3 py-2.5 text-sm text-secondary outline-none focus:ring-2 focus:ring-deep-red/30 disabled:opacity-50"
              />
              <p className="text-[10px] text-muted mt-1">
                {[...newDishNameInput].length}/12 · 2-12 字
              </p>
            </div>

            {/* 上传区 —— 输入有效才激活 */}
            {(() => {
              const trimmed = newDishNameInput.trim();
              const valid = trimmed.length >= 2 && trimmed.length <= 12;
              return (
                <label
                  className={
                    "block w-full rounded-xl border-2 border-dashed py-7 text-center transition " +
                    (dishUploading
                      ? "border-muted text-muted pointer-events-none cursor-wait"
                      : valid
                        ? "border-orange-300 text-deep-red active:bg-orange-50 cursor-pointer"
                        : "border-gray-200 text-muted cursor-not-allowed")
                  }
                >
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={dishUploading || !valid}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleDishPhotoUpload(f);
                      // 清空 value —— 否则选同一张图不会再触发 change
                      e.target.value = "";
                    }}
                  />
                  {dishUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-sm">上传中...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Camera className="w-6 h-6" />
                      <span className="text-sm font-medium">
                        {valid ? "点击拍照 / 选图" : "先填菜名再选图"}
                      </span>
                      <span className="text-[10px] text-muted">支持 JPG/PNG/WebP · 单张 4MB 以内</span>
                    </div>
                  )}
                </label>
              );
            })()}

            {dishUploadError && (
              <p className="text-xs text-red-500 mt-3 text-center">{dishUploadError}</p>
            )}

            <button
              type="button"
              disabled={dishUploading}
              onClick={() => {
                setDishUploadOpen(false);
                setDishUploadError(null);
                setNewDishNameInput("");
              }}
              className="w-full mt-4 py-2.5 rounded-xl bg-gray-100 text-secondary text-sm font-medium active:bg-gray-200 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
