import { describe, expect, it } from 'vitest';
import { getHomePresentation } from '../../../src/views/home/presentation';

describe('home presentation', () => {
  it('uses the modern presentation only for the explicit modern runtime mode', () => {
    expect(getHomePresentation('modern')).toEqual({
      rootClass: 'home-view--modern',
      title: '订阅转换',
      description: '将订阅链接和节点转换为目标客户端配置。',
    });
    expect(getHomePresentation('legacy')).toEqual({
      rootClass: 'home-view--legacy',
      title: 'Subconverter 订阅转换',
      description: '',
    });
    expect(getHomePresentation()).toEqual(getHomePresentation('legacy'));
  });
});
