# Docker 部署

默认 Compose 只启动 3 个服务：`subweb`、`myurls` 和 `redis`。`subweb` 在同一容器内运行 Nginx Gateway 与 SubConverter；只有它的 `8080` 端口绑定到 loopback 的 `SUBWEB_PORT`。MyUrls 处理 APP 域的同源短链创建和 SHORT 域的短码跳转，Redis 保存短链数据。HTTPS、证书和三个域名的路由由外部反向代理负责。

默认模式适合可信维护者自用或受控的小规模部署。它没有 Request Policy Service 的输入级 SSRF/DNS 防护、匿名限流和 HTTPS CONNECT egress 约束；对公网、多用户或不可信订阅输入，改用本文末尾的 hardened Compose。

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
./scripts/validate-compose.sh
docker compose up -d --build --wait
```

`configure.sh` 自动生成 Redis 密码和独立的 IP 哈希秘密，无需手动填写。默认模式的短链数据使用 Redis DB `0`；不要直接执行 `cat .env`。只检查非秘密项时使用明确的白名单：

```sh
grep -E '^(APP_DOMAIN|API_DOMAIN|SHORT_DOMAIN|API_URL|SUBWEB_IMAGE)=' .env
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

Docker Hub 的 `docker.io/keleyaa/subweb:sha-...` 与 `ghcr.io/keleyaa/subweb:sha-...` 是等价的发布来源。`--image` 是必填项，只接受 `sha-*` 标签或完整 `@sha256` 摘要，脚本拒绝 `latest` 和无版本引用。脚本拉取 `subweb`、Redis 和 MyUrls 镜像，再执行 `docker compose up -d --no-build --pull never --wait`。MyUrls 默认使用 `deploy/versions.lock.json` 中的 Rust v2.0.6 版本。

## 外部反向代理

`APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 都转发到 `127.0.0.1:18080`，并保留原始 Host。不要把 Redis 或 MyUrls 端口暴露到公网。默认模式不消费 `TRUSTED_PROXY_CIDR`；该配置仅在 hardened Compose 中用于 Request Policy 的来源地址边界。

## 可选 Hardened Compose

公开部署、多用户使用或不可信的订阅 URL 需要完整的安全边界：

```sh
docker compose -f compose.hardened.yaml up -d --build --wait
```

该模式运行 Gateway、Request Policy Service、SubConverter、两个 MyUrls 实例和 Redis。Request Policy Service 执行 URL、DNS、大小、超时、并发和匿名频率限制，并为 SubConverter 提供受控 HTTPS CONNECT egress。两个 MyUrls 实例分别校验 APP/SHORT hostname，保留管理页面和完整短链 API 的原有契约。

## 运维

```sh
docker compose ps
docker compose logs --tail 100 subweb myurls redis
docker compose stop
docker compose start
docker compose down
```

Hardened 模式的日志服务列表为 `gateway request-policy myurls-app myurls-short subconverter redis`。从历史 MyUrls v1 升级到当前 Rust v2.0.6 前，先按 [`operations.md`](operations.md) 完成 Redis 盘点、备份和已批准 TTL 策略的迁移。
