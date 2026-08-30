# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| MyUrls Rust | [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls)，原始项目为 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls) | stable tag `v2.0.4`；commit `291545f1875da6d7449a2061e8eb813b8d2fd23a`；manifest `sha256:a6b8d44ef40d37098a7ca6001f782fedc9d1d882a3e4fa8d28420dd5f6b7e64d` | 不在本仓库修改 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.8.6` 与锁定 digest | 不在本仓库修改 |
| Redis | [redis/redis](https://github.com/redis/redis) | `8.10.1` 与锁定 digest | 数据层 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 均以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。MyUrls Rust 当前镜像来自
上游 stable tag `v2.0.4`；锁文件同时记录源码 commit 和不可变的 manifest digest。

生产 Compose 不使用外部服务的 `latest`。旧的 v1.13.0 digest 只保留在回滚说明中，不作为新部署
默认值。MyUrls Rust 的稳定 tag 和 manifest digest 已与源码 commit 对齐。
