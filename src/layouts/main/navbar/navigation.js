export function getGithubMenuItem(menuItems) {
  if (!Array.isArray(menuItems)) {
    return null;
  }

  for (const item of menuItems) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const { title, link } = item;
    if (typeof title !== 'string' || !title.trim() || typeof link !== 'string') {
      continue;
    }

    let url;
    try {
      url = new URL(link);
    } catch {
      continue;
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol === 'https:' && (hostname === 'github.com' || hostname.endsWith('.github.com'))) {
      return item;
    }
  }

  return null;
}
