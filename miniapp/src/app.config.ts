/**
 * Taro 全局小程序配置 —— 对应微信小程序的 app.json。
 *
 * 4 个 tab:首页 / 足迹 / 收藏 / 我的。详情页 (restaurant/[id]) 是普通页,不挂 tab。
 */
export default defineAppConfig({
  pages: [
    "pages/index/index",
    "pages/history/index",
    "pages/favorites/index",
    "pages/profile/index",
    // M4.3 加详情页:
    // "pages/restaurant/index",
  ],
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#FFF8F0",
    navigationBarTitleText: "下班吃什么",
    navigationBarTextStyle: "black",
  },
  tabBar: {
    color: "#8A7566",         // 未激活文字色
    selectedColor: "#C54141", // 激活文字色 (深红品牌色)
    backgroundColor: "#FFFFFF",
    borderStyle: "white",
    list: [
      {
        pagePath: "pages/index/index",
        text: "首页",
        iconPath: "assets/tabbar/home.png",
        selectedIconPath: "assets/tabbar/home-active.png",
      },
      {
        pagePath: "pages/history/index",
        text: "足迹",
        iconPath: "assets/tabbar/history.png",
        selectedIconPath: "assets/tabbar/history-active.png",
      },
      {
        pagePath: "pages/favorites/index",
        text: "收藏",
        iconPath: "assets/tabbar/favorites.png",
        selectedIconPath: "assets/tabbar/favorites-active.png",
      },
      {
        pagePath: "pages/profile/index",
        text: "我的",
        iconPath: "assets/tabbar/profile.png",
        selectedIconPath: "assets/tabbar/profile-active.png",
      },
    ],
  },
  // 云托管相关能力,方便 wx.cloud.callContainer 跳过 request 合法域名检查
  cloud: true,
  permission: {
    "scope.userLocation": {
      desc: "用于推荐你附近的餐厅",
    },
  },
  requiredPrivateInfos: ["getLocation"],
});
