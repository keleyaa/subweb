import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getGithubMenuItem, getGithubRepositoryLabel } from '../../src/features/site/github.js';

const githubUrl = new URL('../../src/features/site/github.js', import.meta.url);

describe('GitHub project selection', () => {
  it('provides pure GitHub item and repository-label selectors from the neutral site module', async () => {
    const source = await readFile(githubUrl, 'utf8');

    expect(source).toContain('export function getGithubMenuItem(menuItems)');
    expect(source).toContain('export function getGithubRepositoryLabel(item)');
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
      ]),
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

  it('returns the first valid HTTPS GitHub item, including github.com subdomains', () => {
    const repository = { title: 'Repository', link: 'https://github.com/example/repository' };

    expect(
      getGithubMenuItem([
        { title: 'GitHub', link: 'javascript:alert(1)' },
        { title: 'GitHub mirror', link: 'https://git.example.com/repository' },
        repository,
        { title: 'GitHub status', link: 'https://status.github.com/' },
      ]),
    ).toBe(repository);
    expect(getGithubMenuItem([{ title: 'GitHub status', link: 'https://status.github.com/' }])).toEqual({
      title: 'GitHub status',
      link: 'https://status.github.com/',
    });
  });

  it('derives owner/repository from valid ordinary GitHub repository links', () => {
    expect(getGithubRepositoryLabel({ title: 'Source', link: 'https://github.com/keleyaa/subweb' })).toBe(
      'keleyaa/subweb',
    );
    expect(getGithubRepositoryLabel({ title: 'Source', link: 'https://github.com/keleyaa/subweb/issues' })).toBe(
      'keleyaa/subweb',
    );
  });

  it.each([
    undefined,
    null,
    {},
    { title: 'Source', link: 'https://github.com/keleyaa' },
    { title: 'Source', link: 'https://github.com/' },
    { title: 'Profile', link: 'https://github.com/settings/profile' },
    { title: 'Topic', link: 'https://github.com/topics/vue' },
    { title: 'Organization', link: 'https://github.com/orgs/acme' },
    { title: 'Join', link: 'https://github.com/join/plan' },
    { title: 'Sign up', link: 'https://github.com/signup/plan' },
    { title: 'Password reset', link: 'https://github.com/password_reset/request' },
    { title: 'Solutions', link: 'https://github.com/solutions/industry' },
    { title: 'Resources', link: 'https://github.com/resources/articles' },
    { title: 'Organizations', link: 'https://github.com/organizations/acme' },
    { title: 'Users', link: 'https://github.com/users/example' },
    { title: 'Status', link: 'https://status.github.com/keleyaa/subweb' },
    { title: 'Source', link: 'http://github.com/keleyaa/subweb' },
    { title: 'Source', link: 'https://example.com/keleyaa/subweb' },
  ])('does not derive a project label from invalid or non-repository items: %j', (item) => {
    expect(getGithubRepositoryLabel(item)).toBeNull();
  });
});
