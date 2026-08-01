# Subweb 一体化发行与统一界面设计规格

日期：2026-08-01

状态：已于 2026-08-01 确认书面规格，等待按实施计划执行

## 1. 决策摘要

本项目采用“发行编排整合、上游源码保持独立”的方案：

- `keleyaa/subweb` 继续作为当前维护仓库，同时承担一体化发行入口、部署编排、
  统一网关配置、部署文档和集成测试。
- MyUrls 继续在独立的 `keleyaa/MyUrls` 仓库维护。本仓库不复制其源码、不使用
  Git submodule，只引用经过发布验证并固定版本与镜像 digest 的构建产物。
- SubConverter-Extended 直接使用
  `Aethersailor/SubConverter-Extended` 官方发布，不 fork、不复制源码；发行时固定
  非预发布版本和镜像 digest。
- 保留维护者展示域名 `https://ml1.one` 与 `https://api.ml1.one`，同时让其他部署者
  只需替换两个域名变量即可部署自己的实例。
- 正式提供四类部署方法：本机源码运行、Docker、Railway、Render。Vercel、
  Cloudflare Pages、Netlify、Fly.io 等不属于本次正式支持范围。
- Subweb 依据 MyUrls 已落地的 Luminous Focus 视觉语言和 Apple Design 原则重新精修，
  但保留 Subweb 的信息结构、功能和独立品牌。

## 2. 目标

1. 用户可以从一个仓库完成 Subweb、SubConverter-Extended、MyUrls 和 Redis 的部署、
   配置、验证、升级与回滚。
2. 默认公开入口只有 Subweb Nginx 网关；MyUrls 创建接口、Redis 和转换后端的内部管理面不直接
   暴露。
3. 部署者能够明确选择已有反向代理、平台 TLS 或自备证书直连 Nginx；默认配置不抢占
   `80/443`。
4. Railway 和 Render 使用平台提供的 TLS、域名、私有网络和变量管理，不在容器内争抢
   公网端口。
5. 本机源码运行不依赖 Docker，正式支持 macOS 和主流 Linux；Windows 通过 WSL2
   使用 Linux 流程，不维护原生 PowerShell 服务脚本。
6. Subweb 与 MyUrls 在背景、材料、圆角、排版、主题、反馈和动效上形成同一产品家族，
   默认操作仍然简洁、单页、无多余模块。
7. 发布仓库只包含源码、必要部署描述、测试和文档；密钥、缓存、运行数据、下载的上游
   源码与生成物不进入 Git。

## 3. 非目标

- 不把三个仓库合并为 monorepo，不改变各自 Git 历史或许可证归属。
- 不 fork SubConverter-Extended，也不承诺自动兼容其未来未验证版本。
- 不增加账号、订阅存储、用户数据库、管理后台、模板系统或统计面板。
- 不为 Vercel、Cloudflare Pages 等平台提交半成品配置。
- 不用 Base64、前端混淆或日志隐藏代替真正的秘密管理。
- 不在安装脚本中静默执行 `brew install`、`apt install`、`sudo` 或修改系统服务。
- 不让测试脚本杀死与本项目无关的进程或清理用户已有数据。

## 4. 仓库和来源边界

### 4.1 Subweb 仓库职责

本仓库保存：

- Vue/Vite 前端源码和测试；
- 前端生产镜像；
- 统一 Nginx 静态服务与网关配置；
- 一体化 `compose.yaml`；
- 本机源码运行的检查、启动、状态和停止脚本；
- Railway 与 Render 的必要部署描述；
- 跨服务契约测试、部署验证和运维文档；
- 第三方来源、固定版本、镜像 digest、许可证和升级记录。

### 4.2 MyUrls 边界

- 集成只消费 `ghcr.io/keleyaa/myurls` 的固定版本或 commit SHA 镜像，并记录 digest。
- 本机源码模式从独立 checkout 或固定发布源码构建，不把源码提交到 Subweb。
- 如果 Railway 或 Render 需要 Redis URL/TLS 兼容能力，改动必须在 MyUrls 独立仓库
  设计、测试并发布，然后本仓库升级固定引用；不得在集成层复制一份 Go 实现。
- MyUrls 的 Redis 数据格式、短码大小写、创建响应和一年 TTL 契约保持不变。

### 4.3 SubConverter-Extended 边界

- 使用官方稳定发行版和官方镜像；版本选择规则是“集成基线建立时最新的非预发布版，
  通过本项目契约测试后固定 tag 与 digest”。
