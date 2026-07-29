# Apple 风格无框极简重设计实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将当前首页收敛为用户确认的 Apple 风格“无框极简”单页转换工具，完整移除本机模板功能，同时保持转换、复制、分享、短链、运行时配置和错误反馈行为不变。

**架构：** 继续使用现有 Vue 3 + Vite 单页架构。先把模板模块中仍属于转换核心的客户端选项和高级参数默认值迁移到独立模块，再删除模板存储与界面；随后仅重构主布局、导航、现代首页和 `SubTable` 的呈现层。`window.config`、转换 URL 生成、网络请求和全局反馈组件保持原有所有权。

**技术栈：** Vue 3 Options API、Vue Router 4、Vuex 4、Pinia 2.2.4、Element Plus 2.3.14、Vite 6.4.3、Vitest 2.1.9、ESLint 7。

---

## 文件结构

- `index.html`：保留 Vite 挂载点和运行时配置脚本，移除远程字体依赖与禁止缩放设置。
- `src/features/conversion/options.js`：承载客户端选项和高级参数默认值，不包含存储、模板或网络行为。
- `src/features/templates/preferences.js`：本计划执行期间删除；不调用 `localStorage.removeItem`，因此不主动清理既有模板数据。
- `src/layouts/main/MainLayout.vue`：只负责顶栏和路由内容，不再挂载页脚或旧 landing-page 样式。
- `src/layouts/main/footer/FooterBar.vue`：删除，GitHub 入口统一保留在顶栏。
- `src/layouts/main/navbar/AppBrand.vue`：只显示简洁站点标识，不再承载移动菜单按钮。
- `src/layouts/main/navbar/NavBar.vue`：无阴影、细分隔线、固定内容宽度的顶栏容器。
- `src/layouts/main/navbar/NavMenu.vue`：从运行时菜单中提取 GitHub 入口，并在所有尺寸直接显示为单一文字链接。
- `src/views/home/HomeView.vue`：现代模式使用最大宽度约 `860px` 的单列页面；旧模式仍可回退，不改变 `uxMode` 合同。
- `src/views/home/SubTable.vue`：保留转换逻辑，删除模板状态和方法；现代模式改为输入、基础配置、高级参数、主操作、结果的线性结构。
- `src/views/home/subTableModern.css`：只包含现代无框表单的 scoped 样式，避免继续扩大 `SubTable.vue`。
- `tests/features/conversion/options.spec.js`：锁定客户端选项与高级参数默认值。
- `tests/app/appMarkup.spec.js`：锁定系统字体、可缩放 viewport 和 Vite 文档入口。
- `tests/layouts/mainLayoutMarkup.spec.js`：锁定无页脚、无旧 landing 样式的主布局。
- `tests/layouts/minimalNavigation.spec.js`：锁定单一 GitHub 链接、触控尺寸与无抽屉导航合同。
- `tests/views/home/homeLayout.spec.js`：锁定现代首页单列结构、宽度和无 Hero 空白区。
- `tests/views/home/subTableLayout.spec.js`：锁定配置顺序、模板彻底移除和高级参数默认收起。
- `tests/views/home/subTableModernLayout.spec.js`：锁定无卡片视觉、三列基础配置、唯一蓝色主操作和移动端布局合同。

## 实施约束

- 只做前端；不修改后端、Docker 协议、路由、部署配置或 `window.config` 字段。
- 不新增依赖，不改转换参数编码，不改短链 `/short` 请求协议。
- 不读取、迁移或删除 `subweb.local-conversion-templates`；废弃数据留在浏览器中，避免静默破坏。
- `uxMode === 'modern'` 使用新视觉；`legacy` 回退仍能挂载并完成转换。
- 每个任务先得到预期红灯，再做最小实现并提交；不得把原型目录导入生产源码。

## 任务 1：从模板模块拆出转换核心选项

**文件：**

- 创建：`src/features/conversion/options.js`
- 创建：`tests/features/conversion/options.spec.js`
- 修改：`src/features/templates/preferences.js`
- 修改：`src/views/home/SubTable.vue`

- [ ] **步骤 1：为转换选项写失败测试**

创建 `tests/features/conversion/options.spec.js`：

```js
import { describe, expect, it } from 'vitest';
import { TARGET_OPTIONS, createDefaultMoreConfig } from '@/features/conversion/options';

describe('conversion options', () => {
  it('keeps every supported output target in its established order', () => {
    expect(TARGET_OPTIONS).toEqual([
      { value: 'clash', text: 'Clash' },
      { value: 'clashr', text: 'ClashR' },
      { value: 'v2ray', text: 'V2Ray' },
      { value: 'quan', text: 'Quantumult' },
      { value: 'quanx', text: 'Quantumult X' },
      { value: 'surge&ver=2', text: 'SurgeV2' },
      { value: 'surge&ver=3', text: 'SurgeV3' },
      { value: 'surge&ver=4', text: 'SurgeV4' },
      { value: 'surfboard', text: 'Surfboard' },
      { value: 'ss', text: 'SS (SIP002)' },
      { value: 'sssub', text: 'SS Android' },
      { value: 'ssd', text: 'SSD' },
      { value: 'ssr', text: 'SSR' },
      { value: 'loon', text: 'Loon' },
      { value: 'singbox', text: 'Sing-box' },
    ]);
  });

  it('returns an independent advanced-parameter object each time', () => {
    const first = createDefaultMoreConfig();
    const second = createDefaultMoreConfig();

    expect(first).toEqual({
      include: '',
      exclude: '',
      emoji: true,
      udp: true,
      sort: false,
      scv: false,
      list: false,
    });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
```

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/features/conversion/options.spec.js
```

预期：失败，提示无法解析 `@/features/conversion/options`。

- [ ] **步骤 3：创建无存储职责的转换选项模块**

创建 `src/features/conversion/options.js`：

```js
export const TARGET_OPTIONS = Object.freeze([
  { value: 'clash', text: 'Clash' },
  { value: 'clashr', text: 'ClashR' },
  { value: 'v2ray', text: 'V2Ray' },
  { value: 'quan', text: 'Quantumult' },
  { value: 'quanx', text: 'Quantumult X' },
  { value: 'surge&ver=2', text: 'SurgeV2' },
  { value: 'surge&ver=3', text: 'SurgeV3' },
  { value: 'surge&ver=4', text: 'SurgeV4' },
  { value: 'surfboard', text: 'Surfboard' },
  { value: 'ss', text: 'SS (SIP002)' },
  { value: 'sssub', text: 'SS Android' },
  { value: 'ssd', text: 'SSD' },
  { value: 'ssr', text: 'SSR' },
  { value: 'loon', text: 'Loon' },
  { value: 'singbox', text: 'Sing-box' },
]);

