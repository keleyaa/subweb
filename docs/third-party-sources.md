# 第三方来源与变更边界

版本与摘要以 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 为机器可读依据；下表是人类可读说明，验证日期为 2026-08-01。MyUrls 是唯一运行时例外：Compose 默认使用其稳定发行维护的 `latest`，而锁文件保留最后验证的测试与回滚基线。

| 项目 | 当前来源 | 锁定版本 | 本仓库是否修改其源码 | 许可证/边界 |
| --- | --- | --- | --- | --- |
| Subweb | [`stilleshan/subweb`](https://github.com/stilleshan/subweb) | Fork 历史起点 | 是，本仓库已独立重构 | 本仓库 GPL-3.0 |
| MyUrls | [`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)，原始上游 [`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls) | 运行时默认 `latest`；已验证基线为 `v1.11`, commit `68527398a2b4019f7ee5a176eb8645f68055d0ae`, image digest `sha256:f00046cd6c68986781ac9bf13d43fc4db3dbedb8815146a3510ef325cd5b98b0` | 不在本仓库修改；独立仓库维护 | 以该仓库许可证为准 |
| SubConverter-Extended | [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended) | `v1.2.0`, commit `4db6a63f078f27da2cfb6cc90d47eb2dbd80c1cd`, image digest `sha256:75c110016526ab2cf56d3d832aac912001f1497a594a4eefb9d79cd33125167f` | 否，只固定并配置官方镜像 | 以官方仓库许可证为准 |
| Redis | [`redis/redis`](https://github.com/redis/redis) | `8.10.0`, image digest `sha256:5cca2f8a01ef2264c52dac86f14ec6a5abe973a93331e1b62522cfc5e63e4691` | 否 | 以 Redis 对应版本许可证为准 |
| Nginx unprivileged | [`nginx/nginx`](https://github.com/nginx/nginx) 与官方 unprivileged image | `1.30.4`, image digest `sha256:44e36330f74d4f3a1d4e222acca9e23b401fb87811a7597024502bb759c4dd49` | 只添加模板和启动配置 | 以 Nginx/镜像仓库许可证为准 |

MyUrls 的 Redis URL/TLS 与日志脱敏支持已在独立工作树实现和测试，但尚未发布完整稳定 tag 与镜像摘要。它发布成功前 `ghcr.io/keleyaa/myurls:latest` 不存在；Subweb 的集成验证因此明确覆写为上述 `v1.11` 基线，生产部署则在稳定发行后自动跟随 `latest`。需要可重复发布或回滚时，部署者可以在不提交的 `.env` 中以 `MYURLS_IMAGE` 指定已验证 digest。

## 设计参考

界面使用 Apple 平台的层级、玻璃材质、运动偏好和可访问性原则作为方法参考，并以维护者 MyUrls 页面作为同一产品家族的克制感参考。没有复制 Apple、MyUrls 或其他网站的源码、DOM、CSS、图片、图标或商标。

## 远程配置

远程配置预设不是本仓库代码，只有用户主动选择时才传给转换后端。其来源和许可证单独列在[远程配置来源](remote-config-sources.md)。更新任何组件时必须先核对上游 tag/commit、镜像多架构摘要、许可证和回归测试，再更新锁文件；MyUrls 的 `latest` 是明确记录的运行时例外，其余组件禁止用可变 `latest` 代替发布锁定。
