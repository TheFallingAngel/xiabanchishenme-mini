"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X, ImagePlus, Loader2 } from "lucide-react";
import { submitReview, uploadReviewImage } from "@/lib/reviews";
import type { ReviewRecord } from "@/lib/types";

/**
 * 写评价底部弹层。
 *
 * 流程:
 *   1. 没昵称 → 先填昵称 (一次性,之后复用)
 *   2. 有昵称 → 星级 + 文字 + 图片 → 提交
 *
 * 交互细节:
 *   · 打开时默认焦点在文本框 (有昵称) 或昵称输入框 (首次)
 *   · 图片上传边传边显示缩略图,失败单独提示不阻塞其他已传的
 *   · 提交中 disable 所有按钮,避免双击
 */
export function ReviewForm({
  open,
  restaurantId,
  nickname,
  onClose,
  onSubmitted,
  onNicknameSet,
}: {
  open: boolean;
  restaurantId: string;
  nickname: string | undefined;
  onClose: () => void;
  onSubmitted: (review: ReviewRecord) => void;
  onNicknameSet: (nickname: string) => void;
}) {
  // —— 昵称阶段 ——
  const needNickname = !nickname;
  const [nicknameDraft, setNicknameDraft] = useState("");

  // —— 评价表单阶段 ——
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 每次重新打开重置表单 (昵称不清)
  useEffect(() => {
    if (open) {
      setRating(0);
      setText("");
      setImages([]);
      setError(null);
      setNicknameDraft("");
    }
  }, [open]);

  async function handleSubmitNickname() {
    const nick = nicknameDraft.trim();
    if (nick.length < 1 || nick.length > 12) {
      setError("昵称 1-12 个字");
      return;
    }
    setError(null);
    onNicknameSet(nick);
  }

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 4 - images.length;
    const toUpload = Array.from(files).slice(0, remaining);

    setUploading(true);
    setError(null);

    for (const f of toUpload) {
      try {
        const url = await uploadReviewImage(f);
        setImages((prev) => [...prev, url]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "图片上传失败");
      }
    }

    setUploading(false);
    // reset input 以便重复选同一张
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((u) => u !== url));
  }

  async function handleSubmit() {
    if (!nickname) {
      setError("先填个昵称");
      return;
    }
    if (rating < 1 || rating > 5) {
      setError("打个分吧,1-5 星");
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText && images.length === 0) {
      setError("写一句话或者传张图,总要留点什么");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const review = await submitReview(restaurantId, {
        nickname,
        rating,
        text: trimmedText,
        imageUrls: images,
      });
      onSubmitted(review);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            key="mask"
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* 底部抽屉 */}
          <motion.div
            key="sheet"
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-primary">
                {needNickname ? "先填个昵称" : "写评价"}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1 -mr-1 text-muted hover:text-secondary"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              {needNickname ? (
                <>
                  <p className="text-sm text-secondary mb-3 leading-relaxed">
                    评价会显示给其他用户看。起个昵称,不用真名,随便一点也行。
                  </p>
                  <input
                    type="text"
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    maxLength={12}
                    placeholder="比如: 下班的糖醋排骨"
                    className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-primary placeholder-muted focus:outline-none focus:border-deep-red"
                    autoFocus
                  />
                  <p className="text-xs text-muted mt-1 text-right">
                    {nicknameDraft.length}/12
                  </p>
                  {error && (
                    <p className="text-sm text-red-500 mt-2">{error}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleSubmitNickname}
                    disabled={nicknameDraft.trim().length === 0}
                    className="w-full mt-4 py-3 rounded-xl bg-deep-red text-white text-sm font-medium disabled:bg-gray-200 disabled:text-muted"
                  >
                    保存昵称,继续写评价
                  </button>
                </>
              ) : (
                <>
                  {/* 昵称展示 */}
                  <p className="text-xs text-muted mb-3">
                    以 <span className="text-deep-red font-medium">{nickname}</span>{" "}
                    的身份发布
                  </p>

                  {/* 星级 */}
                  <label className="block text-sm font-medium text-primary mb-2">
                    打个分
                  </label>
                  <div className="flex items-center gap-1.5 mb-4">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRating(n)}
                        className="p-1 -m-1"
                      >
                        <Star
                          className={`w-7 h-7 transition-colors ${
                            n <= rating
                              ? "fill-gold text-gold"
                              : "text-gray-200 fill-gray-100"
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-2 text-xs text-muted">
                      {rating === 0
                        ? "点一下星星"
                        : ["", "差强人意", "一般吧", "还不错", "挺好", "下次还来"][
                            rating
                          ]}
                    </span>
                  </div>

                  {/* 文字 */}
                  <label className="block text-sm font-medium text-primary mb-2">
                    说点什么
                  </label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder="哪道菜好吃、服务怎么样、值不值 —— 两三句就够"
                    className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-primary placeholder-muted focus:outline-none focus:border-deep-red resize-none"
                  />
                  <p className="text-xs text-muted mt-1 text-right">
                    {text.length}/500
                  </p>

                  {/* 图片 */}
                  <label className="block text-sm font-medium text-primary mt-4 mb-2">
                    带张图 (可选)
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {images.map((url) => (
                      <div
                        key={url}
                        className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="上传图片"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(url)}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                          aria-label="删除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {images.length < 4 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-20 h-20 rounded-lg border border-dashed border-gray-300 text-muted flex flex-col items-center justify-center gap-1 hover:border-deep-red hover:text-deep-red disabled:opacity-50"
                      >
                        {uploading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <ImagePlus className="w-5 h-5" />
                            <span className="text-[10px]">
                              {images.length}/4
                            </span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImagePick}
                  />

                  {error && (
                    <p className="text-sm text-red-500 mt-3">{error}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || uploading}
                    className="w-full mt-5 py-3 rounded-xl bg-deep-red text-white text-sm font-medium disabled:bg-gray-200 disabled:text-muted flex items-center justify-center gap-2"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {submitting ? "发布中..." : "发布评价"}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
