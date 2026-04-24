"use client";

import { useMemo, useState, useEffect } from "react";
import {
  User,
  Utensils,
  Wallet,
  Footprints,
  Ban,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  RotateCcw,
  Lock,
  Unlock,
  Sliders,
  Dice5,
  List as ListIcon,
  Smartphone,
  Copy,
  Check,
} from "lucide-react";
import { getOrCreateDeviceId, setDeviceId } from "@/lib/device-id";
import {
  loadPrefs,
  savePrefs,
  updateTastePreferences,
  updateMonthlyBudget,
  updateMaxWalkMinutes,
  unmarkNotInterested,
  clearNotInterested,
  updateScoringWeights,
  resetScoringWeights,
  updateModeSettings,
  resetModeSettings,
} from "@/lib/storage";
import { getImageForCategory } from "@/lib/images";
import { buildUserProfile, suggestTasteCandidates } from "@/lib/user-profile";
import { calculateBudget, budgetUsagePercent, budgetStatus } from "@/lib/budget";
import { weightPercentages } from "@/lib/match-score";
import type { UserPreferences, ScoringWeights, ModeSettings } from "@/lib/types";

const ALL_TASTE_TAGS = [
  "大众菜", "不辣", "川菜", "粤菜", "日料", "西餐", "火锅",
  "湘菜", "烧烤", "海鲜", "韩餐", "快餐", "面食", "小吃",
];

/** 被我忽略的建议不再二次弹出 —— 存一个 session 级集合,刷新后再来一次也没问题 */
const DISMISS_KEY = "xcm_dismissed_taste_suggestions";

