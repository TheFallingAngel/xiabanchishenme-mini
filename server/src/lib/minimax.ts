/**
 * MiniMax LLM client —— 生成"下班吃什么"的个性化推荐理由
 *
 * ✦ 产品口径（来自 PRD v1 + differentiation-memo-2026-04-12）：
 *   · 用户是一线 22-35 岁上班族,下班后决策疲劳,单手地铁刷手机
 *   · 产品不是"找餐厅",是"替你做决定"
 *   · 卡片上那句理由是 "朋友随口说" 的故事,不是导购话术,不是参数堆叠
 *     ❌ "湘村馆评分4.7，步行8分钟"
 *     ✓ "你上周吃了川菜，今天换个湘菜——周末也不排队，步行8分钟"
 *
 * ✦ API: OpenAI 兼容接口
 *   POST https://api.minimaxi.com/v1/chat/completions
 *   Authorization: Bearer $MINIMAX_API_KEY
 *   body: { model, messages, max_tokens, temperature }
 *
 * ✦ M2.x 是推理模型,content 会夹带 <think>...</think>,需剥离后再校验长度。
 */

const DEFAULT_MINIMAX_API_URL = "https://api.minimaxi.com/v1/chat/completions";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7-highspeed";

/**
 * 解析 `MINIMAX_MODEL` 环境变量。
 *
 * 防御场景:真实线上踩过 — Vercel env 里把 API key 误填进了 `MINIMAX_MODEL`。
 * 代码直接 `model: process.env.MINIMAX_MODEL` 会把 JWT / token 当 model 名发请求,
 * MiniMax 返回 invalid model,前端静默走 fallback 模板,用户以为在用 M2.7-highspeed
 * 实际一整套 LLM 链路都空转。
 *
 * 判断规则 (命中任一即忽略 env 值,回退 DEFAULT + warn):
 *   - 长度 > 60           (合法 model 名都很短: "MiniMax-M2.7-highspeed" = 22 字符)
 *   - 以 `eyJ` 开头        (JWT 格式)
 *   - 以 `sk-` 开头        (OpenAI 风格)
 *   - 含空格 / 换行        (明显不是 model 名)
 * 通过则直接用 env 值,保留"线上热切模型"的能力。
 */
/**
 * 一次 MiniMax 调用的三态返回:
 *   - ok:     正常拿到 choices
 *   - retry:  可重试错误 (超时 / 5xx / 429 / 网络层)
 *   - fail:   不可重试 (认证 4xx / 业务永久错 / 结果结构坏)
 *
 * 调用方 `callMinimaxWithRetry` 会按此判定是否跑下一轮。
 */
type MinimaxCallResult =
  | { kind: "ok"; data: MiniMaxResponse }
  | { kind: "retry"; reason: string }
  | { kind: "fail"; reason: string };

interface MinimaxCallPayload {
  apiUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens: number;
  temperature: number;
  top_p: number;
  /**
   * MiniMax M2.x 推理模型专用:把 <think> 思考内容从 content 剥到独立的
   * `choices[0].message.reasoning_content` 字段,content 只剩纯答案。
   * 这样即使模型没乖乖把思考包在 <think> tag 里,也不会裸露 CoT 给用户。
   * 无关模型会忽略该字段,向后兼容。
   */
  reasoning_split?: boolean;
}

async function callMinimaxOnce(
  payload: MinimaxCallPayload,
  timeoutMs: number
): Promise<MinimaxCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(payload.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        max_tokens: payload.max_tokens,
        temperature: payload.temperature,
        top_p: payload.top_p,
        // reasoning_split=true 时思考走 reasoning_content 字段,content 只剩答案
        ...(payload.reasoning_split ? { reasoning_split: true } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const retriable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      const reason = `HTTP ${res.status}: ${errText.slice(0, 200)}`;
      return retriable ? { kind: "retry", reason } : { kind: "fail", reason };
    }

    const data: MiniMaxResponse = await res.json();
    if (data.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
      const code = data.base_resp.status_code;
      // 已知可重试的限流/瞬态码 (MiniMax 文档里 1002 限流, 1008 内部, 1027 高并发)
      const retriable = code === 1002 || code === 1008 || code === 1027;
      const reason = `business ${code}: ${data.base_resp.status_msg || ""}`;
      return retriable ? { kind: "retry", reason } : { kind: "fail", reason };
    }
    return { kind: "ok", data };
  } catch (err) {
    clearTimeout(timer);
    // AbortError (超时) + 网络瞬断 都归为可重试
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || /abort/i.test(err.message || ""));
    const reason = isAbort
      ? `timeout ${timeoutMs}ms`
      : `exception: ${String(err).slice(0, 200)}`;
    return { kind: "retry", reason };
  }
}

/**
 * 带自动重试的 MiniMax 调用。
 *
 * 为什么要重试: M2.7-highspeed 是推理模型,单次 8-10s 属正常,但 MiniMax 端偶发
 * 会跑到 15s+ 或 502/429。线上日志里 20% 的 DOMException[AbortError] 就是这种
 * 瞬态超时 —— 重试一次通常 3-5s 就能回,用户体验远好于直接 fallback 到模板。
 *
 * maxAttempts=2: 第一次快攻失败后给 MiniMax 一次机会,总耗时上限约 2×timeoutMs,
 * 同时 UI 层是骨架/并发,不会阻塞用户操作。
 */
