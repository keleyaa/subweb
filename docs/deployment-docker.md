# Docker 部署

Docker Compose 启动 gateway、SubConverter、MyUrls 和 Redis。Redis 默认使用稳定主线 `docker.io/library/redis:8-alpine`；MyUrls 和 SubConverter 默认跟随各自的 `latest` 标签。[`deploy/versions.lock.json`](../deploy/versions.lock.json) 保留集成测试与回滚使用的已验证基线，且可通过 `REDIS_IMAGE` 显式冻结或回滚 Redis。Redis 卷 `redis-data` 是唯一业务持久数据。

## 前置条件

- Docker Engine 24+ 与 Docker Compose v2。
- Git 与可以访问 GitHub、Docker Hub、GHCR 的网络。
- 两个或三个域名解析到同一入口。维护者展示部署使用三域名模式（`sub.ml1.one`、`api.ml1.one`、`s.ml1.one`）；其他部署者请替换为自己控制的域名。
- 选择 `behind-proxy` 或 `direct-tls`，不要同时启用。

先确认 Docker 已安装并且当前用户能够使用：

```sh
docker --version
docker compose version
docker info >/dev/null
```

如果最后一条命令提示权限不足，需要先按当前系统的 Docker 安装说明配置权限；不要通过给项目文件开放宽泛权限来绕过。

## 第一次拉取项目

以下命令把项目放在当前用户目录，不要求使用 `/root` 或 `/opt`：

```sh
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
pwd
test -f compose.yaml
```

后续所有 `./scripts/...` 和 `docker compose ...` 命令都必须在这个 `subweb` 目录执行。关闭终端后重新连接服务器时，先运行：

```sh
cd "$HOME/apps/subweb"
```

如果目录已经存在，用以下命令更新，不要再次克隆：

```sh
cd "$HOME/apps/subweb"
git status --short
git pull --ff-only origin main
```

工作树有本地改动时，`git pull --ff-only` 可能拒绝更新。先确认改动来源，不要使用 `git reset --hard` 直接丢弃。

## 域名和模式选择

部署前准备两个不同域名：

- `APP_DOMAIN`：网页、短链创建和短码跳转，例如 `sub.example.com`。
- `API_DOMAIN`：订阅转换接口，例如 `api.example.com`。

两个域名都指向同一台服务器。已有宝塔、1Panel、Nginx、OpenResty 或 Cloudflare Tunnel 时选择 `behind-proxy`；80/443 完全空闲且已经有一张覆盖两个域名的证书时才选择 `direct-tls`。

## 预构建镜像快速部署

仓库提供的快速部署脚本会生成 `.env`、拉取 Gateway、SubConverter、MyUrls 和 Redis 镜像，并以 `--no-build` 启动。它不会安装 Docker、修改 DNS、申请证书或删除已有数据卷。

Gateway 的每次正式发行由同一次多架构构建同时推送到两个公开镜像源：

- 默认源：`docker.io/keleyaa/subweb`
- 备用源：`ghcr.io/keleyaa/subweb`

两个镜像源具有相同的 `latest`、日期提交标签、`sha-*` 标签和 manifest digest。部署者拉取公开镜像不需要登录；当某个注册表不可达或限流时，可以只替换 `--image` 的注册表前缀，不需要修改 Compose。

### 三域名模式（推荐）

前端、转换后端、短链服务使用独立域名，职责清晰，支持跨域 CORS。已有宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 等反向代理时：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain sub.ml1.one \
  --api-domain api.ml1.one \
  --short-domain s.ml1.one
```

短链返回 `https://s.ml1.one/abc123`。迁移期间，`https://sub.ml1.one/abc123` 仍可访问（兼容入口）。

### Legacy 双域名模式

向后兼容的部署方式，短链服务在前端域名下：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain sub.ml1.one \
  --api-domain api.ml1.one
```

短链返回 `https://sub.ml1.one/abc123`。

脚本执行成功后已经完成启动，不需要再手工执行 `docker compose up`。检查状态和本机入口：

```sh
docker compose ps
docker compose logs --tail=100 gateway-http myurls subconverter redis
curl -fsS -H 'Host: sub.ml1.one' http://127.0.0.1:18080/healthz
```

没有外层代理且已有覆盖两个域名的证书时：

```sh
./scripts/docker-deploy.sh --mode direct-tls \
  --app-domain sub.example.com --api-domain api.example.com \
  --tls-cert /absolute/path/to/fullchain.pem \
  --tls-key /absolute/path/to/privkey.pem
```

脚本默认使用 `docker.io/keleyaa/subweb:latest` 方便首次体验。正式生产部署应从 Docker Hub 或对应 Actions 发行记录取得版本标签，并显式锁定：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com \
  --image docker.io/keleyaa/subweb:sha-2bf1a9f
```

使用同一发行的 GHCR 备用镜像：

```sh
./scripts/docker-deploy.sh --mode behind-proxy \
  --app-domain example.com --api-domain api.example.com \
  --image ghcr.io/keleyaa/subweb:sha-2bf1a9f
