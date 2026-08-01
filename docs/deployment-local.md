# 本机源码运行

本方式会在本机按锁定 commit 获取并构建 MyUrls 与 SubConverter，启动 Redis、两个后端、Vite 和两个 Nginx gateway 入口。适合开发与验收，不是默认公网生产方案。

## 系统与依赖

支持 macOS、Linux 和 WSL2；不支持原生 Windows。需要 Node.js 24+、npm 11+、Go、CMake、pkg-config、Redis、Nginx、Git、curl、lsof、OpenSSL，以及 SubConverter 所需的 curl、PCRE2、RapidJSON 和 yaml-cpp 开发包。QuickJS 与 libcron 会按 SubConverter 自带的依赖锁在用户缓存中构建，不写入本仓库。

macOS Homebrew 用户可手动执行：

```sh
brew install node go cmake pkg-config redis nginx git curl lsof openssl rapidjson yaml-cpp pcre2
```

Debian/Ubuntu 用户可手动执行：

```sh
sudo apt update
sudo apt install nodejs npm golang cmake pkg-config redis-server nginx git curl lsof openssl \
  build-essential libcurl4-openssl-dev libpcre2-dev rapidjson-dev libyaml-cpp-dev
```

发行版仓库里的 Node/npm 版本若低于要求，应改用 Node 官方支持的安装方式。脚本只检查并报告缺失项，不自动修改系统。

## 最短流程

```sh
./scripts/local/bootstrap.sh
./scripts/local/start.sh
./scripts/local/status.sh
./scripts/local/stop.sh
```

`bootstrap.sh` 校验工具、创建私有秘密、按 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 获取业务源码，并继续读取锁定 SubConverter commit 自带的 `scripts/ci/dependencies.lock.json` 构建 QuickJS/libcron。SubConverter 的 Mihomo bridge 和 C++ 程序在 `.runtime/local/build/subconverter-source/` 隔离副本中构建，不修改用户指定或缓存的 checkout。默认源码缓存位于 `$XDG_CACHE_HOME/subweb/sources` 或 `$HOME/.cache/subweb/sources`；构建、日志、Redis 数据和 PID 位于未提交的 `.runtime/local/`。

已有正确 checkout 时可避免重复下载：

```sh
MYURLS_SOURCE_DIR=/absolute/path/to/MyUrls \
SUBCONVERTER_SOURCE_DIR=/absolute/path/to/SubConverter-Extended \
./scripts/local/bootstrap.sh
```

两个目录必须是绝对路径且 HEAD 与锁文件 commit 一致。

## 端口与访问

默认端口是 Vite `5173`、SubConverter `25500`、MyUrls `18082`、Redis `16379`、应用 gateway `18080`、API gateway `18081`。启动前会检查范围、重复和占用。

可在未提交的 `.env` 设置 `LOCAL_*_PORT`，或只对一次启动传值：

```sh
LOCAL_VITE_PORT=15173 LOCAL_SUBCONVERTER_PORT=15500 \
LOCAL_MYURLS_PORT=18092 LOCAL_REDIS_PORT=16389 \
LOCAL_APP_PORT=19080 LOCAL_API_PORT=19081 \
./scripts/local/start.sh
```

应用入口是 `http://127.0.0.1:18080/`，API 健康入口是 `http://127.0.0.1:18081/healthz`。本机模式使用 loopback，不直接对公网开放。

## 状态、日志与停止

```sh
./scripts/local/status.sh
tail -n 200 .runtime/local/logs/nginx.log
tail -n 200 .runtime/local/logs/myurls.log
tail -n 200 .runtime/local/logs/subconverter.log
./scripts/local/stop.sh
```

状态脚本同时检查 PID 所有权、Redis PING 和 HTTP 健康，不会只因 PID 存在就报告健康。停止脚本仅结束记录且命令身份匹配的项目进程，按反向依赖顺序停止，不删除 Redis 数据、源码缓存、日志或构建产物。

## 重建、升级与回滚

依赖锁或源码变更后先停止，再重新 bootstrap/start：

```sh
./scripts/local/stop.sh
./scripts/local/bootstrap.sh
./scripts/local/start.sh
./scripts/local/status.sh
```

升级前记录当前 Git commit 和 `deploy/versions.lock.json`。回滚时切回原 commit，重新执行 bootstrap；Redis 主版本变更前必须备份，不要让新主版写入数据后直接用旧主版读取。

## 验证与排错

完整生命周期脚本会验证转换、短链、重启持久性、默认/自定义端口和端口释放：

```sh
./scripts/verify-local-source.sh
```

- 缺依赖：按脚本一次性列出的名单安装，不要只补第一个。
- 端口冲突：用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 找到所有者，或设置六个不重复的自定义端口。
- stale PID：先运行 `status.sh` 确认，再用 `stop.sh` 清理项目自己的记录；不要手动终止不属于本项目的进程。
- 健康失败：查看对应日志和 `.runtime/local/config/local.env` 中的非秘密端口；秘密文件不要输出或提交。
