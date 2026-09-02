# Docker 部署

Subweb 通过一个统一 Go Gateway 运行。TLS、证书和域名路由由外层反向代理管理；Gateway 是唯一发布端口，默认只绑定 `127.0.0.1:${SUBWEB_PORT}`。APP、API 和启用后的 SHORT 域都保留原始 Host 转发到该端口。

短链启用时，`compose.yaml` 运行五个服务：`gateway`、`subconverter`、`myurls-app`、`myurls-short` 和 `redis`。Gateway 同时提供请求策略、匿名限流、受控 HTTPS CONNECT egress、静态 SPA、转换和短链路由。SubConverter 只连接内部 egress 网络，不能直接访问外网。

短链关闭时，`compose.disabled-short-links.yaml` 只运行 `gateway` 与 `subconverter`；Redis、MyUrls 和 Turnstile 私密变量都不会被读取。

## 从源码部署

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
./scripts/configure.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY
./scripts/subweb.sh verify
./scripts/subweb.sh up
```

`configure.sh` 自动生成 Redis 密码和独立的 IP 哈希秘密。不要执行 `cat .env`；只检查非秘密项时使用明确白名单：

```sh
grep -E '^(APP_DOMAIN|API_DOMAIN|SHORT_DOMAIN|API_URL|SHORT_LINKS_ENABLED|CUSTOM_BACKEND_ENABLED|SUBWEB_IMAGE)=' .env
```

关闭短链的部署无需 SHORT 域或 Turnstile 私密配置：

```sh
./scripts/configure.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-links-enabled false \
  --custom-backend-enabled false
./scripts/subweb.sh verify
./scripts/subweb.sh up
```

## 使用预构建镜像

```sh
./scripts/docker-deploy.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY \
  --image ghcr.io/keleyaa/subweb:sha-REPLACE_WITH_COMMIT
```

Docker Hub 的 `docker.io/keleyaa/subweb` 与 GHCR 的 `ghcr.io/keleyaa/subweb` 是等价的 Gateway 发布来源。`--image` 是必填项，只接受 `sha-*` 标签或完整 `@sha256` digest，脚本拒绝 `latest` 和无版本引用。它选择当前 feature profile，拉取 Gateway 与版本锁锁定的 Redis、SubConverter、MyUrls 镜像，再执行：

```sh
docker compose -f compose.yaml up -d --no-build --pull never --wait
```

关闭短链时改用：

```sh
./scripts/docker-deploy.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-links-enabled false \
  --custom-backend-enabled false \
  --image ghcr.io/keleyaa/subweb:sha-REPLACE_WITH_COMMIT
```

该命令选择 `compose.disabled-short-links.yaml`，因此不会拉取或要求 MyUrls、Redis、`SHORT_DOMAIN` 或 Turnstile 秘密。

## 外部反向代理

将 `APP_DOMAIN`、`API_DOMAIN` 以及启用的 `SHORT_DOMAIN` 反向代理到 `127.0.0.1:${SUBWEB_PORT}`，保留 `Host` 并传递可信 `X-Forwarded-*` 信息。不要把 Redis、MyUrls、SubConverter 或 Gateway 内部 CONNECT listener 暴露到公网。`TRUSTED_PROXY_CIDR` 只应包含实际反向代理地址范围，不能使用任意来源。

## 运维

使用 feature-aware CLI 管理 Compose，而不是手动选择文件：

```sh
./scripts/subweb.sh status
./scripts/subweb.sh logs
./scripts/subweb.sh down
./scripts/subweb.sh up
./scripts/subweb.sh backup --output "$PWD/.runtime/redis-backups/manual.rdb"
./scripts/subweb.sh restore \
  --backup "$PWD/.runtime/redis-backups/manual.rdb" \
  --confirm-stop-writes
```

升级前验证版本锁和 Compose，记录已解析镜像 digest 并演练 Redis 备份。详细的恢复、回滚、日志和安全运行步骤见 [运维手册](operations.md)。
