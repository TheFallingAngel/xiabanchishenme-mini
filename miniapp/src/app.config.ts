/**
 * Taro 全局小程序配置 —— 对应微信小程序的 app.json。
 * M4 会补齐所有页面;当前只有一个首页用来跑通端到端。
 */
export default defineAppConfig({
  pages: [
    "pages/index/index",
    // M4 后续加:
    // "pages/restaurant/index",
    // "pages/favorites/index",
    // "pages/history/index",
    // "pages/profile/index",
  ],
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#FFF8F0",
    navigationBarTitleText: "下班吃什么",
    navigationBarTextStyle: "black",
  },
  // 云托管相关能力,方便 wx.cloud.callContainer 跳过 request 合法域名检查
  cloud: true,
  permission: {
    "scope.userLocation": {
      desc: "用于推荐你附近的餐厅",
    },
  },
  requiredPrivateInfos: ["getLocation"],
  // tab bar 在 M4 加
  // tabBar: { ... }
});