```

将示例短 SHA 替换为 [GitHub Actions 发行记录](https://github.com/keleyaa/subweb/actions/workflows/docker-build-release.yml)中实际发布的完整 `sha-*` 标签。不要根据本地未推送提交猜测远端标签。

脚本内部的启动契约为：

```sh
docker compose pull
docker compose up -d --no-build --pull always --wait
```

`latest` 会随新发行变化，适合体验和主动跟随更新；`sha-*` 标签或镜像 digest 适合可审计生产部署。Docker Hub 与 GHCR 都不可用时，不要退回不明来源镜像，可按“从源码构建”流程在本机生成 Gateway。快速部署仍是四容器 Compose 架构，不是把 Redis、MyUrls 和 SubConverter 塞入 Gateway 单体镜像。

MyUrls 也默认跟随 `ghcr.io/keleyaa/myurls:latest`。该标签只会在 MyUrls 的完整稳定版本标签（`vX.Y.Z`）发布成功后移动；它当前不存在或拉取失败时，不要把镜像名称改成来源不明的镜像，应先完成对应 MyUrls 稳定发行。需要冻结或回滚时，在不提交的 `.env` 中加入 `MYURLS_IMAGE=ghcr.io/keleyaa/myurls@sha256:<已验证摘要>`，再运行 `./scripts/validate-compose.sh` 和 `docker compose up -d --no-build --pull always --wait`。

## 从源码构建

需要修改前端、Gateway 或验证本地 Dockerfile 时再使用以下流程。

## 已有反向代理：behind-proxy

适用于宝塔、1Panel、Nginx、OpenResty、Cloudflare Tunnel 等已经占用 80/443 的环境：

```sh
./scripts/configure.sh --mode behind-proxy \
  --app-domain sub.ml1.one --api-domain api.ml1.one
./scripts/validate-compose.sh
docker compose up -d --build --wait
docker compose ps
curl -fsS -H 'Host: sub.ml1.one' http://127.0.0.1:18080/healthz
```

Compose 固定绑定 `127.0.0.1:${SUBWEB_PORT:-18080}`。通用 Nginx 配置为两个站点指向同一 upstream：

```nginx
server {
  listen 443 ssl;
  server_name sub.ml1.one;
  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
server {
  listen 443 ssl;
  server_name api.ml1.one;
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

首次执行 `configure.sh` 或 `docker-deploy.sh` 时会自动创建权限为 `600` 的 `.env`。以下值由脚本生成，无需手动填写：

- `API_URL` 与 `SHORT_URL`：从两个域名派生。
- `MYURLS_API_TOKEN`：Gateway 与 MyUrls 共用的随机秘密。
- `REDIS_PASSWORD`：Redis 随机密码。
- `SUBWEB_IMAGE`：使用镜像快速部署时写入。

不要直接执行 `cat .env`，因为其中包含真实 Token 和 Redis 密码。只检查公开配置时使用：

```sh
grep -E '^(COMPOSE_PROFILES|APP_DOMAIN|API_DOMAIN|API_URL|SHORT_URL|SUBWEB_IMAGE)=' .env
```

一般不需要手动编辑 `.env`。`behind-proxy` 需要永久修改本机监听端口时，可以用文本编辑器增加或修改：

```dotenv
SUBWEB_PORT=18090
```

修改后外层反向代理地址也要改成 `http://127.0.0.1:18090`，然后重新执行 `./scripts/validate-compose.sh` 和对应启动命令。不要手工修改 `MYURLS_API_TOKEN` 或 `REDIS_PASSWORD`；使用脚本的轮换流程保证所有消费者一致。

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

每次执行以下命令前都先进入安装目录：

```sh
cd "$HOME/apps/subweb"
```

```sh
docker compose ps
docker compose logs --tail=200 gateway-http myurls subconverter redis
docker compose stop
docker compose start
docker compose down
```

- `stop`：停止容器但保留容器、网络和数据。
- `start`：重新启动已存在的容器。
- `down`：删除容器和网络，但保留命名数据卷。
- 再次部署：重新运行 `docker-deploy.sh`，或按源码构建流程执行 `docker compose up`。

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

失败时切回记录的 commit，必要时在 `.env` 中以 `SUBWEB_IMAGE`/`MYURLS_IMAGE`/`REDIS_IMAGE`/`SUBCONVERTER_IMAGE` 指定已验证 digest 回滚，并重新启动。Redis 主版本变化必须经过单独的备份/恢复兼容验证，不能盲目复用已被新主版写入的数据卷。

SubConverter 镜像更新后，其运行时卷 `subconverter-runtime` 不会自动获得新镜像的 `/base` 内容（Docker 只对空卷做 copy-up）。确认新版本通过集成验证后，重建该卷让新镜像重新填充配置模板：

```sh
docker compose down
docker volume rm subweb_subconverter-runtime
docker compose up -d --wait
```

跳过此步骤会静默沿用旧 `/base` 模板、profiles 与 snippets（新二进制 + 旧配置，健康检查不会告警）。Redis 的 `redis-data` 是业务数据，永远不要用上述方式删除。

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
