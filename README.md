# Subconverter Web

**Self-hosted subscription delivery.**

**自托管订阅转换发行栈。**

Subconverter Web turns one browser workflow into one deployable boundary：订阅转换由 `SubConverter-Extended` 完成，短链由 `MyUrls` 创建和跳转，映射持久化在 Redis；浏览器只接触统一 Gateway，MyUrls Token 始终留在服务端。Docker 部署固定使用三个独立域名和一个回环 HTTP Gateway，公网反代与证书由部署者负责。

<p align="center">
  <img src="./docs/assets/readme/subweb-hero.svg" width="100%" alt="Subconverter Web routes public domains through one gateway to private SubConverter, MyUrls, and Redis services">
</p>

## 先看它能做什么

真实界面只有一个主要任务：粘贴订阅内容，选择转换目标，生成可复制的结果；需要时再创建短链。下面的截图来自当前应用，而不是概念 mockup。

<p align="center">
  <img src="./docs/assets/subconverter-web.png" width="100%" alt="Subconverter Web single-page subscription conversion interface">
</p>

- **转换**：通过 `API_DOMAIN/sub` 调用 SubConverter-Extended。
- **短链**：默认 Docker 部署中，`SHORT_DOMAIN/` 提供 MyUrls 前端，浏览器同源请求 `SHORT_DOMAIN/short`；Subweb 主前端仍通过 `SHORT_DOMAIN/short-api/short` 创建，Gateway 注入服务端 Token 后调用 MyUrls。
- **跳转**：访问 `SHORT_DOMAIN/:shortKey`，由 MyUrls 从 Redis 读取完整映射并返回 redirect；`APP_DOMAIN/:shortKey` 仅保留已存在短码的兼容跳转。
- **持久化**：Redis 是唯一业务数据卷；Gateway 和前端不保存业务数据。

## 边界如何工作

<p align="center">
  <img src="./docs/assets/readme/subweb-architecture.svg" width="100%" alt="Browser reaches APP_DOMAIN and API_DOMAIN through one gateway, then private SubConverter, MyUrls, and Redis services">
</p>

- `APP_DOMAIN`：Subweb 静态前端，以及已存在短码的兼容创建/跳转入口；默认新短链不使用该入口。
- `API_DOMAIN`：`/sub` 转换路由和 SubConverter 健康检查。
- `SHORT_DOMAIN`：MyUrls 前端、同源短链创建、短码跳转和健康检查。
- **Gateway**：按 Host 路由，并在服务端注入 MyUrls Bearer Token；内部服务不发布宿主机端口。
- **SubConverter-Extended**：转换引擎。
- **MyUrls**：短链 `create / redirect` API。
- **Redis**：短链映射的持久层。

## 快速部署

### Docker Compose（推荐）

需要三个你控制的域名：应用、API、短链（例如 `sub.ml1.one`、`api.ml1.one`、`s.ml1.one`）。Nginx、OpenResty、宝塔、1Panel 或 Cloudflare Tunnel 等外层入口将三个域名全部反代到 `http://127.0.0.1:18080`，并负责公网 TLS。

```sh
mkdir -p "$HOME/apps" && cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb

./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com

docker compose ps
```

脚本会生成不提交的 `.env`、MyUrls Token 和 Redis 密码。Gateway 镜像同时发布到 `docker.io/keleyaa/subweb` 与 `ghcr.io/keleyaa/subweb`；生产环境可以通过 `--image` 指定已发行的 `sha-*` Gateway 镜像。Redis 默认使用稳定主线 `docker.io/library/redis:8-alpine`；MyUrls 和 SubConverter 继续跟随各自已发布的稳定 `latest`。需要受控回滚或冻结时在 `.env` 显式覆盖 `MYURLS_IMAGE`、`REDIS_IMAGE`、`SUBCONVERTER_IMAGE` 或 `SUBWEB_IMAGE`。

短链返回 `https://short.example.com/abc123`；前端通过 CORS 跨域创建短链。`https://sub.example.com/abc123` 仅作为已存在短码的兼容入口，不需要额外配置。
项目不依赖 Caddy，也不会申请或续期证书。完整说明见 [Docker 部署](docs/deployment-docker.md)。

### 本机源码运行

适合开发和集成验证；默认只监听 loopback，启动七个独立端口（Vite、SubConverter、MyUrls、Redis、前端、转换后端、短链服务）：

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/local/bootstrap.sh
./scripts/local/start.sh
```

启动后访问 `http://127.0.0.1:18080/`（前端），短链服务在 `http://127.0.0.1:18083/`。查看状态：

```sh
./scripts/local/status.sh
./scripts/local/stop.sh
```

## 重要的安全边界

订阅 URL 可能携带凭据。转换时 SubConverter 会看到它；创建短链时，完整转换 URL 会写入 Redis。**短码不是加密**，拿到短码的人通常可以跟随跳转。

请勿把以下内容提交到 Git、截图、Schema、sitemap 或公开 issue：

- `.env`、`.runtime/`、证书和 Redis 备份；
- 订阅 URL、请求 query、真实短码、Token、Redis URL 或日志样本；
- 历史诊断日志的未脱敏副本。

浏览器配置只包含公开 URL 与预设；MyUrls Token 和 Redis 密码留在服务端。公开部署前先阅读[安全边界](docs/security.md)。

## Fork 与来源说明

- [架构说明](docs/architecture.md) · [运行时配置](docs/configuration.md) · [部署索引](docs/deployment.md)
- [Docker 部署](docs/deployment-docker.md) · [本机源码运行](docs/deployment-local.md) · [运维手册](docs/operations.md)
- [安全边界](docs/security.md) · [第三方来源与变更边界](docs/third-party-sources.md)
- [界面设计规范](docs/interface-design.md) · [远程配置来源](docs/remote-config-sources.md) · [维护与发布](docs/maintenance.md)

本仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb) 源自 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，现独立维护。短链服务使用维护者 fork 的 [`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)，其上游为 [`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls)；转换服务使用 [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended)；界面以 Apple 平台的材质、层级和可访问性原则为方法参考，没有复制第三方代码、DOM、CSS、图片、图标或商标；集成基线、许可证与变更边界记录在[第三方来源](docs/third-party-sources.md)。

## License

本仓库代码采用 [GPL-3.0](LICENSE)；集成组件和远程配置来源继续遵循各自许可证。
