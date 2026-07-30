# 维护指南

## 远端约定

- `origin`：当前维护仓库 [`keleyaa/subweb`](https://github.com/keleyaa/subweb)，日常推送只使用该远端。
- `upstream`：Fork 上游 [`stilleshan/subweb`](https://github.com/stilleshan/subweb)，仅用于查阅或手动同步上游改动；不要向它推送。
- `main`：可发布分支，应跟踪 `origin/main`。

README 的“Fork 与来源说明”是公开来源声明的唯一维护位置。更新上游关系或新增外部代码、素材、设计仓库参考时，必须先更新该说明及相应许可证/NOTICE，再提交。

提交前先确认范围，只加入项目源代码、测试、必要配置和公开文档：

```bash
git status --short
git add <明确的文件路径>
git diff --cached --name-only
```

另外运行 `git diff --check`，不要使用会把全部未跟踪文件一并纳入的宽泛命令。`node_modules/`、`dist/`、测试输出、原型目录、AI 过程目录和本地工作树都已被忽略，不应提交或推送。

## 本地质量流程

运行 `npm test`、`npm run lint`、`npm run build` 和 `git diff --check`。构建完成后可删除 `dist/`；它由 Vite 重新生成。`node_modules/` 是本机依赖缓存，不进入 Git。停止本地预览或测试服务后，再检查端口和工作树状态。

## 推送与一致性检查

```bash
git fetch --prune origin
git status --short --branch
git log origin/main..HEAD --oneline
git push origin main
git status --short --branch
git log HEAD..origin/main --oneline
git log origin/main..HEAD --oneline
```

最后两条日志都没有输出时，当前本地 `main` 与 `origin/main` 指向同一提交。若远端在推送前发生变化，先获取并审查差异；不要未经确认使用强制推送。