const MORE_CONFIG_DEFAULTS = Object.freeze({
  include: '',
  exclude: '',
  emoji: true,
  udp: true,
  sort: false,
  scv: false,
  list: false,
});

export const createDefaultMoreConfig = () => ({ ...MORE_CONFIG_DEFAULTS });
```

在 `src/features/templates/preferences.js` 中从新模块导入这两个导出；保留模板安全归一化代码，删除该文件内重复的常量定义。`SUPPORTED_TARGETS` 继续从导入的 `TARGET_OPTIONS` 构造。

在 `src/views/home/SubTable.vue` 中改为分别导入：

```js
import { TARGET_OPTIONS, createDefaultMoreConfig } from '@/features/conversion/options';
import {
  MAX_TEMPLATES,
  createTemplate,
  loadTemplates,
  normalizeMoreConfig,
  saveTemplates,
} from '@/features/templates/preferences';
```

- [ ] **步骤 4：验证迁移没有改变模板或转换默认值**

运行：

```bash
npm test -- tests/features/conversion/options.spec.js tests/features/templates/preferences.spec.js
npm run lint
```

预期：两个测试文件全部通过；ESLint 退出码为 `0`。

- [ ] **步骤 5：提交转换选项拆分**

```bash
git add src/features/conversion/options.js src/features/templates/preferences.js src/views/home/SubTable.vue tests/features/conversion/options.spec.js
git commit -m "refactor: separate conversion options from templates"
```

## 任务 2：完整移除本机模板界面与存储代码

**文件：**

- 修改：`src/views/home/SubTable.vue`
- 修改：`tests/views/home/subTableLayout.spec.js`
- 修改：`docs/superpowers/specs/2026-07-29-frontend-only-modernization-design.md`
- 修改：`docs/superpowers/plans/2026-07-29-frontend-only-modernization.md`
- 删除：`src/features/templates/preferences.js`
- 删除：`tests/features/templates/preferences.spec.js`

- [ ] **步骤 1：把布局测试改成模板移除合同**

将 `tests/views/home/subTableLayout.spec.js` 更新为：

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../../../src/views/home/SubTable.vue', import.meta.url));

describe('SubTable configuration layout', () => {
  it('keeps the linear conversion order without local templates', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const subscriptionIndex = source.indexOf('id="subscription-urls"');
    const clientIndex = source.indexOf('id="client"');
    const apiIndex = source.indexOf('id="api"');
    const remoteIndex = source.indexOf('id="remote"');
    const moreConfigIndex = source.indexOf('id="more-config-toggle"');
    const resultIndex = source.indexOf('id="converted-sub-url"');

    expect(subscriptionIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(subscriptionIndex);
    expect(apiIndex).toBeGreaterThan(clientIndex);
    expect(remoteIndex).toBeGreaterThan(apiIndex);
    expect(moreConfigIndex).toBeGreaterThan(remoteIndex);
    expect(resultIndex).toBeGreaterThan(moreConfigIndex);
  });

  it('contains no local-template UI, state, lifecycle, or storage calls', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/template-controls|template-name|saved-template/);
    expect(source).not.toMatch(/保存模板|应用模板|本机模板|清空模板/);
    expect(source).not.toMatch(/loadLocalTemplates|saveLocalTemplates|selectedTemplateId|templateName/);
    expect(source).not.toMatch(/features\/templates|localStorage/);
  });

  it('starts with advanced parameters collapsed', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toMatch(/isShowMoreConfig:\s*false/);
  });
});
```

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/views/home/subTableLayout.spec.js
```

预期：第二个断言失败，因为 `SubTable.vue` 仍包含模板界面、状态、方法和存储导入。

- [ ] **步骤 3：删除模板呈现与行为，但不删除浏览器数据**

在 `src/views/home/SubTable.vue` 中完成以下精确删除：

- 删除整个 `.template-controls` DOM 区块。
- 删除 `@/features/templates/preferences` 导入。
- 删除 `templates`、`templateName`、`selectedTemplateId` 数据字段。
- 删除 `created()` 中的模板加载。
- 删除 `showTemplateStorageError`、`loadLocalTemplates`、`saveLocalTemplates`、`createTemplateId`、`saveTemplate`、`applyTemplate`、`deleteTemplate`、`clearTemplates` 方法。
- 保留来自 `@/features/conversion/options` 的 `TARGET_OPTIONS` 和 `createDefaultMoreConfig`。
- 不新增 `localStorage.removeItem`、数据迁移或清理提示。

删除：

```text
src/features/templates/preferences.js
tests/features/templates/preferences.spec.js
```

同步清理整个仓库中的陈旧功能描述：

- 从 `docs/superpowers/specs/2026-07-29-frontend-only-modernization-design.md` 的目标、架构、安全边界和验收条件中删除“本机模板”作为现有能力的描述；保留 Vite、Pinia、现代首页和原生分享内容。
- 从 `docs/superpowers/plans/2026-07-29-frontend-only-modernization.md` 的文件结构、模板任务、验证命令、提交说明和完成清单中删除模板功能；保留已经完成的其它现代化任务记录。
- 扫描 `README*`、`public/`、`prototypes/`、配置文件、源码、测试和其它文档；若存在本机转换模板的入口、配置、示例或说明，一并删除。
- 新设计规格和本实现计划可以保留“为何移除、移除边界、不会主动删除既有浏览器数据”的迁移记录；除此之外不得把模板描述为仍可使用的项目能力。

- [ ] **步骤 4：证明模板模块已无引用且转换测试仍通过**

运行：

```bash
rg -n -i --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!docs/superpowers/specs/2026-07-29-apple-minimal-borderless-redesign.md' \
  --glob '!docs/superpowers/plans/2026-07-29-apple-minimal-borderless-redesign.md' \
  "subweb\.local-conversion-templates|features/templates|template-controls|saved-template|template-name|本机模板|保存模板|应用模板|删除模板|清空模板|local conversion templates|conversion templates" .
