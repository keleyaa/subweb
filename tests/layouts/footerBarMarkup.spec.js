import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const footerBarUrl = new URL('../../src/layouts/main/footer/FooterBar.vue', import.meta.url);

describe('FooterBar source contract', () => {
  it('renders a native footer only for a valid GitHub repository and keeps the external link safe', async () => {
    const source = await readFile(footerBarUrl, 'utf8');

    expect(source).toContain('<footer v-if="githubItem && repositoryLabel" class="footer-bar">');
    expect(source).toContain('<a');
    expect(source).toContain(':href="githubItem.link"');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('aria-label="在新窗口打开 GitHub 项目"');
    expect(source).toContain('GitHub 项目 · {{ repositoryLabel }}');
    expect(source).toContain("import { getGithubMenuItem, getGithubRepositoryLabel } from '@/features/site/github';");
    expect(source).toContain('menuItems: Array.isArray(window.config?.menuItem) ? window.config.menuItem : []');
    expect(source).toMatch(/githubItem\(\)\s*\{\s*return getGithubMenuItem\(this\.menuItems\);\s*\}/);
    expect(source).toMatch(
      /repositoryLabel\(\)\s*\{\s*return getGithubRepositoryLabel\(this\.githubItem\);\s*\}/,
    );
    expect(source).toMatch(/\.footer-bar\s*\{[^}]*max-width:\s*46rem\s*;[^}]*text-align:\s*center\s*;/s);
    expect(source).not.toMatch(/backdrop-filter|box-shadow|background:\s*var\(--surface-glass/);
    expect(source).toContain('var(--text-secondary)');
  });
});
