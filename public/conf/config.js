window.config = {
  // 运行时兼容字段；不再驱动页面内导航品牌文字。
  siteName: 'ML1',
  // 转换后端 API 地址
  apiUrl: 'https://api.ml1.one',
  // 短链服务地址。留空时，前端不会显示短链功能。
  shortUrl: 'https://ml1.one',
  // 可选 GitHub 项目来源；首个安全 HTTPS GitHub URL 会显示在页脚，不作为顶部导航项。
  menuItem: [
    {
      title: 'GitHub',
      link: 'https://github.com/keleyaa/subweb',
      target: '_blank',
    },
  ],
  // 可选远程配置预设。只有在页面中主动选择后才会传给转换后端。
  remoteConfigOptions: [
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini',
      text: 'ACL4SSR Online',
    },
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini',
      text: 'ACL4SSR Online Full',
    },
    {
      value: 'https://raw.githubusercontent.com/FDUZS/subconverter-config/main/config.ini',
      text: 'FDUZS 流媒体与 AI',
    },
    {
      value: 'https://raw.githubusercontent.com/BeingFun/config4subconverter/main/customize.ini',
      text: 'BeingFun Clash / Sing-box',
    },
  ],
};
