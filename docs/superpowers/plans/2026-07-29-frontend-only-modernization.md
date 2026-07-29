# 前端现代化实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development 逐任务实现本计划。步骤使用复选框跟踪进度。

**目标：** 以 Vite 取代 Vue CLI 作为唯一开发/生产构建工具，同时完成 Pinia facade、可回退首页 UX 和显式原生分享；不引入服务端能力。

**架构：** Vite 通过根 index.html、公共静态目录和 runtime config 模块构建到 dist；Vuex 继续拥有状态，Pinia 只读/转发。首页通过静态 window.config.uxMode 选择呈现；分享封装为可单测的纯前端模块。

**技术栈：** Vue 3、Vuex 4、Pinia 2.2.4、Vite 6.4.3、@vitejs/plugin-vue 5.2.4、Vitest 2.1.9。

---

## 文件结构

- package.json / package-lock.json：固定前端依赖和独立脚本。
- vite.config.mjs、根 index.html：Vite 旁路入口与构建配置。
- src/runtime/config.js：运行时配置归一化与 uxMode 合同。
- src/stores/styleFacade.js：Pinia 对 Vuex style.main 的单向 facade。
- src/features/share/nativeShare.js：显式系统原生分享适配器。
- src/views/home/HomeView.vue、src/views/home/SubTable.vue：首页 UX 和分享 UI。
- `tests/**/*.spec.js`：配置、状态和分享的行为测试。

## 任务 1：[x] 建立运行时配置测试骨架与 Vite 旁路

已在 `c01dd53` 完成；以下验证记录对应切换前的兼容阶段。

**文件：**

- 创建：tests/runtime/config.spec.js、src/runtime/config.js、vite.config.mjs、根 index.html
- 修改：package.json、package-lock.json、src/main.js、public/index.html

- [x] **步骤 1：添加测试工具并定义失败的配置合同**

在 package.json 增加精确版本与脚本：

```json
{
  "scripts": {
    "dev:vite": "vite",
    "build:vite": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": { "pinia": "2.2.4" },
  "devDependencies": {
    "@vitejs/plugin-vue": "5.2.4",
    "vite": "6.4.3",
    "vitest": "2.1.9"
  }
}
```

创建 tests/runtime/config.spec.js：

```js
import { describe, expect, it } from 'vitest';
import { normalizeRuntimeConfig } from '@/runtime/config';

describe('normalizeRuntimeConfig', () => {
  it('uses defaults when config is absent', () => {
    expect(normalizeRuntimeConfig()).toMatchObject({
      siteName: 'Subconverter Web',
      uxMode: 'legacy',
    });
  });

  it('keeps only supported ux modes', () => {
    expect(normalizeRuntimeConfig({ uxMode: 'modern' }).uxMode).toBe('modern');
    expect(normalizeRuntimeConfig({ uxMode: 'preview' }).uxMode).toBe('legacy');
  });
});
```

- [x] **步骤 2：运行红灯测试**

运行：npm test -- tests/runtime/config.spec.js

预期：失败，报错无法解析 @/runtime/config。

- [x] **步骤 3：实现运行时配置模块与应用安装**

创建 src/runtime/config.js，导出 normalizeRuntimeConfig(config) 和 installRuntimeConfig(globalObject)。前者仅保留 siteName、apiUrl、shortUrl、menuItem、remoteConfigOptions 和 uxMode；数组字段必须是数组，uxMode 仅接受 legacy/modern。后者必须执行：

```js
globalObject.config = normalizeRuntimeConfig(globalObject.config);
return globalObject.config;
```

在 src/main.js 的 createApp 前执行：

```js
import { installRuntimeConfig } from '@/runtime/config';

installRuntimeConfig(window);
```

从 Vue CLI public/index.html 删除内联归一化脚本，保留 script src="<%= BASE_URL %>conf/config.js"。根 index.html 使用相同文档结构、/conf/config.js 和：

```html
<script type="module" src="/src/main.js"></script>
```

- [x] **步骤 4：实现 Vite 配置**

vite.config.mjs 使用 Vite、Vue、Vite 版 auto-import/components 插件和 ElementPlusResolver；配置 @、layouts、assets、components、network、views、utils alias，base: '/'、build.outDir: 'dist-vite'、build.sourcemap: false，以及：

```js
define: {
  'process.env.BASE_URL': JSON.stringify('/'),
}
```

同一配置的 test 块使用 node 环境与 `tests/**/*.spec.js`。不得修改 vue.config.js、serve、build、Dockerfile 或 workflow。

- [x] **步骤 5：验证绿灯与两套构建**

运行：

```bash
npm test -- tests/runtime/config.spec.js
npm run build
npm run build:vite
test -f dist/conf/config.js
test -f dist-vite/conf/config.js
```

预期：测试通过；两套构建均成功且各自产物包含运行时配置文件。

- [x] **步骤 6：提交**

```bash
git add package.json package-lock.json vite.config.mjs index.html public/index.html src/main.js src/runtime/config.js tests/runtime/config.spec.js
git commit -m "feat: add Vite compatibility build"
```

