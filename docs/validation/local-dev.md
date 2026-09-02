# Compose-first 本地验证

本地验证先启动现行 Compose 依赖，再启动 Vite，不编译或 clone 外部服务源码。运行：

```sh
npm run dev
npm run verify:local
npm run dev:stop
```

## 本地服务

`compose.yaml` 与 `compose.dev.yaml` 的组合使用以下服务：`gateway`、`subconverter`、`myurls-app`、`myurls-short` 和 `redis`。Gateway 发布 `127.0.0.1:<LOCAL_SUBWEB_PORT>`，MyUrls SHORT 发布 `127.0.0.1:<LOCAL_MYURLS_PORT>`，Redis、APP MyUrls 和 SubConverter 保持私有。短链关闭 Turnstile 只适用于本地开发覆盖；生产配置必须按 [Docker 部署](../deployment-docker.md) 使用外部 challenge 配置。

本地端口是 Vite、Gateway 和 SHORT 三个彼此不同的值，必须处于 `1024-65535`。环境文件为 `.runtime/local/compose.env`，由脚本原子创建和更新，权限为 `0600`。Gateway 的本地 API URL 始终与 `LOCAL_SUBWEB_PORT` 同步。

## HTTP 检查

`verify-local-dev.sh` 使用 curl 通过 Vite proxy 调用 `/short-api/links`，检查 JSON Content-Type 和有效短码，然后通过本地 SHORT 端口验证 `302` 跳转。它不读取 Redis 密码，也不将订阅值写入日志。

## 故障边界

先运行 `npm run dev:status` 查看五个依赖的 Compose 状态。端口被占用时只修改 `LOCAL_VITE_PORT`、`LOCAL_SUBWEB_PORT` 或 `LOCAL_MYURLS_PORT`，然后重新执行启动命令。`npm run dev:stop` 不删除 volume，测试数据可留给后续本地运行复用。

本地验证不能证明外置 TLS、生产 Turnstile、公开 DNS 或完整发布镜像安全；这些由 `npm run verify:ci`、`npm run verify:release` 和部署后的 Docker smoke 覆盖。