- 配置文件由本仓库提供最小覆盖层，但保留官方默认文件和许可声明。
- 升级必须经过转换契约、配置解析、健康检查和真实订阅哨兵测试，不能直接跟随
  `latest`。

## 5. 运行架构

一体化发行包含四个逻辑服务：

| 服务 | 职责 | 公网可见性 |
| --- | --- | --- |
| web-gateway | Nginx 提供 Subweb 静态文件、Host/路径路由、短链接口鉴权注入、日志脱敏和可选自备证书 TLS | 唯一公开入口 |
| subconverter | 执行订阅转换 | 仅 web-gateway 可达 |
| myurls | 创建短链和执行短码跳转 | 仅 web-gateway 可达 |
| redis | 持久保存短链 | 仅 MyUrls 可达 |

Subweb 当前生产镜像已经使用 Nginx，因此静态服务和统一网关合并为一个边界，不再引入
另一套业务代理。Docker 与 PaaS 使用四个服务，本机源码模式使用独立
进程实现同一边界。任何部署方式都必须保持相同的路由、健康检查、安全和升级契约。

## 6. 域名与路由

### 6.1 展示部署

| 入口 | 行为 |
| --- | --- |
| `https://ml1.one/` | Subweb 单页应用 |
| `POST https://ml1.one/short-api/short` | web-gateway 注入内部 Bearer Token 后转发 MyUrls `/short` |
| `GET https://ml1.one/<shortKey>` | 转发 MyUrls 短码跳转 |
| `https://api.ml1.one/*` | 转发 SubConverter-Extended |

路由优先级固定为：健康检查、短链创建接口、前端静态资源、首页、合法短码、前端回退。
短码路由必须使用与 MyUrls 相同的合法字符和保留词规则，不能把 `/assets`、`/conf`、
`/healthz`、`/short-api` 或未来明确登记的前端路径误判为短码。

### 6.2 自定义域名

部署者只需提供：

```dotenv
APP_DOMAIN=example.com
API_DOMAIN=api.example.com
```

公开短链基址由 `APP_DOMAIN` 和部署协议推导，不再要求第三个域名。维护者展示环境等价于：

```dotenv
APP_DOMAIN=ml1.one
API_DOMAIN=api.ml1.one
```

浏览器运行时的公开演示默认值继续为 `https://ml1.one` 和
`https://api.ml1.one`；一体化部署配置必须显式生成，不允许普通部署者在未配置域名时
误用维护者的创建接口。

### 6.3 网关规则

- `/short-api/short` 只接受 `POST` 和既有合法内容类型，限制请求体大小。
- web-gateway 删除客户端传入的 `Authorization`，再写入部署秘密中的 MyUrls Token，防止
  客户端伪造或借用其他凭据。
- MyUrls 创建接口不分配独立公网域名，不映射宿主机端口。
- API 域名保留转换服务需要的路径与查询参数，不修改 SubConverter 的公开协议。
- web-gateway 向上游传递正确的 `Host`、`X-Forwarded-For`、`X-Forwarded-Host` 和
  `X-Forwarded-Proto`；只有受信任的外层代理来源可以影响客户端地址解析。
- 转换请求的原始查询串可能包含订阅令牌。网关访问日志不得记录原始查询串，短链创建
  请求体和 Authorization 也不得进入日志。

## 7. 配置模型

### 7.1 公开配置

公开配置只包含浏览器可以读取的值：

- APP 与 API 公网地址；
- GitHub 仓库链接；
- 远程配置预设；
- UI 功能开关。

公开配置中禁止写入 Redis 密码、MyUrls Token、Railway/Render 凭据、订阅地址或其他
秘密。

### 7.2 秘密配置

以下值只存在于 `.env`、平台 Secret/Variable 或进程环境：

- `MYURLS_API_TOKEN`；
- `REDIS_PASSWORD` 或平台 Redis 连接秘密；
- 平台部署令牌；
- 镜像仓库私有凭据。

`scripts/configure.sh` 首次运行时生成高强度 Token 和 Redis 密码；再次运行只更新明确
传入的非秘密配置，除非用户显式请求轮换，否则不覆盖现有秘密。脚本不得把秘密输出到
终端、命令历史、日志或生成的公开 JavaScript。

### 7.3 镜像与源码锁定

发行配置记录：

