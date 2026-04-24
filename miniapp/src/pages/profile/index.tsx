import { View, Text } from "@tarojs/components";
import "./index.scss";

/**
 * 我的页面 stub (M4.1)
 *
 * M4.4 会实现真正的内容:
 *  - 口味偏好标签选择
 *  - 月预算 / 步行上限滑杆
 *  - 不想吃清单管理
 *  - 高级设置 (推荐权重 / 模式门槛)
 *  - 设备码 (方案 A 匿名身份) 卡片 —— 支持复制 / 导入
 */
export default function Profile() {
  return (
    <View className="page page--profile">
      <View className="page__header">
        <Text className="page__title">我的</Text>
      </View>
      <View className="page__placeholder">
        <Text className="placeholder__emoji">👤</Text>
        <Text className="placeholder__title">设置还没搬过来</Text>
        <Text className="placeholder__desc">M4.4 阶段会补齐口味偏好 / 预算 / 高级设置等</Text>
      </View>
    </View>
  );
}
