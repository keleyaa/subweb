# 部署索引

Subweb 只保留一种 Docker 部署方式：3 个域名 + 单一 HTTP Gateway。项目负责应用、转换和短链路由；公网 DNS、HTTPS 证书和反向代理由部署者自己的入口负责。

| 方式 | 适用场景 | 公网入口 | 状态 |
| --- | --- | --- | --- |
| [Docker](deployment-docker.md) | 生产部署 | 3 个域名都反代到 `http://127.0.0.1:18080`，外层负责 TLS | 默认且唯一的 Docker 方案 |
| [本机源码](deployment-local.md) | 开发、调试、集成验证 | 默认只监听本机端口 | 保留独立开发工作流 |

Docker 需要 `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 这 3 个不同域名。3 个域名可以由同一台服务器的 Nginx、OpenResty、宝塔、1Panel、Cloudflare Tunnel 或其他入口接收，然后全部转发到 Gateway 的回环端口。MyUrls、Redis、SubConverter 和 Request Policy Service 不发布宿主机端口。

通用准备：

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

已存在的工作树先用 `git status --short` 检查，再按需更新；不要用强制重置覆盖本地改动。生产前请阅读 [配置](configuration.md)、[架构](architecture.md)、[安全](security.md) 和 [运维](operations.md)。