async function callMinimaxWithRetry(
  label: string,
  payload: MinimaxCallPayload,
  timeoutMs: number,
  maxAttempts = 2
): Promise<MiniMaxResponse | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await callMinimaxOnce(payload, timeoutMs);
    if (r.kind === "ok") {
      if (attempt > 1) {
        console.info(`[${label}] retry succeeded on attempt ${attempt}`);
      }
      return r.data;
    }
    if (r.kind === "fail") {
      console.error(`[${label}] fatal on attempt ${attempt}: ${r.reason}`);
      return null;
    }
    // retry
    if (attempt < maxAttempts) {
      console.warn(
        `[${label}] attempt ${attempt} failed (${r.reason}), retrying once...`
      );
    } else {
      console.error(
        `[${label}] attempts exhausted (${r.reason}) — falling back to template`
      );
    }
  }
  return null;
}

function resolveMinimaxModel(): string {
  const raw = (process.env.MINIMAX_MODEL || "").trim();
  if (!raw) return DEFAULT_MINIMAX_MODEL;
  const looksLikeKey =
    raw.length > 60 ||
    raw.startsWith("eyJ") ||
    raw.startsWith("sk-") ||
    /\s/.test(raw);
  if (looksLikeKey) {
    console.warn(
      `[minimax] MINIMAX_MODEL env looks like a key/token (len=${raw.length}, prefix=${raw.slice(0, 4)}...), ignoring — using default "${DEFAULT_MINIMAX_MODEL}". Rename the env var to MINIMAX_API_KEY.`
    );
    return DEFAULT_MINIMAX_MODEL;
  }
  return raw;
}

/**
 * 调用方需要传入的完整上下文。越丰富,理由越"像朋友在说话"。
 * 只有 restaurantName / category / avgPrice / walkMinutes 是必填。
 */
export interface ReasonContext {
  // —— 餐厅侧 ——
  restaurantName: string;
  category: string;       // 菜系,如 "湘菜" / "兰州拉面"
  avgPrice: number;       // 人均 (¥)
  walkMinutes: number;    // 步行分钟
  rating?: number;        // 0-5,可无
  matchScore?: number;    // 0-100 系统匹配度,可无
  /** 餐厅本身的亮点:高德 tags / alias / recommend 精简,如 "小龙虾·小炒黄牛肉" */
  highlight?: string;

  // —— 当下场景 ——
  weekday?: string;       // 星期一...周日 / "周末"
  timeOfDay?: string;     // "傍晚6点" / "晚上9点" / "深夜"
  weather?: string;       // "小雨" / "降温" / "闷热" (Phase 2 可接)
  mood?: string;          // "热气腾腾" / "清淡爽口" (来自骰子气泡)

  // —— 用户历史 ——
  daysSinceCategory?: number;   // 距上次吃同菜系几天,0 表示今天吃过
  recentHistory?: string[];     // 最近 3-5 顿: ["昨天·川菜", "3天前·日料"]

  // —— 用户偏好(个性化钩子) ——
  /** 用户所有口味标签,如 ["川菜", "日料", "清淡"] */
  tastePreferences?: string[];
  /** 本店 category 是否命中用户口味偏好 */
  tasteHit?: boolean;
  /** 健康标签:未来迭代,如 "低油低盐" */
  healthTags?: string[];
  /** 社交钩子:未来迭代,如 "3 位同事最近去过" */
  socialHint?: string;

  // —— 档位(帮助模型选钩子) ——
  priceTier?: "budget" | "normal" | "mid" | "premium";
  walkTier?: "very-close" | "close" | "normal" | "far";
  ratingTier?: "high" | "normal" | "low" | "unrated";

  // —— 钱包 ——
  budgetRemaining?: number;     // 今日剩余预算 (¥)
  budgetStatus?: "relaxed" | "tight" | "over"; // 充裕/紧张/超支

  // —— 去重提示 ——
  /** 同一次推荐列表里,已经被别家用过的"钩子类型",本次尽量换一个 */
  avoidHooks?: Array<"history" | "taste" | "walk" | "budget" | "weekday" | "highlight">;
}

interface MiniMaxResponse {
  choices?: { message?: { content?: string } }[];
  base_resp?: { status_code?: number; status_msg?: string };
}

/**
 * System prompt —— 把产品的灵魂喂给模型。
 *
 * 设计要点:
 * 1. 角色定位: 不是导购,是身边朋友。
 * 2. 场景锚点: 用户刚下班,决策疲劳,单手操作,容忍度低。
 * 3. 写作公式: 3 选 2 + 1 硬性数字,让 reason 有"故事感"。
 * 4. 禁忌词明示: 把大众点评/小红书风格的词全 ban 掉,避免 LLM 惯性跑偏。
 * 5. 负面示例: 演示"什么是参数堆叠",让模型反向对齐。
 */
