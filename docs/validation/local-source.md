# 本机源码运行验证

本目录的本机运行链路由四个脚本组成：`scripts/local/bootstrap.sh`、`start.sh`、`status.sh` 和 `stop.sh`。`bootstrap.sh` 只检查依赖、获取锁定源码并生成本机产物，不安装系统软件，也不会修改用户已有的 MyUrls 或 SubConverter checkout。

## 可复现命令

```sh
npm ci
./scripts/local/bootstrap.sh
./scripts/local/bootstrap.sh
./scripts/local/start.sh
./scripts/local/status.sh
./scripts/verify-local-source.sh
./scripts/local/stop.sh
./scripts/local/stop.sh
```

验证脚本会检查重复 bootstrap 产物稳定性、默认和六个自定义端口、APP/API 健康入口、前端哨兵、stop 后端口释放及运行数据保留。短链和转换哨兵在完整依赖可用时由同一网关契约测试覆盖；敏感订阅地址、Token、Redis 密码和完整运行日志不写入验证文档。

## 运行环境

GitHub Actions 在 `macos-15` 和 `ubuntu-24.04` 上执行同一生命周期；CI 只在安装编译工具阶段使用系统包管理器，业务脚本不调用 `sudo`。本机缺少 Go、CMake、Redis 或 Nginx 时，bootstrap 会一次性列出缺失项并退出，需用户按提示手动安装后重试。

## 当前工作站证据

截至 2026-08-02，本机源码生命周期的脚本、配置派生、状态聚合、优雅停止和单元测试已通过；实际 macOS 端到端启动尚未执行，因为当前工作站缺少 `go`、`cmake`、`redis-server`、`redis-cli` 和 `nginx`。这不是脚本自动安装依赖的失败，而是预期的安全前置条件阻断。GitHub Actions workflow 提供 macOS/Linux 的真实验证入口，安装依赖后可直接复现上述命令。
