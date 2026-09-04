# 统一 Go Gateway 实施记录

> 状态：已完成。本文是已执行工作的记录，不包含待执行步骤；所有任务均已通过对应验证并合并到 `main`。

## 最终合同

Subweb 项目自有 Gateway 与 Request Policy 已收敛为 Go 1.25 单二进制。Gateway 负责 APP、API、SHORT Host 路由、静态资源、转换策略、匿名限流、MyUrls 适配和受控 HTTPS CONNECT egress。

短链开启时，唯一生产 Compose profile 运行五个服务：`gateway`、`subconverter`、`myurls-app`、`myurls-short` 和 `redis`。短链关闭时，显式的 `compose.disabled-short-links.yaml` 只运行 `gateway` 与 `subconverter`。TLS、证书和公网 DNS 由外部反向代理负责。

## 已完成任务

| 任务 | 已交付内容 | 代表提交 |
| --- | --- | --- |
| 1 | Go module、配置合同和统一错误基础 | `05571ed` |
| 2 | Gateway HTTP skeleton、Host 路由和 ResponseWriter 合同 | `970d06c`、`48bdfdc`、`66a18e5` |
| 3 | URL、DNS、IPv4/IPv6 和 rebinding 策略 | `b890bed`、`c572663`、`122ce49` |
| 4 | 请求限制、响应上限、超时、并发和内存限流 | `d6fce82`、`2e9b397` |
| 5 | Redis DB `1`、Lua 原子限流、HMAC IP key 和真实集成测试 | `35ba5f9` |
| 6 | 单次 DNS 授权、固定 IP HTTPS CONNECT egress | `d68ef17` |
| 7 | `/sub` conversion service、策略和业务控制集成 | `1d8cff7` |
| 8 | Go 静态资源、PWA/crawler 路由和 runtime config | `755a8ea` |
| 9 | Rust MyUrls APP/SHORT adapter、problem-details 和身份转发 | `ce9c53e` |
| 10 | `SHORT_LINKS_ENABLED`、`CUSTOM_BACKEND_ENABLED` 和前端运行时配置 | `3ada1f3` |
| 11 | 五服务 Compose、双 MyUrls wiring、内部 egress 和统一 Gateway image | `cc70e1c` |
| 12 | 配置入口、image deployment CLI 和短链关闭 profile | `718ccc2` |
| 13 | 版本锁、生产 readiness、Compose 和发布 workflow 合同 | `4c1ed4f` |
| 14 | Redis backup/restore、锁定镜像恢复和重启演练 | `7185518` |
| 15 | 已删除的旧运行时清理和验证入口迁移 | `f0c3683` |
| 16 | 真实五服务 smoke、两服务 profile 和 test-only fixture | `61b6b32` |
| 17 | README、架构、部署、运维、安全和本地开发文档同步 | `0d1d373` |
| 18 | release verifier 环境隔离、runtime flag 回归和证据同步 | `fdbcfd0` |

## 当前文件边界

生产和验证路径使用以下文件：

- `Dockerfile`
- `compose.yaml`
- `compose.disabled-short-links.yaml`
- `compose.dev.yaml`
- `compose.test.yaml`
- `compose.fixture.yaml`
- `services/gateway/`
- `scripts/configure.sh`
- `scripts/subweb.sh`
- `scripts/verify-*.sh`
- `deploy/versions.lock.json`

外部 TLS 入口示例只描述项目外的反向代理；它不改变 Compose 服务集合，也不承担 Subweb 的业务路由。

## 验证合同

常规质量门禁：

```sh
npm ci
npm run verify:ci
npm run verify:compose
npm run verify:locks
npm run verify:docs
npm run verify:evidence
git diff --check
```

完整发布预检：

```sh
npm run verify:release
```

发布预检只有在终端出现以下标记时才算成功：

```text
release verification=passed
```

已完成的最终验证包括 `verify:ci`、完整 Playwright、local development、unified business smoke、Redis operations recovery、版本锁、生产 readiness、Compose、文档、证据、Go race/vet/build、Gateway 和外部依赖镜像扫描。实施阶段收尾提交 `fdbcfd0` 的 release preflight 已输出上述成功标记；后续提交继续修复并同步部署与验证合同。

## 维护规则

- 生产镜像、平台 digest 和 rollback runtime image 列表只从 `deploy/versions.lock.json` 读取。
- 不使用可变 `latest` 作为部署输入。
- 短链关闭时不创建或读取 Redis、MyUrls 或 Turnstile 私钥配置。
- 跨 HTTP 合同的 MyUrls 回滚必须同步恢复 Gateway 路由、前端适配、镜像和完整 release manifest。
- 变更部署行为后必须运行 Compose、文档、证据、集成和 release gates。
- 本记录只保留实现结果和当前合同；新增工作应写入新的计划或 issue，不在此文件追加未执行步骤。