const SYSTEM_PROMPT = `你是 "下班吃什么" 这款 App 的决策小助手,不是点评网站,也不是导购。

【用户画像】
一线城市 22-35 岁上班族,刚下班,脑子累了一整天,在地铁上单手刷手机,不想做选择。
他们要的是一句话让自己点头 "行,就这家吧",不是一份测评。

【你的任务】
根据我给的餐厅信息 + 用户历史 + 当下场景 + 个人口味,写一句 18-30 个中文字的推荐理由。
这句话要像朋友随口一说,不是导购文案。

【写作公式】下面 6 类钩子至少命中 2 类,并且硬性带 1 个具体数字 (分钟/人均/天数):
① 历史钩子:引用用户吃过什么或多久没吃同类 (如 "你 5 天没吃面了")
② 口味钩子:用户口味偏好命中时,暗示"你爱吃的 X" (如 "你爱吃的川菜,换一家")
③ 餐厅亮点钩子:引用餐厅本身的特色/招牌 (如 "这家的小龙虾拿手")
④ 场景钩子:引用当下时间/天气/周几/一个人吃 (如 "周五晚上不排队")
⑤ 距离钩子:步行档 (如 "走 4 分钟就到"、"绕一圈 12 分钟也到")
⑥ 钱包钩子:引用预算宽松/便宜不心疼/今晚预算还够

【非常重要 —— 避免雷同】
- 不同店请换不同钩子组合,别每句都写 "人均 X 步行 Y",那是参数堆叠。
- 当我提示 "这次尽量避开: [xx]" 时,请从剩下的钩子里选。
- 有 "餐厅亮点" 就尽量用到它 —— 这是这家店和别家不一样的地方。
- 有 "用户口味偏好命中"标志时,要在句子里隐晦带出"你爱吃的"这层意思,别罗列用户偏好标签。

【格式硬性约束】
- 只输出一句话,不超过 30 个中文字 (理想 18-26 字)
- 纯文本,不要引号、书名号、emoji、英文词、感叹号、句号结尾
- 不要前缀如 "推荐理由:"、"答:"、编号
- 禁用词: 推荐 / 必吃 / 一绝 / 神级 / 隐藏菜单 / 爆款 / 绝了 / yyds
- 避免 "评分 X.X" 这种干巴巴的参数堆叠

【反例 vs 正例】
❌ 湘村馆评分 4.7,步行 8 分钟,人均 48,性价比高
❌ 这家餐厅必吃招牌菜,值得一试!
❌ 附近好评不错,距离近评分高
✓ 你上周吃了川菜,今天换个湘菜,步行 8 分钟还不排队
✓ 周五晚上不想做饭,走 6 分钟就到,人均 45 不心疼
✓ 7 天没吃粤菜了,这家清淡暖胃,一个人正好
✓ 雨天懒得走远,步行 4 分钟,一碗热汤面解决晚饭
✓ 预算还剩一半,换个日料换换心情,步行 10 分钟
✓ 你爱吃的湘菜,这家的小炒黄牛肉拿手,走 7 分钟
✓ 这家小龙虾是本地招牌,走 9 分钟,人均 68 不亏

只返回那句话本身,不要任何其他内容。`;

/**
 * 根据上下文动态构造 user prompt。
 *
 * 设计: 只喂"值得被引用的信号",缺的字段直接不出现,避免让模型编造。
 * 特别标注信号的"可用性"(比如 daysSinceCategory === 0 时告诉它今天已吃过)。
 */