npm test -- tests/features/conversion/options.spec.js tests/views/home/subTableLayout.spec.js tests/features/share/nativeShare.spec.js
npm test
```

预期：全仓 `rg` 无输出并以 `1` 结束；定向测试和现有完整 Vitest 套件全部通过。这证明模板不是仅从页面隐藏，而是已从生产代码、测试、配置、原型和旧功能文档中移除。

- [ ] **步骤 5：提交模板移除**

```bash
git add -A src/features/templates src/views/home/SubTable.vue tests/features/templates tests/views/home/subTableLayout.spec.js docs/superpowers/specs/2026-07-29-frontend-only-modernization-design.md docs/superpowers/plans/2026-07-29-frontend-only-modernization.md
git commit -m "refactor: remove local conversion templates"
```

## 任务 3：简化 HTML 文档与主布局外壳

**文件：**

- 修改：`index.html`
- 修改：`src/layouts/main/MainLayout.vue`
- 修改：`tests/app/appMarkup.spec.js`
- 修改：`tests/layouts/mainLayoutMarkup.spec.js`
- 删除：`src/layouts/main/footer/FooterBar.vue`

- [ ] **步骤 1：先写无远程字体、可缩放和无页脚测试**

在 `tests/app/appMarkup.spec.js` 增加：

```js
it('uses a zoomable document without remote font dependencies', async () => {
  const indexHtml = await readFile(indexUrl, 'utf8');

  expect(indexHtml).toContain('width=device-width,initial-scale=1.0');
  expect(indexHtml).not.toContain('user-scalable=no');
  expect(indexHtml).not.toMatch(/fonts\.loli\.net|fonts\.googleapis\.com/);
  expect(indexHtml).toContain('<script type="text/javascript" src="/conf/config.js"></script>');
});
```

将 `tests/layouts/mainLayoutMarkup.spec.js` 的布局断言改为：

```js
expect(source).toContain('<nav-bar />');
expect(source).toContain('<router-view />');
expect(source).not.toContain('<footer-bar />');
expect(source).not.toContain('FooterBar');
expect(source).not.toContain('front-page.css');
expect(source).not.toContain('front-page-landing.css');
expect(source).toMatch(/min-height:\s*100vh/);
expect(source).toMatch(/background-color:\s*#f5f5f7/);
```

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/app/appMarkup.spec.js tests/layouts/mainLayoutMarkup.spec.js
```

预期：失败，指出远程字体、禁止缩放、页脚和旧 landing 样式仍存在。

- [ ] **步骤 3：收敛根文档**

在 `index.html`：

- 把 viewport 改为 `<meta name="viewport" content="width=device-width,initial-scale=1.0" />`。
- 删除所有 `fonts.loli.net` 的 `preconnect` 和 stylesheet。
- 保留 favicon、`/conf/config.js`、`#app` 和 `/src/main.js`。
- 把 `<html lang="">` 改为 `<html lang="zh-CN">`。

- [ ] **步骤 4：把主布局精简为导航与内容**

将 `src/layouts/main/MainLayout.vue` 模板核心改为：

```vue
<template>
  <div class="main-layout light-style" dir="ltr">
    <nav-bar />
    <router-view />
  </div>
</template>
```

脚本中只保留 `NavBar` 组件注册；删除 `FooterBar`、style facade、滚动监听和 `@wheel`。样式改为：

```css
.main-layout {
  min-height: 100vh;
  background-color: #f5f5f7;
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
```

删除 `src/layouts/main/footer/FooterBar.vue`。不要删除整个 `footer` 目录，除非确认目录已空。

- [ ] **步骤 5：验证布局合同并提交**

运行：

```bash
npm test -- tests/app/appMarkup.spec.js tests/layouts/mainLayoutMarkup.spec.js
npm run lint
```

预期：测试全部通过；ESLint 退出码为 `0`。

提交：

```bash
git add index.html src/layouts/main/MainLayout.vue src/layouts/main/footer/FooterBar.vue tests/app/appMarkup.spec.js tests/layouts/mainLayoutMarkup.spec.js
git commit -m "refactor: simplify the application shell"
```

## 任务 4：将顶栏重做为克制的无框导航

**文件：**

- 修改：`src/layouts/main/navbar/AppBrand.vue`
- 修改：`src/layouts/main/navbar/NavBar.vue`
- 修改：`src/layouts/main/navbar/NavMenu.vue`
- 创建：`tests/layouts/minimalNavigation.spec.js`
- 删除：`tests/layouts/mobileMenuControls.spec.js`

- [ ] **步骤 1：写单一 GitHub 入口和无抽屉导航的失败测试**

创建 `tests/layouts/minimalNavigation.spec.js`：

```js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const appBrandUrl = new URL('../../src/layouts/main/navbar/AppBrand.vue', import.meta.url);
const navMenuUrl = new URL('../../src/layouts/main/navbar/NavMenu.vue', import.meta.url);
const navBarUrl = new URL('../../src/layouts/main/navbar/NavBar.vue', import.meta.url);

describe('minimal navigation', () => {
  it('shows a simple brand without a menu toggle or decorative SVG', async () => {
    const source = await readFile(appBrandUrl, 'utf8');

    expect(source).toContain('class="app-brand-mark"');
    expect(source).toContain('{{ siteName }}');
    expect(source).not.toContain('<svg');
    expect(source).not.toContain('mobile-menu-toggle');
    expect(source).not.toContain("@element-plus/icons-vue");
    expect(source).not.toContain('#7367F0');
  });

  it('renders only the GitHub runtime item as a direct accessible link', async () => {
    const source = await readFile(navMenuUrl, 'utf8');

    expect(source).toContain('v-if="githubItem"');
    expect(source).toContain(':href="githubItem.link"');
    expect(source).toContain(':target="githubItem.target"');
    expect(source).toContain('class="minimal-nav-link"');
    expect(source).toMatch(/githubItem\(\)\s*\{[\s\S]*?github/i);
    expect(source).toMatch(/min-height:\s*44px/);
    expect(source).not.toMatch(/landing-nav-menu|landing-menu-overlay|navbar-toggler/);
    expect(source).not.toMatch(/\binert\b|aria-expanded|@keydown\.esc/);
    expect(source).not.toContain("@element-plus/icons-vue");
  });

  it('uses a centered borderless header with a fine divider', async () => {
    const source = await readFile(navBarUrl, 'utf8');

    expect(source).toContain('class="minimal-navbar"');
    expect(source).toContain('class="minimal-navbar__inner"');
    expect(source).toMatch(/border-bottom:\s*1px solid #d2d2d7/);
    expect(source).toMatch(/max-width:\s*860px/);
    expect(source).not.toMatch(/ref="appBrand"|@close|focusMenuToggle/);
  });
});
```

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/layouts/minimalNavigation.spec.js
```

预期：失败，因为新测试文件对应的无抽屉结构尚未实现；旧组件仍包含图标、菜单按钮、遮罩和抽屉。

- [ ] **步骤 3：精简品牌与顶栏容器**

在 `AppBrand.vue` 中用文本标识替换旧 SVG：

```vue
<router-link to="/" class="app-brand-link" aria-label="返回首页">
  <span class="app-brand-mark" aria-hidden="true">S</span>
  <span class="app-brand-text">{{ siteName }}</span>
</router-link>
```

删除 `Menu` 图标导入、style facade、`focusMenuToggle` 和整个移动菜单按钮。保留从 `window.config.siteName` 读取站点名。核心样式：

```css
.app-brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #1d1d1f;
  text-decoration: none;
}

