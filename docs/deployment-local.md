# 本地开发

本地开发采用 Vite + Docker Compose。Vite 运行 Subweb 页面；Compose 运行 Redis、两个 MyUrls Rust v2.0.6 实例和 SubConverter。Compose override 为需要被宿主机访问的本地端口服务增加专用的非 internal `local-published` 网络；这只服务于本地调试，不改变生产 Compose 的网络隔离。此模式为了调试直接暴露本机 SubConverter 端口，因此**不复现生产的 Gateway、Request Policy Service 与 HTTPS CONNECT egress 边界**。只使用可信测试订阅；完整匿名请求安全验证请运行 Docker 集成门禁。

## 前提

- Node.js 24 和 npm 11
- Docker Desktop 和 Docker Compose v2
- OpenSSL、curl

```sh
git clone https://github.com/keleyaa/subweb.git
cd subweb
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。Vite 将 `/short-api/links` 同源代理到 `http://127.0.0.1:18082/api/links`；转换请求使用 `http://127.0.0.1:25500`。不要在其他项目目录执行这些脚本。

## 生命周期

```sh
npm run dev:status
npm run dev:stop
npm run verify:local
```

`npm run dev` 退出时停止依赖容器，但保留本地 Redis volume，便于下次联调。显式 `npm run dev:stop` 同样不删除数据卷。若要销毁本地数据，先确认项目名和 volume，再使用 Docker Compose 的带 volumes 清理操作。

## 自定义端口

```sh
LOCAL_VITE_PORT=5174 \
LOCAL_MYURLS_PORT=18092 \
LOCAL_SHORT_MYURLS_PORT=18093 \
LOCAL_SUBCONVERTER_PORT=25501 \
npm run dev
```

端口必须互不相同。生成的私有环境位于 `.runtime/local/compose.env`，权限为 `0600`，不应提交或直接输出。

## 验证边界

`npm run verify:local` 验证页面、MyUrls JSON 创建和 `302` 跳转。它不验证生产 egress proxy、DNS rebinding 防护、Gateway Host 隔离、Turnstile 或 Redis 恢复。

完整的生产边界由以下命令覆盖：

```sh
npm run verify:integration
npm run verify:operations
npm run verify:ci
npm run verify:release
```

其中 `npm run verify:ci` 是 GitHub quality job 同样使用的 Docker 门禁；`npm run verify:release` 进一步聚合干净安装、production-readiness、质量、浏览器、镜像安全、Redis 运维和 Docker 集成验证。没有 `.env` 的干净工作树会使用仅限验证进程的临时配置，真实部署仍必须执行 `scripts/configure.sh` 生成 `.env`。
