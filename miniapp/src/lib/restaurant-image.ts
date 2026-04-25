/**
 * 餐厅图片选择 + 分类占位 emoji。
 *
 * H5 那边有更精细的 image-tag 机制 (AI 打标 + 七种用途选图,L1 内存 / L2 localStorage 缓存),
 * 小程序 M4.2 简化为:有 photos[0] 用,没有就 emoji 占位 (按 category 推断)。
 *
 * 后续 M5 如果需要 AI 打标,会单独把 image-tag-client.ts 也搬过来,这里再升级。
 */

/** 简单的"看 category 选 emoji"映射表,覆盖 90% 的场景 */
const CATEGORY_EMOJI_MAP: Array<{ keys: string[]; emoji: string }> = [
  { keys: ["川菜", "四川", "蜀", "麻辣"], emoji: "🌶️" },
  { keys: ["粤菜", "广东", "茶餐厅", "港式", "潮汕", "顺德"], emoji: "🍜" },
  { keys: ["湘菜", "湖南"], emoji: "🥘" },
  { keys: ["日料", "日本", "寿司", "刺身", "拉面", "居酒屋", "和食"], emoji: "🍣" },
  { keys: ["韩餐", "韩国", "韩式", "石锅", "炸鸡"], emoji: "🍲" },
  { keys: ["西餐", "意大利", "法式", "牛排", "披萨", "pizza", "pasta"], emoji: "🍝" },
  { keys: ["火锅", "串串", "冒菜", "麻辣烫"], emoji: "🍲" },
  { keys: ["烧烤", "烤肉", "BBQ", "烤串"], emoji: "🍗" },
  { keys: ["快餐", "汉堡", "麦当劳", "肯德基", "kfc"], emoji: "🍔" },
  { keys: ["海鲜", "鱼", "虾", "蟹", "贝", "生蚝"], emoji: "🦐" },
  { keys: ["东南亚", "泰国", "越南", "新加坡", "咖喱", "冬阴功"], emoji: "🍛" },
  { keys: ["面食", "面", "拉面", "兰州", "刀削", "馄饨", "饺子"], emoji: "🍜" },
  { keys: ["小吃", "包点", "点心"], emoji: "🥟" },
  { keys: ["咖啡", "coffee", "茶", "tea", "饮品"], emoji: "☕" },
  { keys: ["甜品", "蛋糕", "面包", "烘焙", "dessert"], emoji: "🍰" },
];

/** 给一个分类 (含 poiType 多段或 category 单段),返回最贴切的 emoji,兜底"🍽️" */
export function emojiForCategory(category: string, poiType?: string): string {
  const haystack = `${category || ""} ${poiType || ""}`.toLowerCase();
  for (const { keys, emoji } of CATEGORY_EMOJI_MAP) {
    if (keys.some((k) => haystack.includes(k.toLowerCase()))) return emoji;
  }
  return "🍽️";
}

/**
 * 选餐厅图:
 *   1. photos[0] 优先 (高德 POI 自带的 banner)
 *   2. 没有则返回 null,UI 渲染时用 emoji 占位 + 暖渐变背景
 */
export function pickHeroImage(photos?: string[]): string | null {
  if (!photos || photos.length === 0) return null;
  return photos[0];
}

/** gallery (店内实景 / 多图轮播) 的图,M4.2 不用,留位 */
export function pickGalleryImages(photos?: string[]): string[] {
  if (!photos || photos.length === 0) return [];
  return photos.slice(0, 6);
}
