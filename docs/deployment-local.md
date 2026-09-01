# 本地开发

本地开发采用 Vite + Docker Compose。Vite 运行 Subweb 页面；Compose 运行与默认部署相同的 `subweb`、一个 MyUrls Rust v2.0.6 实例和 Redis。`subweb` 在容器内同时运行 Nginx 和 SubConverter，Compose override 只将 `subweb` 与 MyUrls 的调试端口绑定到 loopback。此模式直接使用默认部署边界，不提供 hardened Compose 的 Request Policy、DNS/SSRF 校验、匿名限流或 HTTPS CONNECT egress 约束；只使用可信测试订阅。

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

打开 `http://127.0.0.1:5173/`。Vite 将 `/short-api/links` 同源代理到 `http://127.0.0.1:18082/api/links`；转换请求通过 `http://127.0.0.1:18081/sub` 进入合并容器。不要在其他项目目录执行这些脚本。

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
LOCAL_SUBWEB_PORT=18091 \
npm run dev
```

三个端口必须互不相同。生成的私有环境位于 `.runtime/local/compose.env`，权限为 `0600`，不应提交或直接输出。

## 验证边界

`npm run verify:local` 验证页面、合并 Subweb 容器健康、MyUrls JSON 创建和 `302` 跳转。它不验证 hardened Compose 的 egress proxy、DNS rebinding 防护、Request Policy 限流、Turnstile 或 Redis 恢复。

完整的 hardened 边界由以下命令覆盖：

```sh
npm run verify:integration
npm run verify:operations
npm run verify:ci
npm run verify:release
```

其中 `npm run verify:ci` 是 GitHub quality job 同样使用的 Docker 门禁；`npm run verify:release` 进一步聚合干净安装、production-readiness、质量、浏览器、镜像安全、Redis 运维和 Docker 集成验证。没有 `.env` 的干净工作树会使用仅限验证进程的临时配置，真实部署仍必须执行 `scripts/configure.sh` 生成 `.env`。
