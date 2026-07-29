import { describe, expect, it } from 'vitest';
import { TARGET_OPTIONS, createDefaultMoreConfig } from '../../../src/features/conversion/options';

describe('conversion options', () => {
  it('provides supported targets in the existing display order', () => {
    expect(TARGET_OPTIONS).toEqual([
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
  });

  it('creates independent more-config defaults', () => {
    const first = createDefaultMoreConfig();
    const second = createDefaultMoreConfig();

    expect(first).toEqual({
      include: '',
      exclude: '',
      emoji: true,
      udp: true,
      sort: false,
      scv: false,
      list: false,
    });
    expect(first).not.toBe(second);

    first.include = 'HK';
    expect(second.include).toBe('');
  });
});
