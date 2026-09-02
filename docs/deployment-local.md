# 本地开发

本地开发使用 Docker Compose 启动真实的统一 Gateway、SubConverter、两个 MyUrls Rust v2 实例和 Redis，再由 Vite 提供前端开发服务器。首次使用时：

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
```

Compose 文件是 [`compose.yaml`](../compose.yaml) 与 [`compose.dev.yaml`](../compose.dev.yaml) 的组合；本地配置写入 `.runtime/local/compose.env`，不写入仓库根目录 `.env`。

## 环境要求

- Docker Engine 与 Docker Compose v2
- Node.js 24 与 npm 11
- OpenSSL 与 curl
- 三个未被占用的本地端口：Vite `5173`、Gateway `18081`、MyUrls SHORT `18082`

可通过 `LOCAL_VITE_PORT`、`LOCAL_SUBWEB_PORT` 和 `LOCAL_MYURLS_PORT` 修改端口。端口必须在 `1024-65535`，且彼此不同。

## 启动与停止

```sh
npm ci
npm run dev
```

`npm run dev` 会先执行 Compose-first 依赖启动，再运行 Vite。依赖服务使用现行生产镜像和统一服务名：`gateway`、`subconverter`、`myurls-app`、`myurls-short`、`redis`。本地覆盖文件关闭 MyUrls Turnstile，避免本地开发依赖真实挑战服务；生产环境仍使用 `compose.yaml` 的 Cloudflare Turnstile 配置。

```sh
npm run dev:status
npm run verify:local
npm run dev:stop
```

不要在其他项目目录执行这些命令。`verify:local` 通过 Vite `/short-api` 代理创建短链，并通过本地 SHORT 端口验证重定向。短链测试数据保存在本地 Redis volume；`dev:stop` 只停止容器，不删除 volume。

## 地址与边界

- Vite：`http://127.0.0.1:5173/`
- Gateway：`http://127.0.0.1:18081/`
- MyUrls SHORT：`http://127.0.0.1:18082/`
- Redis、MyUrls APP、SubConverter 不直接发布到宿主机
- SubConverter 只能通过 Gateway 的内部 HTTPS CONNECT egress 访问受策略控制的地址
- 本地不管理 HTTPS 证书和公网 DNS

本地 API URL 会随 Gateway 端口原子更新为 `http://127.0.0.1:<LOCAL_SUBWEB_PORT>`。运行时目录和 Compose 环境文件具有受限权限，属于本机生成数据，不应提交到 Git。

## 排查

查看完整服务状态和日志：

```sh
npm run dev:status
docker compose logs --tail=100 gateway subconverter myurls-app myurls-short redis
```

若端口被占用，设置三个新的端口后重新运行 `npm run dev`。若镜像拉取失败，先确认 Docker registry 可用；不要把未锁定的镜像标签写入 `.runtime/local/compose.env`。
