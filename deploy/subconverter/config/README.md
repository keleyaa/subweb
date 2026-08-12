# 空覆盖目录（历史验证记录）

当前 Compose 跟随 `ghcr.io/aethersailor/subconverter-extended:latest` 浮动标签，运行契约与
升级卷处理见[同目录 README](../README.md)；[`versions.lock.json`](../../versions.lock.json)
保留集成测试与回滚的已验证基线。本文件保留 2026-08-01 针对锁定基线的验证记录：

镜像启动脚本会在首次启动时从自带的 `/base/pref.example.toml` 生成 `/base/pref.toml`，
本集成不提交或挂载未经验证的 `pref.toml`，也不覆盖容器的 `/base`。

2026-08-01 针对锁文件提交
`4db6a63f078f27da2cfb6cc90d47eb2dbd80c1cd` 从官方仓库取得
`base/pref.example.toml`；它与当时锁定镜像内文件的 SHA-256 均为
`5588bccb8ca2dcd25c50746be53c1a9d1e9014182571763f6492607f354ea60c`。将这份完整、受控
配置只读挂到 `/base/pref.toml` 后，以下容器矩阵均完成配置加载、打印 HTTP 启动日志后
以 139 退出，无法稳定通过 `/healthz`：

- `user: 65532:65532`、只读根文件系统；
- root、只读根文件系统；
- root、只读根文件系统并给 `/tmp` 提供可写 `tmpfs`；
- `user: 65532:65532`、可写根文件系统。

后续审查补充验证了 `--read-only` 与空命名卷挂载到 `/base` 的组合：Docker 的 volume
copy-up 会先把镜像中完整 `/base` 复制到空卷，随后启动脚本在卷中生成 `pref.toml`；
容器可保持健康并完成最小转换。因此先前“必须使用可写根文件系统”的结论已撤销。该上游
版本只保留 root 例外，根文件系统仍为只读；`cap_drop: ALL`、
`no-new-privileges:true`、无宿主机端口仍为强制契约（与镜像是否固定无关）。

命名卷（现为固定名 `subconverter-runtime`）只是可重建的镜像运行时副本，不承载部署应依赖
的业务数据。镜像升级时 Docker 不会把新镜像的 `/base` 复制进已有卷，也不会自动创建新版本卷；
确认新版本启动、健康和转换验证通过后，删除旧卷并重建，让新镜像重新填充 `/base`。如未来
确需自定义配置，仍必须先针对目标版本完成启动、健康和转换回归。