## 任务 2：[x] 将 Vite 提升为默认构建

**文件：**

- 创建：tests/build/viteOutput.spec.js
- 修改：package.json、package-lock.json、vite.config.mjs、.eslintrc.js、.gitignore
- 删除：vue.config.js、babel.config.js、public/index.html

- [x] **步骤 1：编写 Vite 输出目录的失败测试**

```js
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.mjs';

describe('production Vite output', () => {
  it('uses the Docker-compatible dist directory', () => {
    expect(viteConfig.build.outDir).toBe('dist');
  });
});
```

- [x] **步骤 2：运行红灯测试**

运行：npm test -- tests/build/viteOutput.spec.js

预期：失败，因为当前 Vite 输出是 dist-vite。

- [x] **步骤 3：完成直接切换**

将 serve 改为 vite、build 改为 vite build，并将 lint 改为非自动修复的 eslint --ext .js,.vue src；移除 dev:vite 和 build:vite。Vite 输出改为 dist 且 build.target 为 es2015。删除 Vue CLI 专属依赖、vue.config.js、babel.config.js、public/index.html 和失效的 /dist-vite ignore；保留 @babel/core 与 @babel/eslint-parser，直到 ESLint parser 有独立迁移任务。

Dockerfile 保持不变，因为它已经调用通用 npm run build 并复制 /app/dist。不得新增 legacy bundle、Polyfill、第二套 build script 或 Docker 输出目录。

- [x] **步骤 4：验证 Vite、lint 和容器合同**

```bash
npm ci --ignore-scripts
npm test
npm run lint
npm run build
test -f dist/index.html
test -f dist/conf/config.js
test -f dist/favicon.ico
docker build -t subweb:vite-cutover .
```

启动容器时使用 loopback 随机端口并注入 API_URL、SHORT_URL、SITE_NAME；验证首页和 /conf/config.js 返回 200，产物配置包含注入值。

- [x] **步骤 5：提交**

```bash
git add package.json package-lock.json vite.config.mjs .eslintrc.js .gitignore tests/build/viteOutput.spec.js
git add -u vue.config.js babel.config.js public/index.html
git commit -m "feat: make Vite the default builder"
```

## 任务 3：[x] 引入 Pinia facade 与白名单静态约束

**文件：**

- 创建：src/stores/styleFacade.js、tests/stores/styleFacade.spec.js
- 修改：src/main.js、src/layouts/main/MainLayout.vue、src/layouts/main/navbar/NavBar.vue、src/layouts/main/navbar/NavMenu.vue、src/layouts/main/navbar/AppBrand.vue、package.json

- [x] **步骤 1：编写 Pinia facade 的失败测试**

```js
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vuexStore from '@/store';
import { useStyleFacadeStore } from '@/stores/styleFacade';

describe('style facade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND_CLOSE');
    vuexStore.commit('MAIN_LAYOUT_NAV_ACTIVE', false);
  });

  it('forwards menu expansion to Vuex without owning duplicate state', () => {
    const facade = useStyleFacadeStore();
    facade.toggleMenu();
    expect(vuexStore.state.style.main.isCollapsed).toBe(true);
    expect(facade.isCollapsed).toBe(true);
  });
});
```

- [x] **步骤 2：运行红灯测试**

运行：npm test -- tests/stores/styleFacade.spec.js

预期：失败，报错无法解析 @/stores/styleFacade。

- [x] **步骤 3：实现 facade 并注册已安装的 Pinia**

src/stores/styleFacade.js 使用 defineStore('style-facade', ...) 读取 vuexStore.state.style.main，并定义：

```js
toggleMenu() {
  vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND');
},
closeMenu() {
  vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND_CLOSE');
},
setNavActive(active) {
  vuexStore.commit('MAIN_LAYOUT_NAV_ACTIVE', active);
}
```

getter navStyles 必须返回 Array.from(vuexStore.state.style.main.navStyles)，不得复制 Set 到 Pinia state。src/main.js 创建 Pinia 并在 Vuex 后安装：

```js
app.use(router).use(store).use(pinia);
```

将四个布局/导航消费方改为从 facade 读取或调用上述动作；不得改动 dialog、menu 模块或 Vuex mutation。

- [x] **步骤 4：添加白名单 lint 合同**

在 package.json 增加：

```json
"lint:p1-04a": "eslint src/views/home/index.js src/network/index.js"
```

不得改变默认 lint、.eslintrc.js、jsconfig.json 或全仓 warning 预算。

- [x] **步骤 5：验证绿灯**

```bash
npm test -- tests/stores/styleFacade.spec.js
npm run lint:p1-04a
npm run lint
npm run build
```

预期：所有命令退出码为 0；Vuex 仍是唯一写入状态源。

- [x] **步骤 6：提交**

```bash
git add src/main.js src/stores/styleFacade.js src/layouts/main/MainLayout.vue src/layouts/main/navbar/NavBar.vue src/layouts/main/navbar/NavMenu.vue src/layouts/main/navbar/AppBrand.vue tests/stores/styleFacade.spec.js package.json
git commit -m "feat: add Pinia style facade"
```

