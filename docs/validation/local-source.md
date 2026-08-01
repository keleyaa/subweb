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

GitHub Actions 在 `macos-15` 和 `ubuntu-24.04` 上执行同一生命周期；CI 只在安装编译工具与系统开发头文件阶段使用系统包管理器，业务脚本不调用 `sudo`。QuickJS 和 libcron 由 bootstrap 按锁定 SubConverter 源码中的依赖 revision 构建；Mihomo Go bridge 与 C++ 主程序在运行时源码副本中完成，不污染外部 checkout。本机缺少 Go、CMake、pkg-config、Redis、Nginx 或系统开发包时，bootstrap 会一次性列出命令依赖；CMake 对缺失开发包会给出精确包名，安装后重试即可。

## 当前工作站证据

截至 2026-08-02，本机源码生命周期的脚本、配置派生、状态聚合、优雅停止和单元测试已通过；实际维护工作站仍缺少 `go`、`cmake`、`redis-server`、`redis-cli` 和 `nginx`，因此不把该机器描述为端到端通过。GitHub Actions 的 macOS/Linux 任务负责真实构建与生命周期复现；此前失败日志已确认分别缺少 `libcurl` 和 `yaml-cpp` 开发依赖，本次修复把完整系统开发包和锁定 QuickJS/libcron 构建纳入同一工作流。