- Subweb 源码 commit；
- MyUrls tag、commit 和镜像 digest；
- SubConverter-Extended tag 与镜像 digest；
- Redis 镜像 tag 与 digest；
- Nginx 基础镜像 tag 与 digest。

任何生产示例都不得使用未固定的 `latest` 作为可重复部署依据。

## 8. 正式部署方法

### 8.1 本机源码运行

#### 支持范围

- macOS 当前受支持版本，Apple Silicon 与 Intel；
- 主流 Linux x86_64 与 arm64；
- Windows 通过 WSL2 使用 Linux 脚本；
- 不提供原生 Windows 服务注册、批处理或 PowerShell 生命周期管理。

#### 依赖

- Node.js 与 npm 使用 Subweb `package.json` 声明的版本范围；
- Go 使用 MyUrls `go.mod` 与 toolchain 声明；
- Redis 使用 MyUrls 已验证的主版本范围；
- CMake、C++ 工具链及其他依赖按 SubConverter-Extended 固定发行版官方构建说明；
- Nginx 使用操作系统受支持版本作为本机统一网关。

文档分别给出 Homebrew 和 Debian/Ubuntu 系列的显式安装命令，但脚本只检查依赖并报告
缺失项，不自行获得管理员权限。

#### 源码位置

- Subweb 使用当前仓库；
- MyUrls 使用用户指定的独立 checkout，或由 bootstrap 下载到操作系统缓存目录的固定
  源码；
- SubConverter-Extended 使用用户指定的官方 checkout，或下载到缓存目录的固定源码；
- 下载缓存、构建目录、PID、日志和运行数据均不提交 Git。

用户可以通过 `MYURLS_SOURCE_DIR` 和 `SUBCONVERTER_SOURCE_DIR` 指向已有 checkout。
bootstrap 不修改这些 checkout，不自动切分支，也不把它们加入 Subweb 工作树。

#### 固定本地端口

| 进程 | 监听地址 |
| --- | --- |
| Subweb Vite | `127.0.0.1:5173` |
| SubConverter-Extended | `127.0.0.1:25500` |
| MyUrls | `127.0.0.1:18082` |
| 项目专用 Redis | `127.0.0.1:16379` |
| 本地 APP web-gateway | `127.0.0.1:18080` |
| 本地 API web-gateway | `127.0.0.1:18081` |

所有端口只绑定 loopback。启动前逐个探测；端口已占用时报告进程和变量名并退出，不自动
杀进程。端口允许通过 `.env` 更换，但 web-gateway、运行时配置、MyUrls 公开短链基址和
健康检查必须一起重算。

#### 生命周期命令

最终用户流程限定为：

```sh
./scripts/local/bootstrap.sh
./scripts/local/start.sh
./scripts/local/status.sh
./scripts/local/stop.sh
```

- `bootstrap.sh` 检查工具、固定源码引用、构建所需组件并创建被忽略的运行目录；重复
  执行必须幂等。
- `start.sh` 先做端口和配置预检，再依次启动 Redis、MyUrls、SubConverter、Subweb、
  Nginx web-gateway；依赖未健康时终止并清理本次启动的进程。
- `status.sh` 同时检查 PID 所有权与 HTTP/Redis 健康，不把“PID 存在”当成健康。
- `stop.sh` 只停止 PID 文件中且启动身份匹配的本项目进程，等待优雅退出后再处理残留，
  绝不使用宽泛的 `pkill node`、`killall` 或端口全局清理。

本机源码模式是开发和验证方式，不作为无人值守生产服务的首选；需要开机自启和生产
证书时使用 Docker 或由部署者自行把已验证命令接入系统服务管理器。

### 8.2 Docker

根目录保留一个权威 `compose.yaml`。Subweb Nginx 容器同时提供静态前端和业务网关，
通过互斥 profile 选择端口与 TLS 责任：

- `behind-proxy`：默认模式，只监听 `127.0.0.1:18080` 的 HTTP，由宝塔、1Panel、Nginx、
  OpenResty 或 Cloudflare Tunnel 终止 TLS。
- `direct-tls`：Nginx 使用部署者提供且覆盖 APP/API 两个域名的证书和私钥，监听
  `80/443`，将 HTTP 跳转到 HTTPS；项目不申请、不续期证书。

