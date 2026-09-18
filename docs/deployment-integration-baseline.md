# 部署契约整合基线

本文冻结 `docs/deployment-integration-prd.md` Phase 0 开始时的生产部署合同。后续阶段只能消除管理面重复，不能改变这里记录的运行时信任边界、故障隔离或 profile 选择规则。可执行验证器优先于本文；本文记录的是改造前的可比较事实与允许收敛的差异。

## 运行时合同快照

### 四服务短链启用合同

`compose.yaml` 是短链启用的生产入口，准确包含以下四个服务：

- `gateway`：唯一发布到 `127.0.0.1:${SUBWEB_PORT}:8080` 的服务；负责 APP/API/SHORT Host 路由、转换策略、限流、MyUrls 适配与内部 CONNECT egress。
- `subconverter`：只连接 `subconverter-egress`，通过 Gateway 的内部 egress 获取外部订阅。
- `myurls`：只连接 `myurls-edge` 与 `myurls-data`，处理 APP 创建和 APP/SHORT 短码解析的唯一上游。
- `redis`：只连接 `myurls-data` 与 `redis-policy`；MyUrls 使用 DB `0`，Gateway 限流使用 DB `1`。

启用合同要求 APP、API、SHORT 三个不同域名和短链所需的 Redis、IP HMAC、Turnstile 配置。Gateway 必须连接 `redis-policy`，但不得加入 `myurls-data`；SubConverter 不得加入 MyUrls 或 Redis 网络。四个服务、Gateway loopback 发布端口、各内部网络和容器权限均由 `scripts/validate-compose.sh` 与 production-readiness 验证。

### 两服务短链关闭合同

`compose.disabled-short-links.yaml` 是短链关闭的独立生产入口，准确包含 `gateway` 与 `subconverter` 两个服务。Gateway 的 `SHORT_LINKS_ENABLED=false`，不配置 MyUrls 上游或 Redis 限流 URL，并使用进程内限流；SubConverter 仍只通过内部 egress 访问外部订阅。

该合同不要求 `SHORT_DOMAIN`、Redis、MyUrls、Turnstile 或相关秘密，且不声明多 Gateway 实例的共享限流。它不是从启用合同删除服务后可随意得到的 profile：变量插值发生在 Compose profile 选择之前，因此 Compose profile 不能作为隐藏必填变量的条件机制。

## 版本与部署入口快照

`deploy/versions.lock.json` 是 Redis、SubConverter 和 MyUrls 的可追溯来源，记录每个外部运行时的 registry repository、source repository/commit、tag、manifest digest、平台 digest 与必要端口。Gateway 镜像是单独的 release 输入，不属于该外部运行时集合。

当前基线中，`compose.yaml` 和 `compose.disabled-short-links.yaml` 仍各自内嵌外部镜像的锁定默认值；`scripts/configure.sh` 提供同名 `*_IMAGE` 覆盖输入；`scripts/verify-version-locks.mjs`、`scripts/validate-compose.sh`、`scripts/docker-deploy.sh` 和 release workflow 分别读取版本锁。验证器已经拒绝和锁不一致的覆盖，因此这些重复读取和回填路径是后续可以收敛的管理面，不是可变部署选择。

部署命令职责保持如下：

- `scripts/configure.sh` 校验输入并原子写入权限为 `0600` 的 `.env`。
- `scripts/subweb.sh` 只读取 `SHORT_LINKS_ENABLED` 并选择显式 Compose 合同，再分派 `up`、`upgrade`、恢复等命令。
- `scripts/docker-deploy.sh` 验证不可变 Gateway 引用和外部运行时版本锁，随后启动由所选合同定义的镜像集合。
- release workflow 从版本锁生成外部 runtime images 与 rollback manifest。

## 允许收敛与禁止改变

后续阶段可以把 Gateway/SubConverter 的重复 Compose 服务配置抽取为公共合同、由版本锁生成受管运行时镜像环境与 rollback 数据，并让部署脚本和 workflow 复用同一解析入口。最终渲染的 Compose 输出必须与本基线的两种服务、网络、端口、健康检查、只读文件系统、capability、依赖顺序和变量要求等价。

以下不在本次整合范围：

- 将 MyUrls 或 SubConverter 编译或运行在 Gateway 内。
- 拆分 Redis，或合并 MyUrls 的 DB `0` 与 Gateway 限流 DB `1`。
- 合并两个内部 CONNECT listener。
- 以 Compose profile 代替显式的短链开启/关闭 Compose 合同。
- 用只替换 MyUrls 镜像的方式执行跨 HTTP 合同回滚。

## 比较与验证

每个后续阶段至少运行与其改动相匹配的验证，并在合并前运行：

```sh
npm run verify:locks
npm run verify:compose
npm run verify:production-readiness
npm run verify:docs
git diff --check
```

短链启用和关闭的 rendered Compose 合同分别由 `tests/deploy/composeStack.spec.js`、`tests/deploy/featureFlagCompose.spec.js` 以及 `scripts/validate-compose.sh` 覆盖；Docker 生命周期、恢复与集成验证继续按既有单独门禁执行。
