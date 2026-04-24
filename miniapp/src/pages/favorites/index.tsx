import { View, Text } from "@tarojs/components";
import "./index.scss";

/**
 * 收藏页面 stub (M4.1)
 *
 * M4.4 会实现真正的内容:
 *  - 已收藏的餐厅列表 (favoriteDetails 本地 + 云托管余量拉取)
 *  - 顶部真实搜索框
 *  - 点卡片跳详情 / 长按取消收藏
 */
export default function Favorites() {
  return (
    <View className="page page--favorites">
      <View className="page__header">
        <Text className="page__title">收藏</Text>
      </View>
      <View className="page__placeholder">
        <Text className="placeholder__emoji">❤️</Text>
        <Text className="placeholder__title">还没有收藏</Text>
        <Text className="placeholder__desc">点首页卡片右上的 ♡ 可以收藏</Text>
      </View>
    </View>
  );
}
