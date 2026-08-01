# Docker 镜像快速部署设计

## 目标

在保留 Gateway、SubConverter、MyUrls、Redis 多容器边界的前提下，提供一个无需本地构建前端镜像的 Docker 快速部署入口。部署者只需准备 Docker Compose、两个域名和对应入口条件，即可由脚本生成秘密、拉取镜像、校验配置并启动完整服务栈。

## 方案选择

采用“预构建 Gateway 镜像 + Compose 编排 + 单命令脚本”，不制作包含四个进程的单体镜像。单体镜像会破坏 Redis 持久化、独立健康检查、服务升级和日志边界；单独维护第二份 Compose 文件又会造成安全配置漂移。权威文件继续使用根目录 `compose.yaml`，快速部署脚本通过 `SUBWEB_IMAGE` 选择 Docker Hub 镜像，并强制 `--no-build --pull always`。

## 用户接口

新增 `scripts/docker-deploy.sh`：

```sh
./scripts/docker-deploy.sh \
  --mode behind-proxy \
  --app-domain example.com \
  --api-domain api.example.com
```

默认镜像为 `docker.io/keleyaa/subweb:latest`，适合首次体验；生产部署可用 `--image` 指定不可变的 `sha-*` 标签或 digest。`direct-tls` 继续要求 `--tls-cert` 与 `--tls-key`。脚本只负责当前仓库，不安装 Docker、不修改 DNS、不配置外层反向代理，也不删除已有卷。

## 执行顺序

1. 校验 Docker 与 Compose v2 可用。
2. 校验镜像引用，只接受无空白、无控制字符的 OCI 风格引用。
3. 调用现有 `configure.sh` 原子写入 `.env`，同时持久化 `SUBWEB_IMAGE`。
4. 调用 `validate-compose.sh` 验证 profile、端口和内部服务边界。
5. 执行 `docker compose pull`。
6. 执行 `docker compose up -d --no-build --pull always --wait`。
7. 输出 `docker compose ps`，不输出 Token、Redis 密码或完整 `.env`。

任何前置、配置、拉取或启动步骤失败时立即退出。脚本不自动执行 `down -v`，避免删除短链数据。

## 配置兼容

`configure.sh` 新增可选 `--subweb-image`。未传入时保持源码构建现状，不写 `SUBWEB_IMAGE`；传入时写入 `.env`。重新配置域名时，若没有显式传入镜像，则保留现有合法 `SUBWEB_IMAGE`，避免下一次启动意外退回本地构建。

## 验证

- 单元测试模拟 Docker CLI，确认命令顺序和 `--no-build`。
- 配置测试验证镜像写入、保留、重复参数和注入拒绝。
- Compose 测试确认 `SUBWEB_IMAGE` 能替换 Gateway 镜像且内部镜像仍按 digest 锁定。
- 文档测试要求 README 与 Docker 手册同时给出源码构建和预构建镜像入口。
- 完成后运行定向测试、`npm run verify:compose`、`npm run verify:docs`、`npm run verify`。
