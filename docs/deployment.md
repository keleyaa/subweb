# 部署索引

Subweb 的生产部署只有一个 Compose 合同。默认启用短链时运行五个服务：Go Gateway、SubConverter、MyUrls APP、MyUrls SHORT 和 Redis。设置 `SHORT_LINKS_ENABLED=false` 时必须改用明确的 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml)，该 profile 只运行 Gateway 与 SubConverter。

项目公开一个由 Gateway 绑定到宿主机 loopback 的 HTTP 端口。公网 DNS、TLS 证书、80/443 端口和外层反向代理由部署者负责；外层代理必须保留原始 Host，并将 APP、API、SHORT 三个域名转发到同一个 Gateway 端口。

| 方式 | 适用场景 | 入口 | 合同 |
| --- | --- | --- | --- |
| [Docker 部署](deployment-docker.md) | 生产与预构建镜像 | 外层 TLS 代理转发到 `127.0.0.1:<SUBWEB_PORT>` | 唯一生产部署方式 |
| [本机源码](deployment-local.md) | 开发、调试和本地集成 | Vite、Gateway 与本地 SHORT loopback 端口 | Compose 加 Vite |

## 生产模式

短链启用时需要 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 三个不同域名，以及 Cloudflare Turnstile、Redis 和 IP 哈希密钥。短链关闭时不需要 `SHORT_DOMAIN`、MyUrls、Redis 或 Turnstile 私钥；API 和 APP 仍由 Gateway 提供，SubConverter 仍通过内部 egress 边界运行。

SubConverter、MyUrls 和 Redis 的生产版本与不可变 digest 由 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 约束；Gateway 发布镜像由 release workflow 独立构建，部署时必须通过 `--image` 使用不可变 tag 或 digest，且不作为该版本锁中的发布镜像清单。不要用 `latest` 替换锁定引用，也不要将已删除的旧 Nginx、Node Request Policy 或历史 Compose 文件作为部署步骤。

## 通用准备

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

已有工作树先运行 `git status --short`，不要用强制重置覆盖本地改动。生产前阅读 [配置](configuration.md)、[架构](architecture.md)、[安全](security.md) 和 [运维](operations.md)。
