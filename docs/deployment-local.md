# 本地开发

本地开发采用 Vite + Docker Compose：Vite 运行 Subweb，Compose 只运行两个 MyUrls v2 实例、
SubConverter 和私有 Redis。不再下载或编译 MyUrls、SubConverter 的源码。

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

打开 `http://127.0.0.1:5173/`。Vite 将 `/short-api/v1/links` 同源代理到
`http://127.0.0.1:18082/api/v1/links`，转换请求使用
`http://127.0.0.1:25500`。不要在其他项目目录执行这些脚本。

## 生命周期

```sh
npm run dev:status
npm run dev:stop
npm run verify:local
```

`npm run dev` 退出时停止依赖容器，但保留本地 Redis volume，便于下次联调。显式
`npm run dev:stop` 同样不删除数据卷。若要销毁本地数据，先确认项目名和 volume，再使用
Docker Compose 的带 volumes 清理操作。

## 自定义端口

```sh
LOCAL_VITE_PORT=5174 \
LOCAL_MYURLS_PORT=18092 \
LOCAL_SHORT_MYURLS_PORT=18093 \
LOCAL_SUBCONVERTER_PORT=25501 \
npm run dev
```

端口必须互不相同。生成的私有环境位于 `.runtime/local/compose.env`，权限为 `0600`，
不应提交或直接输出。

## 验证边界

`npm run verify:local` 验证页面、v2 JSON 创建和 302 跳转。完整的 Nginx、挑战和 Redis
恢复门禁由 `npm run verify:integration` 与 `npm run verify:operations` 覆盖。
