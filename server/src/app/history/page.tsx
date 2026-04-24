"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  UtensilsCrossed,
  ChefHat,
  Pencil,
  X,
  Check,
  Trash2,
} from "lucide-react";
import type { HistoryRecord } from "@/lib/types";
import {
  loadPrefs,
  savePrefs,
  updateHistoryAmount,
  removeHistoryRecord,
} from "@/lib/storage";
import { getImageForCategory } from "@/lib/images";
import { MOCK_RESTAURANTS } from "@/lib/mock-data";

/** YYYY-MM 字符串;"all" 表示不过滤 */
type MonthFilter = string;

function formatMonthLabel(m: MonthFilter): string {
  if (m === "all") return "全部月份";
  const [y, mo] = m.split("-");
  return `${y} 年 ${Number(mo)} 月`;
}

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  // 快速编辑金额抽屉
  const [editing, setEditing] = useState<HistoryRecord | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // 删除二次确认的 "待删" key —— 点第一次进入危险态,点第二次才真删
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);

  // 日历筛选 —— 点右上角日历打开;默认当月
  const [monthFilter, setMonthFilter] = useState<MonthFilter>(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  useEffect(() => {
    const prefs = loadPrefs();
    setHistory(prefs.history.filter((h) => h.action === "ate_today"));
  }, []);

  // 从所有 history 里摘 YYYY-MM 列表,作为 picker 选项;倒序 (新的在上)
  const availableMonths = useMemo<MonthFilter[]>(() => {
    const set = new Set<string>();
    for (const h of history) {
      const m = h.date.slice(0, 7);
      if (m) set.add(m);
    }
    const arr = Array.from(set).sort().reverse();
    // 确保当前月即使没记录也出现在列表上,方便切换回来看本月
    const thisMonth = new Date().toISOString().slice(0, 7);
    if (!arr.includes(thisMonth)) arr.unshift(thisMonth);
    return arr;
  }, [history]);

  // 筛选后的记录
  const filteredRecords = useMemo(
    () =>
      monthFilter === "all"
        ? history
        : history.filter((h) => h.date.startsWith(monthFilter)),
    [history, monthFilter]
  );

  // 当期 stats —— 基于筛选后的月份,而不是硬编码当月
  const periodLabel = formatMonthLabel(monthFilter);
  const totalMeals = filteredRecords.length;
  const totalSpent = filteredRecords.reduce(
    (sum, h) => sum + (h.amount || 0),
    0
  );
  const uniqueRestaurants = new Set(
    filteredRecords.map((h) => h.restaurantId)
  ).size;

  // MOCK_RESTAURANTS 里找对应店的人均,作为快速编辑的默认值
  const suggestedByRestaurant = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const r of MOCK_RESTAURANTS) map[r.id] = r.avgPrice;
    return map;
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }

  function openEdit(rec: HistoryRecord) {
    const suggested =
      rec.amount && rec.amount > 0
        ? String(rec.amount)
        : suggestedByRestaurant[rec.restaurantId]
          ? String(suggestedByRestaurant[rec.restaurantId])
          : "";
    setAmountStr(suggested);
    setEditing(rec);
  }

  function handleConfirmEdit() {
    if (!editing) return;
    const raw = amountStr.trim();
    const n = raw === "" ? undefined : Number(raw);
    if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 9999)) {
      showToast("请输入 0 - 9999 的金额");
      return;
    }
    const prefs = loadPrefs();
    const nextPrefs = updateHistoryAmount(prefs, editing.restaurantId, editing.date, n);
    savePrefs(nextPrefs);
    setHistory(nextPrefs.history.filter((h) => h.action === "ate_today"));
    setEditing(null);
    showToast(n !== undefined ? `已更新为 ¥${n}` : "已清空金额");
  }

  /**
   * 删除一条足迹 —— 用户手一抖点错了某家,或想清掉旧数据。
   * 为了避免误删,我们做两阶段确认: 第一次点变红 "再点一次删除",
   * 3 秒后自动撤销; 二次点才真删。
   */
  function handleDelete() {
    if (!editing) return;
    const key = `${editing.restaurantId}__${editing.date}`;
    if (pendingDeleteKey !== key) {
      setPendingDeleteKey(key);
      showToast("再点一次即删除");
      // 3 秒内不点就自动退出危险态,避免下次打开仍处于"待删"误伤
      setTimeout(() => {
        setPendingDeleteKey((cur) => (cur === key ? null : cur));
      }, 3000);
      return;
    }
    const prefs = loadPrefs();
    const nextPrefs = removeHistoryRecord(
      prefs,
      editing.restaurantId,
      editing.date
    );
    savePrefs(nextPrefs);
    setHistory(nextPrefs.history.filter((h) => h.action === "ate_today"));
    setEditing(null);
    setPendingDeleteKey(null);
    showToast("已删除这条足迹");
  }

  return (
    <main className="min-h-screen bg-cream pb-safe animate-fade-in">
      {/* Header */}
      <div className="px-4 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-secondary">足迹</h1>
          <button
            type="button"
            onClick={() => setMonthPickerOpen(true)}
            className="flex items-center gap-1.5 text-xs text-deep-red px-2.5 py-1.5 rounded-full border border-deep-red/40 bg-white active:scale-95"
            aria-label="选择月份"
          >
            <CalendarDays className="w-4 h-4" />
            {periodLabel}
          </button>
        </div>
      </div>

      <div className="px-4">
        {/* Stats row — 3 blocks */}
        <div className="flex gap-3 mb-5">
          <div className="flex-1 bg-white rounded-2xl p-3 shadow-card text-center">
            <p className="text-2xl font-bold text-secondary">{totalMeals}</p>
            <p className="text-xs text-muted">总餐数</p>
          </div>
          <div className="flex-1 bg-white rounded-2xl p-3 shadow-card text-center">
            <p className="text-2xl font-bold text-secondary">
              {totalSpent > 0 ? `¥${totalSpent}` : "--"}
            </p>
            <p className="text-xs text-muted">总花费</p>
          </div>
          <div className="flex-1 bg-white rounded-2xl p-3 shadow-card text-center">
            <p className="text-2xl font-bold text-secondary">{uniqueRestaurants}</p>
            <p className="text-xs text-muted">去过的店</p>
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-4">
              <ChefHat className="w-10 h-10 text-deep-red/40" />
            </div>
            <h2 className="text-lg font-semibold text-secondary mb-2">
              {history.length === 0 ? "还没有记录" : `${periodLabel}没有记录`}
            </h2>
            <p className="text-sm text-muted mb-6">
              {history.length === 0
                ? '在推荐页点击"今天去了"开始记录'
                : "换个月份,或者去推荐页开始记录"}
            </p>
            <button
              onClick={() => router.push("/")}
              className="bg-deep-red text-white px-6 py-2.5 rounded-xl text-sm font-medium shadow-card active:scale-95 transition-transform"
            >
              去挑选餐厅
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecords.map((record) => {
              const key = `${record.restaurantId}__${record.date}`;
              const hasAmount = !!record.amount && record.amount > 0;
              return (
                <div
                  key={key}
                  className="w-full flex items-center gap-3 bg-white rounded-xl px-3 py-3 shadow-card border border-gray-50"
                >
                  {/* 左:点缩略图 / 文字跳详情 */}
                  <button
                    type="button"
                    onClick={() => router.push(`/restaurant/${record.restaurantId}`)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-80"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      <img
                        src={record.heroImage || getImageForCategory(record.category)}
                        alt={record.restaurantName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-secondary text-sm truncate">
                        {record.restaurantName}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {new Date(record.date).toLocaleDateString("zh-CN", {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </button>

                  {/* 右:金额徽章,点开抽屉直接改 */}
                  <button
                    type="button"
                    onClick={() => openEdit(record)}
                    className={
                      hasAmount
                        ? "text-sm font-medium text-deep-red px-2 py-1 rounded-full border border-deep-red/30 active:scale-95 flex items-center gap-1"
                        : "text-xs text-muted px-2 py-1 rounded-full border border-dashed border-gray-300 active:scale-95 flex items-center gap-1"
                    }
                    aria-label="编辑已花金额"
                  >
                    {hasAmount ? (
                      <>¥{record.amount}</>
                    ) : (
                      <>
                        <Pencil className="w-3 h-3" />
                        记一笔
                      </>
                    )}
                  </button>
                </div>
              );
            })}

            {/* Highlight card */}
            <div className="bg-[#FFF8F0] rounded-2xl p-4 border border-orange-100/60 flex items-center gap-3">
              <UtensilsCrossed className="w-8 h-8 text-gold/60" />
              <div>
                <p className="text-sm font-medium text-secondary">你的美食足迹</p>
                <p className="text-xs text-muted">
                  {periodLabel}已探索 {uniqueRestaurants} 家餐厅
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 编辑金额抽屉 —— z-[60] 盖过 BottomNav 的 z-50,不然按钮会被 tab 条吃掉 */}
      {editing && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] animate-fade-in"
          onClick={() => {
            setEditing(null);
            setPendingDeleteKey(null);
          }}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 max-w-[393px] mx-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-secondary">
                改金额 · {editing.restaurantName}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setPendingDeleteKey(null);
                }}
                className="w-8 h-8 flex items-center justify-center text-muted active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted mb-4">
              {new Date(editing.date).toLocaleDateString("zh-CN", {
                month: "short",
                day: "numeric",
              })}{" "}
              · 改完会即时更新上方统计 / 首页预算条。留空表示不计金额。
            </p>

            <div className="flex items-center gap-2 bg-cream rounded-xl px-3 py-3 mb-4">
              <span className="text-lg font-semibold text-deep-red">¥</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                autoFocus
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={
                  suggestedByRestaurant[editing.restaurantId]
                    ? `默认人均 ${suggestedByRestaurant[editing.restaurantId]}`
                    : "0"
                }
                className="flex-1 bg-transparent outline-none text-lg font-semibold text-secondary placeholder:text-muted/60"
              />
              {suggestedByRestaurant[editing.restaurantId] && (
                <button
                  type="button"
                  onClick={() =>
                    setAmountStr(String(suggestedByRestaurant[editing.restaurantId]))
                  }
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
                  onClick={() => setAmountStr(String(v))}
                  className="flex-1 py-1.5 text-xs rounded-full border border-gray-200 text-secondary active:scale-95"
                >
                  {v}
                </button>
              ))}
            </div>

            {/* 底部动作:删除 (二次确认) · 清空金额 · 保存
                之前"清空"独占 1/3 宽占位显眼但用得少,塞到中间的金额输入区已经足够;
                这里把位置让给"删除",因为删除才是用户真正需要在管理态下做的事 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                className={
                  pendingDeleteKey ===
                  `${editing.restaurantId}__${editing.date}`
                    ? "flex-1 py-3 rounded-xl bg-red-50 border border-red-300 text-red-600 text-sm font-semibold active:scale-95 flex items-center justify-center gap-1.5"
                    : "flex-1 py-3 rounded-xl border border-gray-200 text-muted text-sm font-medium active:scale-95 flex items-center justify-center gap-1.5"
                }
                aria-label="删除这条足迹"
              >
                <Trash2 className="w-4 h-4" />
                {pendingDeleteKey ===
                `${editing.restaurantId}__${editing.date}`
                  ? "再点确认"
                  : "删除"}
              </button>
              <button
                type="button"
                onClick={() => setAmountStr("")}
                className="px-3 py-3 rounded-xl border border-gray-200 text-muted text-xs font-medium active:scale-95"
              >
                清空金额
              </button>
              <button
                type="button"
                onClick={handleConfirmEdit}
                className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-deep-red to-deep-red-dark text-white text-sm font-bold active:scale-95 flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 月份选择抽屉 —— z-[60] 盖过 BottomNav 的 z-50,不然"全部/本月"按钮会被 tab 压住 */}
      {monthPickerOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setMonthPickerOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 max-w-[393px] mx-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-secondary">选择月份</h3>
              <button
                type="button"
                onClick={() => setMonthPickerOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-muted active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setMonthFilter("all");
                  setMonthPickerOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm active:scale-[0.99] ${
                  monthFilter === "all"
                    ? "bg-deep-red text-white border-deep-red"
                    : "bg-cream border-gray-100 text-secondary"
                }`}
              >
                全部月份
                <span className="ml-2 text-xs opacity-70">{history.length} 条</span>
              </button>
              {availableMonths.map((m) => {
                const count = history.filter((h) => h.date.startsWith(m)).length;
                const active = m === monthFilter;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMonthFilter(m);
                      setMonthPickerOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm active:scale-[0.99] ${
                      active
                        ? "bg-deep-red text-white border-deep-red"
                        : "bg-cream border-gray-100 text-secondary"
                    }`}
                  >
                    {formatMonthLabel(m)}
                    <span className="ml-2 text-xs opacity-70">{count} 条</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-black/85 text-white text-xs px-4 py-2 rounded-full shadow-card z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </main>
  );
}
