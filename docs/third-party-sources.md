# 第三方来源与变更边界

生产 Compose 的所有外部镜像（Redis、SubConverter-Extended、Nginx 基础镜像、MyUrls）默认跟随各自 `latest` 浮动标签；[`deploy/versions.lock.json`](../deploy/versions.lock.json) 保留已验证基线（验证日期 2026-08-18）：MyUrls 集成测试直接消费其 digest，其余服务作为回滚参考，并作为 `verify:locks` 校验的机器可读依据。需要冻结时在 `.env` 设置 `MYURLS_IMAGE`/`REDIS_IMAGE`/`SUBCONVERTER_IMAGE`/`SUBWEB_IMAGE`。

| 项目 | 当前来源 | 运行时镜像 | 已验证基线（测试/回滚） | 本仓库是否修改其源码 | 许可证/边界 |
| --- | --- | --- | --- | --- | --- |
| Subweb | [`stilleshan/subweb`](https://github.com/stilleshan/subweb) | `docker.io/keleyaa/subweb:latest` | 发布 tag `sha-*`/`latest` | 是，本仓库已独立重构 | 本仓库 GPL-3.0 |
| MyUrls | [`keleyaa/MyUrls`](https://github.com/keleyaa/MyUrls)，原始上游 [`CareyWang/MyUrls`](https://github.com/CareyWang/MyUrls) | `ghcr.io/keleyaa/myurls:latest` | `v1.13.0`, commit `7dc3db6a6347fe9db6e79cec053fece19553fe84`, image digest `sha256:b98836c038e070c8f889f391d63bd9535aee93ce91753f4bb30353f3395d0915` | 不在本仓库修改；独立仓库维护 | 以该仓库许可证为准 |
| SubConverter-Extended | [`Aethersailor/SubConverter-Extended`](https://github.com/Aethersailor/SubConverter-Extended) | `ghcr.io/aethersailor/subconverter-extended:latest` | `v1.2.0`, commit `4db6a63f078f27da2cfb6cc90d47eb2dbd80c1cd`, image digest `sha256:75c110016526ab2cf56d3d832aac912001f1497a594a4eefb9d79cd33125167f` | 否，只配置官方镜像 | 以官方仓库许可证为准 |
| Redis | [`redis/redis`](https://github.com/redis/redis) | `docker.io/library/redis:latest` | `8.10.0`, image digest `sha256:5cca2f8a01ef2264c52dac86f14ec6a5abe973a93331e1b62522cfc5e63e4691` | 否 | 以 Redis 对应版本许可证为准 |
| Nginx unprivileged | [`nginx/nginx`](https://github.com/nginx/nginx) 与官方 unprivileged image | `nginxinc/nginx-unprivileged:alpine` | `1.30.4`, image digest `sha256:44e36330f74d4f3a1d4e222acca9e23b401fb87811a7597024502bb759c4dd49` | 只添加模板和启动配置 | 以 Nginx/镜像仓库许可证为准 |

MyUrls `v1.13.0` 已发布并推进 `ghcr.io/keleyaa/myurls:latest`；Subweb 的可重复集成验证使用上述
`v1.13.0` digest，生产部署默认继续跟随 `latest`。需要可重复发布或回滚时，部署者可以在不提交的
`.env` 中以 `MYURLS_IMAGE` 指定已验证 digest；`configure.sh` 会在重新生成配置时保留该覆盖值。

## 设计参考

界面使用 Apple 平台的层级、玻璃材质、运动偏好和可访问性原则作为方法参考，并以维护者 MyUrls 页面作为同一产品家族的克制感参考。没有复制 Apple、MyUrls 或其他网站的源码、DOM、CSS、图片、图标或商标。

## 远程配置

远程配置预设不是本仓库代码，只有用户主动选择时才传给转换后端。其来源和许可证单独列在[远程配置来源](remote-config-sources.md)。所有运行时镜像跟随 `latest`，升级前应核对上游发布说明、许可证和回归测试；每次镜像更新后运行集成验证（`verify:integration:*`）与漏洞扫描，确认通过再继续使用。需要受控回滚时在 `.env` 中用 `MYURLS_IMAGE`/`SUBWEB_IMAGE` 指定已验证 digest。
