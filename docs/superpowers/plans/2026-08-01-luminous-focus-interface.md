# Luminous Focus 统一界面实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不增加功能模块和页面的前提下，把 Subweb 精修为与 MyUrls 同一产品家族的单页 Luminous Focus 界面，同时修正复制失败时的误导状态。

**架构：** 保留现有 Vue Options API 和转换 URL 纯函数；新增一个纯状态模块统一复制/生成状态。页面只有居中品牌、唯一主玻璃工作区和 GitHub 来源；背景用静态环境光，输入/结果是高不透明小表面，不嵌套第二张玻璃卡。

**技术栈：** Vue 3、CSS custom properties、Vue Transition、Vitest 源码/纯函数测试、Playwright Chromium、Clipboard API、现有主题模块。

---

## 视觉和交互不可变条件

- 品牌无障碍名称和文档标题固定为 `Subconverter Web`；视觉可有对辅助技术隐藏的蓝色句点。
- 顶部不再有横跨内容的玻璃导航卡，不恢复顶部 GitHub 入口。
- 默认只显示订阅地址、目标客户端、远程配置和一个“转换并复制”主按钮。
- 后端地址收入“服务设置”，现有高级字段收入“高级参数”，两者默认收起。
- 未转换时 DOM 中不渲染结果表面和短链按钮；短链仅在当前转换结果存在时出现。
- 只有剪贴板 Promise 成功后才显示成功复制反馈；失败时显示“链接已生成，请手动复制”。
- 输出相关参数改变后，旧转换、旧短链和复制反馈立即不再可见/可用。

## 任务 1：用纯函数建模生成与复制状态

**文件：**
- 新建：`src/views/home/actionState.js`
- 新建：`tests/views/home/actionState.spec.js`
- 修改：`src/views/home/index.js`
- 修改：`tests/views/home/conversionActionState.spec.js`

- [ ] **步骤 1：先写状态机失败测试**

  定义稳定常量和返回类型：

  ```js
  export const COPY_STATUS = Object.freeze({
    IDLE: 'idle',
    COPYING: 'copying',
    COPIED: 'copied',
    MANUAL: 'manual',
  });

  export function getSubscriptionActionLabel({ hasResult, copyStatus }) {}
  export function getShortActionLabel({ hasShortUrl, copyStatus, isGenerating }) {}
  export function getCopyFeedback({ resource, copyStatus }) {}
  export function createEmptyResultState() {}
  ```

  测试要求：无结果是“转换并复制”；有结果时按钮是“复制订阅”；短链从“生成并复制短链”进入“生成中…”再进入“复制短链”；`manual` 只返回手动复制提示，不返回成功提示。

- [ ] **步骤 2：运行定向测试并确认红灯**

  ```sh
  npm test -- tests/views/home/actionState.spec.js tests/views/home/conversionActionState.spec.js
  ```

- [ ] **步骤 3：实现状态函数与输入 key 契约**

  `createEmptyResultState()` 返回：

  ```js
  {
    subUrl: '',
    shortUrl: '',
    conversionKey: '',
    shortUrlConversionKey: '',
    subscriptionCopyStatus: COPY_STATUS.IDLE,
    shortCopyStatus: COPY_STATUS.IDLE,
  }
  ```

  `createConversionInputKey` 继续只依赖影响输出的字段。新增测试明确将“服务设置是否展开”排除，将实际 API 值纳入；不让单纯展开/收起使结果过期。

- [ ] **步骤 4：绿灯并提交**

  ```sh
  npm test -- tests/views/home/actionState.spec.js tests/views/home/conversionActionState.spec.js
  git add src/views/home/actionState.js src/views/home/index.js tests/views/home/actionState.spec.js tests/views/home/conversionActionState.spec.js
  git commit -m "refactor: model conversion and clipboard action states"
  ```

## 任务 2：重构单页信息层级和可靠剪贴板流程

**文件：**
- 修改：`src/views/home/SubTable.vue`
- 修改：`tests/views/home/subTableLayout.spec.js`
- 修改：`tests/views/home/subTableModernLayout.spec.js`
- 修改：`tests/e2e/app.spec.js`

- [ ] **步骤 1：先把布局契约更新为新层级**

  源码测试断言 DOM 顺序为：订阅输入 → 客户端 → 远程配置 → 服务设置 disclosure → 高级参数 disclosure → 主操作 → 条件结果。后端 select 和自定义 API 位于 `id="service-settings"` 内，两 disclosure 都有独立 `aria-expanded` / `aria-controls`。

  结果区必须包在 `v-if="hasCurrentSubscriptionResult"` 内；短链按钮还要求 `hasShortUrlService`。不再断言空结果 input 永久存在。

