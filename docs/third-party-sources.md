# 第三方来源

| 组件 | 来源 | 当前锁定证据 | 维护边界 |
| --- | --- | --- | --- |
| Subweb | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本仓库保留来源说明 | 独立维护 |
| SubConverter | [Aethersailor/SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | `v1.9.4` 与锁定 digest | 不在本仓库修改 |

精确 commit、OCI reference、manifest 和 amd64/arm64 digest 均以
[`deploy/versions.lock.json`](../deploy/versions.lock.json) 为准。SubConverter 当前镜像来自
上游 stable tag `v2.0.8`；锁文件同时记录源码 commit 和不可变的 manifest digest。

生产 Compose 不使用外部服务的 `latest`。短链存储已内嵌到 Gateway，MyUrls 与 Redis 不再是运行时依赖；其历史来源仅保留在 Git 历史中；仓库不提供已维护的镜像 digest 或 rollback manifest。
