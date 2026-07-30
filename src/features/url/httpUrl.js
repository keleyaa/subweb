export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