.app-brand-mark {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: #1d1d1f;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
```

在 `NavBar.vue` 去掉 Bootstrap 外层宽容器，使用：

```vue
<nav class="minimal-navbar">
  <div class="minimal-navbar__inner">
    <AppBrand />
    <NavMenu />
  </div>
</nav>
```

同时删除 `NavBar.vue` 中的 `styleFacade` 导入、refs 和 `focusMenuToggle`。

核心样式：

```css
.minimal-navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid #d2d2d7;
  background: rgba(245, 245, 247, 0.96);
}

.minimal-navbar__inner {
  display: flex;
  max-width: 860px;
  min-height: 56px;
  margin: 0 auto;
  padding: 0 20px;
  align-items: center;
  justify-content: space-between;
}

@media (prefers-reduced-transparency: reduce) {
  .minimal-navbar {
    background: #f5f5f7;
  }
}
```

- [ ] **步骤 4：把运行时菜单收敛为直接 GitHub 链接**

将 `NavMenu.vue` 替换为：

```vue
<template>
  <a
    v-if="githubItem"
    :href="githubItem.link"
    :target="githubItem.target"
    class="minimal-nav-link"
    rel="noopener noreferrer"
  >
    {{ githubItem.title }}
  </a>
</template>

<script>
export default {
  name: 'NavMenu',
  data() {
    return {
      navBarItem: window.config.menuItem,
    };
  },
  computed: {
    githubItem() {
      return this.navBarItem.find((item) => /github/i.test(`${item.title} ${item.link}`)) || null;
    },
  },
};
</script>

<style scoped>
.minimal-nav-link {
  display: inline-flex;
  min-height: 44px;
  padding: 0 4px;
  align-items: center;
  color: #424245;
  font-size: 14px;
  text-decoration: none;
}

.minimal-nav-link:hover,
.minimal-nav-link:focus-visible {
  color: #06c;
}

