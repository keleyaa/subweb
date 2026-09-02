# SubConverter 运行时合同

Subweb 将锁定的 SubConverter-Extended 镜像作为独立服务运行。生产 Compose 不直接发布 SubConverter 端口，服务只加入内部 `subconverter-egress` 网络，并通过环境代理将外部订阅请求交给 Gateway 的 HTTPS CONNECT listener。

## 镜像与配置

镜像、tag、manifest digest 和平台 digest 由 [`../../deploy/versions.lock.json`](../../deploy/versions.lock.json) 锁定。不要使用 `latest` 或未验证的镜像覆盖。Gateway 将请求限制为允许的 URL、已验证 public-unicast 地址和 `:443` CONNECT；SubConverter 不应拥有绕过该边界的公网网络。

SubConverter 的 `MANAGED_CONFIG_PREFIX` 指向 Gateway 的 API URL。启动 entrypoint 会在可写的 `/base` named volume 中保留上游相对路径，并将默认 external config 固定到镜像内的 `config/example_external_config.ini`，避免启动时依赖不可控的远程默认配置。`snippets/` 等相对资源必须与偏好文件位于同一 `/base` 树中。

## 权限

Compose 以 root 启动只执行一次 volume bootstrap，临时只授予 `CHOWN`、`SETUID`、`SETGID`，并使用只读 passwd/group 文件映射。entrypoint 完成目录初始化后切换到 UID/GID `101:101`，再启动上游进程。最终 PID 1 的 `CapEff` 必须为全零；不要授予 `NET_ADMIN`、`SYS_ADMIN` 或完整 capabilities。

运行时 root filesystem 只读，`/run/subconverter` 使用受限 tmpfs，日志经 supervisor 和 awk filter 处理。日志不得包含原始订阅 URL、Query、Token、IP 或完整短码。

## 健康检查

```sh
docker compose ps subconverter
```

健康检查请求容器内的 `/healthz`。若失败，先检查 `/base` volume 是否为新 volume、entrypoint 是否可执行、UID 是否为 `101`、`CapEff` 是否为零，以及 Gateway egress proxy 是否可达。不要通过给 SubConverter 发布端口或取消内部网络来绕过故障。
