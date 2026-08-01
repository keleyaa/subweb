# Subweb

Subweb 是一套可自托管的订阅转换发行项目。它把 `Subconverter Web` 单页前端、SubConverter-Extended 转换服务、MyUrls 短链服务、Redis 和统一 Nginx 网关放进同一套部署与维护流程；浏览器只访问应用域名和 API 域名，内部服务默认不直接暴露。

## 界面预览

![Subconverter Web 单页订阅转换界面](docs/assets/subconverter-web.png)

## Fork 与来源说明

本仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb) fork 自 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，之后已作为独立维护项目改造前端、网关、测试、容器和文档。短链服务来自维护者 fork 的 [`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)，其原始上游是 [`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls)；转换服务直接使用持续维护的 [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended)，不在本仓库修改其源码。

界面参考 Apple 平台的材质、层级和可访问性原则，并与 MyUrls 的简洁产品气质保持一致；没有复制第三方页面代码、DOM、图形资产或商标。完整版本、镜像摘要、许可证和修改边界见[第三方来源](docs/third-party-sources.md)。

## 架构摘要

- `APP_DOMAIN` 提供网页、短链创建代理 `/short-api/short` 和短码跳转。
- `API_DOMAIN` 提供 `/sub` 等转换接口。
- 网关在服务端注入 MyUrls API Token，Token 不进入浏览器配置。
- Redis 是唯一业务持久数据；前端、网关、MyUrls 和 SubConverter 均可按锁定版本重建。
- `ml1.one` 与 `api.ml1.one` 只是维护者展示部署的默认值。其他部署者必须替换成自己的两个域名。

详细请求路径和信任边界见[架构说明](docs/architecture.md)。

## 快速部署

### Docker

适合生产自托管，也是当前完整集成验证的主要方式。第一次部署必须先把项目拉取到服务器并进入项目目录。以下示例把项目放在当前用户的 `$HOME/apps/subweb`：

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

已有宝塔、1Panel、Nginx、OpenResty 或 Cloudflare Tunnel 时，直接拉取已发布镜像并启动：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com
docker compose ps
```

把 `example.com` 和 `api.example.com` 换成自己的两个域名。脚本自动生成未提交的 `.env`、Token 和 Redis 密码，无需手工填写秘密。生产环境建议增加 `--image docker.io/keleyaa/subweb:sha-<提交短 SHA>` 锁定镜像。需要修改源码或验证本地 Dockerfile 时，使用源码构建方式：

```sh
./scripts/configure.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com
./scripts/validate-compose.sh
docker compose up -d --build --wait
```

项目不依赖 Caddy。没有现成反向代理但已有合法双域名证书时，可使用 `direct-tls`。参见 [Docker 部署](docs/deployment-docker.md)。

### 本机源码

适合开发和验证。先拉取项目并进入项目目录，再按锁文件拉取和构建 MyUrls 与 SubConverter：

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/local/bootstrap.sh
./scripts/local/start.sh
./scripts/local/status.sh
```

浏览器访问 `http://127.0.0.1:18080/`。结束测试时运行 `./scripts/local/stop.sh`。依赖安装和完整流程见[本机源码运行](docs/deployment-local.md)。

两种部署方式的选择矩阵见[部署索引](docs/deployment.md)。

## 开发与验证

要求 Node.js 24+、npm 11+：

```sh
npm ci
npm run verify
npm run test:e2e
npm run verify:locks
npm run verify:compose
npm run verify:docs
```

容器全链路验证会创建并清理专用测试项目：

```sh
npm run verify:integration:behind-proxy
npm run verify:integration:direct-tls
```

## 文档

- [架构说明](docs/architecture.md)
- [运行时配置](docs/configuration.md)
- [部署索引](docs/deployment.md)
- [本机源码运行](docs/deployment-local.md)
- [Docker 部署](docs/deployment-docker.md)
- [安全边界](docs/security.md)
- [运维手册](docs/operations.md)
- [第三方来源](docs/third-party-sources.md)
- [界面设计规范](docs/interface-design.md)
- [远程配置来源](docs/remote-config-sources.md)
- [维护与发布](docs/maintenance.md)

## 许可证

本仓库代码遵循 [GPL-3.0](LICENSE)。集成组件和远程配置继续遵循各自许可证。