.minimal-nav-link:focus-visible {
  outline: 3px solid rgba(0, 102, 204, 0.24);
  outline-offset: 2px;
  border-radius: 4px;
}
</style>
```

这一步不修改 `window.config.menuItem` 的格式或归一化逻辑，只在极简顶栏中选择 GitHub 项；“首页”不重复显示，因为左侧站点标识已经链接到 `/`。若运行时菜单没有 GitHub 项，右侧保持为空，不生成替代链接。

- [ ] **步骤 5：删除旧抽屉测试并验证导航**

删除 `tests/layouts/mobileMenuControls.spec.js`，运行：

```bash
npm test -- tests/layouts/minimalNavigation.spec.js tests/runtime/config.spec.js
npm run lint
```

预期：测试全部通过；运行时配置测试确认 `menuItem` 合同未变；ESLint 退出码为 `0`。

- [ ] **步骤 6：提交导航重设计**

```bash
git add src/layouts/main/navbar/AppBrand.vue src/layouts/main/navbar/NavBar.vue src/layouts/main/navbar/NavMenu.vue tests/layouts/minimalNavigation.spec.js tests/layouts/mobileMenuControls.spec.js
git commit -m "feat: add minimal borderless navigation"
```

## 任务 5：把现代首页改为单列无 Hero 工作区

**文件：**

- 修改：`src/views/home/HomeView.vue`
- 修改：`tests/views/home/homeLayout.spec.js`
- 修改：`tests/views/home/presentation.spec.js`

- [ ] **步骤 1：为现代与旧模式的单实例结构写失败测试**

将 `tests/views/home/homeLayout.spec.js` 更新为读取 `HomeView.vue`，并断言：

```js
expect(source).toContain('class="home-workspace"');
expect(source).toContain('class="home-workspace__inner"');
expect(source).toContain('<SubTable :mode="uxMode" />');
expect(source.match(/<SubTable\b/g)).toHaveLength(1);
expect(source).not.toContain('landing-hero-blank');
expect(source).not.toContain('hero-animation-img');
expect(source).not.toMatch(/linear-gradient/);
expect(source).toMatch(/max-width:\s*860px/);
expect(source).toMatch(/padding:\s*48px 20px 64px/);
```

在 `tests/views/home/presentation.spec.js` 保留现代标题和说明断言：

```js
expect(getHomePresentation('modern')).toMatchObject({
  title: '订阅转换',
  description: '将订阅链接和节点转换为目标客户端配置。',
});
```

保留当前已通过呈现测试的短说明，不修改 legacy 标题与空说明。

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/views/home/homeLayout.spec.js tests/views/home/presentation.spec.js
```

预期：布局测试失败，因为旧 Hero、渐变和空白占位仍存在。

- [ ] **步骤 3：重写为一个 SubTable 实例的简洁页面**

将 `HomeView.vue` 模板改为：

```vue
<template>
  <main class="home-workspace" :class="presentation.rootClass">
    <div class="home-workspace__inner">
      <header class="home-workspace__heading">
        <h1>{{ presentation.title }}</h1>
        <p v-if="presentation.description">{{ presentation.description }}</p>
      </header>
      <SubTable :mode="uxMode" />
    </div>
  </main>
</template>
```

保留现有脚本与 `uxMode` 计算，不创建第二个 `SubTable`。样式使用：

```css
.home-workspace {
  min-height: calc(100vh - 57px);
}

.home-workspace__inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 20px 64px;
}

.home-workspace__heading {
  margin-bottom: 28px;
}

.home-workspace__heading h1 {
  margin: 0 0 8px;
  color: #1d1d1f;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.2;
}

.home-workspace__heading p {
  margin: 0;
  color: #6e6e73;
  font-size: 15px;
  line-height: 1.5;
}

@media (max-width: 575.98px) {
  .home-workspace__inner {
    padding: 28px 16px 40px;
  }

  .home-workspace__heading {
    margin-bottom: 20px;
  }

  .home-workspace__heading h1 {
    font-size: 27px;
  }
}
```

- [ ] **步骤 4：验证首页结构并提交**

运行：

```bash
npm test -- tests/views/home/homeLayout.spec.js tests/views/home/presentation.spec.js
npm run lint
```

预期：测试全部通过；ESLint 退出码为 `0`。

提交：

```bash
git add src/views/home/HomeView.vue tests/views/home/homeLayout.spec.js tests/views/home/presentation.spec.js
git commit -m "feat: simplify the conversion workspace"
```

## 任务 6：重构现代转换表单为无框线性流程

**文件：**

- 修改：`src/views/home/SubTable.vue`
- 创建：`src/views/home/subTableModern.css`
- 修改：`tests/views/home/subTableLayout.spec.js`
- 创建：`tests/views/home/subTableModernLayout.spec.js`

- [ ] **步骤 1：为现代表单结构和视觉写失败测试**

创建 `tests/views/home/subTableModernLayout.spec.js`：

