# 一体化实施基线

## 记录信息

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-01 17:35:46 UTC+08:00 |
| Commit SHA | `6a26a2d0974a6765c8cc275a76f8d6bd29f6937b` |
| Node.js | `v24.14.1` |
| npm | `11.11.0` |
| Docker Engine | `29.6.2`（build `dfc4efb1e2`） |
| Docker Compose | `v5.3.1` |

## 命令结果

| 状态 | 命令 | 退出码 | 失败分类 |
| --- | --- | ---: | --- |
| 通过 | `git status --short --branch` | 0 | 无 |
| 通过 | `git log -3 --oneline --decorate` | 0 | 无 |
| 通过 | `git remote -v` | 0 | 无 |
| 通过 | `npm ci --cache /private/tmp/subweb-npm-cache-clean` | 0 | 无 |
| 通过 | `npm run verify` | 0 | 无 |
| 失败 | `npm run test:e2e`（受限沙箱内首次执行） | 1 | 执行环境限制：Chromium 无权注册 macOS Mach port；不是测试断言失败 |
| 通过 | `npm run test:e2e`（允许启动浏览器后复验） | 0 | 无 |
| 通过 | `npm audit --audit-level=moderate --cache /private/tmp/subweb-npm-cache-clean` | 0 | 无 |
| 通过 | `docker compose config --quiet` | 0 | 无 |
