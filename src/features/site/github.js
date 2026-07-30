function getGithubUrl(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const { title, link } = item;
  if (typeof title !== 'string' || !title.trim() || typeof link !== 'string') {
    return null;
  }

  try {
    const url = new URL(link);
    const [owner, repository, ...extraSegments] = url.pathname.split('/').filter(Boolean);

    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      owner &&
      repository &&
      extraSegments.length === 0 &&
      !RESERVED_GITHUB_PATHS.has(owner.toLowerCase())
      ? url
      : null;
  } catch {
    return null;
  }
}

export function getGithubMenuItem(menuItems) {
  if (!Array.isArray(menuItems)) {
    return null;
  }

  return menuItems.find((item) => getGithubUrl(item)) ?? null;
}

export function getGithubRepositoryLabel(item) {
  const url = getGithubUrl(item);
  if (!url) {
    return null;
  }

  const [owner, repository] = url.pathname.split('/').filter(Boolean);

  return `${owner}/${repository}`;
}
const RESERVED_GITHUB_PATHS = new Set([
  'about',
  'account',
  'apps',
  'blog',
  'business',
  'collections',
  'community',
  'contact',
  'customer-stories',
  'dashboard',
  'developers',
  'education',
  'enterprise',
  'events',
  'explore',
  'features',
  'github',
  'issues',
  'join',
  'login',
  'marketplace',
  'mobile',
  'new',
  'nonprofits',
  'notifications',
  'open-source',
  'organizations',
  'orgs',
  'password_reset',
  'pricing',
  'readme',
  'resources',
  'search',
  'security',
  'sessions',
  'settings',
  'site',
  'signup',
  'social-impact',
  'solutions',
  'sponsors',
  'stars',
  'support',
  'team',
  'teams',
  'topics',
  'trending',
  'users',
  'watching',
]);