export default function ProfilePage() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  // 用户点 x 忽略过的建议 —— 这次打开不再显示;写到 sessionStorage,不进 prefs
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  // "不想吃" 管理区块的折叠状态 —— 默认收起,点头部展开才看得到列表
  const [showNotInterested, setShowNotInterested] = useState(false);
  // 高级模式区块的折叠 —— 解锁后默认展开,让用户第一次看见;非解锁状态也收起
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 设备码相关
  const [deviceId, setDeviceIdState] = useState<string>("");
  const [showDeviceIdFull, setShowDeviceIdFull] = useState(false);
  const [copiedDevice, setCopiedDevice] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    // 首次 mount 读取或生成设备码 —— getOrCreateDeviceId 里会持久化到 localStorage
    setDeviceIdState(getOrCreateDeviceId());
  }, []);

  /** 把设备码复制到剪贴板,2s 后回到"复制"按钮原状 */
  async function handleCopyDeviceId() {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopiedDevice(true);
      setTimeout(() => setCopiedDevice(false), 2000);
    } catch {
      // 一些浏览器无痕模式下 clipboard API 会拒绝;兜底用 prompt 让用户自己复制
      window.prompt("复制下面这段设备码:", deviceId);
    }
  }

  /** 用另一台设备的设备码覆盖本机的 —— 服务端按 deviceId 聚合的数据立即可见 */
  function handleImportDeviceId() {
    const input = window.prompt(
      "粘入另一台设备的设备码 (替换当前本机的匿名身份,导入后那台设备的评价和菜品照片会在这里显示):",
      ""
    );
    if (!input) return;
    try {
      setDeviceId(input);
      setDeviceIdState(input.trim());
      // 给用户一个感性反馈;没有全局 toast 就用 alert 保证看得到
      alert("设备码已替换。");
    } catch (err) {
      alert(err instanceof Error ? err.message : "导入失败");
    }
  }

  // 从历史沉淀的口味建议 —— 仅在我的页面展示,点 "加入" 才真的写 tastePreferences
  const tasteSuggestions = useMemo(() => {
    if (!prefs) return [];
    return suggestTasteCandidates(prefs).filter(
      (s) => !dismissed.has(s.category)
    );
  }, [prefs, dismissed]);

  if (!prefs) return null;

  const profile = buildUserProfile(prefs);
  const budget = calculateBudget(prefs);
  const bStatus = budgetStatus(budget);
  const bPercent = budgetUsagePercent(budget);
  const notInterestedCount = Object.keys(prefs.notInterested).length;

  // 按 notedAt 倒序 —— 最近标的排最前,没有详情(老数据)的放最后
  const notInterestedList = (() => {
    const details = prefs.notInterestedDetails || {};
    const ids = Object.keys(prefs.notInterested);
    const withDetails = ids
      .map((id) => ({ id, d: details[id] }))
      .sort((a, b) => {
        const aT = a.d?.notedAt || "";
        const bT = b.d?.notedAt || "";
        return bT.localeCompare(aT);
      });
    return withDetails;
  })();

  /** "X 天前标的" 文案 —— 老记录没 notedAt 就不显示 */
  function notedAgoLabel(iso?: string): string {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 0) return "今天标的";
    if (days === 1) return "昨天标的";
    return `${days} 天前标的`;
  }

  function handleToggleTaste(taste: string) {
    if (!prefs) return;
    const current = prefs.tastePreferences;
    const next = current.includes(taste)
      ? current.filter((t) => t !== taste)
      : [...current, taste];
    const updated = updateTastePreferences(prefs, next);
    setPrefs(updated);
    savePrefs(updated);
  }

  // 点 "加入" —— 把某个建议并入 tastePreferences,并从 dismiss 集合移除 (因为已经被接受了)
  function handleAcceptSuggestion(taste: string) {
    if (!prefs) return;
    if (prefs.tastePreferences.includes(taste)) return;
    const updated = updateTastePreferences(prefs, [
      ...prefs.tastePreferences,
      taste,
    ]);
    setPrefs(updated);
    savePrefs(updated);
  }

  // 点 × —— 本次 session 内不再建议;存 sessionStorage
  function handleDismissSuggestion(taste: string) {
    const next = new Set(dismissed);
    next.add(taste);
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(next)));
    } catch {}
  }

  function handleBudgetChange(value: number) {
    if (!prefs) return;
    const updated = updateMonthlyBudget(prefs, value);
    setPrefs(updated);
    savePrefs(updated);
  }

  // 解除某一家的"不想吃" —— 那条详情记录一起清掉
  function handleRestoreNotInterested(restaurantId: string) {
    if (!prefs) return;
    const updated = unmarkNotInterested(prefs, restaurantId);
    setPrefs(updated);
    savePrefs(updated);
  }

  // 一键解除所有"不想吃" —— 带确认,避免误触
  function handleClearAllNotInterested() {
    if (!prefs) return;
    if (!window.confirm("确定要解除所有不想吃的餐厅吗?")) return;
    const updated = clearNotInterested(prefs);
    setPrefs(updated);
    savePrefs(updated);
  }

  function handleWalkChange(value: number) {
    if (!prefs) return;
    const updated = updateMaxWalkMinutes(prefs, value);
    setPrefs(updated);
    savePrefs(updated);
  }

  // —— 高级模式:权重/模式门槛 ——
  // 4 维权重:为了避免每次 drag 都全量持久化,handleXChange 直接 setPrefs + savePrefs
  // (savePrefs 本身是同步 localStorage,开销可接受)
  function handleWeightChange(field: keyof ScoringWeights, value: number) {
    if (!prefs) return;
    const current: ScoringWeights =
      prefs.scoringWeights || { taste: 30, distance: 25, budget: 20, rating: 15 };
    const next = { ...current, [field]: value };
    // 防御:若四项全 0,滑回默认 —— 这种情况下 resolveWeights 也会 fallback,
    // 但 UI 层显式还原更好理解
    if (next.taste + next.distance + next.budget + next.rating <= 0) {
      const cleared = resetScoringWeights(prefs);
      setPrefs(cleared);
      savePrefs(cleared);
      return;
    }
    const updated = updateScoringWeights(prefs, next);
    setPrefs(updated);
    savePrefs(updated);
  }

  function handleResetWeights() {
    if (!prefs) return;
    const updated = resetScoringWeights(prefs);
    setPrefs(updated);
    savePrefs(updated);
  }

  function handleModeSettingChange(field: keyof ModeSettings, value: number) {
    if (!prefs) return;
    const current: ModeSettings =
      prefs.modeSettings || { diceMaxAttempts: 3, listModeCap: 6 };
    const updated = updateModeSettings(prefs, { ...current, [field]: value });
    setPrefs(updated);
    savePrefs(updated);
  }

  function handleResetModeSettings() {
    if (!prefs) return;
    const updated = resetModeSettings(prefs);
    setPrefs(updated);
    savePrefs(updated);
  }

  // 高级解锁展开态 —— 默认收起,避免非高级用户看到一大片 disabled 区块
  return (
    <main className="min-h-screen bg-cream pb-safe animate-fade-in">
      {/* Header */}
      <div className="px-4 pt-14 pb-4">
        <h1 className="text-2xl font-bold text-secondary">我的</h1>
      </div>

      <div className="px-4 space-y-4">
        {/* Avatar area */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-deep-red to-deep-red-dark flex items-center justify-center">
            <User className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-secondary">小桃</h2>
            <p className="text-sm text-muted">吃货一枚</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-3">
          <div className="flex-1 bg-white rounded-2xl p-3 shadow-card text-center">
            <p className="text-2xl font-bold text-secondary">{profile.totalMeals}</p>
            <p className="text-xs text-muted">总餐数</p>
          </div>
          <div className="flex-1 bg-white rounded-2xl p-3 shadow-card text-center">
            <p className="text-2xl font-bold text-secondary">{prefs.favorites.length}</p>
            <p className="text-xs text-muted">收藏数</p>
          </div>
        </div>

        {/* Taste Preferences — pill tags */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <div className="flex items-center gap-2 mb-3">
            <Utensils className="w-5 h-5 text-deep-red" />
            <span className="font-medium text-secondary">口味偏好</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_TASTE_TAGS.map((taste) => {
              const selected = prefs.tastePreferences.includes(taste);
              return (
                <button
                  key={taste}
                  onClick={() => handleToggleTaste(taste)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    selected
                      ? "bg-deep-red text-white shadow-sm"
                      : "bg-gray-100 text-muted hover:bg-gray-200"
                  }`}
                >
                  {taste}
                </button>
              );
            })}
          </div>

          {/* 基于历史足迹的口味建议 —— 用户必须确认才会写入 */}
          {tasteSuggestions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-gold" />
                <span className="text-xs text-muted">
                  根据你去过的餐厅推荐 · 点「加入」确认后才会更新偏好
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tasteSuggestions.map((s) => (
                  <div
                    key={s.category}
                    className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-deep-red/40 bg-deep-red/5 text-sm"
                  >
                    <span className="text-secondary font-medium">{s.category}</span>
                    <span className="text-xs text-muted">×{s.count}</span>
                    <button
                      onClick={() => handleAcceptSuggestion(s.category)}
                      className="ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-deep-red text-white text-xs font-medium hover:bg-deep-red-dark transition-colors"
                      aria-label={`加入 ${s.category} 到口味偏好`}
                    >
                      <Plus className="w-3 h-3" />
                      加入
                    </button>
                    <button
                      onClick={() => handleDismissSuggestion(s.category)}
                      className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-muted hover:bg-gray-200 transition-colors"
                      aria-label={`忽略 ${s.category} 的建议`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Monthly Budget */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-gold" />
              <span className="font-medium text-secondary">月度预算</span>
            </div>
            <span className="text-deep-red font-bold text-lg">¥{prefs.monthlyBudget}</span>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-gold to-deep-red rounded-full transition-all"
              style={{ width: `${Math.min(100, bPercent)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>已花 ¥{budget.spentThisMonth}</span>
            <span className={bStatus.color + " font-medium"}>{bStatus.label}</span>
          </div>
          <input
            type="range"
            min={500}
            max={8000}
            step={100}
            value={prefs.monthlyBudget}
            onChange={(e) => handleBudgetChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-deep-red mt-3"
          />
          <div className="flex justify-between text-xs text-muted mt-1">
            <span>¥500</span>
            <span>每日约 ¥{Math.round(prefs.monthlyBudget / 30)}</span>
            <span>¥8000</span>
          </div>
        </div>

        {/* Walking Distance */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Footprints className="w-5 h-5 text-deep-red" />
              <span className="font-medium text-secondary">步行距离</span>
            </div>
            <span className="text-deep-red font-bold">{prefs.maxWalkMinutes}分钟</span>
          </div>
          <input
            type="range"
            min={5}
            max={60}
            step={5}
            value={prefs.maxWalkMinutes}
            onChange={(e) => handleWalkChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-deep-red"
          />
          <div className="flex justify-between text-xs text-muted mt-1">
            <span>5分钟</span>
            <span>约 {Math.round(prefs.maxWalkMinutes * 80)}米</span>
            <span>60分钟</span>
          </div>
        </div>

        {/* Not Interested List —— 可展开管理 */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <button
            type="button"
            onClick={() => setShowNotInterested((v) => !v)}
            className="w-full flex items-center justify-between"
            aria-expanded={showNotInterested}
          >
            <div className="flex items-center gap-2">
              <Ban className="w-5 h-5 text-muted" />
              <span className="font-medium text-secondary">最近不想吃</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">{notInterestedCount} 家</span>
              {showNotInterested ? (
                <ChevronUp className="w-4 h-4 text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted" />
              )}
            </div>
          </button>
          <p className="text-xs text-muted mt-1 text-left">
            标记"不想吃"的餐厅 7 天内不再推荐
          </p>

          {showNotInterested && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              {notInterestedList.length === 0 && (
                <p className="text-sm text-muted text-center py-4">
                  还没有标记过"不想吃"的餐厅
                </p>
              )}

              {notInterestedList.map(({ id, d }) => {
                const name = d?.restaurantName || "未命名餐厅";
                const category = d?.category || "";
                const img =
                  d?.heroImage ||
                  (category ? getImageForCategory(category) : undefined);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 py-2"
                  >
                    {img ? (
                      <img
                        src={img}
                        alt={name}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-gray-100"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center">
                        <Ban className="w-5 h-5 text-muted" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-secondary truncate">
                        {name}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {category}
                        {category && d?.notedAt ? " · " : ""}
                        {notedAgoLabel(d?.notedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreNotInterested(id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-100 text-xs text-secondary hover:bg-gray-200 active:bg-gray-300 flex-shrink-0"
                      aria-label="解除不想吃"
                    >
                      <RotateCcw className="w-3 h-3" />
                      恢复
                    </button>
                  </div>
                );
              })}

              {notInterestedList.length > 1 && (
                <button
                  type="button"
                  onClick={handleClearAllNotInterested}
                  className="w-full mt-2 py-2 rounded-lg text-sm text-deep-red border border-deep-red/20 hover:bg-deep-red/5 active:bg-deep-red/10"
                >
                  全部解除
                </button>
              )}
            </div>
          )}
        </div>

        {/* —— 设备码 (方案 A · 匿名身份) —— */}
        {/* 点评和菜品照片按 deviceId 归属于这台设备;换机复制一下设备码就能把数据带过去 */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-deep-red" />
              <span className="font-medium text-secondary">设备码</span>
            </div>
            <button
              type="button"
              onClick={() => setShowDeviceIdFull((v) => !v)}
              className="text-xs text-muted underline"
            >
              {showDeviceIdFull ? "收起" : "查看完整"}
            </button>
          </div>
          <p className="text-xs text-muted mb-3 leading-relaxed">
            这是你在这台设备上的匿名身份。写的点评 / 传的菜品照片都挂在这个码上。
            换手机或清浏览器前,复制出来存好;新设备 profile 页点"导入设备码"粘进去,数据即刻回来。
          </p>
          <div className="bg-cream rounded-lg px-3 py-2 mb-2">
            <code className="text-xs text-secondary break-all">
              {showDeviceIdFull
                ? deviceId
                : deviceId
                  ? `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`
                  : "生成中…"}
            </code>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyDeviceId}
              disabled={!deviceId}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-deep-red text-white text-xs font-medium active:scale-95 disabled:opacity-40"
            >
              {copiedDevice ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  复制设备码
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleImportDeviceId}
              className="flex-1 py-2 rounded-lg bg-cream text-secondary text-xs font-medium active:scale-95 border border-gray-200"
            >
              导入设备码
            </button>
          </div>
        </div>

        {/* —— 高级模式:推荐权重 / 模式门槛 —— */}
        {/* 入口:一张卡,展开后露出权重滑杆和模式门槛。没解锁时展开区变灰 + 提示还差几天 */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between"
            aria-expanded={showAdvanced}
          >
            <div className="flex items-center gap-2">
              {prefs.advancedUnlocked ? (
                <Unlock className="w-5 h-5 text-deep-red" />
              ) : (
                <Lock className="w-5 h-5 text-muted" />
              )}
              <span className="font-medium text-secondary">高级设置</span>
              {prefs.advancedUnlocked && (
                <span className="px-1.5 py-0.5 rounded-full bg-gold-light text-gold text-[10px] font-medium">
                  已解锁
                </span>
              )}
            </div>
            {showAdvanced ? (
              <ChevronUp className="w-4 h-4 text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted" />
            )}
          </button>
          <p className="text-xs text-muted mt-1 text-left">
            {prefs.advancedUnlocked
              ? "调推荐权重、改模式门槛 —— 让推荐更像你"
              : `累计打开 3 天后解锁(目前 ${prefs.consecutiveDays} 天)`}
          </p>

          {showAdvanced && (
            <div
              className={`mt-3 pt-3 border-t border-gray-100 space-y-5 ${
                prefs.advancedUnlocked ? "" : "opacity-40 pointer-events-none select-none"
              }`}
              aria-disabled={!prefs.advancedUnlocked}
            >
              {/* —— 推荐权重滑杆 —— */}
              {(() => {
                const sw: ScoringWeights =
                  prefs.scoringWeights || {
                    taste: 30,
                    distance: 25,
                    budget: 20,
                    rating: 15,
                  };
                const pct = weightPercentages(prefs.scoringWeights);
                const weightRow = (
                  key: keyof ScoringWeights,
                  label: string,
                  pctValue: number
                ) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-secondary">{label}</span>
                      <span className="text-xs text-muted">
                        权重 {sw[key]} · 实际占比 {pctValue}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={sw[key]}
                      onChange={(e) => handleWeightChange(key, Number(e.target.value))}
                      disabled={!prefs.advancedUnlocked}
                      className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-deep-red"
                    />
                  </div>
                );
                return (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-deep-red" />
                        <span className="text-sm font-medium text-secondary">
                          推荐打分权重
                        </span>
                      </div>
                      {prefs.scoringWeights && (
                        <button
                          type="button"
                          onClick={handleResetWeights}
                          className="flex items-center gap-1 text-xs text-muted hover:text-secondary"
                        >
                          <RotateCcw className="w-3 h-3" />
                          恢复默认
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {weightRow("taste", "口味", pct.taste)}
                      {weightRow("distance", "距离", pct.distance)}
                      {weightRow("budget", "预算", pct.budget)}
                      {weightRow("rating", "评分", pct.rating)}
                    </div>
                    <p className="text-[11px] text-muted mt-2">
                      系统按比例归一 · 避重复 (新鲜度) 固定占 10%
                    </p>
                  </div>
                );
              })()}

              {/* —— 模式门槛 —— */}
              {(() => {
                const ms: ModeSettings =
                  prefs.modeSettings || { diceMaxAttempts: 3, listModeCap: 6 };
                return (
                  <div className="pt-4 border-t border-dashed border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-secondary">
                        模式门槛
                      </span>
                      {prefs.modeSettings && (
                        <button
                          type="button"
                          onClick={handleResetModeSettings}
                          className="flex items-center gap-1 text-xs text-muted hover:text-secondary"
                        >
                          <RotateCcw className="w-3 h-3" />
                          恢复默认
                        </button>
                      )}
                    </div>

                    {/* 骰子最大次数 */}
                    <div className="space-y-1 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5">
                          <Dice5 className="w-4 h-4 text-gold" />
                          <span className="text-secondary">骰子抽选次数</span>
                        </div>
                        <span className="text-xs text-muted">
                          最多 {ms.diceMaxAttempts} 次
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={ms.diceMaxAttempts}
                        onChange={(e) =>
                          handleModeSettingChange(
                            "diceMaxAttempts",
                            Number(e.target.value)
                          )
                        }
                        disabled={!prefs.advancedUnlocked}
                        className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-deep-red"
                      />
                      <div className="flex justify-between text-[11px] text-muted">
                        <span>1 次</span>
                        <span>6 次</span>
                      </div>
                    </div>

                    {/* 列表模式显示家数 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5">
                          <ListIcon className="w-4 h-4 text-deep-red" />
                          <span className="text-secondary">列表模式显示家数</span>
                        </div>
                        <span className="text-xs text-muted">
                          {ms.listModeCap} 家
                        </span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={12}
                        step={1}
                        value={ms.listModeCap}
                        onChange={(e) =>
                          handleModeSettingChange(
                            "listModeCap",
                            Number(e.target.value)
                          )
                        }
                        disabled={!prefs.advancedUnlocked}
                        className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-deep-red"
                      />
                      <div className="flex justify-between text-[11px] text-muted">
                        <span>3 家</span>
                        <span>12 家</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Bottom spacer */}
        <div className="h-4" />
      </div>
    </main>
  );
}
