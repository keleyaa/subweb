import { describe, expect, it } from 'vitest';
import {
  COPY_STATUS,
  createEmptyResultState,
  getCopyFeedback,
  getShortActionLabel,
  getSubscriptionActionLabel,
} from '../../../src/views/home/actionState.js';

describe('conversion action labels', () => {
  it('models subscription generation and copy states', () => {
    expect(getSubscriptionActionLabel({ hasResult: false, copyStatus: COPY_STATUS.IDLE })).toBe('转换并复制');
    expect(getSubscriptionActionLabel({ hasResult: true, copyStatus: COPY_STATUS.IDLE })).toBe('复制订阅');
    expect(getSubscriptionActionLabel({ hasResult: true, copyStatus: COPY_STATUS.COPYING })).toBe('复制中...');
  });

  it('models short-link generation and copy states', () => {
    expect(getShortActionLabel({ hasShortUrl: false, copyStatus: COPY_STATUS.IDLE, isGenerating: false })).toBe(
      '生成并复制短链'
    );
    expect(getShortActionLabel({ hasShortUrl: false, copyStatus: COPY_STATUS.IDLE, isGenerating: true })).toBe(
      '生成中...'
    );
    expect(getShortActionLabel({ hasShortUrl: true, copyStatus: COPY_STATUS.IDLE, isGenerating: false })).toBe(
      '复制短链'
    );
  });

  it('never describes a rejected clipboard operation as successful', () => {
    expect(getCopyFeedback({ resource: '订阅链接', copyStatus: COPY_STATUS.COPIED })).toBe('订阅链接已复制');
    expect(getCopyFeedback({ resource: '订阅链接', copyStatus: COPY_STATUS.MANUAL })).toBe(
      '链接已生成，请手动复制'
    );
  });

  it('creates a complete idle result state', () => {
    expect(createEmptyResultState()).toEqual({
      subUrl: '',
      shortUrl: '',
      conversionKey: '',
      shortUrlConversionKey: '',
      subscriptionCopyStatus: COPY_STATUS.IDLE,
      shortCopyStatus: COPY_STATUS.IDLE,
    });
  });
});