function buildUserPrompt(ctx: ReasonContext): string {
  const lines: string[] = [];

  // —— 餐厅核心信息（必)——
  lines.push(`餐厅: ${ctx.restaurantName} (${ctx.category})`);
  lines.push(`人均 ¥${ctx.avgPrice},步行 ${ctx.walkMinutes} 分钟`);
  if (ctx.rating && ctx.rating > 0) lines.push(`评分 ${ctx.rating.toFixed(1)}`);

  // —— 餐厅差异化亮点 (非常重要 —— 让每家店写出不一样的理由)——
  if (ctx.highlight) {
    lines.push(`这家的亮点: ${ctx.highlight} (优先用进句子里,突出和别家不一样)`);
  }
  if (ctx.priceTier) {
    const label = {
      budget: "便宜档 (人均 ≤30,钩子可用'不心疼')",
      normal: "日常档 (人均 30-80,钩子可用'预算内')",
      mid: "中等档 (人均 80-150,钩子可用'犒劳一下')",
      premium: "高档 (>150,慎用,只在预算充裕时推)",
    }[ctx.priceTier];
    lines.push(`价格档: ${label}`);
  }
  if (ctx.walkTier) {
    const label = {
      "very-close": "非常近 (≤5 分钟,钩子:'不用绕远')",
      close: "近 (≤10 分钟,钩子:'顺路')",
      normal: "正常 (≤20 分钟,钩子:'走一小段也不亏')",
      far: "稍远 (>20 分钟,别主打距离)",
    }[ctx.walkTier];
    lines.push(`步行档: ${label}`);
  }
  if (ctx.ratingTier === "high") lines.push("评分档: 高 (≥4.5,可暗示'评价不错')");
  else if (ctx.ratingTier === "low") lines.push("评分档: 偏低 (<4.0,别吹评价)");

  // —— 当下场景 ——
  const sceneParts: string[] = [];
  if (ctx.weekday) sceneParts.push(ctx.weekday);
  if (ctx.timeOfDay) sceneParts.push(ctx.timeOfDay);
  if (ctx.weather) sceneParts.push(ctx.weather);
  if (sceneParts.length > 0) lines.push(`当下: ${sceneParts.join("、")}`);
  if (ctx.mood) lines.push(`今日心情标签: ${ctx.mood}`);

  // —— 用户历史（最关键的差异化信号)——
  if (typeof ctx.daysSinceCategory === "number") {
    if (ctx.daysSinceCategory === 0) {
      lines.push(`⚠️ 用户今天刚吃过 ${ctx.category},别主打"换口味",要别的角度`);
    } else if (ctx.daysSinceCategory <= 2) {
      lines.push(`用户 ${ctx.daysSinceCategory} 天前吃过 ${ctx.category},建议别强调同菜系`);
    } else if (ctx.daysSinceCategory >= 5) {
      lines.push(`用户已经 ${ctx.daysSinceCategory} 天没吃 ${ctx.category} 了 (强钩子,建议引用)`);
    } else {
      lines.push(`距上次吃 ${ctx.category}: ${ctx.daysSinceCategory} 天`);
    }
  } else {
    lines.push(`该用户近期未吃过 ${ctx.category} (可选钩子)`);
  }

  if (ctx.recentHistory && ctx.recentHistory.length > 0) {
    lines.push(`最近几顿: ${ctx.recentHistory.slice(0, 4).join(" / ")}`);
  }

  // —— 用户口味偏好(个性化钩子的核心)——
  if (ctx.tastePreferences && ctx.tastePreferences.length > 0) {
    lines.push(`用户口味偏好: ${ctx.tastePreferences.slice(0, 6).join("、")}`);
    if (ctx.tasteHit === true) {
      lines.push(`✓ 本店 ${ctx.category} 命中用户口味偏好 (强钩子:可以隐晦带"你爱吃的"/"对胃口"这种意思,别罗列标签)`);
    } else if (ctx.tasteHit === false) {
      lines.push(`本店 ${ctx.category} 不在用户常吃偏好里 (钩子:"换一家换换口味" 也行)`);
    }
  }

  // —— 健康 / 天气 / 社交(未来迭代槽位,有才喂)——
  if (ctx.healthTags && ctx.healthTags.length > 0) {
    lines.push(`健康标签: ${ctx.healthTags.join("、")}`);
  }
  if (ctx.socialHint) lines.push(`社交信号: ${ctx.socialHint}`);

  // —— 钱包 ——
  if (typeof ctx.budgetRemaining === "number" && ctx.budgetRemaining > 0) {
    const over = ctx.avgPrice > ctx.budgetRemaining;
    if (over) {
      lines.push(`今日剩余预算 ¥${ctx.budgetRemaining} < 人均,会略超支`);
    } else if (ctx.avgPrice <= ctx.budgetRemaining * 0.5) {
      lines.push(`今日剩余预算 ¥${ctx.budgetRemaining},这家只占一半,很划算`);
    } else {
      lines.push(`今日剩余预算 ¥${ctx.budgetRemaining},这家正好在预算内`);
    }
  }
  if (ctx.budgetStatus === "tight") lines.push("注意: 用户这月预算比较紧");
  if (ctx.budgetStatus === "over") lines.push("注意: 用户这月已超预算,语气别再推奢侈选择");

  // —— 避免雷同提示 ——
  if (ctx.avoidHooks && ctx.avoidHooks.length > 0) {
    const map: Record<string, string> = {
      history: "历史钩子(距上次吃多久)",
      taste: "口味钩子(你爱吃的)",
      walk: "距离钩子(步行 N 分钟)",
      budget: "钱包钩子(预算/不心疼)",
      weekday: "场景钩子(周几/时段)",
      highlight: "亮点钩子(这家的招牌)",
    };
    const names = ctx.avoidHooks.map((k) => map[k] || k).join("、");
    lines.push(`⚠️ 这次尽量避开: ${names} (同一次推荐已经用过,请换别的钩子组合)`);
  }

  return lines.join("\n") + "\n\n现在写那句 18-30 字的推荐理由:";
}

/**
 * 剥掉推理模型的 <think>...</think> 块,并清理首尾引号/前缀/标点。
 *
 * 鲁棒性要点 (线上踩过):
 *   · 闭合的 <think>...</think> → 正常正则剥离
 *   · 只有闭合标签没开头 (</think>xxx) → 取尾段
 *   · 开了 <think> 但 max_tokens=2048 被思考吃光,没闭合 —— 回头看是整段都是思考,
 *     此前正则不匹配,整段(含 `<think>` + 几千字思考)会直接喂给 gate,gate 拒 null,
 *     前端却还在渲染流式 preview —— 表现就是用户截图里那种 "显示思考过程 + 循环过长"。
 *     所以这里兜底: 从 `<think>` 起截到末尾,视为整段无效内容。
 */
