# Docker Hub 与 GHCR 双发布设计

## 目标

每次 `main` 发布在同一次 Buildx 多架构构建中，把 Gateway 镜像同时推送到 Docker Hub 与 GitHub Container Registry。两个镜像源必须拥有相同的 `latest`、日期加提交短 SHA、`sha-*` 标签，并解析到同一个 manifest digest。

## 发布边界

- Docker Hub 保持默认部署源：`docker.io/keleyaa/subweb`。
- GHCR 增加为备用部署源：`ghcr.io/keleyaa/subweb`。
- Docker Hub 继续使用现有仓库 Secrets 登录；GHCR 使用 Actions 内置的 `GITHUB_TOKEN`，不增加长期 PAT。
- `release` 作业增加最小权限 `packages: write`，其他作业权限不扩大。
- 构建、SBOM、provenance 和平台集合保持不变，避免两个注册表分别构建导致 digest 漂移。

## 发行证据与部署文档

回滚清单记录同一 digest 下的 Docker Hub 与 GHCR 两个完整引用，Actions 摘要也显示两个镜像源。README、Docker 部署和维护文档说明默认源、备用源、不可变标签以及 GHCR 首次发布后的公开可见性要求。

## 验证

项目测试静态约束工作流权限、GHCR 登录、双注册表标签和双引用回滚清单；文档测试约束两个可执行镜像引用。随后运行项目单元测试、lint、构建、文档检查与工作流 YAML 解析。