## 任务 4：[x] 实现运行时可回退的首页 UX

**文件：**

- 修改：public/conf/config.js、src/views/home/HomeView.vue、src/views/home/SubTable.vue
- 测试：扩展 tests/runtime/config.spec.js

- [x] **步骤 1：先扩展配置红灯测试**

```js
it('does not allow an invalid mode to opt into modern UI', () => {
  expect(normalizeRuntimeConfig({ uxMode: null }).uxMode).toBe('legacy');
  expect(normalizeRuntimeConfig({ uxMode: 'modern' }).uxMode).toBe('modern');
});
```

运行：npm test -- tests/runtime/config.spec.js

预期：在 uxMode 尚未写入实际部署配置前，测试仍通过；后续浏览器检查确认页面使用归一化后的模式。

- [x] **步骤 2：实现模式配置和单实例首页呈现**

在 public/conf/config.js 显式写入：

```js
uxMode: 'modern',
```

HomeView.vue 只根据 window.config.uxMode === 'modern' 改变标题、介绍区和 CSS class；它只能渲染一个 <SubTable :mode="uxMode" />。不得新增 route、query、Vuex 临时开关或第二个 SubTable。

SubTable.vue 接收：

```js
props: {
  mode: { type: String, default: 'legacy' },
},
```

并以 mode class 改善响应式信息分组。删除不存在的 @change="selectTarget"，保留所有 v-model、现有 id、可编辑输出、转换后复制、短链请求和 loading finally 清理。统一可见文案为“短链”。

- [x] **步骤 3：验证行为和浏览器回归**

```bash
npm test -- tests/runtime/config.spec.js
npm run lint
npm run build
```

启动本地服务后，在 375、768、1440 宽度检查：无效/缺失 uxMode 只显示 legacy；modern 只显示一个表单；label/id 和 Tab 顺序正确；控制台没有 selectTarget 或重复 id 警告；转换、复制和短链成功/失败路径保持。

- [x] **步骤 4：提交**

```bash
git add public/conf/config.js src/views/home/HomeView.vue src/views/home/SubTable.vue tests/runtime/config.spec.js
git commit -m "feat: add runtime UX mode"
```

## 任务 5：[x] 实现显式原生分享与全量验证

**文件：**

- 创建：src/features/share/nativeShare.js、tests/features/share/nativeShare.spec.js
- 修改：src/views/home/SubTable.vue

- [x] **步骤 1：编写原生分享分支的失败测试**

```js
import { describe, expect, it } from 'vitest';
import { shareUrl } from '@/features/share/nativeShare';

it('does not invoke the platform share API without a URL', async () => {
  const navigatorObject = {
    share: async () => {
      throw new Error('must not run');
    },
  };
  await expect(shareUrl('', navigatorObject)).resolves.toEqual({ status: 'missing' });
});

it('marks an explicit user cancellation as cancelled', async () => {
  const navigatorObject = {
    share: async () => {
      throw Object.assign(new Error(), { name: 'AbortError' });
    },
  };
  await expect(shareUrl('https://example.test/sub', navigatorObject)).resolves.toEqual({ status: 'cancelled' });
});
```

- [x] **步骤 2：运行红灯测试**

运行：npm test -- tests/features/share/nativeShare.spec.js

预期：失败，报错无法解析原生分享模块。

- [x] **步骤 3：实现分享适配器和 UI**

shareUrl(url, navigatorObject = globalThis.navigator) 必须返回 missing、unsupported、shared、cancelled 或 failed；只有有 URL 且 navigatorObject.share 是函数时才能调用：

```js
await navigatorObject.share({ url });
```

在 SubTable.vue 中只在结果存在时显示分享按钮。unsupported 回退调用既有 toCopy(result.subUrl, '订阅链接')；cancelled 不提示错误；failed 显示既有错误 dialog。分享不得生成转换、生成短链或改变网络请求。

- [x] **步骤 4：执行全部验证**

```bash
npm test
npm run lint:p1-04a
npm run lint
npm run build
git diff --check
```

启动 Vite 服务执行本地浏览器 smoke：加载 conf/config.js，分享功能可见，modern/legacy 回退正确，控制台无错误。对分享使用 mock 或取消的系统面板，不调用真实短链或远程配置服务。

- [x] **步骤 5：提交**

```bash
git add src/features/share/nativeShare.js tests/features/share/nativeShare.spec.js src/views/home/SubTable.vue
git commit -m "feat: add native subscription sharing"
```

## 最终验收

- [x] 每个新纯函数都先经过失败测试，再以最小实现转绿。
- [x] npm test、Vite build、两条 lint、Docker runtime 验证和 git diff --check 均通过。
- [x] Vite/Docker 默认构建合同、Vuex 唯一状态源、/short v1 协议和 runtime config 所有权未改变。
- [x] 浏览器在三种视口、Vite 构建和两种 UX mode 下无 console error、重复 id 或交互回退。