function stripReasoning(raw: string): string {
  let s = raw;
  // 0. 最坏情况:开了 <think> 但没闭合 —— 把 <think> 及其后所有内容丢掉
  const openIdx = s.indexOf("<think>");
  if (openIdx >= 0 && s.indexOf("</think>", openIdx) < 0) {
    s = s.slice(0, openIdx);
  }
  // 1. 贪婪剥离所有闭合 <think>...</think>,兼容多段
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 2. 兼容部分模型只收尾不收头的 </think> 场景
  if (s.includes("</think>")) {
    s = s.split("</think>").pop() || s;
  }
  // 3. 防御性兜底:如果某些模型用变体 tag (<reasoning>/<thinking>/<analysis>),也一并剥
  s = s.replace(/<\/?(?:think|thinking|reasoning|analysis)[^>]*>/gi, "");
  // 4. 去掉常见前缀
  s = s.replace(/^\s*(?:推荐理由[\u003a\uff1a]\s*|答[\u003a\uff1a]\s*|理由[\u003a\uff1a]\s*|好的[,\uff0c]?\s*)/u, "");
  // 5. 去掉首尾引号/书名号/括号 (半角/全角都覆盖)
  s = s
    .trim()
    .replace(/^[\u300c\u300e"'\u201c\u2018\u0028\uff08\[\u3010]+/u, "")
    .replace(/[\u300d\u300f"'\u201d\u2019\u0029\uff09\]\u3011]+$/u, "");
  // 6. 去掉句尾句号 (但保留逗号顿号,因为那是口语停顿)
  s = s.replace(/[\u3002.]\s*$/u, "");
  // 7. 去除所有感叹号 —— prompt 禁了还是兜底
  s = s.replace(/[!\uff01]+/gu, "");
  return s.trim();
}

/**
 * 基础脏词 / 破功词兜底校验。命中则返回 null,由调用方降级。
 */
const BANNED_PATTERNS = [
  /推荐这家/,
  /必吃/,
  /一绝/,
  /神级/,
  /yyds/i,
  /隐藏菜单/,
  /爆款/,
  /绝了/,
  /强烈(推荐|建议)/,
];

function passesStyleGate(line: string): boolean {
  if (!line) return false;
  // 长度: 允许到 36 字作缓冲,但高于那个说明模型跑飞
  const len = [...line].length;
  if (len < 10 || len > 40) return false;
  if (BANNED_PATTERNS.some((p) => p.test(line))) return false;
  // 全是数字 / 英文 / 符号的兜底
  if (!/[\u4e00-\u9fa5]/.test(line)) return false;
  return true;
}

/**
 * 调用 MiniMax API 生成一句个性化推荐理由。
 * 失败返回 null,调用方应降级到 recommend.ts 的模板。
 */
export async function generateLLMReason(
  ctx: ReasonContext
): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    const modelVar = (process.env.MINIMAX_MODEL || "").trim();
    const looksMisplaced =
      modelVar.length > 60 || modelVar.startsWith("eyJ") || modelVar.startsWith("sk-");
    if (looksMisplaced) {
      console.error(
        "[minimax] MINIMAX_API_KEY is empty, but MINIMAX_MODEL holds a key-shaped string. You likely swapped the env var names — rename MINIMAX_MODEL → MINIMAX_API_KEY in Vercel."
      );
    } else {
      console.warn("[minimax] MINIMAX_API_KEY not set — falling back to template");
    }
    return null;
  }

  const apiUrl = process.env.MINIMAX_API_URL || DEFAULT_MINIMAX_API_URL;
  const model = resolveMinimaxModel();

  // 超时 18s (原 15s,MiniMax M2 推理有时会跑到 15s+);失败重试 1 次
  const data = await callMinimaxWithRetry(
    "minimax",
    {
      apiUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      // 推理模型 <think> 会吃掉 500-1500 token,2048 预算留足余量,
      // 实际返回的 reason 只是一句话 (后面剥 <think> + 截到 36 字)
      max_tokens: 2048,
      // 0.85 让输出更有个性,避免千篇一律
      temperature: 0.85,
      top_p: 0.95,
    },
    18_000
  );
  if (!data) return null;

  const raw = data.choices?.[0]?.message?.content || "";
  const content = stripReasoning(raw);

  if (!content || content.length < 5) {
    console.warn("[minimax] empty content after stripping, raw len=", raw.length);
    return null;
  }
  // 只保留第一行
  const firstLine = content.split(/\r?\n/)[0].trim();

  if (!passesStyleGate(firstLine)) {
    console.warn("[minimax] style gate failed for:", firstLine);
    return null;
  }

  // 截到 36 字 (漫长的版本加 …)
  const chars = [...firstLine];
  return chars.length > 36 ? chars.slice(0, 34).join("") + "…" : firstLine;
}

/**
 * 详情页专用的"为什么适合你今天"段落。
 *
 * 与卡片上的 generateLLMReason 的差异:
 *   · 位置:详情页 Info 卡下方 — 用户已经看过名字/评分/价格,在问"为什么是这家"
 *   · 长度:40-80 字,2 句 (第一句点主因,第二句补场景/钱包/心情)
 *   · 语气:还是朋友,但可以展开讲,比卡片一句话更走心
 *
 * 复用 ReasonContext,复用 stripReasoning / BANNED_PATTERNS。
 */
const INSIGHT_SYSTEM_PROMPT = `你是 "下班吃什么" App 的决策小助手,这里是餐厅详情页的 "为什么是这家" 段落。

【语境】
用户刚从推荐卡片点进来,已经看过餐厅名字、评分、价格、步行时间。
他们现在想要你用朋友的口气告诉他:"今晚去这家合不合适"。不要再重复评分/人均这些已经看到的冷数字。

【输出契约 — 最高优先级,任何一条违反都会被丢弃】
1. 长度:40-80 个中文字符(含标点),超出会被截断
2. 结构:只 2 个自然句,用逗号或句号连接,整段不换行不分段
3. 风格:朋友私下顺口说的语气,平实、口语、不装;不要导购腔,不要报告体,不要文案腔
4. 输出:只返回那段话本身 —— 不说"以下是理由"、不加前缀后缀、不加标题、不引号包裹

【绝对禁止 — 命中任何一条整段作废】
- 任何编号或列表格式:"1. 2. 3." / "①②③" / "一、二、" / 连续换行 / bullet 点
- 任何元话术:"考虑到" / "用户..." / "亮点:" / "价格档:" / "当前:" / "匹配度" / "分析" / "推理"
- 复述输入信号:不要重复说评分、人均、步行分钟(卡片上已展示)
- 禁用词:推荐 / 必吃 / 一绝 / 神级 / 隐藏菜单 / 爆款 / 绝了 / yyds / 值得一试 / 不容错过
- 禁用符号:emoji、引号(「」""')、书名号、感叹号、英文词、全角省略号
- 编造"老板人好"、"据说很好吃"这种无依据的主观描述
- 罗列用户口味标签清单("你爱吃川菜、湘菜、粤菜"这种),要把"你爱吃"融进句子

【内容编排指引】
- 第一句:点出今天选这家的核心理由 (历史 / 场景 / 口味 / 钱包,至少带一个具体数字)
- 第二句:补一个差异化的感受 (餐厅亮点 / 菜品特点 / 一个人的便利 / 预算下的安心)

【差异化信号优先级】
- 有 "餐厅亮点 (招牌/特色)" 时,一定要在第二句里自然带出,这是这家店跟别家最不一样的地方。
- 有 "用户口味偏好命中" 时,第一句可以暗示"对你胃口""你爱吃这口"。
- 有 "健康标签" 时,可以提一句健康相关的感受。
- 未来有 "天气 / 社交信号" 也要自然融入。

【正例 — 直接按这个字数、口气、结构写】
7 天没吃粤菜了,这家一碗及第粥正好暖胃。走 8 分钟就到,周五傍晚不太会排队,一个人点一砂锅饭也自在。
你爱吃湘菜,这家小炒黄牛肉是本地招牌。走 7 分钟到店,傍晚点一份也不用排,一个人吃刚刚好。
下雨天懒得挪远,这家步行 4 分钟在地铁口旁,到店就能点一碗热汤面。晚上 8 点后人少,适合一个人慢慢吃。

【反例 — 绝不要这样】
❌ 这家餐厅评分 4.6 人均 45,性价比很高值得一试
❌ 招牌菜必吃!环境一绝,老板服务超棒!
❌ 推荐理由: 1. 步行近 2. 好评多 3. 性价比高
❌ 考虑到用户口味偏好是湘菜,今天刚吃过日料,这家…(元话术,禁)
❌ (很近) 3. 评分 4.4 4. 亮点: 薯条 5. 价格档: 日常档…(CoT 泄漏,禁)

再次强调:只输出那段话本身,不要任何编号、前缀、思考过程、说明或 meta 信息。`;

function buildInsightUserPrompt(ctx: ReasonContext): string {
  // 复用卡片 prompt 的数据组织逻辑,但提示语改成 "写详情页段落"
  const shared = buildUserPrompt(ctx);
  // 替换末尾的短 prompt 为长版本
  return shared.replace(
    /现在写那句 18-30 字的推荐理由:$/,
    "现在写那段 40-80 字的 \"为什么是这家\" 段落 (分成 2 句):"
  );
}

/**
 * 基础脏词 / 破功词校验 — 详情页版,稍放宽长度。
 *
 * 注意 HTML/XML tag 字符的显式拒绝: 即便 stripReasoning 加固后,
 * 仍可能有残留的 `<think`/`<reasoning` 前缀或畸形 `>` 漏过 —— 整段直接拒,
 * 让上层优雅降级到 cardReason,比硬渲染一堆 tag 好看一万倍。
 */
function passesInsightGate(line: string): boolean {
  if (!line) return false;
  const len = [...line].length;
  if (len < 25 || len > 110) return false;
  if (BANNED_PATTERNS.some((p) => p.test(line))) return false;
  if (!/[\u4e00-\u9fa5]/.test(line)) return false;
  // 带 tag 字符直接拒 —— 模型泄露思考块 / XML 残片都会命中
  if (/[<>]/.test(line)) return false;
  return true;
}

/**
 * 生成详情页 "为什么是这家" 段落。失败返回 null,调用方应优雅降级
 * (通常就是展示卡片的一句话 reason 作为简版)。
 */
export async function generateLLMInsight(
  ctx: ReasonContext
): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    const modelVar = (process.env.MINIMAX_MODEL || "").trim();
    const looksMisplaced =
      modelVar.length > 60 || modelVar.startsWith("eyJ") || modelVar.startsWith("sk-");
    if (looksMisplaced) {
      console.error(
        "[minimax/insight] MINIMAX_API_KEY is empty, but MINIMAX_MODEL holds a key-shaped string. Rename MINIMAX_MODEL → MINIMAX_API_KEY in Vercel."
      );
    } else {
      console.warn("[minimax/insight] MINIMAX_API_KEY not set");
    }
    return null;
  }

  const apiUrl = process.env.MINIMAX_API_URL || DEFAULT_MINIMAX_API_URL;
  const model = resolveMinimaxModel();

  // 详情页是停留页,给 LLM 更宽裕的时间 (22s),失败重试 1 次。
  // UI 层是骨架态,总上限 ~44s 不会阻塞其他内容。
  const data = await callMinimaxWithRetry(
    "minimax/insight",
    {
      apiUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: INSIGHT_SYSTEM_PROMPT },
        { role: "user", content: buildInsightUserPrompt(ctx) },
      ],
      max_tokens: 2048,
      temperature: 0.85,
      top_p: 0.95,
      // M2.x 思考一定会跑(不能关),但 reasoning_split 能把思考剥到
      // reasoning_content 字段,content 只剩纯答案,避免裸 CoT 泄漏
      reasoning_split: true,
    },
    22_000
  );
  if (!data) return null;

  const raw = data.choices?.[0]?.message?.content || "";
  // 详情页允许换行,但合并成单段,LLM 偶尔会输出 "第一句。\n第二句"
  const content = stripReasoning(raw)
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!content || !passesInsightGate(content)) {
    console.warn("[minimax/insight] gate failed:", content.slice(0, 60));
    return null;
  }

  // 截到 120 字以防模型写嗨了
  const chars = [...content];
  return chars.length > 120 ? chars.slice(0, 118).join("") + "…" : content;
}

