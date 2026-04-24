import { View, Text } from "@tarojs/components";
import "./index.scss";

/**
 * 足迹页面 stub (M4.1)
 *
 * M4.4 会实现真正的内容:
 *  - 近 14 天吃过 / 标记过的餐厅列表
 *  - 按日期分组
 *  - 金额编辑 / 删除
 *  - 月度花费汇总
 */
export default function History() {
  return (
    <View className="page page--history">
      <View className="page__header">
        <Text className="page__title">足迹</Text>
      </View>
      <View className="page__placeholder">
        <Text className="placeholder__emoji">👣</Text>
        <Text className="placeholder__title">还没有足迹</Text>
        <Text className="placeholder__desc">吃过一家餐厅后会出现在这里</Text>
      </View>
    </View>
  );
}
