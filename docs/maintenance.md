# 维护与发布

## 仓库边界

- `origin` 只能指向当前维护仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb)。
- `upstream` 仅用于读取 Fork 起点 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，不得推送。
- MyUrls 必须在独立 `/Users/li/Desktop/GitHub/MyUrls` 仓库维护，不把其源码、`.git` 或构建产物复制进 Subweb。
- SubConverter-Extended 使用官方上游锁定产物，不在本仓库做隐式补丁。

来源变化必须同步更新[第三方来源](third-party-sources.md)、锁文件、README 和相关测试。

## 必须提交与禁止提交

文档和测试是项目可运行、可维护的一部分，属于必须提交的文件；`docs/` 与 `tests/` 不能因为“不参与运行时”而整体排除。应提交源码、配置模板、锁文件、部署脚本、工作流、测试和当前文档。

以下是本地或生成数据，不提交：

- `.env`
- `.runtime/`
- `node_modules/`
- `dist/`
- `test-results/`
- `playwright-report/`
- 证书、私钥、Redis 数据/备份、平台凭据
- 下载的 MyUrls/SubConverter 源码和临时容器输出

提交前用 `git check-ignore -v` 检查边界；不要为了工作树看起来干净而删除不属于当前任务的用户文件。

## 质量门禁

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
npm run verify:integration:behind-proxy
npm run verify:integration:direct-tls
git diff --check
```

本机源码验证还需 `./scripts/verify-local-source.sh`，前提是当前主机已手动安装全部原生依赖。Railway/Render 目前只能标记 `designed`；在真实新建、功能、持久性、日志、升级与回滚证据完成前不得改成 `verified`。

`npm run verify:release` 聚合安装、审计、质量、浏览器、锁、Compose、文档、容器、两个 Docker profile 和证据门禁。它会重装依赖并运行较长时间，仅在准备发布的干净工作树执行。

## 锁定更新

外部服务升级先核验正式 tag、commit、manifest digest、amd64/arm64 digest 和许可证，再更新 [`deploy/versions.lock.json`](../deploy/versions.lock.json)。运行锁校验、对应服务测试和两个 Docker profile 的全链路验证。禁止在生产示例使用 `latest`，也不能把本地未发布 commit 写成远端可拉取镜像。

## 提交与推送

```sh
git status --short --branch
git diff --check
git diff --name-status origin/main...HEAD
git remote -v
git branch -vv
```

逐项确认追踪集合只包含 Subweb 必需文件，提交信息说明真实边界。推送必须获得用户明确授权，并在推送前执行：

```sh
git fetch --prune origin
git log --oneline origin/main..HEAD
git push origin "HEAD:$(git branch --show-current)"
```

推送后比较本地 HEAD 与远端分支 SHA，并检查 GitHub Actions 与发布镜像 digest。工作树干净不等于远端一致，远端 CI 成功也不能替代本地秘密/数据边界检查。禁止未经确认强制推送。
