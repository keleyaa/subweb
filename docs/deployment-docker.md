# Docker 部署

Docker 生产部署由公共服务合同 [`compose.common-services.yaml`](../compose.common-services.yaml) 和两个显式入口组合：启用短链使用 [`compose.yaml`](../compose.yaml)，关闭短链使用 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml)。Gateway 是项目自有的 Go 单二进制，负责 Host 路由、静态资源、转换请求策略、Redis 限流、MyUrls 适配和内部 HTTPS CONNECT egress。SubConverter、一个 MyUrls Rust v2 实例和 Redis 作为独立服务运行。

公网部署必须在外层 HTTPS 代理启用认证（例如 Cloudflare Access、VPN 或 Basic Auth），并且不要直接把容器端口发布到公网。若不需要短链，应关闭短链；短链目标会按 TTL 写入 Redis，持有码即可访问。

## 1. 首次交互式安装

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/subweb.sh install
```

不带参数的 `./scripts/subweb.sh install` 只在交互式终端打开安装向导。它依次询问 APP 域名、API 域名、是否启用短链；仅启用短链时询问 SHORT 域名和 Turnstile Site Key；随后可选填 `TRUSTED_PROXY_CIDR`，并要求明确输入 Gateway 发布版本 `vX.Y.Z`。

向导先将该版本解析为不可变 GHCR manifest digest，再展示不含 Turnstile Secret Key 的确认摘要；只接受 `yes` 才会继续。确认后才通过既有隐藏输入流程获取 Turnstile Secret Key，随后生成权限为 `0600` 的 `.env`、校验 Compose、拉取镜像并等待服务健康。不会使用 `latest`，也没有隐式版本选择。

启用短链时，Turnstile Site Key 与 Secret Key 必须由部署者提供。默认值为 `SHORT_LINKS_ENABLED=true` 与 `CUSTOM_BACKEND_ENABLED=true`；Redis 密码与 IP 哈希密钥由脚本生成或保留已有值，除非显式要求轮换，不要在部署过程中更换它们。`configure.sh` 同时从 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 生成三项外部 runtime 镜像值。

## 2. 手动验证与启动

```sh
./scripts/validate-compose.sh
./scripts/subweb.sh verify
./scripts/subweb.sh up
./scripts/subweb.sh status
```

启用短链时 Compose 应准确包含四个服务：`gateway`、`subconverter`、`myurls`、`redis`。只有 Gateway 发布宿主机端口，且端口绑定 `127.0.0.1`。MyUrls 使用 Redis DB `0`，Gateway 限流使用 Redis DB `1`；Redis、MyUrls 和 SubConverter 没有宿主机端口。

启动依赖会先等待 Gateway（包括内部 `:25502` 订阅 egress 监听，以及启用短链时的 `:25503` 受限 egress 监听）健康，再启动 SubConverter 与 MyUrls，以避免代理尚未就绪时产生启动告警。

## 3. 外层 TLS

短链启用时外层反向代理转发 `APP_DOMAIN`、`API_DOMAIN` 和 `SHORT_DOMAIN` 到 `http://127.0.0.1:<SUBWEB_PORT>`：

- `APP_DOMAIN`：前端和 APP 短链管理接口
- `API_DOMAIN`：转换 API
- `SHORT_DOMAIN`：短码跳转

短链关闭时不设置 `SHORT_DOMAIN` 或短链路由，外层反向代理只转发 `APP_DOMAIN` 和 `API_DOMAIN` 到 `http://127.0.0.1:<SUBWEB_PORT>`。外层代理负责证书、TLS、HSTS 和公网 DNS。必须保留 Host，并按部署者实际代理地址配置 `TRUSTED_PROXY_CIDR`；`configure.sh` 的部署入口接受精确 IPv4 CIDR，不要把任意公网 IPv4 网段配置为可信代理。Gateway 仅在 TCP peer 命中该 CIDR 时信任 `X-Forwarded-For`/`X-Real-IP`，并使用代理链中最右侧的非可信地址作为客户端身份；否则只使用 socket peer。可参考 [外部 TLS 反向代理示例](deployment-nginx.md)，但示例不是项目运行时。

