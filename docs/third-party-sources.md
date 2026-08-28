# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| MyUrls v2 | [keleyaa/MyUrls](https://github.com/keleyaa/MyUrls)，原始 [CareyWang/MyUrls](https://github.com/CareyWang/MyUrls) | stable tag `v2.0.2`；commit `c86c5d6d7d85eb1c02bfdef73dff489e8a547395`；manifest `sha256:b76423a5b5f346c27c40cbecb3954409f645f85df462d49577bb14d738d6127b` | 不在本仓库修改 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.8.6` 与锁定 digest | 不在本仓库修改 |
| Redis | [redis/redis](https://github.com/redis/redis) | `8.10.1` 与锁定 digest | 数据层 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。MyUrls v2 当前镜像来自
成功的手动发布工作流，并由上游 stable tag `v2.0.2` 标识；锁文件同时记录源码 commit
和不可变 manifest digest。

生产 Compose 不使用外部服务的 `latest`。旧 v1.13.0 digest 只保留在回滚说明中，不作为新部署
默认值。MyUrls v2 的稳定 tag 和 manifest digest 已与源码 commit 对齐。
