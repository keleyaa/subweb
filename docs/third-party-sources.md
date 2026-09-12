# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| MyUrls Rust | [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls)，原始项目为 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls) | stable tag `v2.0.8`；commit `42234e8d1085b6c1449d16f04cd61e34104037f5`；manifest `sha256:441aed70342b9071f4f64bdbb6fe7d659774c23f1f8bfd3db76c33936eb01d36` | 不在本仓库修改 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.9.4` 与锁定 digest | 不在本仓库修改 |
| Redis | [redis/redis](https://github.com/redis/redis) | `8.10.1` 与锁定 digest | 数据层 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 均以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。MyUrls Rust 当前镜像来自
上游 stable tag `v2.0.8`；锁文件同时记录源码 commit 和不可变的 manifest digest。

生产 Compose 不使用外部服务的 `latest`。历史 Node v1.13.0 仅用于说明跨合同回滚风险；仓库不提供已维护的镜像 digest 或 rollback manifest，不能将其作为新部署或直接回滚来源。MyUrls Rust v2.0.8 的稳定 tag 和 manifest digest 已与源码 commit 对齐；该发布包含 Redis 断线恢复、请求总超时、RFC 9457 `request_timeout` 错误体和静态资源 immutable 缓存策略。发布镜像不包含 Turnstile test adapter，Subweb 的集成 smoke 使用生产配置。
