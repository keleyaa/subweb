# 前端现代化与本机体验设计

**状态：** 用户已批准执行，范围限定为前端

## 目标

将此前标记为 design-only 的 P1、P2、P3 前端部分实现为可并行验证、可回滚的能力：

- 以 Vite 作为唯一开发与生产构建工具，移除 Vue CLI 专属发布路径。
- 保持 Vuex 为唯一状态源，并用 Pinia facade 渐进迁移布局样式状态的消费方。
- 为首页提供由运行时配置控制的新旧 UX 呈现，并保持转换、复制和短链协议不变。
- 提供仅保存非敏感转换偏好的本机模板，以及用户显式触发的系统原生分享。

## 范围与非目标

本轮只修改浏览器端代码、静态资源、构建工具和测试。不会新增后端、登录、管理员后台、云同步、服务端分享链接、路由、查询参数合同或外部请求。

模板存储不得包含订阅输入、转换结果、短链结果、`apiUrl`、`shortUrl`、手动 API、远程配置 URL 或任何 URL/token。现有 `/short` v1 请求形状保持为 `POST {shortUrl}/short` 和 `FormData.longUrl=btoa(result.subUrl)`。

Harbor、provenance/SBOM 和生产 tag/部署回滚不属于本规格。

## 架构决策

### 1. Vite 直接构建

Vite 完成等价构建验证后，`serve` 和 `build` 直接调用 Vite，生产输出统一为 `dist`，继续满足 Docker 对 `/app/dist` 的复制合同。Vue CLI 脚本、专属配置和依赖被移除，不长期维护双工具链；回滚通过还原 Vite 切换前的 Git 提交完成。

Vite 配置复用当前 alias、Element Plus 自动导入和组件自动注册；它为 `process.env.BASE_URL` 提供 `/` 定义，避免在共享 router 源码中引入只适用于 Vite 的表达式。根 `index.html` 在应用模块前加载 `/conf/config.js`，并从同一个运行时配置模块获得缺失或无效配置的回退。构建目标显式为 `es2015`；IE11 仍不受支持，且不会为已无服务端要求的旧浏览器添加 legacy bundle 或 polyfill。

### 2. 运行时配置合同

新增可测试的 `normalizeRuntimeConfig`，在应用挂载前处理 `window.config`。它保留既有字段，并新增严格字段：

```js
uxMode: 'legacy' | 'modern'
```

缺失、非字符串或未知值一律回退到 `legacy`。仓库默认 `public/conf/config.js` 可显式设置 `modern`，而缺失配置文件和无效配置始终安全回退至旧呈现。配置是在页面加载时读取的静态值，变更需要刷新页面生效。

### 3. Vuex 到 Pinia 的单向 facade

Vuex 继续拥有 `style.main.navStyles` 和 `style.main.isCollapsed`。Pinia 只提供读取这些状态并转发既有 Vuex mutation 的 facade，不复制状态、不双写、不迁移全局 dialog 或空的 menu 模块。

布局和导航中的样式状态消费方逐步改用 facade；现有 `Set` 到 class 的顺序和菜单展开/关闭语义保持不变。移除 Pinia 或恢复这些消费方即可完整回退。

### 4. 首页 UX 模式

路由、`App.vue`、全局 dialog、loading、notification 和 `MainLayout` 不分支。`HomeView` 只决定 `legacy` 或 `modern` 首页呈现；`SubTable` 始终只有一份挂载实例，以防止重复 id、重复表单状态或重复请求。

现代呈现优化信息层级和响应式布局，但维持输入顺序、label/id 关联、可编辑结果字段、转换后复制、短链前重新生成转换链接、loading 清理和所有网络协议。清理失效的 `selectTarget` 监听；统一用户可见的“短链”文案。

### 5. 本机偏好模板

新增 versioned `localStorage` envelope，最多保存 12 条命名模板。每条模板仅包含：

```js
{
  id: string,
  name: string,
  target: string,
  moreConfig: {
    include: string,
    exclude: string,
    emoji: boolean,
    udp: boolean,
    sort: boolean,
    scv: boolean,
    list: boolean
  }
}
```

读取时验证 schema；损坏、旧版或未知字段数据回退为空集合。保存、应用、删除和清空模板均不调用网络，也不改变部署级 `window.config` 所有权。

### 6. 显式原生分享

仅当 `result.subUrl` 已存在且用户点击分享按钮时调用 `navigator.share({ url: result.subUrl })`。平台不支持时回退复制；用户取消分享不显示错误，也不改变转换或短链状态。分享操作不自动生成短链、不写入模板、不发送额外网络请求。

## 测试策略

新增 Vitest 作为最小前端测试骨架，先覆盖纯函数和适配器：运行时配置归一化、模板 schema/存储、原生分享分支、Pinia facade 的 Vuex 转发。每项行为遵循红-绿循环。

集成验证必须执行 Vite build、非自动修复 ESLint、P1 白名单 lint、Vitest、Docker build/run 和 `git diff --check`。本地浏览器在 375、768、1440 宽度验证 `legacy`/`modern` 配置、单一表单 id、模板不存敏感字段、转换/复制/短链路径和控制台无 Vue 警告。

## 回滚策略

- Vite：恢复 Vite 直接切换前的 Git 提交；Docker 输出目录始终保持 `dist`。
- Pinia：移除 facade 并恢复 Vuex 消费方；Vuex 状态从未被移除。
- UX：将 `uxMode` 改为 `legacy`，或恢复首页和表单的对应提交。
- 模板/分享：移除 UI 和适配器；本机 `localStorage` 只使用命名空间键，不影响现有应用数据。

## 交付顺序

1. 建立测试骨架、运行时配置模块并验证 Vite 构建。
2. 将 Vite 提升为唯一开发/生产构建工具，验证 Docker runtime config 合同。
3. 引入 Pinia facade 和白名单静态约束。
4. 实现 UX 模式、现代首页呈现和回归修复。
5. 实现本机偏好模板和显式原生分享。
6. 完成构建、单元测试、浏览器回归和独立审查。
