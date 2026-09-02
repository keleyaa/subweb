/* global window */

window.__SUBWEB_CONFIG__ = {
  apiUrl: 'https://api.ml1.one',
  shortLinksEnabled: true,
  customBackendEnabled: true,
  turnstileSiteKey: '',
  menuItem: [
    {
      title: 'GitHub',
      link: 'https://github.com/keleyaa/subweb',
      target: '_blank',
    },
  ],
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
window.config = window.__SUBWEB_CONFIG__;
