/** Taro prod 环境扩展 —— 压缩/混淆/体积优化 */
export default {
  mini: {
    optimizeMainPackage: {
      enable: true,
    },
  },
  h5: {
    /**
     * 如需 CDN 加载 runtime,这里改 esnextModules 或 webpackChain
     */
  },
};
