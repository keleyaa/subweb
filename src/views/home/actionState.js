export const COPY_STATUS = Object.freeze({
  IDLE: 'idle',
  COPYING: 'copying',
  COPIED: 'copied',
  MANUAL: 'manual',
});

export function getSubscriptionActionLabel({ hasResult, copyStatus }) {
  if (!hasResult) return '转换并复制';
  return copyStatus === COPY_STATUS.COPYING ? '复制中...' : '复制订阅';
}

export function getShortActionLabel({ hasShortUrl, copyStatus, isGenerating }) {
  if (isGenerating) return '生成中...';
  if (!hasShortUrl) return '生成并复制短链';
  return copyStatus === COPY_STATUS.COPYING ? '复制中...' : '复制短链';
}

export function getCopyFeedback({ resource, copyStatus }) {
  if (copyStatus === COPY_STATUS.COPIED) return resource + '已复制';
  if (copyStatus === COPY_STATUS.MANUAL) return '链接已生成，请手动复制';
  return '';
}

export function createEmptyResultState() {
  return {
    subUrl: '',
    shortUrl: '',
    conversionKey: '',
    shortUrlConversionKey: '',
    subscriptionCopyStatus: COPY_STATUS.IDLE,
    shortCopyStatus: COPY_STATUS.IDLE,
  };
}
