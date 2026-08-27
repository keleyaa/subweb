# Compose-first 本地验证

```sh
npm ci
npm run verify:local
```

成功信号为 `Compose-first local development flow passed.`。验证使用临时 Vite 进程和
项目自有 Compose 服务，结束后停止容器但不读取或打印 Redis 密码、IP 哈希秘密、长 URL 或
短码。
