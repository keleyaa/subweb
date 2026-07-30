# Subweb

Subweb 是一个独立维护的单页订阅转换前端，页面品牌显示为 `Subconverter Web`。用户可以在一个页面内输入订阅、选择目标客户端、生成并自动复制转换链接；实际转换由部署者配置的兼容后端完成。

## Fork 与来源说明

| 类型 | 来源 | 说明 |
| --- | --- | --- |
| 当前维护仓库 | [keleyaa/subweb](https://github.com/keleyaa/subweb) | 当前代码、镜像、文档和后续维护均以此仓库为准。 |
| Fork 上游 | [stilleshan/subweb](https://github.com/stilleshan/subweb) | 本项目由该开源仓库 fork 而来，并以其历史代码为起点。 |
| 设计与代码仓库参考 | 无其他记录 | 留存的前端现代化和无框极简设计计划未记录其他第三方代码仓库作为设计或代码来源。 |

Fork 之后，本项目已经独立调整前端构建、运行时配置、页面结构、交互、样式、测试、容器和发布流程。上游仓库的旧 README、默认服务和部署方式不代表当前项目状态。

当前界面采用维护者指定的 Apple 风格的无框极简方向；这是视觉原则参考，不是第三方代码来源。改版没有直接复制 Apple 或其他第三方项目的源码、UI 资源或图片。

## 项目边界

- 本仓库只包含静态前端，不包含订阅转换后端、节点服务、账号或数据存储。
- 默认转换后端为 `https://api.ml1.one`，默认短链服务为 `https://ml1.one`。
- 生成转换链接不会请求转换后端；使用生成的链接时，订阅内容会由对应后端处理。
- 生成短链会把转换链接发送给短链服务。Base64 只是请求格式，不是加密。
- “后端默认配置”不会追加 `config` 参数；公开远程配置只有在用户主动选择后才会传给后端。

## 功能

- 单页完成订阅输入、客户端选择、远程配置和高级参数设置。
- 点击“转换订阅”后生成并自动复制结果，按钮随后切换为“复制订阅”。
- 点击“生成短链”后请求短链服务并自动复制，按钮随后切换为“复制短链”。
- 支持明暗主题切换、系统主题初始值、键盘焦点和移动端布局。
- 页脚显示当前维护的 GitHub 仓库。

## 本地开发

要求 Node.js 24 或更高版本、npm 11 或更高版本：

```bash
npm ci
npm run serve
```

完整本地质量检查：

```bash
npm run verify
npm run test:e2e
npm audit --audit-level=moderate
```

第一次运行 E2E 前执行 `npx playwright install chromium`。生产构建输出到 `dist/`，该目录不会提交到 Git。

## Docker 快速部署

使用仓库源码和 Docker Compose：

```bash
cp .env.example .env
docker compose config
docker compose up -d --build
curl -fsS http://127.0.0.1:18080/healthz
```

也可以直接使用公开镜像：

```bash
docker run -d --name subweb --restart unless-stopped \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  -p 127.0.0.1:18080:8080 \
  -e API_URL='https://api.ml1.one' \
  -e SHORT_URL='https://ml1.one' \
  keleyaa/subweb:latest
```

生产环境应使用 HTTPS 反向代理，并优先按发布 digest 固定镜像。完整步骤、验证、升级和回滚方式见[部署说明](docs/deployment.md)。

## 文档

- [运行时配置](docs/configuration.md)：后端、短链、GitHub 来源和远程配置预设。
- [远程配置来源](docs/remote-config-sources.md)：默认预设的仓库、许可证和使用边界。
- [部署说明](docs/deployment.md)：Compose、Docker Run、反向代理、验证、升级和回滚。
- [维护指南](docs/maintenance.md)：质量门禁、远端、清理和推送边界。
- [界面设计规范](docs/interface-design.md)：当前单页与玻璃材质设计约束。

## 许可证

本项目遵循仓库中的 [GPL-3.0 许可证](LICENSE)。