```js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const componentUrl = new URL('../../../src/views/home/SubTable.vue', import.meta.url);
const styleUrl = new URL('../../../src/views/home/subTableModern.css', import.meta.url);

describe('modern SubTable layout', () => {
  it('uses a borderless linear workflow with one primary action', async () => {
    const source = await readFile(componentUrl, 'utf8');

    expect(source).toContain('class="subscription-input"');
    expect(source).toContain('class="base-config-grid"');
    expect(source).toContain('class="advanced-disclosure"');
    expect(source).toContain('class="primary-action-row"');
    expect(source).toContain('class="results-section"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('转换订阅');
    expect(source.match(/btn-primary/g)).toHaveLength(1);
    expect(source).not.toContain('class="card');
    expect(source).not.toContain('divider-dashed');
  });

  it('exposes disclosure state and preserves existing form semantics', async () => {
    const source = await readFile(componentUrl, 'utf8');

    expect(source).toContain(':aria-expanded="String(isShowMoreConfig)"');
    expect(source).toContain('aria-controls="advanced-config"');
    expect(source).toContain('id="advanced-config"');
    expect(source).toContain('<Transition name="field-reveal">');
    expect(source).toContain('<Transition name="advanced-reveal">');
    expect(source).toContain('for="subscription-urls"');
    expect(source).toContain('for="converted-sub-url"');
    expect(source).toContain('for="short-url-result"');
  });

  it('uses the confirmed neutral visual system and mobile contracts', async () => {
    const style = await readFile(styleUrl, 'utf8');

    expect(style).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(style).toMatch(/border-top:\s*1px solid #d2d2d7/);
    expect(style).toMatch(/border-radius:\s*8px/);
    expect(style).toMatch(/background:\s*#0071e3/);
    expect(style).toMatch(/min-height:\s*44px/);
    expect(style).toContain('@media (max-width: 767.98px)');
    expect(style).toContain('@media (prefers-reduced-motion: reduce)');
    expect(style).toMatch(/transition:\s*opacity 180ms ease-out, transform 180ms ease-out/);
    expect(style).not.toMatch(/box-shadow|linear-gradient|backdrop-filter/);
  });
});
```

- [ ] **步骤 2：运行红灯测试**

运行：

```bash
npm test -- tests/views/home/subTableLayout.spec.js tests/views/home/subTableModernLayout.spec.js
```

预期：新测试失败，因为现代结构类和独立样式文件尚不存在。

- [ ] **步骤 3：调整模板结构，不改业务方法**

在 `SubTable.vue` 中保留现有 `data`、选择器事件、`getConverter`、`getSubUrl`、`getShortUrl`、`toCopy`、`shareSubscription` 和错误处理。将模板替换为以下结构；所有条件字段和 `v-model` 保持原合同：

```vue
<form class="sub-table" :class="{ 'sub-table--modern': mode === 'modern' }" @submit.prevent="getSubUrl">
  <fieldset class="subscription-input">
    <legend class="visually-hidden">订阅输入与配置</legend>
    <label class="form-label" for="subscription-urls">订阅链接</label>
    <textarea
      id="subscription-urls"
      v-model.trim="urls"
      class="form-control"
      :placeholder="placeholder"
      rows="3"
    ></textarea>
  </fieldset>

  <div class="base-config-grid">
    <div class="form-field">
      <label class="form-label" for="client">客户端</label>
      <select id="client" v-model="target" class="form-select">
        <option v-for="option in targetOptions" :key="option.value" :value="option.value">
          {{ option.text }}
        </option>
      </select>
    </div>

    <div class="form-field">
      <label class="form-label" for="api">后端服务</label>
      <select id="api" class="form-select" @change="selectApi">
        <option :value="apiUrl">{{ apiUrl }}</option>
        <option value="manual">自定义后端 API 地址</option>
      </select>
    </div>

    <div class="form-field">
      <label class="form-label" for="remote">远程配置</label>
      <select id="remote" class="form-select" @change="selectRemoteConfig">
        <option value="">默认配置</option>
        <option v-for="option in remoteConfigOptions" :key="option.value" :value="option.value">
          {{ option.text }}
        </option>
        <option value="manual">自定义远程配置地址</option>
      </select>
    </div>
  </div>

  <Transition name="field-reveal">
    <div v-if="isShowManualApiUrl" class="conditional-field">
      <label class="form-label" for="manual-api-url">自定义后端 API 地址</label>
      <input
        id="manual-api-url"
        v-model="api"
        class="form-control"
        placeholder="例如：https://sub.ops.ci"
      />
    </div>
  </Transition>

  <Transition name="field-reveal">
    <div v-if="isShowRemoteConfig" class="conditional-field">
      <label class="form-label" for="manual-remote-config">自定义远程配置地址</label>
      <input
        id="manual-remote-config"
        v-model="remoteConfig"
        class="form-control"
        placeholder="请输入远程配置地址"
      />
    </div>
  </Transition>

  <button
    id="more-config-toggle"
    type="button"
    class="advanced-disclosure"
    :aria-expanded="String(isShowMoreConfig)"
    aria-controls="advanced-config"
    @click="showMoreConfig"
  >
    <span>高级参数</span>
    <span aria-hidden="true">{{ isShowMoreConfig ? '−' : '+' }}</span>
  </button>

  <Transition name="advanced-reveal">
    <div v-if="isShowMoreConfig" id="advanced-config" class="advanced-config">
      <div class="advanced-text-grid">
      <div class="form-field">
        <label class="form-label" for="more-config-include">Include</label>
        <input id="more-config-include" v-model="moreConfig.include" class="form-control" placeholder="可选" />
      </div>
      <div class="form-field">
        <label class="form-label" for="more-config-exclude">Exclude</label>
        <input id="more-config-exclude" v-model="moreConfig.exclude" class="form-control" placeholder="可选" />
      </div>
      </div>

      <div class="advanced-checks">
      <label class="form-check" for="emoji">
        <input id="emoji" v-model="moreConfig.emoji" class="form-check-input" type="checkbox" />
        <span>Emoji</span>
      </label>
      <label class="form-check" for="udp">
        <input id="udp" v-model="moreConfig.udp" class="form-check-input" type="checkbox" />
        <span>开启 UDP</span>
      </label>
      <label class="form-check" for="sort">
        <input id="sort" v-model="moreConfig.sort" class="form-check-input" type="checkbox" />
        <span>排序节点</span>
      </label>
      <label class="form-check" for="scv">
        <input id="scv" v-model="moreConfig.scv" class="form-check-input" type="checkbox" />
        <span>关闭证书检查</span>
      </label>
      <label class="form-check" for="nodelist">
        <input id="nodelist" v-model="moreConfig.list" class="form-check-input" type="checkbox" />
        <span>Node List</span>
      </label>
      </div>
    </div>
  </Transition>

  <div class="primary-action-row">
    <button type="submit" class="btn btn-primary">转换订阅</button>
  </div>

  <fieldset class="results-section">
    <legend>转换结果</legend>
    <p class="result-status" :class="{ 'result-status--success': result.subUrl }" aria-live="polite">
      {{ result.subUrl ? '转换链接已生成' : '转换后将在此显示结果' }}
    </p>

    <div class="result-group">
      <label class="form-label" for="converted-sub-url">转换链接</label>
      <div class="result-control-row">
        <input
          id="converted-sub-url"
          v-model.trim="result.subUrl"
          class="form-control"
          placeholder="转换后显示链接"
        />
        <button type="button" class="btn btn-secondary" :disabled="!result.subUrl" @click="toCopy(result.subUrl, '订阅链接')">
          复制
        </button>
        <button v-if="result.subUrl" type="button" class="btn btn-secondary" @click="shareSubscription">分享</button>
      </div>
    </div>

    <div class="result-group">
      <label class="form-label" for="short-url-result">短链结果</label>
      <div class="result-control-row">
        <input
          id="short-url-result"
          v-model.trim="result.shortUrl"
          class="form-control"
          placeholder="生成后显示短链"
        />
        <button type="button" class="btn btn-secondary" :disabled="!result.shortUrl" @click="toCopy(result.shortUrl, '短链')">
          复制短链
        </button>
        <button type="button" class="btn btn-secondary" @click="getShortUrl">生成短链</button>
      </div>
    </div>
  </fieldset>
</form>
```

