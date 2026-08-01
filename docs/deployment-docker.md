# Docker 部署

Docker Compose 启动 gateway、SubConverter、MyUrls 和 Redis。所有外部镜像都由摘要锁定；Redis 卷 `redis-data` 是唯一业务持久数据。

## 前置条件

- Docker Engine 24+ 与 Docker Compose v2。
- 两个不同域名，例如 `example.com` 和 `api.example.com`，都解析到同一入口。
- 选择 `behind-proxy` 或 `direct-tls`，不要同时启用。

## 预构建镜像快速部署

仓库提供的快速部署脚本会生成 `.env`、拉取 Gateway、SubConverter、MyUrls 和 Redis 镜像，并以 `--no-build` 启动。它不会安装 Docker、修改 DNS、申请证书或删除已有数据卷。

已有宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 等反向代理时：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com
```

没有外层代理且已有覆盖两个域名的证书时：

```sh
./scripts/docker-deploy.sh --mode direct-tls \
  --app-domain example.com --api-domain api.example.com \
  --tls-cert /absolute/path/to/fullchain.pem \
  --tls-key /absolute/path/to/privkey.pem
```

脚本默认使用 `docker.io/keleyaa/subweb:latest` 方便首次体验。正式生产部署应从 Docker Hub 或对应 Actions 发行记录取得版本标签，并显式锁定：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com \
  --image docker.io/keleyaa/subweb:sha-2bf1a9f
```

脚本内部的启动契约为：

```sh
docker compose pull
docker compose up -d --no-build --pull always --wait
```

`latest` 会随新发行变化，适合体验和主动跟随更新；`sha-*` 标签或镜像 digest 适合可审计生产部署。快速部署仍是四容器 Compose 架构，不是把 Redis、MyUrls 和 SubConverter 塞入 Gateway 单体镜像。

## 从源码构建

需要修改前端、Gateway 或验证本地 Dockerfile 时再使用以下流程。

## 已有反向代理：behind-proxy

适用于宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 等已经占用 80/443 的环境：

```sh
./scripts/configure.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com
./scripts/validate-compose.sh
docker compose up -d --build --wait
docker compose ps
curl -fsS -H 'Host: example.com' http://127.0.0.1:18080/healthz
```

Compose 固定绑定 `127.0.0.1:${SUBWEB_PORT:-18080}`。通用 Nginx 配置为两个站点指向同一 upstream：

```nginx
server {
  listen 443 ssl;
  server_name example.com;
  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
server {
  listen 443 ssl;
  server_name api.example.com;
  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

宝塔或 1Panel 中创建两个 HTTPS 网站，域名分别填写应用域名和 API 域名，反向代理目标都填 `http://127.0.0.1:18080`，保留 Host 头并启用 WebSocket 兼容即可。证书、强制 HTTPS 和 Cloudflare 模式由外层入口维护。项目不要求 Caddy。

## 网关直接 TLS：direct-tls

此模式需要 80/443 未被占用，以及一张 SAN 覆盖两个域名的现成证书。项目不会申请或续期证书：

```sh
./scripts/configure.sh --mode direct-tls \
  --app-domain example.com --api-domain api.example.com \
  --tls-cert /absolute/path/to/fullchain.pem \
  --tls-key /absolute/path/to/privkey.pem
./scripts/validate-compose.sh
docker compose up -d --build --wait
```

路径必须绝对且文件已存在；Compose 只读挂载证书。私钥只允许管理员和 Docker 读取。续期后先验证证书文件，再重建 gateway 使其重新读取：

```sh
docker compose exec gateway-tls nginx -t
docker compose restart gateway-tls
docker compose ps
```

## 配置变更与秘密轮换

更换域名时重新运行 `configure.sh`，更新 DNS/证书/外层代理后执行：

```sh
./scripts/validate-compose.sh
docker compose up -d --build --wait
```

默认复用 `.env` 中的秘密。轮换会使旧 Token 立即失效，并改变 Redis 密码，必须先停写、备份并同步更新整个栈：

```sh
./scripts/configure.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com --rotate-secrets
```

不要输出或提交 `.env`。`API_URL` 和 `SHORT_URL` 是公开派生值，Token 与 Redis 密码不是。

## 日常操作

```sh
docker compose ps
docker compose logs --tail=200 gateway-http myurls subconverter redis
docker compose stop
docker compose start
docker compose down
```

`docker compose down` 默认保留命名卷；禁止使用 `down -v` 作为日常停止命令，因为它会删除短链数据。备份、恢复、升级和回滚流程见[运维手册](operations.md)。

## 升级与回滚

镜像快速部署升级时，先备份 Redis，再重新运行 `docker-deploy.sh` 并通过 `--image` 指定新的不可变标签。回滚时指定之前记录的标签；脚本不会删除 `redis-data` 卷。

源码构建部署按以下流程升级。

升级前备份 Redis、记录当前 Git commit 和锁文件摘要，然后：

```sh
git fetch --prune origin
git pull --ff-only origin main
npm ci
npm run verify
npm run verify:locks
./scripts/validate-compose.sh
docker compose build --pull
docker compose up -d --build --wait
```

失败时切回记录的 commit，恢复对应锁定镜像并重新启动。Redis 主版本变化必须经过单独的备份/恢复兼容验证，不能盲目复用已被新主版写入的数据卷。

## 验证与排错

```sh
npm run verify:integration:behind-proxy
npm run verify:integration:direct-tls
```

生产部署至少检查：两个域名 TLS、Host 路由、转换、创建短链、旧短码重启后仍可跳转、内部服务没有宿主机端口、响应安全头和日志无订阅 URL/Token。

- `502`：查看 gateway 与目标服务健康，确认两个域名都转发到同一端口并保留 Host。
- 创建短链 `401/403`：Token 两端不一致；重新由同一 `.env` 创建 gateway 和 MyUrls。
- 页面仍显示旧域名：检查容器内渲染的 `/conf/config.js`，然后无缓存刷新。
- 端口占用：`behind-proxy` 修改未提交 `.env` 的 `SUBWEB_PORT`；`direct-tls` 必须释放 80/443。
- Redis 不健康：不要删除卷；先看日志、磁盘权限和密码配置，再按运维流程恢复。
