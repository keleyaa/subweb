# 当前验证基线

本文只记录当前代码的可执行验证入口，不承担生产部署说明。部署步骤以
[`docs/deployment.md`](../deployment.md) 和 [`docs/deployment-docker.md`](../deployment-docker.md) 为准。

## 必需门禁

```sh
npm ci
npm audit --audit-level=moderate
npm run verify
npm run test:e2e
npm run verify:locks
npm run verify:compose
npm run verify:docs
npm run verify:evidence
npm run verify:operations
npm run verify:integration
git diff --check
```

准备 Docker 验证时先生成临时配置：

```sh
./scripts/configure.sh \
  --app-domain app.test \
  --api-domain api.app.test \
  --short-domain short.app.test
```

## 集成开关

默认 `npm test` 只运行不依赖 Docker 的集成契约测试。Docker quality workflow 设置
`RUN_DOCKER_INTEGRATION=1`，从而实际启动四服务 Compose 栈并验证：

- APP、API、SHORT 三个 Host 的职责隔离；
- SHORT 域名的 MyUrls 前端、同源创建和跳转；
- APP 域名的已有短码兼容入口；
- Redis 重启后的短链持久性；
- 内部端口私有、Token 覆盖和日志隐私。

## 本机源码门禁

```sh
./scripts/verify-local-source.sh
```

该脚本需要本机已安装 Go、CMake、pkg-config、Redis、Nginx 及对应开发包；GitHub Actions
会在 macOS 和 Linux runner 上先安装这些依赖。本机缺少依赖时只能报告前置条件不足，不能将
该结果解释为项目测试失败。
