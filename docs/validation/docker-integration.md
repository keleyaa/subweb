# Docker 一体化集成验证

本文记录当前固定三域名、单一 HTTP Gateway 方案的验证范围。它是验证记录，不是部署指南；生产部署只按
[`docs/deployment.md`](../deployment.md) 和 [`docs/deployment-docker.md`](../deployment-docker.md) 操作。

## 验证环境

| 项目 | 值 |
| --- | --- |
| 验证入口 | `scripts/verify-integrated-stack.sh` |
| 配置方案 | 固定三域名 + 单一 HTTP Gateway |
| 公网入口 | 外部反向代理转发到 `127.0.0.1:18080` |
| 集成开关 | `RUN_DOCKER_INTEGRATION=1` |

## 集成验证镜像

Compose 默认使用各上游当前发布策略；需要可重复验证或回滚时，在不提交的 `.env` 中显式覆盖镜像引用。
锁定基线和来源说明见 [`deploy/versions.lock.json`](../../deploy/versions.lock.json) 与
[`docs/third-party-sources.md`](../third-party-sources.md)。

## 验证结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm test -- --run tests/integration/gatewayStack.spec.js tests/integration/privacySentinel.spec.js` | 0 | 14 项通过，2 项 Docker 用例按设计明确跳过 |
| `RUN_DOCKER_INTEGRATION=1 npm test -- --run tests/integration/gatewayStack.spec.js tests/integration/privacySentinel.spec.js` | 0 | 16 项全部通过 |
| `./scripts/verify-integrated-stack.sh` | 0 | 四服务健康，三 Host、MyUrls 前端、短链、持久性和隐私契约通过 |

集成验证覆盖以下契约：

1. APP Host 返回 Subweb，API Host 完成真实的最小订阅转换；
2. Gateway 覆盖客户端伪造的 `Authorization`，浏览器不接触 MyUrls 内部 Token；
3. 创建的新短链使用 SHORT 域名，短码可跳转到原目标；
4. 依次重启 Redis 和 MyUrls 后，已创建短码仍可访问；
5. Redis、MyUrls 和 SubConverter 均未发布宿主机端口，且宿主 loopback 对 `6379`、`8080`、`25500` 的实际 TCP 连接均被拒绝；
6. Gateway、MyUrls、SubConverter 和 Redis 日志中均未发现随机隐私哨兵、完整订阅 URL 或内部 Token。

隐私验证使用一次性随机订阅 URL，并将随机值放入上游已知会脱敏的 `token` 查询参数。脚本同时扫描完整 URL 和随机值，终端只输出泄漏计数，不输出哨兵、Token、Redis 密码或完整容器日志。

## TLS 边界

项目不监听 80/443，也不读取证书文件。证书覆盖、HTTP 到 HTTPS 跳转、HSTS、WAF 和公网端口冲突属于外层反向代理；项目集成验证只检查回环 HTTP 路由和 Host 隔离。

Redis 离线备份校验将服务日志写入独立文件，`DBSIZE` 输出不会被启动日志污染。恢复流程只在权限为 `0700` 的运维目录内创建短生命周期的只读暂存快照，使容器内 Redis 用户可读取宿主机 `0600` 备份；暂存文件在成功、失败或退出时删除，不以 root 身份运行 Redis。

测试证书仅由 `scripts/test-support/create-test-certificate.sh` 写入权限为 `0700` 的独立系统临时目录；Linux 容器验证期间只放宽文件读取位、不开放目录遍历，并由退出陷阱删除。端口冲突测试使用唯一命名且带 `--rm` 的临时容器；Compose 验证使用随机 project name，退出时只执行该 project 的 `down --volumes --remove-orphans`，不会清理其他项目的容器、网络或卷。

## 证据边界

本文件不保存测试证书、私钥、MyUrls Token、Redis 密码、随机哨兵、原始订阅 URL 或完整服务日志。容器级测试必须显式设置 `RUN_DOCKER_INTEGRATION=1`；未设置时显示为跳过，不视为容器验证通过。
