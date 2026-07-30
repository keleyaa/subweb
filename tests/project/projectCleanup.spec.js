import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const rootFile = (path) => new URL(path, root);

const removedArtifacts = [
  '.claude/plans/subweb-modernization-execution.plan.md',
  'docs/superpowers/plans/2026-07-29-apple-minimal-borderless-redesign.md',
  'docs/superpowers/plans/2026-07-29-frontend-only-modernization.md',
  'docs/superpowers/specs/2026-07-29-apple-minimal-borderless-redesign.md',
  'docs/superpowers/specs/2026-07-29-frontend-only-modernization-design.md',
  'src/layouts/LayoutView.vue',
  'src/assets/vendor/css/pages/front-page.css',
  'src/assets/vendor/css/pages/front-page-landing.css',
  'src/assets/vendor/css/rtl/core.css',
  'src/assets/vendor/css/rtl/theme-default.css',
  'src/stores/styleFacade.js',
  'src/store/modules/menu.js',
  'src/store/modules/style.js',
  'src/store/modules/styles/main.js',
].map(rootFile);

describe('project cleanup and independent-maintenance boundary', () => {
  it('removes retired process records, compatibility state, and inherited UI assets', async () => {
    await Promise.all(removedArtifacts.map((artifact) => expect(access(artifact)).rejects.toMatchObject({ code: 'ENOENT' })));
  });

  it('keeps metadata, docs, and build context free of upstream operational defaults', async () => {
    const [readme, publicConfig, runtimeConfig, dockerfile, workflow, dockerignore] = await Promise.all([
      readFile(rootFile('README.md'), 'utf8'),
      readFile(rootFile('public/conf/config.js'), 'utf8'),
      readFile(rootFile('src/runtime/config.js'), 'utf8'),
      readFile(rootFile('Dockerfile'), 'utf8'),
      readFile(rootFile('.github/workflows/docker-build-release.yml'), 'utf8'),
      readFile(rootFile('.dockerignore'), 'utf8'),
    ]);

    for (const source of [publicConfig, runtimeConfig, dockerfile]) {
      expect(source).not.toContain('stilleshan');
      expect(source).not.toContain('s.ops.ci');
      expect(source).not.toContain('sub.ops.ci');
    }

    expect(readme).toContain('独立维护');
    expect(readme).toContain('Fork 与来源说明');
    expect(readme).toContain('https://github.com/stilleshan/subweb');
    expect(readme).toContain('未记录其他第三方代码仓库作为设计或代码来源');
    expect(readme).toContain('Apple 风格的无框极简方向');
    expect(dockerfile).not.toContain('LABEL maintainer');
    expect(dockerfile).not.toContain('ENV VERSION');
    expect(workflow).not.toContain('paths-ignore:');
    for (const ignoredPath of ['docs', 'tests', 'output', 'prototypes', '.worktrees']) {
      expect(dockerignore.split('\n')).toContain(ignoredPath);
    }
  });

  it('keeps only active frontend tooling and records the public maintenance docs', async () => {
    const [packageSource, viteConfig, appSource, routerSource, homeViewSource] = await Promise.all([
      readFile(rootFile('package.json'), 'utf8'),
      readFile(rootFile('vite.config.mjs'), 'utf8'),
      readFile(rootFile('src/App.vue'), 'utf8'),
      readFile(rootFile('src/router/index.js'), 'utf8'),
      readFile(rootFile('src/views/home/HomeView.vue'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageSource);

    expect(packageJson).toMatchObject({
      description: 'Independent minimal frontend for subscription conversion backends',
      homepage: 'https://github.com/keleyaa/subweb',
      repository: {
        type: 'git',
        url: 'git+https://github.com/keleyaa/subweb.git',
      },
    });

    for (const dependency of ['core-js', 'moment', 'perfect-scrollbar', 'pinia']) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency);
    }
    for (const dependency of ['unplugin-auto-import', 'unplugin-vue-components']) {
      expect(packageJson.devDependencies).not.toHaveProperty(dependency);
    }
    expect(viteConfig).not.toContain('AutoImport');
    expect(viteConfig).not.toContain('Components');
    expect(viteConfig).not.toContain('ElementPlusResolver');
    expect(appSource).not.toContain('assets/vendor');
    expect(appSource).not.toContain('element-plus/theme-chalk/index.css');
    expect(routerSource).toContain("name: 'workspace'");
    expect(routerSource).not.toContain("name: 'LayoutView'");
    expect(homeViewSource).toContain("name: 'HomeView'");
    expect(homeViewSource).not.toContain('SubconverterView');

    await expect(access(rootFile('docs/configuration.md'))).resolves.toBeUndefined();
    await expect(access(rootFile('docs/deployment.md'))).resolves.toBeUndefined();
  });
});
