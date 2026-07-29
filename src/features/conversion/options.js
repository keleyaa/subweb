export const TARGET_OPTIONS = Object.freeze([
  { value: 'clash', text: 'Clash' },
  { value: 'clashr', text: 'ClashR' },
  { value: 'v2ray', text: 'V2Ray' },
  { value: 'quan', text: 'Quantumult' },
  { value: 'quanx', text: 'Quantumult X' },
  { value: 'surge&ver=2', text: 'SurgeV2' },
  { value: 'surge&ver=3', text: 'SurgeV3' },
  { value: 'surge&ver=4', text: 'SurgeV4' },
  { value: 'surfboard', text: 'Surfboard' },
  { value: 'ss', text: 'SS (SIP002)' },
  { value: 'sssub', text: 'SS Android' },
  { value: 'ssd', text: 'SSD' },
  { value: 'ssr', text: 'SSR' },
  { value: 'loon', text: 'Loon' },
  { value: 'singbox', text: 'Sing-box' },
]);

const MORE_CONFIG_DEFAULTS = Object.freeze({
  include: '',
  exclude: '',
  emoji: true,
  udp: true,
  sort: false,
  scv: false,
  list: false,
});

export const createDefaultMoreConfig = () => ({ ...MORE_CONFIG_DEFAULTS });