结果区按钮合同：

- 转换结果旁增加显式“复制”按钮，调用 `toCopy(result.subUrl, '订阅链接')`，结果为空时禁用。
- 分享按钮只在 `result.subUrl` 存在时显示，调用原 `shareSubscription`。
- 短链结果旁增加显式“复制短链”按钮，调用 `toCopy(result.shortUrl, '短链')`，结果为空时禁用。
- “生成短链”使用中性次要按钮，不使用 `btn-primary`。
- 表单提交只触发原 `getSubUrl`；不要让其它按钮隐式提交。

- [ ] **步骤 4：加入现代 scoped 样式**

在 `SubTable.vue` 末尾增加：

```vue
<style scoped src="./subTableModern.css"></style>
```

创建 `src/views/home/subTableModern.css`，至少包含以下完整合同：

```css
.sub-table--modern {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 20px;
}

.sub-table--modern fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.sub-table--modern .base-config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.sub-table--modern :is(.form-field, .conditional-field, .result-group) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.sub-table--modern .form-label {
  margin: 0;
  color: #424245;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
}

.sub-table--modern :is(.form-control, .form-select) {
  width: 100%;
  min-height: 44px;
  border: 1px solid #c7c7cc;
  border-radius: 8px;
  background: #fff;
  color: #1d1d1f;
}

.sub-table--modern textarea.form-control {
  min-height: 132px;
  resize: vertical;
}

.sub-table--modern .advanced-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sub-table--modern .field-reveal-enter-active,
.sub-table--modern .field-reveal-leave-active,
.sub-table--modern .advanced-reveal-enter-active,
.sub-table--modern .advanced-reveal-leave-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.sub-table--modern .field-reveal-enter-from,
.sub-table--modern .field-reveal-leave-to,
.sub-table--modern .advanced-reveal-enter-from,
.sub-table--modern .advanced-reveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.sub-table--modern .advanced-text-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.sub-table--modern .advanced-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
}

.sub-table--modern .form-check {
  display: inline-flex;
  min-height: 40px;
  margin: 0;
  padding: 0;
  align-items: center;
  gap: 8px;
  color: #424245;
}

.sub-table--modern :is(.form-control, .form-select, button):focus-visible {
  outline: 3px solid rgba(0, 113, 227, 0.28);
  outline-offset: 2px;
}

.sub-table--modern .advanced-disclosure {
  display: flex;
  min-height: 44px;
  padding: 0;
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-top: 1px solid #d2d2d7;
  border-bottom: 1px solid #d2d2d7;
  border-radius: 0;
  background: transparent;
  color: #1d1d1f;
}

.sub-table--modern .primary-action-row {
  display: flex;
  justify-content: flex-end;
}

.sub-table--modern .btn-primary {
  min-width: 152px;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: #0071e3;
  color: #fff;
}

.sub-table--modern .results-section {
  padding-top: 24px;
  border-top: 1px solid #d2d2d7;
}

.sub-table--modern .results-section legend {
  margin-bottom: 14px;
  color: #1d1d1f;
  font-size: 17px;
  font-weight: 600;
}

.sub-table--modern .result-status {
  margin: 0 0 16px;
  color: #6e6e73;
  font-size: 13px;
}

.sub-table--modern .result-status--success {
  color: #248a3d;
}

.sub-table--modern .result-group + .result-group {
  margin-top: 16px;
}

.sub-table--modern .result-control-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
}

.sub-table--modern .btn-secondary {
  min-height: 44px;
  border: 1px solid #c7c7cc;
  border-radius: 8px;
  background: #fff;
  color: #1d1d1f;
}

.sub-table--modern .btn-secondary:disabled {
  color: #8e8e93;
  cursor: not-allowed;
  opacity: 0.65;
}

@media (max-width: 767.98px) {
  .sub-table--modern {
    gap: 16px;
  }

  .sub-table--modern .base-config-grid {
    grid-template-columns: 1fr;
  }

  .sub-table--modern .advanced-text-grid,
  .sub-table--modern .result-control-row {
    grid-template-columns: 1fr;
  }

  .sub-table--modern .primary-action-row .btn-primary {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sub-table--modern *,
  .sub-table--modern *::before,
  .sub-table--modern *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

所有现代规则只使用白色、`#f5f5f7`、中性灰、`#1d1d1f`、`#0071e3` 和成功文字绿；圆角不超过 `8px`，不得添加卡片阴影、渐变或玻璃效果。旧 scoped CSS 中只保留 legacy 模式仍使用的规则，删除 `.sub-table--modern` 重复规则。

