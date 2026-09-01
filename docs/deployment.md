# 部署索引

Subweb 的默认 Docker 部署使用 3 个服务和单一 HTTP `subweb` 入口：合并的 Gateway/SubConverter、MyUrls 和 Redis。项目负责应用、转换和短链路由；公网 DNS、HTTPS 证书和反向代理由部署者自己的入口负责。

| 方式 | 适用场景 | 公网入口 | 状态 |
| --- | --- | --- | --- |
| [Docker](deployment-docker.md) | 可信自用或受控部署 | 3 个域名都反代到 `http://127.0.0.1:18080`，外层负责 TLS | 默认 3 服务；文档包含可选 hardened 模式 |
| [本机源码](deployment-local.md) | 开发、调试、集成验证 | 默认只监听本机端口 | 保留独立开发工作流 |

Docker 需要 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 这 3 个不同域名。使用预构建 Subweb 镜像时，`scripts/docker-deploy.sh` 还必须显式传入 `--image` 的 `sha-*` 标签或 `@sha256` 摘要；它不会接受 `latest`。3 个域名可以由同一台服务器的 Nginx、OpenResty、宝塔、1Panel、Cloudflare Tunnel 或其他入口接收，然后全部转发到 Subweb 的回环端口。默认模式中 MyUrls 和 Redis 不发布宿主机端口；Request Policy 与独立 SubConverter 只在 hardened 模式存在。

通用准备：

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

已存在的工作树先用 `git status --short` 检查，再按需更新；不要用强制重置覆盖本地改动。生产前请阅读 [配置](configuration.md)、[架构](architecture.md)、[安全](security.md) 和 [运维](operations.md)。
