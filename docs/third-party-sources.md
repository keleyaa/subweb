# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| MyUrls Rust | [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls)，原始项目为 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls) | stable tag `v2.0.5`；commit `0cf3f7dcb79041f87ff6c1827a0e09c1b4ca7417`；manifest `sha256:8020ce81d843a2945b84470eb08c717aa880c61c056d1df15dfd79f8362d50b9` | 不在本仓库修改 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.8.6` 与锁定 digest | 不在本仓库修改 |
| Redis | [redis/redis](https://github.com/redis/redis) | `8.10.1` 与锁定 digest | 数据层 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 均以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。MyUrls Rust 当前镜像来自
上游 stable tag `v2.0.5`；锁文件同时记录源码 commit 和不可变的 manifest digest。

生产 Compose 不使用外部服务的 `latest`。旧的 v1.13.0 digest 只保留在回滚说明中，不作为新部署
默认值。MyUrls Rust v2.0.5 的稳定 tag 和 manifest digest 已与源码 commit 对齐；该发布包含 Redis 断线恢复、请求总超时和静态资源 immutable 缓存策略，并保留仅限隔离集成环境使用的 Turnstile test adapter，生产模式不会启用它。
