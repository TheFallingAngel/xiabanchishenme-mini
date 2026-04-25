import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import { useRouter } from "@tarojs/taro";
import Taro from "@tarojs/taro";
import type { Restaurant } from "@shared/types";
import "./index.scss";

/**
 * 详情页 stub (M4.2 占位 / M4.3 才完整重做)
 *
 * 现在只读 sessionStorage 的 selected_restaurant 显示基础信息,
 * 让首页"看看详情" / 列表点击 / 收藏点击的导航有去处,不至于跳 404。
 *
 * M4.3 会完整迁移 H5 detail 页:头图轮播 / 招牌菜 UGC / 点评 / 地图 / LLM insight 等。
 */
export default function Restaurant() {
  const router = useRouter();
  const id = router.params?.id || "";
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  useEffect(() => {
    try {
      const raw = Taro.getStorageSync("selected_restaurant");
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed?.id === id) setRestaurant(parsed);
      }
    } catch {}
  }, [id]);

  return (
    <View className="restaurant-stub">
      <View className="restaurant-stub__hint">
        <Text className="restaurant-stub__emoji">🍴</Text>
        <Text className="restaurant-stub__title">详情页 M4.3 重做中</Text>
        <Text className="restaurant-stub__desc">
          已经收到这家:{restaurant?.name || id}
        </Text>
      </View>
    </View>
  );
}