`scripts/configure.sh --mode ...` 写入唯一启用的 profile；Compose 配置验证必须拒绝两个
web-gateway profile 同时启用。除 web-gateway 外不发布任何宿主机端口。项目不提供
Certbot、acme.sh 或其他 ACME 客户端容器，证书获取和续期由部署者、面板、CDN
或平台负责。

默认已有反向代理部署：

```sh
./scripts/configure.sh --mode behind-proxy --app-domain example.com --api-domain api.example.com
docker compose config --quiet
docker compose up -d --build --wait
```

自备证书直连部署：

```sh
./scripts/configure.sh --mode direct-tls --app-domain example.com --api-domain api.example.com \
  --tls-cert /srv/subweb/tls/fullchain.pem --tls-key /srv/subweb/tls/privkey.pem
docker compose config --quiet
docker compose up -d --build --wait
```

外层代理必须把两个域名都转发到 `http://127.0.0.1:18080` 并保留原始 Host。文档分别
提供通用 Nginx、宝塔和 1Panel 示例，同时明确它们只是同一模式的不同界面，不是额外
部署架构。

`direct-tls` 要求 DNS 已指向主机、`80/443` 可从公网访问、证书覆盖两个域名且私钥权限
受限。证书以只读挂载传入；续期后先执行 `nginx -t`，再优雅 reload。`behind-proxy`
不得映射容器 `80/443`，是推荐的无冲突默认值。没有外层代理或有效证书时只允许在本机
或受信任内网使用 HTTP，不把明文公网部署描述为生产可用。

Redis 使用持久卷和受保护密码；Compose 的依赖关系以健康检查为准。所有应用容器使用
非 root、最小 capabilities、只读根文件系统和明确的可写挂载；不满足某项边界的上游
镜像必须由集成测试记录并通过最小补偿措施隔离。

### 8.3 Railway

Railway 使用平台反向代理模式：

- web-gateway 是唯一公开 Service，监听 `0.0.0.0:$PORT`；
- subconverter、myurls 和 Redis 只走 Railway 私有网络；
- `ml1.one` 类 APP 域名和 `api.ml1.one` 类 API 域名都绑定到 web-gateway，由 Host 路由；
- Railway 负责 TLS，Nginx 只处理平台转发的 HTTP，不声明宿主机端口映射；
- 服务引用使用 Railway reference variables，不把私有地址和密码硬编码到仓库。

仓库提供经过真实部署验证的 Railway 配置和部署说明。Railway 不直接运行 Compose；
文档说明 Compose 服务与 Railway Service 的对应关系，并在可复现模板发布后提供 Deploy
按钮。模板必须要求用户输入两个域名，自动生成 Token，并创建带持久存储的 Redis。

发布验收至少包含：部署完成、两个域名 TLS、前端加载、转换链接、短链创建与跳转、
私有服务不可公网访问、重启后短链仍存在、日志无订阅哨兵值。

### 8.4 Render

Render 使用 `render.yaml` Blueprint：

- web-gateway 为公开 Web Service；
- subconverter、myurls 为 Private Service；
- Redis 使用 Render Key Value 或等价的 Blueprint 私有持久服务；
- web-gateway 监听平台端口，由 Render 负责域名和 TLS；
- Secret 使用 `generateValue` 或 Dashboard 输入，绝不写入 Blueprint；
- 服务连接使用 Blueprint 的 `fromService` 或连接字符串引用。

如果 Render 提供的 Redis 连接是 URI，MyUrls 必须通过其独立仓库发布的 Redis URL/TLS
能力消费；不得用脆弱的 shell 字符串切割密码和主机。该兼容发布是 Render 正式支持的
前置门禁，不满足时 Render 文档不得宣称完整部署可用。

Render 验收项目与 Railway 相同，并额外验证 Blueprint 从全新环境创建、秘密不会出现在
构建日志、Key Value 重启持久性以及服务在同一区域使用私有连接。

## 9. Subweb 统一视觉设计

### 9.1 设计方向

采用 MyUrls 已落地的 Luminous Focus 产品语言：明亮环境光、克制玻璃材料、清晰实色
输入、单列聚焦和轻量来源页脚。统一的是设计 token、材质逻辑、排版节奏、主题和反馈，
不是把 MyUrls 的 DOM 或业务界面复制到 Subweb。

Apple Design 原则落实为：常用路径优先、即时按压反馈、空间关系可预测、材料层级不嵌套、
系统字体优先、动效可中断且无无意义弹跳，并完整响应减少动态、减少透明度和增强对比度。

### 9.2 页面结构

