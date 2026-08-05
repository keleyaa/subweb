# 部署索引

## 先选择可用方式

| 方式 | 适用场景 | TLS 与公网入口 | 当前状态 |
| --- | --- | --- | --- |
| [本机源码](deployment-local.md) | 开发、调试、完整源码验证 | 默认只在本机端口；公开时自行配置外层代理 | 已实现，并通过 macOS 与 Ubuntu 生命周期 CI |
| [Docker](deployment-docker.md) `behind-proxy` | 已有宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 或其他入口 | 外层服务终止 TLS，Compose 只绑定 `127.0.0.1:18080` | 已实现并有自动化集成验证 |
| [Docker](deployment-docker.md) `direct-tls` | 没有外层代理，但已有合法双域名证书且 80/443 可用 | 网关直接监听 80/443；部署者负责证书申请与续期 | 已实现并有自动化集成验证 |

项目不依赖 Caddy。已有面板或反向代理不会与 `behind-proxy` 冲突：外层代理占用 80/443，Subweb 只监听 loopback 端口。不要同时启用 `direct-tls`，否则会争用 80/443。

当前真正可以按文档落地的是 Docker 和本机源码：

- 生产服务器优先选择 Docker `behind-proxy`。
- 没有反向代理、但已经准备好双域名证书和空闲 80/443 时选择 Docker `direct-tls`。
- 开发和本机验收选择本机源码。

Docker 和本机源码都从以下操作开始：

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

如果已经拉取过项目，不要再次执行 `git clone`，而是进入原目录更新：

```sh
cd "$HOME/apps/subweb"
git status --short
git pull --ff-only origin main
```

`git status --short` 有输出时先确认这些本地改动是否需要保留，不要直接覆盖。进入项目后用 `pwd` 确认当前目录以 `/subweb` 结尾，并用 `test -f compose.yaml` 确认文件完整。

维护者展示部署使用 `sub.ml1.one` 与 `api.ml1.one`。它们只是展示值，其他部署者需要准备自己的两个不同域名，并让它们指向同一公网 gateway；应用 Host 提供网页和短链，API Host 提供转换接口。

生产前同时阅读[配置](configuration.md)、[架构](architecture.md)、[安全](security.md)和[运维](operations.md)。
