# Docker 部署

Compose 启动 `gateway`、`subconverter`、两个 MyUrls v2 实例和 `redis`。两个 MyUrls 实例共用 Redis 数据，
分别校验 APP 与 SHORT hostname。只有 Gateway 将容器的 `8080` 端口绑定到 loopback 的 `SUBWEB_PORT`。HTTPS、证书和
3 个域名的路由由外部反向代理负责。

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

`configure.sh` 自动生成 Redis 密码和独立的 IP 哈希秘密，无需手动填写。不要直接执行 `cat .env`；
只检查非秘密项时使用明确的白名单：

```sh
grep -E '^(APP_DOMAIN|API_DOMAIN|SHORT_DOMAIN|API_URL|SUBWEB_IMAGE)=' .env
```

## 使用预构建 Gateway

```sh
./scripts/docker-deploy.sh \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --turnstile-secret-key YOUR_SECRET_KEY \
  --image ghcr.io/keleyaa/subweb:sha-REPLACE_WITH_COMMIT
```

Docker Hub 的 `docker.io/keleyaa/subweb:sha-...` 与
`ghcr.io/keleyaa/subweb:sha-...` 是等价的发布来源。脚本执行
`docker compose up -d --no-build --pull always --wait`，但 MyUrls 默认仍使用
`deploy/versions.lock.json` 中的 semver + digest；Gateway、Redis、SubConverter 和 MyUrls 默认都使用锁定 digest。

## 外部反向代理

`APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 都转发到 `127.0.0.1:18080`，并保留原始 Host。
外部代理应覆盖 `X-Forwarded-For`；只有在明确配置该代理来源的
`TRUSTED_PROXY_CIDR` 后，Gateway 才会信任它。不要把 Redis、MyUrls 或 SubConverter
端口暴露到公网。

## 运维

```sh
docker compose ps
docker compose logs --tail 100 gateway myurls-app myurls-short subconverter redis
docker compose stop
docker compose start
docker compose down
```

不要在日志命令中附加 `.env` 内容。生产切换到 v2 前，先按 [`operations.md`](operations.md) 完成 Redis 盘点、备份和已批准 TTL 策略的迁移。
