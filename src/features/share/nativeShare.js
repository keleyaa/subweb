/* global globalThis */

export async function shareUrl(url, navigatorObject = globalThis.navigator) {
  if (typeof url !== 'string' || !url.trim()) {
    return { status: 'missing' };
  }

  try {
    const share = navigatorObject?.share;
    if (typeof share !== 'function') {
      return { status: 'unsupported' };
    }

    await share.call(navigatorObject, { url: url.trim() });
    return { status: 'shared' };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { status: 'cancelled' };
    }

    return { status: 'failed' };
  }
}