/**
 * 批量并发生成推荐理由。
 * Returns a map of id → reason (null on individual failure).
 */
export async function batchGenerateReasons(
  items: (ReasonContext & { id: string })[]
): Promise<Record<string, string | null>> {
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const reason = await generateLLMReason(item);
      return { id: item.id, reason };
    })
  );

  const map: Record<string, string | null> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      map[result.value.id] = result.value.reason;
    }
  }
  return map;
}

/**
 * 流式版 insight —— SSE 提速 (方案 C)。
 *
 * 为什么需要: M2.7-highspeed **不能关 thinking** (官方文档确认),思考块耗时 1~2s 是常态。
 * 非流式下首字要等到整段生成完 (3~5s);流式下思考时没字,一旦 `</think>` 结束,
 * 真正内容会一 token 一 token 吐出来 —— 首字可见 < 500ms,观感"LLM 在写字"。
 *
 * 实现要点:
 *   - 走 OpenAI 兼容 `stream: true`,SSE 按行解析 `data:` payload
 *   - `<think>...</think>` 在服务器侧剥离(状态机 inThink) —— **不把思考内容吐给前端**
 *   - 处理 tag 跨 chunk 断裂:保留末尾 8 字作为 "可能是不完整 tag" 的安全边界,stream 结束时再 flush
 *   - 失败/超时返回 null,上层走 SSE "done: null",前端自己降级到卡片 reason
 *
 * onChunk 回调只在**非思考段**收到新文本时触发。典型时序:
 *   t=0:    开始,无回调 (模型在思考)
 *   t=1.8s: 回调 ("你上周")
 *   t=1.9s: 回调 ("吃了川菜")
 *   ...
 *   t=3.5s: Promise resolve,返回完整文本
 *
 * @returns 完整原始 content (含 <think>,留给上层做最终 gate 校验);出错返 null
 */
