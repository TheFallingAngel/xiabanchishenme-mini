import Taro from "@tarojs/taro";

/**
 * 全局反馈工具 —— 把 Taro.showToast / showLoading 的调用统一封装,
 * 后续改样式 / 接入自定义 toast 组件只改这一处。
 *
 * 和 H5 那边 showToast(...) 的语义尽量对齐,方便 shared lib 未来抽象。
 */

/** 成功提示 —— 绿色对勾 2s */
export function toastSuccess(title: string, duration = 1500): void {
  Taro.showToast({
    title: title.slice(0, 14), // 小程序 toast 文案最长 14 个汉字左右,超了会被吞
    icon: "success",
    duration,
    mask: false,
  });
}

/** 失败提示 —— 无图标,纯文字,提醒用户但不挡操作 */
export function toastError(title: string, duration = 2000): void {
  Taro.showToast({
    title: title.slice(0, 14),
    icon: "none",
    duration,
    mask: false,
  });
}

/** 中性提示 —— 无图标,用于"已删除"/"已恢复"这类动作反馈 */
export function toastInfo(title: string, duration = 1500): void {
  Taro.showToast({
    title: title.slice(0, 14),
    icon: "none",
    duration,
    mask: false,
  });
}

/** 显示 loading,返回一个关闭函数 (防忘记 hideLoading) */
export function showLoading(title = "加载中"): () => void {
  Taro.showLoading({ title, mask: true });
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    Taro.hideLoading();
  };
}

/** 弹确认对话框,返回 true/false */
export function confirm(opts: {
  title?: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.showModal({
      title: opts.title,
      content: opts.content,
      confirmText: opts.confirmText || "确定",
      cancelText: opts.cancelText || "取消",
      confirmColor: opts.confirmColor || "#C54141",
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
}