- [ ] **步骤 5：运行组件测试和行为回归**

运行：

```bash
npm test -- tests/views/home/subTableLayout.spec.js tests/views/home/subTableModernLayout.spec.js tests/views/home
npm run lint
```

预期：现代布局测试和全部首页行为测试通过；ESLint 退出码为 `0`。转换 URL、校验、复制、分享和短链断言不得为适配新 DOM 而删除。

- [ ] **步骤 6：提交表单重设计**

```bash
git add src/views/home/SubTable.vue src/views/home/subTableModern.css tests/views/home/subTableLayout.spec.js tests/views/home/subTableModernLayout.spec.js
git commit -m "feat: redesign the conversion form"
```

## 任务 7：全量验证、浏览器验收与原型清理

**文件：**

- 删除本地原型：`prototypes/apple-macos-a/`
- 验证：全部已修改的生产文件与测试

- [ ] **步骤 1：运行完整静态与单元验证**

运行：

```bash
npm test
npm run lint
npm run build
git diff --check
```

预期：Vitest 全部通过；ESLint 退出码为 `0`；Vite 成功生成 `dist/`；`git diff --check` 无输出。

- [ ] **步骤 2：证明模板和原型没有进入生产源码或产物**

运行：

```bash
rg -n -i --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!docs/superpowers/specs/2026-07-29-apple-minimal-borderless-redesign.md' \
  --glob '!docs/superpowers/plans/2026-07-29-apple-minimal-borderless-redesign.md' \
  "subweb\.local-conversion-templates|features/templates|template-controls|saved-template|template-name|本机模板|保存模板|应用模板|删除模板|清空模板|local conversion templates|conversion templates" .
rg -n "prototypes/apple-macos-a|prototype\.css|borderless\.js" src dist
```

预期：两条命令都无输出并以 `1` 结束。第一条扫描源码、测试、配置、原型、构建产物和旧文档，而不只是网站界面；不要通过删除历史 localStorage 数据来满足断言。

- [ ] **步骤 3：启动生产预览并做三档浏览器回归**

运行：

```bash
npm run serve -- --host 127.0.0.1
```

使用 Playwright 或应用内浏览器分别检查 `1440×1000`、`768×1024`、`390×844`：

- 页面只有顶栏、标题、说明、表单和结果区，没有页脚、Hero、卡片、模板或额外面板。
- `390×844` 且高级参数收起时，“转换订阅”完整位于首屏内。
- 三个宽度都没有横向滚动、文字遮挡和按钮重叠。
- 桌面端客户端、后端服务、远程配置同一行；移动端按该顺序纵向排列。
- 自定义后端与自定义远程配置能显示、填写和隐藏。
- 高级参数默认收起，展开后值可编辑，再收起/展开后值不丢失。
- 转换生成结果并自动复制；显式复制按钮可用。
- 支持分享时调用系统分享；不支持时回退复制。
- 生成短链仍先生成转换 URL，再调用现有 `/short` 协议；失败时 loading 能关闭。
- 站点标识和 GitHub 链接均可用键盘聚焦与激活，焦点轮廓清晰；页面不存在抽屉、遮罩或隐藏菜单层。
- 浏览器控制台没有 error 或 warning。

- [ ] **步骤 4：完成视觉对照**

将生产页面与已选的 `prototypes/apple-macos-a/index.html?v=2` 无框版本并排检查，只接受以下差异：真实运行时站点名、真实菜单项、真实表单数据和生产反馈组件。若出现额外卡片、侧栏、渐变、装饰区或第二个主色按钮，回到任务 4–6 修正后重新执行步骤 1–3。

- [ ] **步骤 5：验收后删除本地原型**

确认生产页面已通过步骤 1–4 后，删除精确目录：

```bash
rm -r prototypes/apple-macos-a
```

再运行：

```bash
test ! -e prototypes/apple-macos-a
git status --short
```

预期：原型目录不存在；状态只包含本计划范围内尚未提交的改动，不包含意外文件。

- [ ] **步骤 6：提交最终验证与清理结果**

若任务 7 没有生产代码修正且原型始终未被 Git 跟踪，不创建空提交。若浏览器验收产生了必要修正，先重复全量验证，再只提交这些修正：

```bash
git add index.html src tests
git commit -m "fix: polish minimal responsive layout"
```

## 完成定义

- [ ] 用户确认的“无框极简”视觉已进入默认现代首页。
- [ ] 页面内不存在本机模板入口，模板代码无生产引用，既有 localStorage 数据未被主动删除。
- [ ] 高级参数默认收起，全部原有参数和条件输入仍有效。
- [ ] 转换、自动复制、显式复制、分享回退、短链、Dialog、notification 和 loading 行为通过回归。
- [ ] `390px`、`768px`、`1440px` 浏览器验收通过，移动端首屏可见主操作。
- [ ] `npm test`、`npm run lint`、`npm run build`、`git diff --check` 全部通过。
- [ ] 原型没有被生产源码引用，验收后本地原型目录已删除。
