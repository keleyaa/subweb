# Docker 部署

Docker 生产部署使用 [`compose.yaml`](../compose.yaml) 的唯一启用短链 profile。Gateway 是项目自有的 Go 单二进制，负责 Host 路由、静态资源、转换请求策略、Redis 限流、MyUrls 适配和内部 HTTPS CONNECT egress。SubConverter、两个 MyUrls Rust v2 实例和 Redis 作为独立服务运行。

## 1. 获取源码并启动

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb

./scripts/subweb.sh install \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key YOUR_SITE_KEY \
  --image ghcr.io/keleyaa/subweb:sha-<commit>
```

命令会在终端隐藏提示输入 Turnstile Secret Key，然后自动生成权限为 `0600` 的 `.env`、校验 Compose、拉取镜像并等待服务健康。启用短链时，Turnstile Site Key 与 Secret Key 必须由部署者提供；CI 或非交互环境将私钥通过 `--turnstile-secret-key-stdin` 传入。默认值为 `SHORT_LINKS_ENABLED=true` 与 `CUSTOM_BACKEND_ENABLED=true`；Redis 密码与 IP 哈希密钥由脚本生成或保留已有值，除非显式要求轮换，不要在部署过程中更换它们。

## 2. 手动验证与启动

```sh
./scripts/validate-compose.sh
./scripts/subweb.sh verify
./scripts/subweb.sh up
./scripts/subweb.sh status
```

启用短链时 Compose 应准确包含五个服务：`gateway`、`subconverter`、`myurls-app`、`myurls-short`、`redis`。只有 Gateway 发布宿主机端口，且端口绑定 `127.0.0.1`。MyUrls 使用 Redis DB `0`，Gateway 限流使用 Redis DB `1`；Redis、MyUrls 和 SubConverter 没有宿主机端口。

## 3. 外层 TLS

外层反向代理将以下三个 HTTPS 虚拟主机全部转发到 `http://127.0.0.1:<SUBWEB_PORT>`：

- `APP_DOMAIN`：前端和 APP 短链管理接口
- `API_DOMAIN`：转换 API
- `SHORT_DOMAIN`：短码跳转

外层代理负责证书、TLS、HSTS 和公网 DNS。必须保留 Host，并按部署者实际代理地址配置 `TRUSTED_PROXY_CIDR`；`configure.sh` 的部署入口接受精确 IPv4 CIDR，不要把任意公网 IPv4 网段配置为可信代理。Gateway 仅在 TCP peer 命中该 CIDR 时信任 `X-Forwarded-For`/`X-Real-IP`，并使用代理链中最右侧的非可信地址作为客户端身份；否则只使用 socket peer。可参考 [外部 TLS 反向代理示例](deployment-nginx.md)，但示例不是项目运行时。

## 4. 关闭短链

短链关闭不是通过删除环境变量实现，而是选择显式 Compose 文件：

```sh
./scripts/configure.sh \
  --short-links-enabled false \
  --app-domain app.example.com \
  --api-domain api.example.com
./scripts/subweb.sh verify
./scripts/subweb.sh up
```

此 profile 使用 [`compose.disabled-short-links.yaml`](../compose.disabled-short-links.yaml)，只运行 `gateway` 和 `subconverter`。它不读取 Redis、MyUrls、`SHORT_DOMAIN` 或 Turnstile 私钥。`/short-api/links` 和 APP 短码路径不可用，普通转换仍可用。

## 5. 预构建镜像与自动化

使用预构建 Gateway 时必须显式传入不可变引用：

`--image` 只接受 `sha-*` 标签或 `@sha256:<digest>`，拒绝 `latest` 和未经验证的 CLI 参数。Docker Hub `docker.io/keleyaa/subweb` 与 GHCR `ghcr.io/keleyaa/subweb` 是等价发布来源。SubConverter、MyUrls 和 Redis 的锁定版本、平台 digest 与来源以 [版本锁](../deploy/versions.lock.json) 为准；Gateway 使用当前 release 提供的不可变引用。

CI 或其他非交互环境使用管道传入私钥，不需要 heredoc：

```sh
printf '%s\n' "$TURNSTILE_SECRET_KEY" | ./scripts/subweb.sh install \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key "$TURNSTILE_SITE_KEY" \
  --turnstile-secret-key-stdin \
  --image ghcr.io/keleyaa/subweb:sha-<commit>
```

`subweb.sh upgrade` 会先验证 Compose/版本锁合同，再拉取镜像。不要执行 `cat .env`。

## 6. 常用运维命令

```sh
./scripts/subweb.sh logs gateway
./scripts/subweb.sh down
./scripts/subweb.sh upgrade
./scripts/subweb.sh backup --output /absolute/path/backup.rdb
./scripts/subweb.sh restore --backup /absolute/path/backup.rdb --confirm-stop-writes
```

备份和恢复只在短链启用且显式确认停止写入时可用。不要将 `.env`、备份文件、Redis 密码、Turnstile 私钥或完整短码放入日志、Issue 或截图。