- [ ] **步骤 2：先扩展 E2E 交互并确认红灯**

  在 `tests/e2e/app.spec.js` 新增：

  - 首屏没有“转换结果”、“短链”和短链按钮；
  - 默认按钮为“转换并复制”，转换成功后结果出现、按钮为“复制订阅”、短链次级操作出现；
  - 通过 init script 使 `navigator.clipboard.writeText` 拒绝，转换 URL 仍显示，`aria-live` 呈现“链接已生成，请手动复制”，不出现“复制成功”；
  - 修改客户端或订阅值后结果/短链区立即消失，再次操作用新输入；
  - 短链请求失败时保留转换 URL，不显示内部 upstream、Token 或堆栈。

  ```sh
  npm test -- tests/views/home/subTableLayout.spec.js tests/views/home/subTableModernLayout.spec.js
  npm run test:e2e -- --grep "result|clipboard|short link"
  ```

- [ ] **步骤 3：重构模板而不改变字段功能**

  - `base-config-grid` 只保留客户端和远程配置；
  - 新增 `service-settings-toggle` / `service-settings`，默认 `isShowServiceSettings: false`；
  - 保留 `more-config-toggle` / `advanced-config`、全部现有 ID/标签/转换参数；
  - 主按钮放在默认配置后、结果前，不和短链按钮排成两个同级主操作；
  - 结果用 `Transition name="result-materialize"` 条件渲染，短链按钮位于结果表面内。

- [ ] **步骤 4：让复制函数返回可信结果**

  将 `toCopy(url, title)` 改为 `copyResult(url, resource)`，返回 `Promise<boolean>`。成功设置对应 `COPIED` 并通知，失败设置 `MANUAL` 并使用结果内 `aria-live` 反馈；剪贴板失败不弹出阻断对话框。当新输入 key 不再匹配时，computed 立即隐藏旧结果，下次生成覆盖所有旧 URL/copy status。

  `getSubUrl()` 生成后 `await copyResult`；`getShortUrl()` 只在响应仍对应当前 key 时设置 ShortUrl，然后 `await copyResult`。所有异步方法都在 `finally` 恢复 loading，不将旧请求响应写入新输入。

- [ ] **步骤 5：单测/E2E 绿灯并提交**

  ```sh
  npm test -- tests/views/home
  npm run test:e2e -- --grep "converts|clipboard|short link"
  git add src/views/home/SubTable.vue tests/views/home tests/e2e/app.spec.js
  git commit -m "feat: focus conversion and result actions"
  ```

## 任务 3：实现与 MyUrls 一致的光感、材料和排版

**文件：**
- 修改：`src/styles/base.css`
- 修改：`src/layouts/main/MainLayout.vue`
- 修改：`src/layouts/main/navbar/NavBar.vue`
- 修改：`src/layouts/main/navbar/AppBrand.vue`
- 修改：`src/layouts/main/footer/FooterBar.vue`
- 修改：`src/views/home/HomeView.vue`
- 修改：`src/views/home/subTableModern.css`
- 修改：`tests/layouts/minimalNavigation.spec.js`
- 修改：`tests/layouts/mainLayoutMarkup.spec.js`
- 修改：`tests/layouts/footerBarMarkup.spec.js`
- 修改：`tests/views/home/homeLayout.spec.js`

- [ ] **步骤 1：先更新视觉源码契约并确认红灯**

  测试从“禁止任何 gradient”改为精确允许只在页面背景的静态 `radial-gradient`，并仍禁止工作区/控件内的装饰渐变。断言：

  - 品牌容器不再是 sticky 玻璃卡，文字水平居中，主题按钮在右上角/同一光学轴；
  - Home 宽度约 `46rem`，品牌、工作区和页脚光学中心一致；
  - 只有 `.sub-table--modern` 使用主玻璃 blur/shadow，Footer 是无边框轻量来源文字；
  - light/dark token 不是机械反色，两主题都有可读文字、明确 focus ring 和高不透明 control surface；
  - 交互目标最小 `44px`，没有 `transition: all`。

  ```sh
  npm test -- tests/layouts tests/views/home/homeLayout.spec.js tests/views/home/subTableModernLayout.spec.js
  ```

- [ ] **步骤 2：实现静态环境光和系统主题 token**

  `base.css` 定义浅色冷白/珍珠材料和深色烟蓝黑/亮蓝操作色；`body::before` 用静态蓝、青、淡紫 radial gradient 做环境光，`pointer-events: none`，不加循环动画。全局 canvas 仍有实色基底，使减少透明度时能直接取代 blur。

- [ ] **步骤 3：精修品牌、主表面和来源页脚**

  - NavBar 使用透明的语义 header/nav 容器，不再 sticky、border、card shadow 或 backdrop-filter；
  - AppBrand 使用居中 `Subconverter Web` 字标，可保留 favicon 作网站图标但不用左侧项目名导航排版；蓝色句点用 `aria-hidden="true"`；
  - HomeView 删除重复品牌/营销式文案，保留简短的“订阅转换”工作标题；
  - 主表面桌面圆角约 `2rem`，内控件统一更小圆角，字段间距按 4/8px 节奏；
  - Footer 只显示安全 GitHub 仓库链接，无独立玻璃卡。

