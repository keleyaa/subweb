# SubConverter-Extended 容器契约基线

本目录记录 Subweb 集成实际使用并已验证的最小容器契约。版本和 digest 的唯一机器可读
来源是 [`../versions.lock.json`](../versions.lock.json)，部署文件不得改用浮动标签。

## 固定产物

- 正式版本：`v1.2.0`
- 源码提交：`4db6a63f078f27da2cfb6cc90d47eb2dbd80c1cd`
- 镜像：`ghcr.io/aethersailor/subconverter-extended:v1.2.0`
- 多架构 digest：
  `sha256:75c110016526ab2cf56d3d832aac912001f1497a594a4eefb9d79cd33125167f`
- 容器 HTTP 端口：`25500/tcp`

该 digest 已确认同时包含 `linux/amd64` 和 `linux/arm64`，对应子 digest 记录在锁文件中。

## 已验证的启动配置

2026-08-01 使用上述 digest 实际启动容器时采用了：

```text
MANAGED_CONFIG_PREFIX=http://127.0.0.1:25500
SUBCONVERTER_SECURITY_PROFILE=public
SUBCONVERTER_ALLOW_PUBLIC_UPLOAD=false
```

镜像工作目录为 `/base`，启动命令为 `/usr/local/bin/start-subconverter`。上游镜像在未显式
设置 `PREF_PATH` 时会从 `/base/pref.example.toml` 生成 `/base/pref.toml`。这是上游单独运行时的
通用行为；本项目的 Compose 不使用该持久配置路径，以免部署者的旧配置恢复详细请求日志。不要覆盖整个
`/base`，以免遮盖镜像自带资源。`/base/stats` 仅在启用统计功能时需要持久化。

集成 Compose 不接受部署者留在卷内的 `pref.toml` 作为运行配置。每次启动都会从固定镜像的
`pref.example.toml` 在 `/base` 中重新派生 `pref.subweb.toml`，强制 `log_level = "warn"` 与
`print_debug_info = false`，避免旧命名卷重新启用详细请求日志。SubConverter 标准输出还会在进入 Docker
日志驱动前经过项目过滤器，完整 URI、编码 `url`/`link` 参数和 Authorization 值不会写入容器日志。
实际容器检查确认，固定镜像仍需以 root 启动，但根文件系统可以保持只读。版本绑定命名卷
`subconverter-runtime-v1-2-0` 挂到 `/base`
时，Docker 首次挂载会把镜像中完整的 `/base` 复制进空卷，启动脚本可在其中生成
`pref.toml`，同时不会开放宿主机端口或放宽 `cap_drop: ALL`、
`no-new-privileges:true`。

`subconverter-runtime-v1-2-0` 只是可重建的镜像运行时副本，不是 Redis 那类业务持久数据，
部署不得依赖其中保存业务状态。卷名由锁文件版本按“转小写、连续非字母数字替换为单个连字符”
规则生成；升级或回滚会自然创建对应版本的新卷，避免旧 `/base` 遮盖新镜像。Docker 不会
自动删除旧版本卷，确认新版本验证通过后才能手动删除旧卷。

集成 Compose 还会将本目录的 `gai.conf` 只读挂载到 `/etc/gai.conf`。当 Docker 主机能解析 IPv6 地址却
没有可用 IPv6 默认路由时，这会让 SubConverter 使用的 glibc/libcurl 优先选择 IPv4，减少远程规则集下载
因 IPv6 黑洞失败的概率。该策略不开放端口、不设置代理，也不修改其他容器；更新后只需重建
`subconverter` 服务即可生效。

## 已验证的 HTTP 行为

以下行为均在固定 digest 的 `linux/arm64` 容器上实际确认：

- `GET /healthz` 返回 HTTP 200，可作为容器健康探测；
- `GET /version` 返回 HTTP 200 和非空版本响应；
- 使用 `target=clash`，并把上游 `v1.2.0` 的公开
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
