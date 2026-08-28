# Subconverter Web

**Self-hosted subscription delivery.**

自托管的订阅转换与短链服务：浏览器只连接一个 Gateway；转换由 `SubConverter-Extended` 完成，短链由 MyUrls v2 创建和跳转，Redis 保存短链映射。

<p align="center">
  <img src="./docs/assets/readme/subweb-hero.svg" width="100%" alt="Subconverter Web 将公共域名经由单个 Gateway 路由到私有的 SubConverter、MyUrls 和 Redis">
</p>

<p align="center">
  <img src="./docs/assets/subconverter-web.png" width="100%" alt="Subconverter Web 的订阅转换页面">
</p>

## 能做什么

- **转换订阅**：粘贴订阅内容，选择目标格式，复制结果。
- **创建短链**：主站通过同源的 `/short-api/v1/links` 创建短链；MyUrls 页面也可在短链域名下使用。
- **跳转短链**：`SHORT_DOMAIN/:shortKey` 由 MyUrls 查 Redis 后跳转；`APP_DOMAIN/:shortKey` 兼容已有短码。
- **保留映射**：Redis 是唯一业务数据卷，Gateway 和前端不保存业务数据。

## 服务边界

<p align="center">
  <img src="./docs/assets/readme/subweb-architecture.svg" width="100%" alt="浏览器经一个 Gateway 分别访问应用、API 和短链域名，再连接私有的 SubConverter、MyUrls 与 Redis">
</p>

| 域名或服务 | 职责 |
| --- | --- |
| `APP_DOMAIN` | Subweb 前端、短链创建接口，以及已有短码的兼容跳转 |
| `API_DOMAIN` | `/sub` 转换路由和 SubConverter 健康检查 |
| `SHORT_DOMAIN` | MyUrls 页面、短链创建与跳转 |
| Gateway | 按 Host 路由请求，清理浏览器凭据；内部服务不开放宿主机端口 |
| SubConverter-Extended | 订阅转换 |
| MyUrls | 短链创建与跳转 |
| Redis | 短链映射持久化 |

## 部署

Docker Compose 部署需要三个由你控制的域名：应用、API 和短链，例如 `sub.example.com`、`api.example.com`、`short.example.com`。外层 Nginx、OpenResty、宝塔、1Panel 或 Cloudflare Tunnel 应将这三个域名反代到 `http://127.0.0.1:18080`，并处理公网 TLS。

```sh
mkdir -p "$HOME/apps" && cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb

./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY

docker compose ps
```

脚本会生成权限为 `0600` 的 `.env`、Redis 密码和独立的 IP 哈希秘密，完成 Compose 校验、拉取镜像并启动服务。短链形如 `https://short.example.com/abc123`；主站的创建接口返回 `code`、`shortUrl` 和 `expiresAt`。

Gateway 镜像同时发布到 `docker.io/keleyaa/subweb` 与 `ghcr.io/keleyaa/subweb`。MyUrls v2 的镜像版本与 manifest digest 锁定在 `deploy/versions.lock.json`；如需冻结版本或回滚，可在 `.env` 中覆盖镜像。完整步骤见 [Docker 部署](docs/deployment-docker.md)。

### 本地开发

本机开发时，Vite 与 Docker Compose 依赖均只监听 loopback：

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173/`。常用命令：

```sh
npm run dev:status
npm run dev:stop
```

## 日志与安全

MyUrls 默认以 `info` 级别输出正常请求记录；需要降低日志量时，在 `.env` 设置 `MYURLS_LOG_LEVEL=warn` 后重建 `myurls-app` 与 `myurls-short`。日志写入容器 stdout，由 Docker `json-file` 轮转。SubConverter 仍固定关闭 verbose 与 `print_debug_info`。

订阅 URL 可能携带凭据。转换时 SubConverter 会读取它，创建短链时完整转换 URL 会写入 Redis。**短码不是加密**：任何拿到短码的人通常都能完成跳转。

不要提交、截图或发布以下内容：

- `.env`、`.runtime/`、证书、Redis 备份；
- 订阅 URL、query、真实短码、Token、Redis URL 或未脱敏日志；
- 历史诊断日志的原始副本。

浏览器配置只包含公开 URL 与预设；`TURNSTILE_SECRET_KEY`、Redis 密码和 IP 哈希秘密只留在服务端。公开部署前请阅读[安全边界](docs/security.md)。

## 文档与来源

- [架构说明](docs/architecture.md) · [运行时配置](docs/configuration.md) · [部署索引](docs/deployment.md)
- [Docker 部署](docs/deployment-docker.md) · [本机源码运行](docs/deployment-local.md) · [运维手册](docs/operations.md)
- [安全边界](docs/security.md) · [第三方来源与变更边界](docs/third-party-sources.md)
- [界面设计规范](docs/interface-design.md) · [远程配置来源](docs/remote-config-sources.md) · [维护与发布](docs/maintenance.md)

本仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb) 源自 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，现独立维护。短链服务使用维护者 fork 的 [`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)，上游为 [`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls)；转换服务使用 [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended)。集成基线、许可证和变更边界见[第三方来源](docs/third-party-sources.md)。

## License

本仓库代码采用 [GPL-3.0](LICENSE)；集成组件和远程配置来源继续遵循各自许可证。
