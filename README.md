# Subconverter Web

> 自托管订阅转换与可选短链发行服务。统一 Go Gateway 是唯一公网边界；其余服务保持私有，并由 Compose 合同与锁定的运行时镜像约束。

<p align="center">
  <img src="./assets/readme/command-interface.png" alt="Subconverter Web 固定黑色命令界面：订阅输入、客户端选择、订阅后端、高级参数与转换并复制操作" width="100%">
</p>

## 核心能力

### 转换订阅

粘贴订阅链接或节点，选择客户端与远程配置，生成可复制的转换地址。订阅后端和高级参数按需展开，不会同时挤占工作区。

### 发行可选短链

APP 同源 `/short-api/links` 用于创建短链；启用后，一个 MyUrls Rust v2.0.8 上游同时支持 APP 管理与 SHORT 域名的短码解析。关闭短链时，MyUrls 与 Redis 不会部署。

### 保持网络边界可见

Gateway 是唯一发布到宿主机 loopback 的服务，负责 Host 路由、请求策略、限流和受控 CONNECT egress。SubConverter、MyUrls 与 Redis 保持在内部网络中；生产入口的 TLS、80/443 端口和 DNS 由部署者管理。

## 快速开始

### 生产 Docker 部署

首次生产部署在交互式终端运行：

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/subweb.sh install
```

向导询问 APP、API 域名和是否启用短链；仅在启用时询问 SHORT 域名与 Turnstile Site Key。随后可选填 `TRUSTED_PROXY_CIDR`，并要求明确输入 Gateway 发布版本 `vX.Y.Z`。它将版本解析为不可变 GHCR manifest digest，显示不含密钥的确认摘要，并且只接受 `yes` 才会继续；Turnstile Secret Key 仍通过既有隐藏输入流程处理。不会选择 `latest`，也不会隐式选择版本。

默认短链 profile 启动 `gateway`、`subconverter`、`myurls` 和 `redis` 四个服务。所有 APP、API、SHORT 域名由外层 TLS 反向代理转发到 `127.0.0.1:<SUBWEB_PORT>`，并保留原始 Host。完整步骤见 [Docker 部署](docs/deployment-docker.md)；部署入口、代理和域名约束见 [部署总览](docs/deployment.md)。

`SHORT_LINKS_ENABLED=true` 选择默认短链 profile；`SHORT_LINKS_ENABLED=false` 选择关闭短链 profile。

| 运行模式 | 服务 | 域名要求 |
| --- | --- | --- |
| 默认短链 profile | Gateway、SubConverter、MyUrls、Redis | APP、API、SHORT 三个不同域名 |
| 关闭短链 profile | Gateway、SubConverter | APP、API 两个不同域名；不设置 SHORT 域名 |

### 本机源码与 VPS

本机源码开发使用 Docker Compose 与 Vite；生产部署使用 Docker Compose，不需要在容器中运行 Node.js。开发、验证和发布门禁要求 Node.js 24、npm 11、Docker Engine、Docker Compose v2、OpenSSL 与 curl。参见 [本地开发](docs/deployment-local.md)。

单台服务器部署、外部 TLS 代理和恢复操作分别见 [Linux VPS 部署](docs/deployment-vps.md)、[Nginx 代理示例](docs/deployment-nginx.md) 和 [运维](docs/operations.md)。

### 自动化安装与不可变镜像

CI 或其他非交互环境显式提供安装参数。启用短链时，Turnstile Secret Key 必须通过 `--turnstile-secret-key-stdin` 管道传入：

```sh
printf '%s\n' "$TURNSTILE_SECRET_KEY" | ./scripts/subweb.sh install \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-links-enabled true \
  --short-domain short.example.com \
  --turnstile-site-key "$TURNSTILE_SITE_KEY" \
  --turnstile-secret-key-stdin \
  --version vX.Y.Z