页面从上到下只有：

1. 居中品牌区；
2. 一个主转换工作区；
3. 简洁 GitHub 来源链接。

品牌文字固定为 `Subconverter Web`，可以用独立、对辅助技术隐藏的蓝色句点作为视觉强调，
但文档标题、页面标题和无障碍名称不附加标点。主题按钮位于品牌区右上方或同一视觉轴，
不再使用横跨页面的独立导航玻璃卡。

页面使用与 MyUrls 同源的蓝、青、淡紫环境光，但背景保持静态，不加入漂浮光球、视差、
循环动画、插画、数据卡片或营销文案。

### 9.3 工作区信息层级

默认可见：

- 订阅地址多行输入；
- 目标客户端；
- 远程配置；
- 一个主操作按钮。

“服务设置”收纳后端地址；“高级参数”收纳已有高级字段。两个 disclosure 默认收起，
保留明确标签、键盘状态和展开内容归属。常用路径不要求用户理解后端、短链或模板概念。

工作区是页面唯一主要玻璃面。输入、选择器、结果使用高不透明度的实色或轻微内嵌表面，
不得在主玻璃面内再堆叠透明卡片。桌面宽度以 MyUrls 的窄列比例为基准，因 Subweb 字段
更多可扩展到约 `46rem`，移动端保留 `1rem` 安全边距。

### 9.4 操作与结果

- 初始主按钮文案为“转换并复制”。成功生成且剪贴板写入成功后切换为“复制订阅”。
- 如果生成成功但浏览器拒绝剪贴板，必须显示“链接已生成，请手动复制”，按钮不能谎称
  已复制。
- 未转换前不渲染空的结果框或短链按钮。
- 转换成功后显示一个可聚焦的转换结果表面；短链功能在此时以次级操作出现。
- 短链按钮初始为“生成并复制短链”，成功复制后切换为“复制短链”。
- 输入、客户端、远程配置、服务地址或影响输出的高级参数变化后，旧结果和按钮复制状态
  立即失效，避免复制过期内容。
- 网络错误保留输入和已生成转换链接，错误提示说明重试方向，不暴露 Redis、内部主机、
  Token 或堆栈。

### 9.5 主题、材料和排版

- 首次访问跟随系统主题；用户手动选择持久保存。
- 浅色使用冷白画布、珍珠半透明主面和深蓝操作色；深色使用烟蓝黑画布、深色材料和亮蓝
  操作色，不做机械反色。
- 主面使用约 `2rem` 圆角和强于小控件的 blur/shadow；控件圆角保持一致但更小。
- 正文使用系统字体栈；大标题收紧字距和行高，正文保持舒适行高，小字号不使用负字距。
- 所有交互目标最小 `44px`，焦点环在明暗主题和增强对比模式中均清晰。

### 9.6 动效

- 按压在 pointer-down 立即反馈，主按钮可使用约 `scale(0.97)`、`100ms` 的快速响应。
- disclosure、主题和状态变化使用 `160ms` 至 `240ms` 的克制过渡。
- 结果材料出现采用约 `280ms` 至 `320ms` 的轻微 scale、blur 和 opacity materialize，
  默认无 overshoot；不为非手势操作增加弹跳。
- 动画不能锁住输入，新状态从当前屏幕状态继续，不等待旧过渡结束。
- `prefers-reduced-motion: reduce` 移除位移和缩放，只保留短促颜色或透明度变化。
- `prefers-reduced-transparency: reduce` 停用 blur 并提高背景不透明度。
- `prefers-contrast: more` 使用近实色材料、明确边框和更强焦点环。

## 10. 安全与隐私

1. web-gateway 是唯一公网容器；Redis、MyUrls 创建接口和内部服务端口不直接发布。
2. MyUrls Token 只在 web-gateway 到 MyUrls 的私有请求中出现。
3. Redis 密码、Token 和平台秘密不进入前端 bundle、`config.js`、镜像层、日志、测试快照
   或 Git。
4. API 访问日志不记录原始查询串；验证使用唯一哨兵订阅令牌并扫描 web-gateway、容器和平台
   日志，发现即失败。
5. MyUrls 保持 URL 协议、短码、请求体、限流和原子写入防护。
6. SubConverter 使用公开安全配置：关闭不需要的上传和管理能力，固定管理前缀和公开模式。
7. web-gateway 设置 CSP、HSTS（仅生产 HTTPS）、`X-Content-Type-Options`、frame 限制、
   Referrer Policy 和 Permissions Policy；外层代理不得移除。
