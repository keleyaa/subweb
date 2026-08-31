# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| MyUrls Rust | [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls)，原始项目为 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls) | stable tag `v2.0.6`；commit `9a04a210c19f97178255ed1fe096c4de56922224`；manifest `sha256:3ccd97bd9b3c5ad6dfea4c414f055698b0cce39a54a47fdb94c5cab7f6526ed3` | 不在本仓库修改 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.8.6` 与锁定 digest | 不在本仓库修改 |
| Redis | [redis/redis](https://github.com/redis/redis) | `8.10.1` 与锁定 digest | 数据层 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 均以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。MyUrls Rust 当前镜像来自
上游 stable tag `v2.0.6`；锁文件同时记录源码 commit 和不可变的 manifest digest。

生产 Compose 不使用外部服务的 `latest`。旧的 v1.13.0 digest 只保留在回滚说明中，不作为新部署
默认值。MyUrls Rust v2.0.6 的稳定 tag 和 manifest digest 已与源码 commit 对齐；该发布包含 Redis 断线恢复、请求总超时、RFC 9457 `request_timeout` 错误体和静态资源 immutable 缓存策略。发布镜像不包含 Turnstile test adapter，Subweb 的集成 smoke 使用生产配置。
