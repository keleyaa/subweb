# 部署说明

Subweb 的生产镜像只包含静态前端，由非 root Nginx 在容器内 `8080` 端口提供服务。订阅转换后端和短链服务需要单独部署，并通过运行时配置接入。

## 前置条件

- 推荐 Docker Engine 24 或更高版本，以及 Docker Compose v2 插件。
- 从源码开发或运行本地质量检查时，需要 Node.js 24 和 npm 11。
- 生产环境需要一个能够终止 HTTPS 的反向代理或入口网关。
- 主机必须能够访问转换后端、短链服务和所选远程配置；浏览器还需要满足对应服务的 CORS 策略。

## Docker Compose

仓库提供正式的 `compose.yaml` 和 `.env.example`。默认只监听本机 `127.0.0.1:18080`：

```bash
cp .env.example .env
docker compose config
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:18080/healthz
```

`.env` 支持以下值：

```dotenv
SUBWEB_BIND_ADDRESS=127.0.0.1
SUBWEB_PORT=18080
API_URL=https://api.ml1.one
SHORT_URL=https://ml1.one
```

设置 `SUBWEB_BIND_ADDRESS=0.0.0.0` 会让端口暴露到所有主机接口，只有在防火墙和访问控制已经明确配置时才这样做。把 `SHORT_URL` 留空可以关闭短链功能。

停止服务：

```bash
docker compose down
```

### 可选资源限制

小型部署可以新建不提交仓库的 `compose.override.yaml`：

```yaml
services:
  web:
    cpus: "0.50"
    mem_limit: 128m
```

运行 `docker compose config` 确认合并结果，再执行 `docker compose up -d --build`。实际限制应结合反向代理并发量和主机容量调整。

## Docker Run

本地构建：

```bash
docker build --check .
docker build -t subweb:local .
```

启动：

```bash
docker run -d --name subweb --restart unless-stopped \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  -p 127.0.0.1:18080:8080 \
  -e API_URL='https://api.ml1.one' \
  -e SHORT_URL='https://ml1.one' \
  subweb:local
```

公开镜像位于 [Docker Hub `keleyaa/subweb`](https://hub.docker.com/r/keleyaa/subweb)：

```bash
docker pull keleyaa/subweb:latest
docker run -d --name subweb --restart unless-stopped \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  -p 127.0.0.1:18080:8080 \
  keleyaa/subweb:latest
```

`latest` 会变化。需要可重复部署时，从 GitHub Actions 发布摘要或回滚清单取得 digest，然后使用：

```bash
docker pull keleyaa/subweb@sha256:<发布摘要>
docker run -d --name subweb -p 127.0.0.1:18080:8080 \
  keleyaa/subweb@sha256:<发布摘要>
```

## 挂载完整配置

需要关闭短链、隐藏仓库链接或修改远程配置预设时，复制并编辑完整配置：

```bash
mkdir -p runtime-config
cp public/conf/config.js runtime-config/config.js
```

启动只读挂载。此模式不要同时传入 `API_URL` 或 `SHORT_URL`：

```bash
docker run -d --name subweb --restart unless-stopped \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  -p 127.0.0.1:18080:8080 \
  -v "$(pwd)/runtime-config:/usr/share/nginx/html/conf:ro" \
  keleyaa/subweb:latest
```

升级前备份 `runtime-config/config.js`，并与新版本的 `public/conf/config.js` 比较字段变化。

## HTTPS 反向代理

以下 Nginx 片段假设容器只监听 `127.0.0.1:18080`，证书由主机 Nginx 管理：

```nginx
server {
  listen 443 ssl http2;
  server_name subweb.example.com;

  ssl_certificate /etc/letsencrypt/live/subweb.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/subweb.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

容器已经返回 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。不要在外层代理删除这些响应头。

## 部署后验证

```bash
docker inspect --format '{{.State.Health.Status}}' subweb
curl -fsS http://127.0.0.1:18080/healthz
curl -fsSI http://127.0.0.1:18080/
curl -fsS http://127.0.0.1:18080/conf/config.js -o /tmp/subweb-config.js
node --check /tmp/subweb-config.js
rm -f /tmp/subweb-config.js
```

Docker Run 部署可用前述 `docker inspect` 命令；Compose 部署先运行 `docker compose ps`，并确认 `web` 服务显示为 `healthy`。`/healthz` 应返回 `ok`，首页响应应包含安全头。浏览器中还应验证：

1. 页面标题和左上角均为 `Subconverter Web`。
2. 转换后按钮变为“复制订阅”，剪贴板内容是当前转换链接。
3. 短链启用时，生成结果后按钮变为“复制短链”。
4. 明暗主题切换后刷新仍保持选择。
5. 浏览器控制台没有应用错误。

仓库提供与 CI 共用的容器验证脚本：

```bash
./scripts/verify-container.sh subweb:verify
```

脚本不会映射宿主机端口，并会自动删除临时容器；测试镜像可在确认后手动删除。

## 日志与故障排查

查看状态和日志：

```bash
docker compose ps
docker compose logs --tail=200 web
docker inspect --format '{{json .State.Health}}' subweb
```

- 容器启动失败并提示无法写入配置：检查是否把配置只读挂载后又传入了 `API_URL` 或 `SHORT_URL`。
- 页面回退到默认服务：检查 URL 是否完整、是否含前后空格或用户名密码，并直接读取 `/conf/config.js`。
- 转换链接可生成但访问失败：这是转换后端请求；检查后端可达性、证书、参数兼容性和服务日志。
- 页面请求后端或短链失败：在浏览器网络面板检查 CORS、TLS、混合内容和响应格式。短链接口需要接受 `multipart/form-data` 中的 `longUrl`。
- 反向代理返回 502：确认 `curl http://127.0.0.1:18080/healthz` 能从代理主机访问，并核对代理目标端口是 `18080`。

## 升级与回滚

源码构建部署：

```bash
git fetch --prune origin
git pull --ff-only origin main
npm ci
npm run verify
docker compose build --pull
docker compose up -d
```

公开镜像部署：

```bash
docker pull keleyaa/subweb:latest
docker stop subweb
docker rm subweb
```

然后使用前述 `docker run` 命令重新创建容器。执行前记录当前 digest；若新版本验证失败，停止并删除新容器，再用已记录的旧 digest 创建同名容器。容器不保存业务数据；需要持久保留的只有部署者自行维护的完整配置文件。

每次发布都会上传保留 90 天的 `rollback-manifest-...` GitHub Actions 构件，其中包含源码 SHA、镜像 digest 和可直接拉取的 `rollback_target.source_reference`。回滚时按该引用拉取并重新创建容器，不要依赖可能已覆盖的 `latest` 标签。

## 发布门禁

`main` 分支发布前必须通过：

- `npm audit --audit-level=moderate`
- 单元测试、ESLint 和生产构建
- Chromium E2E
- `docker compose config`
- 实际容器非 root、配置语法、健康检查和安全头验证
- Trivy 对最终镜像的 HIGH/CRITICAL 可修复漏洞扫描

通过后才会发布多架构镜像、SBOM、provenance、唯一日期加 SHA 标签、`sha-...` 标签和 digest 回滚清单。仓库需要配置 `DOCKER_USERNAME` 和 `DOCKER_PASSWORD`；用户名必须有权推送 `keleyaa/subweb`。
