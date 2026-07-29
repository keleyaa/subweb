/* global globalThis */

export async function shareUrl(url, navigatorObject = globalThis.navigator) {
  if (typeof url !== 'string' || !url.trim()) {
    return { status: 'missing' };
  }

  if (!navigatorObject || typeof navigatorObject.share !== 'function') {
    return { status: 'unsupported' };
  }

  try {
    await navigatorObject.share({ url: url.trim() });
    return { status: 'shared' };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { status: 'cancelled' };
    }

    return { status: 'failed' };
  }
}
