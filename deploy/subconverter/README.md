# SubConverter-Extended 容器契约基线

本目录记录 Subweb 集成实际使用并已验证的容器契约与安全配置。生产 Compose 使用
`ghcr.io/aethersailor/subconverter-extended:v1.8.6` 及其 manifest digest；集成测试使用同一锁定工件。
[`../versions.lock.json`](../versions.lock.json) 保留已验证基线作为回滚参考与
`verify:locks` 校验的机器可读依据。需要覆盖版本时在 `.env` 设置
`SUBCONVERTER_IMAGE`（建议指向锁文件中的 digest）。Compose 只能校验 OCI 引用格式；替代镜像的启动、健康端点、网络与日志契约必须由维护者单独验证。

## 已验证基线（集成测试使用）

- 正式版本：`v1.8.6`
- 源码提交：`27d081bd8bb455d1581cd1f2afa8905921829b4f`
- 镜像：`ghcr.io/aethersailor/subconverter-extended:v1.8.6`
- 多架构 digest：
  `sha256:5986d0db938d85482185e51b55be3a0326e56c1ba3e3f8326895e89f31804475`
- 容器 HTTP 端口：`25500/tcp`

该 digest 已确认同时包含 `linux/amd64` 和 `linux/arm64`，对应的子 digest 记录在锁文件中。

## 已验证的启动配置

2026-08-01 使用上述 digest 实际启动容器时，采用了以下配置：

```text
MANAGED_CONFIG_PREFIX=http://127.0.0.1:25500
SUBCONVERTER_SECURITY_PROFILE=public
SUBCONVERTER_ALLOW_PUBLIC_UPLOAD=false
```

镜像工作目录为 `/base`，启动命令为 `/usr/local/bin/start-subconverter`。上游镜像在未显式
设置 `PREF_PATH` 时会从 `/base/pref.example.toml` 生成 `/base/pref.toml`。这是上游单独运行时的
通用行为。本项目的 Compose 不使用该持久配置路径，以免部署者的旧配置恢复详细请求日志。不要覆盖整个
`/base`，以免遮盖镜像自带资源。`/base/stats` 仅在启用统计功能时需要持久化。

集成 Compose 不接受部署者留在卷内的 `pref.toml` 作为运行配置。每次启动都会从镜像自带的
`pref.example.toml` 在 `/base` 中重新派生 `pref.subweb.toml`，强制 `log_level = "warn"` 与
`print_debug_info = false`，避免旧命名卷重新启用详细请求日志。SubConverter 标准输出还会在进入 Docker
日志驱动前经过项目过滤器，完整 URI、编码 `url`/`link` 参数和 Authorization 值不会写入容器日志。
实际容器检查确认，该上游镜像仍需以 root 身份启动，但根文件系统可以保持只读。命名卷
`subconverter-runtime` 挂到 `/base`
时，Docker 首次挂载会把镜像中完整的 `/base` 复制进空卷，启动脚本可在其中生成
`pref.toml`，同时不会开放宿主机端口或放宽 `cap_drop: ALL`、
`no-new-privileges:true`。

`subconverter-runtime` 只是可重建的镜像运行时副本，不是 Redis 那类业务持久数据，
部署不得依赖其中保存业务状态。升级锁定镜像后，Docker 不会把新镜像的
`/base` 复制进已有卷，因此升级后需先删除旧卷让新镜像重新填充 `/base`。先用 `docker compose config --volumes` 确认当前 Compose project 实际生成的运行时卷名；默认 project 才可能是 `subweb_subconverter-runtime`。确认新版本验证通过后再删除旧卷，并保留旧卷直到确认无需回滚。

集成 Compose 还会将本目录的 `gai.conf` 只读挂载到 `/etc/gai.conf`。当 Docker 主机能解析 IPv6 地址却
没有可用 IPv6 默认路由时，这会让 SubConverter 使用的 glibc/libcurl 优先选择 IPv4，减少远程规则集下载
因 IPv6 黑洞失败的概率。该策略不会开放端口、设置代理或修改其他容器；更新后只需重建
`subconverter` 服务即可生效。

## 已验证的 HTTP 行为

以下行为均在锁定基线的 `linux/arm64` 容器上实际确认：

- `GET /healthz` 返回 HTTP 200，可作为容器健康探测；
- `GET /version` 返回 HTTP 200 和非空版本响应；
- 使用 `target=clash`，并把上游 `v1.8.6` 的公开
  `tests/fixtures/sample-subscription.txt` 作为 `url` 时，`GET /sub` 返回 HTTP 200；
- 转换结果是非空 Clash YAML，包含基础端口配置、`proxy-providers` 和代理组。

最小健康探测：

```sh
curl --fail --silent --show-error http://127.0.0.1:25500/healthz >/dev/null
```

最小转换请求的参数形态：

```text
/sub?target=clash&url=<percent-encoded-subscription-url>
```

公网部署时仍应保持 `SUBCONVERTER_SECURITY_PROFILE=public` 和
`SUBCONVERTER_ALLOW_PUBLIC_UPLOAD=false`，并把 `MANAGED_CONFIG_PREFIX` 改为实际 API
公开地址。以上变量只在容器运行时注入，不得写入前端 bundle。