8. 远程配置来源继续记录仓库、许可证和信任边界，不把第三方配置描述成项目自有内容。

## 11. 健康检查与错误处理

- web-gateway：`/healthz`、静态前端和运行时配置可读，并分别验证 APP/API 上游路由；
- subconverter：HTTP 健康端点或最小无敏感参数探测；
- MyUrls：`/healthz` 必须实际 PING Redis；
- Redis：认证后的 `PING`；

启动过程必须允许依赖短暂未就绪并采用有上限的重试；达到上限后输出服务名和可操作原因，
不泄密。PaaS 没有 Compose `depends_on` 语义，因此服务自身和健康检查必须能处理启动顺序。

聚合健康不能用一个“web-gateway 进程存活”掩盖 Redis 或 MyUrls 失败。公开健康端点只返回稳定
状态，不返回内部地址、版本漏洞信息或异常文本；详细原因保留在受控日志。

## 12. 数据、备份与恢复

- 唯一业务持久数据是 Redis 中的短链键值和 TTL；`direct-tls` 使用的证书和私钥属于
  部署者管理的外部运维数据。
- Docker 文档提供认证 RDB/AOF 备份、校验、恢复演练和 Redis 主版本回滚边界。
- Railway 和 Render 文档说明平台卷/Key Value 的持久性、备份责任和导出验证。
- 升级 Redis 主版本前停止创建写入、生成备份并验证可读；回滚时不复用已由新主版本写入
  且未验证兼容的数据目录。
- 前端、web-gateway、MyUrls 和 SubConverter 均为可重建组件，不依赖容器本地临时文件保存
  业务状态。

## 13. 测试与验收

### 13.1 静态和单元测试

- 现有 Subweb 单元、ESLint 和生产构建继续通过；
- 新增路由、配置推导、结果状态、日志脱敏和 UI 层级测试；
- 检查仓库中没有 MyUrls/SubConverter 源码副本、真实秘密或未固定生产镜像；
- Railway、Render 和 Compose 描述通过各自可用的 schema/config 验证。

### 13.2 UI 浏览器测试

- 桌面与移动端、浅色与深色；
- 键盘完整操作、焦点顺序和 disclosure 状态；
- 转换成功、复制成功、剪贴板拒绝、短链成功、短链错误；
- 参数变化使旧结果失效；
- reduced motion、reduced transparency、more contrast；
- 视口内无横向溢出，品牌和主工作区视觉中心一致；
- 页面不存在空结果区、重复复制按钮、顶部 GitHub 重复入口或模板功能。

### 13.3 本机源码测试

- macOS 与 Linux 的依赖检查、bootstrap 幂等、启动、状态、停止；
- 每个默认端口被占用时安全失败，且不终止占用进程；
- 中途启动失败只清理本次创建的进程；
- 停止后端口释放、PID 文件清理、Redis 数据保留；
- 自定义端口后所有派生 URL、MyUrls 短链和健康检查保持一致。

### 13.4 Docker 集成测试

- `direct-tls` 与 `behind-proxy` 两个 profile 分别通过 `docker compose config`；
- 同时启用两个 profile 必须失败；
- 只有 web-gateway 存在宿主机端口映射；
- 所有健康检查变为 healthy 后才执行功能哨兵；
- 创建短链、访问短码、重启 Redis/MyUrls 后再次访问；
- web-gateway 向 MyUrls 注入 Token，直接访问内部端口不可行；
- `direct-tls` 在缺少证书、私钥权限错误、域名不受证书覆盖或 Nginx 配置校验失败时拒绝
  启动；证书 reload 不终止已有连接；
- 容器用户、capabilities、只读文件系统、镜像 digest 和安全头符合约束。

### 13.5 Railway 与 Render 真实部署测试

正式文档发布前各完成一次全新环境部署和一次升级部署。验收包括：

- 平台默认域名和自定义双域名；
- HTTPS 和 Host 路由；
- 私有网络与无公网内部端口；
- 转换、创建短链、跳转和重启持久性；
- 秘密只存在平台变量；
- 日志扫描无哨兵订阅值；
- 回滚到前一个固定镜像后服务恢复。

没有真实部署证据的平台配置只能标为“设计中”，不得在 README 标记为正式支持。

## 14. 文档交付