export async function streamLLMInsight(
  ctx: ReasonContext,
  onChunk: (text: string) => void,
  timeoutMs = 25_000
): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    const modelVar = (process.env.MINIMAX_MODEL || "").trim();
    const looksMisplaced =
      modelVar.length > 60 || modelVar.startsWith("eyJ") || modelVar.startsWith("sk-");
    if (looksMisplaced) {
      console.error(
        "[minimax/insight-stream] MINIMAX_API_KEY empty but MINIMAX_MODEL holds a key. Rename env var."
      );
    } else {
      console.warn("[minimax/insight-stream] MINIMAX_API_KEY not set");
    }
    return null;
  }

  const apiUrl = process.env.MINIMAX_API_URL || DEFAULT_MINIMAX_API_URL;
  const model = resolveMinimaxModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // —— 流式 <think> 剥离状态机 ——
  // inThink: 当前扫描游标是否位于 <think>...</think> 之间
  // scanIdx: accumulated 里已经被扫描过的位置(之后的还没处理)
  // TAG_LEN: </think> 长度 (8),用作 "尾部可能是不完整 tag" 的安全边界
  const state = { inThink: false, scanIdx: 0, emitted: 0, stopped: false };
  const TAG_LEN = 8;
  // 非思考段 emit 封顶 —— passesInsightGate 拒 > 110,留 2x buffer 就够了。
  // 模型偶尔会跑飞进入循环输出 (用户截图里看到的 "循环过长") —— 这里兜底,
  // 超过后不再 emit 也不再改状态,让 stream 继续读但视觉上停住。
  const EMIT_CAP = 220;
  let accumulated = "";

  /** 根据 accumulated 的当前内容,尽可能多地 emit 非思考文本;final=true 时把末尾 safety margin 也 flush */
  function drain(final: boolean) {
    if (state.stopped) return;
    const boundary = final ? accumulated.length : Math.max(state.scanIdx, accumulated.length - TAG_LEN);
    const safeEmit = (chunk: string) => {
      if (!chunk || state.stopped) return;
      // 如果 chunk 里有残留的 tag 字符,整段扔,别往前端推
      if (/[<>]/.test(chunk)) return;
      if (state.emitted + chunk.length > EMIT_CAP) {
        // 超过封顶,把超出部分截掉 (仅 emit 剩下的 headroom);
        // 之后不再 emit,等 done 时由 finalize gate 统一裁决
        const headroom = Math.max(0, EMIT_CAP - state.emitted);
        if (headroom > 0) {
          const trimmed = chunk.slice(0, headroom);
          state.emitted += trimmed.length;
          onChunk(trimmed);
        }
        state.stopped = true;
        return;
      }
      state.emitted += chunk.length;
      onChunk(chunk);
    };
    while (state.scanIdx < boundary) {
      if (state.inThink) {
        const end = accumulated.indexOf("</think>", state.scanIdx);
        if (end < 0 || end + TAG_LEN > boundary) {
          // </think> 还没完整到位,等下一波
          state.scanIdx = boundary;
          break;
        }
        state.scanIdx = end + TAG_LEN;
        state.inThink = false;
      } else {
        const start = accumulated.indexOf("<think>", state.scanIdx);
        if (start < 0 || start + 7 > boundary) {
          // 没下一个 <think>,或 <think> 可能是不完整的 —— emit 到 boundary
          safeEmit(accumulated.slice(state.scanIdx, boundary));
          state.scanIdx = boundary;
          break;
        }
        // emit <think> 之前的部分
        if (start > state.scanIdx) {
          safeEmit(accumulated.slice(state.scanIdx, start));
        }
        state.scanIdx = start + 7;
        state.inThink = true;
      }
    }
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: INSIGHT_SYSTEM_PROMPT },
          { role: "user", content: buildInsightUserPrompt(ctx) },
        ],
        max_tokens: 2048,
        temperature: 0.85,
        top_p: 0.95,
        stream: true,
        // 关键:reasoning_split 让 SSE 的 delta 按字段分类 ——
        //   · delta.content          → 纯答案文本 (就是我们要 emit 到前端的)
        //   · delta.reasoning_content → 思考过程 (直接丢掉)
        // 这样即便模型不乖乖包 <think>,也不会让 CoT 溜到前端成品里。
        reasoning_split: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      const errText = await res.text().catch(() => "");
      console.warn(
        `[minimax/insight-stream] HTTP ${res.status}: ${errText.slice(0, 200)}`
      );
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });

      // SSE 按行分割;一条消息以 \n\n 结尾,但 data: 单独一行也 OK
      let nlIdx: number;
      while ((nlIdx = sseBuffer.indexOf("\n")) >= 0) {
        const line = sseBuffer.slice(0, nlIdx).trim();
        sseBuffer = sseBuffer.slice(nlIdx + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue; // 继续读,让 reader.read() 报 done
        try {
          const parsed = JSON.parse(payload);
          const delta: unknown = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            accumulated += delta;
            drain(false);
          }
          // base_resp 业务错误码
          const br = parsed?.base_resp;
          if (br && br.status_code && br.status_code !== 0) {
            console.warn(
              `[minimax/insight-stream] base_resp ${br.status_code}: ${br.status_msg || ""}`
            );
            clearTimeout(timer);
            reader.cancel().catch(() => {});
            return null;
          }
        } catch {
          // JSON parse fail — 单行噪声忽略
        }
      }
    }

    clearTimeout(timer);
    drain(true); // flush 末尾安全边界
    return accumulated;
  } catch (err) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || /abort/i.test(err.message || ""));
    console.warn(
      `[minimax/insight-stream] ${isAbort ? `timeout ${timeoutMs}ms` : String(err).slice(0, 200)}`
    );
    return null;
  }
}

/**
 * 对流式/非流式拿到的 raw content 做最终清洗 + gate 校验 + 截断。
 * 返回 null 代表校验失败,调用方应降级。
 *
 * 之前 generateLLMInsight 里是**内联**做这些事;拆出来是为了让 stream 路径也能共用同一套规则,
 * 避免两处 drift。
 */
export function finalizeInsight(raw: string | null): string | null {
  if (!raw) return null;
  const content = stripReasoning(raw)
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!content || !passesInsightGate(content)) {
    console.warn("[minimax/insight] finalize gate failed:", content.slice(0, 60));
    return null;
  }
  const chars = [...content];
  return chars.length > 120 ? chars.slice(0, 118).join("") + "…" : content;
}
