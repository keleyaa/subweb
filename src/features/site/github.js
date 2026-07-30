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
    const hostname = url.hostname.toLowerCase();

    return url.protocol === 'https:' && (hostname === 'github.com' || hostname.endsWith('.github.com')) ? url : null;
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
  if (!url || url.hostname.toLowerCase() !== 'github.com') {
    return null;
  }

  const [owner, repository] = url.pathname.split('/').filter(Boolean);

  return owner && repository && !RESERVED_GITHUB_PATHS.has(owner.toLowerCase()) ? `${owner}/${repository}` : null;
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
