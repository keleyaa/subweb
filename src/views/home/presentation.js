const LEGACY_PRESENTATION = {
  rootClass: 'home-view--legacy',
  title: 'Subconverter 订阅转换',
  description: '',
};

const MODERN_PRESENTATION = {
  rootClass: 'home-view--modern',
  title: '订阅转换',
  description: '将订阅链接和节点转换为目标客户端配置。',
};

export function getHomePresentation(uxMode) {
  return { ...(uxMode === 'modern' ? MODERN_PRESENTATION : LEGACY_PRESENTATION) };
}