- [ ] **步骤 4：实现物理感但克制的动效**

  - 主按钮 pointer-down/`:active` 使用约 `scale(0.97)` / `100ms`，次按钮与 disclosure 使用更轻的 `scale(0.985)`；
  - disclosure 和主题过渡 `160–240ms`，结果 materialize `280–320ms` 使用轻微 opacity/blur/scale，无 overshoot/bounce；
  - 动画不禁用 pointer input，Vue Transition 能从当前状态中断并反向；
  - reduced motion 去掉位移/缩放/blur，只保留短促透明度/颜色；reduced transparency 去 blur 并提高不透明度；more contrast 使用近实色材料、强边框和强 focus ring。

- [ ] **步骤 5：单测绿灯并提交**

  ```sh
  npm test -- tests/layouts tests/views/home/homeLayout.spec.js tests/views/home/subTableModernLayout.spec.js
  git add src/styles/base.css src/layouts/main src/views/home/HomeView.vue src/views/home/subTableModern.css tests/layouts tests/views/home/homeLayout.spec.js tests/views/home/subTableModernLayout.spec.js
  git commit -m "style: align subweb with luminous focus"
  ```

## 任务 4：扩展主题、无障碍和响应式浏览器验证

**文件：**
- 修改：`tests/e2e/app.spec.js`
- 修改：`playwright.config.js`
- 新建：`tests/e2e/helpers/browserPreferences.js`
- 新建：`docs/validation/interface.md`

- [ ] **步骤 1：添加四类环境和键盘失败测试**

  Playwright 项目/参数至少覆盖：

  - desktop `1440×900` light/dark；mobile `390×844` light/dark；
  - `reducedMotion: 'reduce'`，通过 CDP 或注入 media emulation 覆盖 reduced transparency/more contrast；
  - 从页首 Tab 到主题、订阅、客户端、远程、两 disclosure、主操作、结果和短链的焦点顺序；
  - Enter/Space 展开和收起，`aria-expanded` 与可见状态一致；
  - 每个视口 `documentElement.scrollWidth <= innerWidth`，44px 目标尺寸，品牌和主表面中心差在 1 CSS px 内；
  - 页面没有模板功能、顶部 GitHub、空结果、重复复制按钮或横向溢出。

- [ ] **步骤 2：为媒体偏好创建单一 helper**

  `browserPreferences.js` 只负责可恢复的 media emulation，每个测试结束恢复默认。若 Chromium 无法原生模拟 reduced transparency/more contrast，helper 通过测试专用 `addInitScript` 包装 `matchMedia`，只对准确 query 返回 true，不污染其他 media query。

- [ ] **步骤 3：运行全套 E2E 并检查视觉**

  ```sh
  npm run test:e2e
  ```

  在桌面/移动、浅色/深色各保存一张临时截图作人工审查，审查品牌光学居中、环境光边界、主表面层级、文字对比和控件节奏。截图保留在 `test-results/` 或系统临时目录，不提交 Git。

- [ ] **步骤 4：记录无截图验证摘要并提交**

  `docs/validation/interface.md` 记录浏览器版本、视口/主题/媒体偏好矩阵、E2E 计数、人工审查结论和已知非阻断差异；不把临时截图或用户订阅值提交。

  ```sh
  git add tests/e2e playwright.config.js docs/validation/interface.md
  git commit -m "test: cover luminous interface preferences and viewports"
  ```

## 任务 5：执行完整 UI 回归和 bundle 边界

**文件：**
- 修改：`tests/project/projectCleanup.spec.js`
- 修改：`tests/build/viteOutput.spec.js`

- [ ] **步骤 1：扩展禁止项测试**

  禁止清单包括：模板 UI/状态/存储、营销 hero、漂浮光球循环动画、插画/外部字体请求、顶部 GitHub 链接、旧 `uxMode/presentation`、重复主操作和秘密字段。`dist` 测试扫描不得包含 `MYURLS_API_TOKEN`、`REDIS_PASSWORD`、内部 Service hostname 或 `.runtime` 路径。

- [ ] **步骤 2：全套验证**

  ```sh
  npm run verify
  npm run test:e2e
  ```

  预期：现有转换参数、远程配置、高级选项、主题持久化、GitHub 安全来源和短链 multipart 边界全部保留。

- [ ] **步骤 3：提交最终 UI 门禁**

  ```sh
  git add tests/project/projectCleanup.spec.js tests/build/viteOutput.spec.js
  git commit -m "test: protect the focused interface release boundary"
  ```

## 本计划审查门禁

- [ ] 常用路径在一页完成，无模板、账号、数据卡、营销区或第二主面板。
- [ ] 未转换时没有结果表面和短链操作；转换成功后只有一个转换结果和一个短链次级操作。
- [ ] 剪贴板拒绝时 URL 仍可手动选择，页面不宣称成功复制。
- [ ] 主题、reduced motion、reduced transparency、more contrast、键盘和 390px 视口全部通过真实浏览器测试。
- [ ] 环境光是静态页面背景，工作区内不嵌套玻璃卡，无循环动画、弹跳或不可中断过渡。
- [ ] 与 MyUrls 统一的是 token/材料/节奏/反馈，不复制 MyUrls DOM、图形资产或业务界面。
