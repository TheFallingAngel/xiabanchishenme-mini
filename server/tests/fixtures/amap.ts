/**
 * 高德 API 响应固定桩 —— L2 路由测试喂给 fetch mock。
 *
 * 覆盖:
 *   - /v3/place/around       : searchRestaurants (成功 / 空 / 错误)
 *   - /v3/direction/walking  : getWalkingTime
 *   - /v3/place/detail       : getPoiDetail
 *   - /v3/assistant/inputtips: /api/location/search
 *   - /v3/geocode/regeo      : 逆地理 + adcode 查询
 *   - /v3/weather/weatherInfo: 天气
 */

/** 造 N 条高德 POI,附带上 biz_ext。 */
export function makeAmapPoi(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `B0FF${String(i).padStart(4, "0")}`,
    name: `测试店 ${i}`,
    type: "餐饮服务;中餐厅",
    address: `北京路 ${i} 号`,
    biz_ext: { cost: String(30 + i), rating: (4 + (i % 5) * 0.1).toFixed(1) },
    tel: `1008${6 + i}`,
    photos: [{ url: `https://amap-pic.test/${i}.jpg` }],
    location: `${(113.325 + i * 0.001).toFixed(3)},${(23.125 + i * 0.0005).toFixed(4)}`,
    distance: String(200 + i * 50),
  }));
}

export const amapSearchOk = (n = 5) => ({
  status: "1",
  info: "OK",
  count: String(n),
  pois: makeAmapPoi(n),
});

export const amapSearchEmpty = {
  status: "1",
  info: "OK",
  count: "0",
  pois: [],
};

export const amapSearchInvalidKey = {
  status: "0",
  info: "INVALID_USER_KEY",
  infocode: "10001",
};

export const amapWalkingOk = (durationSec: number) => ({
  status: "1",
  info: "OK",
  route: { paths: [{ duration: String(durationSec) }] },
});

export const amapPoiDetailOk = (id: string) => ({
  status: "1",
  info: "OK",
  pois: [
    {
      id,
      name: "湘村小馆",
      type: "餐饮服务;中餐厅",
      address: "北京路 10 号",
      biz_ext: {
        cost: "58",
        rating: "4.5",
        open_time_week: "周一至周日 10:00-22:00",
        recommend: "小炒黄牛肉;剁椒鱼头",
      },
      tag: "湘菜;家常;小炒",
      photos: [
        { url: "https://amap-pic.test/detail-1.jpg", title: "门面" },
        { url: "https://amap-pic.test/detail-2.jpg" },
      ],
      location: "113.325,23.125",
    },
  ],
});

export const amapInputTipsOk = {
  status: "1",
  info: "OK",
  tips: [
    { name: "朝阳门", address: "北京市朝阳区", location: "116.436,39.921" },
    { name: "朝阳门北大街", address: "北京市朝阳区", location: "116.436,39.925" },
    { name: "无坐标", address: "不该被选中", location: "" },
  ],
};

export const amapRegeoOk = {
  status: "1",
  info: "OK",
  regeocode: {
    formatted_address: "广东省广州市天河区北京路 1 号",
    addressComponent: {
      adcode: "440106",
      citycode: "020",
      township: "北京街",
      neighborhood: { name: "北京路商圈" },
    },
    pois: [{ name: "北京路步行街" }],
  },
};

export const amapWeatherOk = {
  status: "1",
  info: "OK",
  lives: [
    {
      weather: "小雨",
      temperature: "18",
      temperature_float: "18.0",
      humidity: "80",
    },
  ],
};

export const amapWeatherHot = {
  status: "1",
  lives: [{ weather: "晴", temperature: "34", humidity: "50" }],
};
