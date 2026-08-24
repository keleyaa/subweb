# Single HTTP Deployment Design

## Goal

将 Docker 部署收敛为一个默认方案：Subweb 只提供绑定到 loopback 的 HTTP Gateway，用户自行负责公网反向代理、TLS 证书、HTTPS 跳转和域名解析。

## Fixed deployment contract

- `APP_DOMAIN`、`API_DOMAIN`、`SHORT_DOMAIN` 三个不同域名是部署必填项。
- 三个域名都由外部入口反代到同一个 `http://127.0.0.1:18080`。
- Gateway 只监听容器 `8080`，Compose 只发布 `127.0.0.1:${SUBWEB_PORT:-18080}:8080`。
- Compose 只保留一个 `gateway` 服务，不再使用 `behind-proxy`/`direct-tls` profiles。
- 项目不再接收或校验证书路径，不再生成 HTTPS Gateway，不再占用宿主机 `80`/`443`。
- 公开 URL 仍按 HTTPS 生成；HTTPS 终止和强制跳转完全属于外部代理职责。

## CLI contract

部署入口固定为：

```sh
./scripts/docker-deploy.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com
```

`configure.sh` 和 `docker-deploy.sh` 删除 `--mode`、`--tls-cert`、`--tls-key`。`--image`、秘密复用/轮换和镜像覆盖继续保留。

生成的 `.env` 保留公开域名、`API_URL`、`SHORT_URL`、镜像和秘密；删除 `COMPOSE_PROFILES`、`DOMAIN_MODE`、`PUBLIC_SCHEME`、`GATEWAY_MODE`、`GATEWAY_PORT`、`TLS_CERT_PATH` 和 `TLS_KEY_PATH` 等模式分支变量。Gateway 和 MyUrls 内部使用固定 HTTPS 公共 URL 语义。

## Runtime and routing

- 只保留 `nginx/templates/http.conf.template`；Gateway renderer 不再选择 direct-TLS 模板。
- `Dockerfile` 只暴露 `8080`，健康检查固定请求 `http://127.0.0.1:8080/healthz`。
- `SHORT_DOMAIN` server 始终生成，提供 MyUrls UI、静态资源、同源 `POST /short`、`/<shortKey>` 跳转和 `/healthz`。
- `APP_DOMAIN` 继续提供 Subweb 前端，并保留 `/short-api/short` 和 `/<shortKey>` 兼容入口，避免已有 APP 短链立即失效。
- `API_DOMAIN` 继续提供 SubConverter 路由。
- 不增加 MyUrls、Redis 或 SubConverter 宿主机端口。
- 未知 Host 继续返回 `421`，未知路径继续返回 `404`。

## Migration boundary

新版本不再把 Legacy 双域名和 Direct-TLS 当作正式部署模式。已有实例需要由部署者：

1. 在外部代理增加 `SHORT_DOMAIN` vhost，并让三个 vhost 指向 Gateway loopback 端口。
2. 重新运行固定参数的 `configure.sh`，生成新的 `.env`。
3. 使用 `docker compose up -d --no-build --pull always --wait` 重建 Gateway。

旧 APP 短链跳转路由保留；旧的 TLS 容器、profile 和证书挂载不由新 Compose 管理。项目不自动迁移证书或外部代理配置。

## Verification

- 配置测试验证三个域名必填、无模式参数、无 TLS 参数、固定 HTTP Gateway。
- Compose 测试验证只有一个 `gateway` 服务发布 loopback `8080`，内部服务无宿主机端口。
- Gateway 渲染测试验证唯一 HTTP 模板、三域名 server、短链 UI 路由和未知 Host `421`。
- 集成测试只运行一条三域名 HTTP Gateway 链路，验证 Subweb、SubConverter、MyUrls UI、短链创建/跳转、APP 兼容和 Redis 持久性。
- 发布门禁、运维脚本、镜像验证、README 和部署文档不再引用 Direct-TLS 或双模式命令。
