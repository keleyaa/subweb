# Subconverter Web

> 面向自托管维护者的在线订阅转换与短链服务。固定黑色命令界面、单一 Gateway、受控订阅访问边界。

<p align="center">
  <img src="./assets/readme/command-interface.png" alt="Subconverter Web 固定黑色命令界面：订阅输入、客户端选择、订阅后端、高级参数与转换并复制操作" width="100%">
</p>

## 能力

- **订阅转换：** 输入订阅链接或节点，选择客户端与远程配置后生成可复制的转换地址。
- **状态行设置：** 「订阅后端」在默认后端与自定义 API 地址之间切换；「高级参数」采用保存前草稿与显式重置，两个区域互斥原位展开。
- **短链：** 通过同源 `/short-api/links` 创建短链；浏览器不接触 MyUrls 内部 Token。
- **匿名请求保护：** Request Policy Service 对转换输入执行 HTTPS、域名/IP、DNS、端口、大小、超时、并发和频率限制。
- **受控出站：** SubConverter 仅加入内部 egress 网络，必须经 Request Policy Service 的 HTTPS CONNECT proxy 按已验证 IP 访问公网订阅，避免二次 DNS 解析绕过校验。
- **PWA 图标：** 提供命令链接 favicon、Apple Touch Icon、`192 px` / `512 px` 图标与 manifest。

## 快速开始

### 环境要求

- Docker Engine 与 Docker Compose v2
- OpenSSL、curl
- 3 个不同域名：APP、API、SHORT

### 本机源码部署

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/configure.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY
./scripts/validate-compose.sh
docker compose build request-policy
docker compose up -d --build --wait
```

外层反向代理将 3 个域名都转发到 `127.0.0.1:18080`，并保留原始 Host。项目自身不管理 HTTPS 证书、`80/443` 端口或公网 DNS。

更多部署方式见 [部署索引](docs/deployment.md)。

### 发布镜像

Docker Hub 的 `docker.io/keleyaa/subweb` 与 GHCR 的 `ghcr.io/keleyaa/subweb` 是等价的 Gateway 发布来源。使用 `scripts/docker-deploy.sh --image` 可选择经过验证的镜像引用；完整步骤见 [Docker 部署](docs/deployment-docker.md)。

## 架构

<p align="center">
  <img src="./assets/readme/security-architecture.svg" alt="浏览器经 Gateway 访问 Request Policy Service、SubConverter、MyUrls 与 Redis；SubConverter 的公网订阅访问经 HTTPS CONNECT egress proxy 按已验证 IP 建连" width="100%">
</p>

| 边界 | 职责 |
| --- | --- |
| Gateway | 唯一公开容器端口；按 APP / API / SHORT Host 路由，清理凭据与不可信请求头。 |
| Request Policy Service | `/sub` 输入校验、匿名限流、并发与大小限制、熔断；同时提供 SubConverter 专用 HTTPS CONNECT egress proxy。 |
| SubConverter | 仅处理转换，加入内部 egress 网络；没有默认网络的直接出站路径。 |
| MyUrls v2 | APP / SHORT 两个实例处理短链 API、管理页面与跳转。 |
| Redis | DB `0` 保存短链，DB `1` 保存带 TTL 的匿名限流状态；不保存普通转换 URL 或转换结果。 |

## 界面操作

1. 粘贴订阅链接或节点。
2. 选择客户端与远程配置。
3. 按需展开「订阅后端」或「高级参数」；两项不会同时占用页面空间。
4. 点击「转换并复制」。成功后显示转换结果和短链操作。

页面固定使用黑色命令主题，不提供明暗主题切换。交互目标、键盘焦点、减少动效与增强对比度均有独立验证。

## 安全与隐私

- 只允许通过 Gateway 访问公开路由；Redis、MyUrls、SubConverter 与 Request Policy Service 不发布宿主机端口。
- 匿名转换默认每个来源 IP 每分钟最多 `10` 次，同时最多运行 `2` 个请求；达到限制时返回 `429` 与 `Retry-After`。
- 转换 URL 与结果不写入 Redis；用户主动创建短链时，短链目标按 TTL 保存，短链属于持有即可访问的数据。
- 日志不记录原始 IP、订阅 URL、Query、Token、Redis 密码或完整短码；请勿将这些值放入截图、Issue 或公开工单。
- `proxy-providers` URL 由最终客户端直接拉取，不经过本服务的 egress proxy；部署者应理解并接受这一客户端侧边界。

详细边界见 [安全](docs/security.md) 与 [配置](docs/configuration.md)。

## 验证与维护

```sh
npm ci
npm run verify:release
git diff --check
```

`npm run verify:release` 在没有 `.env` 的干净工作树中使用临时验证配置完成 Compose 构建；真实部署仍必须通过 `scripts/configure.sh` 生成权限为 `0600` 的 `.env`。

发布前、备份恢复、镜像锁定与推送边界见 [维护与发布](docs/maintenance.md)。

## 文档

**使用与配置**

- [架构](docs/architecture.md)
- [配置](docs/configuration.md)
- [远程配置来源](docs/remote-config-sources.md)
- [界面设计](docs/interface-design.md)

**部署与安全**

- [部署总览](docs/deployment.md)
- [本地开发](docs/deployment-local.md)
- [Docker 部署](docs/deployment-docker.md)
- [安全边界](docs/security.md)
- [运维](docs/operations.md)

**来源与维护**

- [第三方来源](docs/third-party-sources.md)
- [维护与验证](docs/maintenance.md)

## Fork 与来源说明

本项目是对 [stilleshan/subweb](https://github.com/stilleshan/subweb) 的独立维护版本，保留订阅转换的前端基础，并以自托管 Gateway、受控请求策略、短链与部署验证作为当前运行边界。MyUrls 来自 [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls) 与 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls)，转换引擎来自 [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended)。

完整的镜像来源、版本与许可证说明见 [第三方来源](docs/third-party-sources.md)。
