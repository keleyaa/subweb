import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getGithubMenuItem } from '../../src/layouts/main/navbar/navigation.js';

const navigationUrl = new URL('../../src/layouts/main/navbar/navigation.js', import.meta.url);

describe('minimal navigation link selection', () => {
  it('provides a pure GitHub menu item selector', async () => {
    const source = await readFile(navigationUrl, 'utf8').catch(() => '');

    expect(source).toContain('export function getGithubMenuItem(menuItems)');
  });

  it.each([undefined, null, {}, 'github', 42])('returns null for non-array menu data: %j', (menuItems) => {
    expect(getGithubMenuItem(menuItems)).toBeNull();
  });

  it('ignores null entries and entries with malformed fields', () => {
    expect(
      getGithubMenuItem([
        null,
        undefined,
        'https://github.com/example',
        {},
        { title: null, link: 'https://github.com/example' },
        { title: 'GitHub', link: null },
        { title: '   ', link: 'https://github.com/example' },
      ])
    ).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,github',
    'http://github.com/example',
    'https://example.com/github',
    'https://evilgithub.com/example',
    'https://github.com.evil.example/example',
  ])('rejects unsafe or non-GitHub links: %s', (link) => {
    expect(getGithubMenuItem([{ title: 'GitHub', link }])).toBeNull();
  });

  it('does not trust a GitHub-looking title when the hostname is unrelated', () => {
    expect(getGithubMenuItem([{ title: 'Visit GitHub', link: 'https://example.com/source' }])).toBeNull();
  });

  it('returns an item linking to github.com over HTTPS', () => {
    const item = { title: 'Source code', link: 'https://github.com/example/repository', target: '_blank' };

    expect(getGithubMenuItem([item])).toBe(item);
  });

  it('returns an item linking to a github.com subdomain over HTTPS', () => {
    const item = { title: 'GitHub status', link: 'https://status.github.com/' };

    expect(getGithubMenuItem([item])).toBe(item);
  });

  it('skips invalid entries and returns the first valid GitHub item', () => {
    const validItem = { title: 'Repository', link: 'https://github.com/example/repository' };

    expect(
      getGithubMenuItem([
        { title: 'GitHub', link: 'javascript:alert(1)' },
        { title: 'GitHub mirror', link: 'https://git.example.com/repository' },
        validItem,
        { title: 'Later repository', link: 'https://github.com/example/later' },
      ])
    ).toBe(validItem);
  });
});
