export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    return false;
  }

  try {
    const url = new URL(value);
    const isLoopbackHttp =
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost');

    return (
      (url.protocol === 'https:' || isLoopbackHttp) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