## 4. 关闭短链

在首次安装向导中选择 `false` 时，向导不会询问 SHORT 域名、Turnstile Site Key 或 Secret Key，也不会启动 Redis 或 MyUrls。此 profile 使用 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml)，只运行 `gateway` 和 `subconverter`；`/short-api/links` 和 APP 短码路径不可用，普通转换仍可用。

现有显式配置方式保留给高级或手动操作：

```sh
./scripts/configure.sh \
  --short-links-enabled false \
  --app-domain app.example.com \
  --api-domain api.example.com
./scripts/subweb.sh verify
./scripts/subweb.sh up
```

## 5. 自动化与预构建镜像

CI 或其他非交互环境必须明确提供 Gateway 输入。`--version vX.Y.Z` 仅通过 GHCR 在配置和部署前解析为不可变 manifest digest；版本 tag 不会直接写入运行时配置。`--image` 是直接传入的、与 registry 无关的不可变 digest 镜像输入；Docker Hub 与 GHCR 的 release digest 是等价的直接来源，例如 `--image ghcr.io/keleyaa/subweb@sha256:<digest>`。`--version` 与 `--image` 互斥。不要将 `latest` 或发布版本 tag 传给 `--image`。

启用短链时，Turnstile Secret Key 必须通过 `--turnstile-secret-key-stdin` 管道传入：

```sh
printf '%s\n' "$TURNSTILE_SECRET_KEY" | ./scripts/subweb.sh install \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key "$TURNSTILE_SITE_KEY" \
  --turnstile-secret-key-stdin \
  --version vX.Y.Z
```

SubConverter、MyUrls 和 Redis 的锁定版本、平台 digest 与来源只从 [版本锁](../deploy/versions.lock.json) 的 runtime-image contract 派生，不能手工覆盖。`scripts/runtime-image-contract.mjs` 为 Compose、部署和 release rollback 生成同一组不可变引用。推送匹配 `vX.Y.Z` 的 Git tag 会自动触发 Docker release workflow；也可以通过 `workflow_dispatch` 的 `version` 输入手动补跑已有 tag。普通分支推送和 Pull Request 不会触发该工作流。

`subweb.sh upgrade` 会先验证 Compose/版本锁合同，再拉取镜像。不要执行 `cat .env`。

生产命令要求 `.env` 是权限 `0600` 的普通文件，且不能是符号链接。`./scripts/subweb.sh down` 只停止服务，不使用 `--volumes`；启动或升级失败不会自动重置 Redis 数据。若 Redis 7 无法读取来自较新主版本的 RDB，命令会明确报告数据格式不兼容，必须使用兼容备份或由操作者确认单独的重置操作。

## 6. 常用运维命令

```sh
./scripts/subweb.sh logs gateway
./scripts/subweb.sh down
./scripts/subweb.sh upgrade
./scripts/subweb.sh backup --output /absolute/path/backup.rdb
./scripts/subweb.sh restore --backup /absolute/path/backup.rdb --confirm-stop-writes
```

备份和恢复只在短链启用且显式确认停止写入时可用。不要将 `.env`、备份文件、Redis 密码、Turnstile 私钥或完整短码放入日志、Issue 或截图。

## 当前运行时版本

当前启用短链的生产 profile 固定运行四个服务：`gateway`、`subconverter`、唯一的 `myurls` 和 Redis。Redis 使用 `docker.io/library/redis:7.4.11-alpine`，具体 manifest 与平台 digest 以 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。

升级前执行 `./scripts/subweb.sh verify`，升级使用 `./scripts/subweb.sh upgrade`；不要手工替换 Redis、MyUrls 或 SubConverter 的镜像 tag，也不要使用 `latest`。升级后执行 `npm run verify:integration`，确认四个服务健康且短链创建、解析和过期流程正常。
