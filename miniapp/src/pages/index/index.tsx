import { useEffect, useState } from "react";
import { View, Text, ScrollView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { request, type RequestError } from "@/lib/request";
import type { Restaurant } from "@shared/types";
import "./index.scss";

/**
 * 首页 M3 版本 —— 最小实现,只为验证:
 *   1. Taro 编译到 weapp 能跑
 *   2. wx.cloud.callContainer 能调通云托管后端
 *   3. shared/ 下的 TypeScript 类型能 import
 *
 * M4 会真正实现骰子卡片 / 列表 / 模式切换等产品交互。
 */

interface RestaurantsResponse {
  restaurants: Restaurant[];
  mock?: boolean;
}

// 默认定位:珠江新城 (广州),只是为了让 M3 stub 能跑;
// M4 会接入 wx.getLocation 拿用户真实坐标
const DEFAULT_LNG = 113.32;
const DEFAULT_LAT = 23.12;

export default function Index() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    fetchRestaurants();
  }, []);

  async function fetchRestaurants() {
    setLoading(true);
    setErrMsg(null);
    try {
      const data = await request<RestaurantsResponse>({
        path: "/api/restaurants",
        method: "GET",
        query: {
          lng: DEFAULT_LNG,
          lat: DEFAULT_LAT,
          maxWalkMinutes: 25,
          radius: 2000,
        },
        timeout: 20000,
      });
      setRestaurants(data.restaurants ?? []);
      setIsMock(!!data.mock);
    } catch (e) {
      const err = e as RequestError;
      console.error("[首页] /api/restaurants 失败", err);
      setErrMsg(err.message || "网络请求失败,稍后重试");
      Taro.showToast({ title: "加载失败", icon: "none" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="home">
      <View className="home__header">
        <Text className="home__title">下班吃什么</Text>
        {isMock && <Text className="home__badge">演示数据</Text>}
      </View>

      <View className="home__subtitle">
        <Text>M3 验证页 · 调云托管后端</Text>
      </View>

      {loading && (
        <View className="home__loading">
          <Text>加载中…</Text>
        </View>
      )}

      {errMsg && (
        <View className="home__error">
          <Text>{errMsg}</Text>
        </View>
      )}

      {!loading && !errMsg && (
        <ScrollView scrollY className="home__list">
          <View className="home__count">
            拉到 {restaurants.length} 家餐厅
          </View>
          {restaurants.map((r) => (
            <View key={r.id} className="card">
              <View className="card__name">{r.name}</View>
              <View className="card__meta">
                <Text>{r.category}</Text>
                {r.avgPrice > 0 && <Text> · ¥{r.avgPrice}/人</Text>}
                {r.walkMinutes > 0 && <Text> · 步行 {r.walkMinutes} 分钟</Text>}
                {r.rating > 0 && <Text> · ⭐ {r.rating}</Text>}
              </View>
              {r.poiTag && (
                <View className="card__tags">{r.poiTag.slice(0, 60)}</View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