README 只保留项目定位、来源、四种部署入口和最短快速开始。详细内容分流到：

- 架构与仓库边界；
- 配置和域名更换；
- 本机源码运行；
- Docker 自备证书直连与已有反向代理；
- Railway；
- Render；
- 安全、备份、升级、回滚和故障排查；
- 第三方来源、固定版本、许可证与更新策略；
- 统一界面设计规范。

每种部署文档必须包含：前置条件、最短命令、变量表、域名/DNS、启动、状态、日志、停止、
升级、备份、恢复、回滚、验证清单和常见错误。命令示例使用 `example.com` 或明确标记的
维护者展示域名，不包含真实秘密。

## 15. 仓库清洁与发布边界

必须提交：源码、锁文件、必要测试、Compose/Nginx/PaaS 描述、脚本、README、部署和来源
文档。不得提交：

- `.env` 和任何真实秘密；
- `.runtime/`、PID、日志、Redis 数据、证书和私钥；
- 下载的 MyUrls/SubConverter 源码或构建目录；
- `dist/`、测试报告、截图临时输出和平台本地状态；
- 重复、过时或未验证的平台配置。

发布前执行全套验证并确认 `git status --short` 只包含预期提交。文档、测试和部署描述是
项目稳定落地所需文件，不因“生产容器运行时不读取”而排除；生成物和本机状态才应忽略。

## 16. 实施顺序

1. 建立版本与契约基线，验证 MyUrls 和 SubConverter 固定产物；
2. 先写失败的路由、秘密、日志、配置与集成契约测试；
3. 扩展现有 Nginx 为统一 web-gateway，并实现配置模型；
4. 实现 Docker 两种互斥入口和全栈健康检查；
5. 实现本机源码生命周期脚本；
6. 完成 Railway 真实部署；
7. 完成 Render Redis 兼容门禁和真实部署；
8. 按 Luminous Focus 规格重构 Subweb；
9. 执行跨方式功能、隐私、持久性、升级与回滚验证；
10. 更新全部文档、来源声明和发布清单。

实现计划必须把每一步拆成可独立验证的小任务，采用测试先行，并在 Docker、本机、Railway、
Render 和 UI 工作流之间设置审查检查点。

## 17. 完成标准

只有同时满足以下条件才可宣称整合完成：

- 四种正式部署方法均有可复制步骤，Docker、Railway、Render 和本机源码模式均有实际
  成功证据；
- 自定义两个域名后无需修改源码，公开 URL、短链返回值和网关路由全部一致；
- 默认 `behind-proxy` 不占用 `80/443`；`direct-tls` 在端口占用或证书无效时拒绝启动，
  PaaS 不声明宿主机端口；
- Redis 和 MyUrls 创建接口不直接暴露；
- 订阅、Token 和 Redis 秘密未出现在 bundle、Git 或日志；
- 短链在重启后仍可访问，备份与回滚经过演练；
- Subweb 与 MyUrls 视觉一致，现有转换、高级配置、主题、自动复制和短链行为没有回归；
- 全套单元、静态、构建、容器、浏览器和集成验证通过；
- README、详细文档、运行配置、测试与实际实现一致；
- 工作树中没有运行数据、下载源码、缓存、临时报告或无关文件。

## 18. 来源与参考

- 当前维护仓库：[`keleyaa/subweb`](https://github.com/keleyaa/subweb)
- Fork 起点：[`stilleshan/subweb`](https://github.com/stilleshan/subweb)
- 独立维护的短链项目：[`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)
- MyUrls 原始来源：[`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls)
- 官方转换后端：
  [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended)
- Nginx 反向代理与自备证书 HTTPS：
  [NGINX Reverse Proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy)、
  [Configuring HTTPS servers](https://nginx.org/en/docs/http/configuring_https_servers.html)
- Railway Compose 映射和 Dockerfile：
  [Deploy a Docker Compose App](https://docs.railway.com/guides/docker-compose)、
  [Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- Render Blueprint、Docker 和 Key Value：
  [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)、
  [Docker on Render](https://render.com/docs/docker)、
  [Render Key Value](https://render.com/docs/key-value)

Apple Design 和 MyUrls Luminous Focus 用于设计原则与家族一致性参考，不代表复制 Apple、
MyUrls 或其他第三方的源码、图形资源、商标素材或页面 DOM。实现阶段必须在 README、许可
文件和第三方来源清单中继续保留各仓库的作者、许可证与修改边界。