```

`--version vX.Y.Z` 仅通过 GHCR 在配置和部署前解析为不可变 manifest digest，不会将版本 tag 直接写入运行时配置。`--image` 是直接传入的、与 registry 无关的不可变 digest 镜像输入；Docker Hub 与 GHCR 的 release digest 是等价的直接来源，例如 `--image ghcr.io/keleyaa/subweb@sha256:<digest>`。`--version` 与 `--image` 互斥，`--image` 不接收 `latest` 或发布版本 tag。SubConverter、MyUrls Rust 和 Redis 的镜像只从 [版本锁](deploy/versions.lock.json) 的 runtime-image contract 派生，不能手工覆盖。推送 `vX.Y.Z` 格式的 Git tag 会自动触发 Docker release workflow，也可以手动输入已有 tag 补跑。产品发布版本只由 Git tag 决定，`package.json` 仅是 Node 工具链元数据。

## 安全与数据边界

- Gateway 只发布 loopback 端口；MyUrls、Redis 和 SubConverter 不发布宿主机端口。
- `/sub` 强制执行 DNS、SSRF、响应大小、超时、并发、限流和 `:443` CONNECT 策略；SubConverter 不能绕过 Gateway 直接访问公网。
- Gateway 清理凭据、Cookie、Origin 和伪造的转发头，验证 Host 并重建客户端身份；日志不记录原始 IP、订阅 URL、Query、Token、Redis 密码或完整短码。
- 转换 URL 与结果不写入 Redis；用户主动创建的短链按 TTL 保存，短链属于持有即可访问的数据。Redis DB `0` 保存短链，DB `1` 保存 Gateway HMAC IP 限流状态。

完整服务拓扑与网络隔离见 [架构](docs/architecture.md)，受控 egress、隐私与凭据边界见 [安全](docs/security.md) 和 [配置](docs/configuration.md)。

## 验证与维护

```sh
npm ci
npm run verify:ci
npm run verify:release
git diff --check
```

`npm run verify:ci` 是 GitHub quality job 与本地发布验证共用的 Docker 门禁。`npm run verify:integration` 执行真实 unified business smoke，`npm run verify:operations` 执行 Redis backup/restore 恢复演练。真实部署仍必须通过 `scripts/configure.sh` 生成权限为 `0600` 的 `.env`。

发布前、备份恢复、镜像锁定与推送边界见 [维护与发布](docs/maintenance.md)。

## 文档

**使用与配置**

- [架构](docs/architecture.md)
- [部署契约整合基线](docs/deployment-integration-baseline.md)
- [配置](docs/configuration.md)
- [远程配置来源](docs/remote-config-sources.md)
- [界面设计](docs/interface-design.md)

**部署与安全**

- [部署总览](docs/deployment.md)
- [本地开发](docs/deployment-local.md)
- [Docker 部署](docs/deployment-docker.md)
- [外部 TLS 反向代理示例](docs/deployment-nginx.md)
- [单台 Linux VPS 部署](docs/deployment-vps.md)
- [安全边界](docs/security.md)
- [运维](docs/operations.md)

**验证、来源与维护**

- [单一 HTTP Docker 集成验证](docs/validation/docker-integration.md)
- [Compose-first 本地验证](docs/validation/local-dev.md)
- [Command Interface 界面验证](docs/validation/interface.md)
- [SubConverter 容器契约](deploy/subconverter/README.md)
- [第三方来源](docs/third-party-sources.md)
- [维护与验证](docs/maintenance.md)

## Fork 与来源说明

本项目是对 [stilleshan/subweb](https://github.com/stilleshan/subweb) 的独立维护版本，保留订阅转换的前端基础，并以自托管 Go Gateway、受控请求策略、短链与部署验证作为当前运行边界。MyUrls 来自 [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls) 与 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls)，转换引擎来自 [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended)。

完整的镜像来源、版本与许可证说明见 [第三方来源](docs/third-party-sources.md)。
