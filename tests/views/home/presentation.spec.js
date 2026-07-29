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

  it('returns isolated presentation objects for repeated calls', () => {
    const firstPresentation = getHomePresentation('modern');
    const secondPresentation = getHomePresentation('modern');

    expect(firstPresentation).not.toBe(secondPresentation);

    firstPresentation.title = 'Changed title';

    expect(secondPresentation.title).toBe('订阅转换');
  });
});
