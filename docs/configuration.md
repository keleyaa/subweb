# 运行时配置

## 公开域名

| 变量 | 默认展示值 | 可公开 | 生效方式 |
| --- | --- | --- | --- |
| `APP_DOMAIN` | `sub.ml1.one` | 是 | `configure.sh` 写入 `.env`，重建网关容器 |
| `API_DOMAIN` | `api.ml1.one` | 是 | 同上；必须与应用域名不同 |
| `SHORT_DOMAIN` | 无 | 是 | 同上；必须与 APP/API 不同 |
| `API_URL` | 从 `API_DOMAIN` 派生为 HTTPS URL | 是 | 写入浏览器 `apiUrl` |
| `SHORT_URL` | 从 `SHORT_DOMAIN` 或 `APP_DOMAIN` 派生 | 是 | 写入浏览器 `shortUrl` |
| `SUBWEB_IMAGE` | Compose 默认 `subweb:local` | 是 | `docker-deploy.sh` 写入已发布 Gateway 镜像；源码构建可不设置 |

这些默认域名属于维护者展示部署。其他用户必须用自己的域名执行：

```sh
./scripts/configure.sh \
  --app-domain sub.example.com \
  --api-domain api.example.com \
  --short-domain s.example.com
```

三个域名始终启用，短链返回 `https://SHORT_DOMAIN/:key`。HTTPS 和证书由外层反向代理负责；项目内部只有回环 HTTP Gateway。

更换域名时重新运行同一命令。默认保留现有秘密；增加 `--rotate-secrets` 才会同时轮换 MyUrls Token 和 Redis 密码，轮换前必须按[运维手册](operations.md)安排停写和备份。

使用预构建镜像时，`docker-deploy.sh --image` 会把引用写入 `.env`。后续只重新配置域名也会保留该引用。生产环境使用 `sha-*` 标签或 digest；不带 `--image` 的快速部署默认跟随 `docker.io/keleyaa/subweb:latest`。同一发行也发布为 `ghcr.io/keleyaa/subweb`，切换注册表时只需重新执行部署脚本并传入对应的完整 `--image` 引用。

## 秘密与内部地址

| 值 | 所有者 | 公开 | 说明 |
| --- | --- | --- | --- |
| `MYURLS_API_TOKEN` | `configure.sh` 或平台秘密系统 | 否 | 网关注入、MyUrls 校验；轮换需同时更新两端 |
| `REDIS_PASSWORD` | `configure.sh` | 否 | Docker 和本机 Redis；不进入浏览器 |
| `MYURLS_RATE_LIMIT_RPS` | `5` | 否 | 短链创建接口每秒令牌数，由 Compose/本机启动固定启用 |
| `MYURLS_RATE_LIMIT_BURST` | `10` | 否 | 短链创建接口突发容量 |
| `SUBCONVERTER_UPSTREAM` | 部署编排 | 否 | Docker 默认 `http://subconverter:25500` |
| `MYURLS_UPSTREAM` | 部署编排 | 否 | Docker 默认 `http://myurls:8080` |

`.env` 是私有文件，不提交。`.env.example` 中的 secret 只是无效占位符，正式部署必须运行 `configure.sh`。

## 浏览器配置

前端启动时读取 `/conf/config.js` 的 `window.config`。容器启动脚本从公开的 `API_URL`、`SHORT_URL` 渲染该文件；也可以在静态构建中编辑 [`public/conf/config.js`](../public/conf/config.js)。文件可被任何访客读取，严禁秘密。

字段规则：

- `apiUrl`：完整 HTTPS URL；仅本机开发允许 `http://127.0.0.1` 或 `http://localhost`；无效时回退到 `https://api.ml1.one`。
- `shortUrl`：完整 HTTPS URL；仅本机开发允许 `http://127.0.0.1` 或 `http://localhost`；空字符串关闭短链；无效非空值回退到 `https://ml1.one`。
- `menuItem`：只接受 GitHub 仓库根链接，显示在页脚。
- `remoteConfigOptions`：名称非空且 URL 完整的公开远程配置列表。

“后端默认配置”不附加 `config` 参数。选定公开预设后，后端会读取第三方文件；来源见[远程配置来源](remote-config-sources.md)。

## 本机源码端口

| 变量 | 默认端口 |
| --- | --- |
| `LOCAL_VITE_PORT` | 5173 |
| `LOCAL_SUBCONVERTER_PORT` | 25500 |
| `LOCAL_MYURLS_PORT` | 18082 |
| `LOCAL_REDIS_PORT` | 16379 |
| `LOCAL_APP_PORT` | 18080 |
| `LOCAL_API_PORT` | 18081 |
| `LOCAL_SHORT_PORT` | 18083 |

可写入未提交的 `.env` 或在命令前导出。启动脚本要求七个端口互不重复且未被占用；活跃值写入权限受限的 `.runtime/local/config/local.env`。

**访问地址**（本机三域名模式）：
- 前端：`http://127.0.0.1:18080/`
- 转换 API：`http://127.0.0.1:18081/sub?...`
- MyUrls 前端：`http://127.0.0.1:18083/`
- MyUrls 同源创建：`http://127.0.0.1:18083/short`（`multipart/form-data`）
- 短链服务：`http://127.0.0.1:18083/short-api/short`（创建）
- 短链跳转：`http://127.0.0.1:18083/:key`（跳转）
