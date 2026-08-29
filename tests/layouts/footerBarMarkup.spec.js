import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const footerBarUrl = new URL('../../src/layouts/main/footer/FooterBar.vue', import.meta.url);

describe('FooterBar source contract', () => {
  it('renders a compact native footer and keeps the repository link safe', async () => {
    const source = await readFile(footerBarUrl, 'utf8');

    expect(source).toContain('<footer class="footer-bar">');
    expect(source).toContain('Subconverter Web. / Public utility');
    expect(source).toContain('<a');
    expect(source).toContain('v-if="githubItem && repositoryLabel"');
    expect(source).toContain(':href="githubItem.link"');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('aria-label="在新窗口打开 GitHub 项目"');
    expect(source).toContain('{{ repositoryLabel }}');
    expect(source).toContain('隐私优先 · 无需登录');
    expect(source).toContain("import { getGithubMenuItem, getGithubRepositoryLabel } from '@/features/site/github';");
    expect(source).toContain('menuItems: Array.isArray(window.config?.menuItem) ? window.config.menuItem : []');
    expect(source).toMatch(/\.footer-bar\s*\{[^}]*justify-content:\s*space-between;[^}]*padding:\s*0 30px 30px;/s);
    expect(source).toContain('color: #737674');
    expect(source).toContain('var(--text-primary)');
  });
});
