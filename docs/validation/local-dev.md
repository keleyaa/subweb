# Compose-first 本地验证

```sh
npm ci
npm run verify:local
```

成功信号为 `Compose-first local development flow passed.`。验证使用临时 Vite 进程和
项目自有的 Compose 服务。验证结束后会停止容器，但不会读取或打印 Redis 密码、IP 哈希秘密、长 URL 或
短码。
