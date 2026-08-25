# Docker 部署

Docker Compose 启动四个服务：`gateway`、`subconverter`、`myurls` 和 `redis`。只有 Gateway 发布宿主机端口，而且固定绑定到 `127.0.0.1:${SUBWEB_PORT:-18080}` 的容器 `8080` 端口。HTTPS、证书、DNS 和公网反代由部署者自己的入口负责。

## 前置条件

- Docker Engine 24+ 与 Docker Compose v2。
- Git，以及访问镜像仓库的网络。
- 三个不同域名解析到同一个反向代理入口：应用、API、短链。
- 反向代理把三个 Host 全部转发到 `http://127.0.0.1:18080`，保留原始 `Host`。

首次拉取：

```sh
mkdir -p "$HOME/apps" && cd "$HOME/apps"
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

## 镜像部署

```sh
cd "$HOME/apps/subweb"
./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com
```

脚本会生成权限为 `600` 的 `.env`，复用现有 Token、Redis 密码和镜像覆盖，拉取镜像并启动栈。Gateway 同时发布到 `docker.io/keleyaa/subweb` 和 `ghcr.io/keleyaa/subweb`；生产环境可以用 `--image docker.io/keleyaa/subweb:sha-<verified>` 或 GHCR 等价引用锁定发行版本。

不要直接执行 `cat .env`；秘密由脚本生成，无需手动填写。需要使用备用仓库时：

```sh
./scripts/docker-deploy.sh --app-domain sub.example.com --api-domain api.example.com --short-domain short.example.com --image ghcr.io/keleyaa/subweb:sha-<verified>
```

检查服务和回环入口：

```sh
docker compose ps
docker compose logs --tail=100 gateway myurls subconverter redis
curl -fsS -H 'Host: sub.example.com' http://127.0.0.1:18080/healthz
curl -fsS -H 'Host: short.example.com' http://127.0.0.1:18080/healthz
```

## 反向代理

为三个域名分别配置 HTTPS 站点，反代目标都填 `http://127.0.0.1:18080`。外层入口应保留 `Host`，并传递 `X-Forwarded-Proto https`。Nginx 示例：

```nginx
server {
  listen 443 ssl;
  server_name sub.example.com api.example.com short.example.com;

  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

默认 Gateway 不信任 `X-Forwarded-For`，因此所有经由同一外层反代的请求会共享其内部限流桶。多用户部署时，将反代到达 Gateway 的实际来源地址配置为精确 IPv4 CIDR，例如：

```sh
./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --trusted-proxy-cidr 172.18.0.1/32
```

该 CIDR 只应包含你控制的反代来源，不能使用 `0.0.0.0/0`。Docker 网络布局不同，示例地址不是通用默认值；先确认外层反代连接 Gateway 时在容器内呈现的来源地址。

如果面板要求三个站点，则为每个域名重复同一条反代规则。短链域名的 `/`、`/app.js`、`/styles.css`、`/fonts/` 和 `/short` 会由 Gateway 转发到内部 MyUrls；不需要给 MyUrls 单独配置端口。

## 配置与升级

重新配置域名时：

```sh
./scripts/configure.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com
./scripts/validate-compose.sh
docker compose up -d --no-build --pull always --wait
```

只公开检查值时：

```sh
grep -E '^(APP_DOMAIN|API_DOMAIN|SHORT_DOMAIN|API_URL|SHORT_URL|SUBWEB_IMAGE)=' .env
```

日常操作：

```sh
docker compose ps
docker compose stop
docker compose start
docker compose down
```

`docker compose down` 不删除命名卷；不要用 `down -v` 删除短链数据。升级前先备份 Redis，再更新镜像或源码并运行 `npm run verify`、`npm run verify:compose`。SubConverter 运行卷的更新和 Redis 备份恢复见[运维手册](operations.md)。

## 从源码构建镜像

需要修改 Gateway 或前端时才构建本地镜像：

```sh
./scripts/configure.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com
./scripts/validate-compose.sh
docker compose up -d --build --wait
```

源码构建与镜像部署使用同一个 `gateway` 服务和同一个回环 HTTP 入口；公网反代和证书配置始终由部署者自己的入口负责。

## 验证

```sh
npm run verify
npm run verify:compose
npm run verify:container
npm run verify:integration
```

集成验证覆盖三 Host 路由、MyUrls 前端、短链创建与跳转、CORS、Redis 重启持久性、内部端口私有和日志隐私。证书续期、强制 HTTPS、HSTS 和公网端口属于外层反向代理的职责。
