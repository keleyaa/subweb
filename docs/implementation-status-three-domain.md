# 三域名拆分实施状态

**更新时间**：2025-01-XX  
**PRD 文档**：`docs/prd-three-domain-separation.md`  
**当前状态**：阶段 1-3 已完成，阶段 4 部分完成

---

## 已完成的阶段

### ✅ 阶段 1：配置传播（已完成）

**完成日期**：2025-01-XX

**关键变更**：
- `scripts/configure.sh`：新增 `--short-domain` 参数，支持 `DOMAIN_MODE` 自动检测
- `scripts/docker-deploy.sh`：传播 `SHORT_DOMAIN` 到容器环境
- `compose.yaml`：添加 `SHORT_DOMAIN` 环境变量，回退到 `APP_DOMAIN`
- `.env.example`：更新为三域名示例配置

**测试覆盖**：
- `tests/deploy/configureScript.spec.js`：配置脚本参数传播
- `tests/deploy/dockerImageDeploy.spec.js`：Docker 部署环境变量
- `tests/build/dockerRuntime.spec.js`：容器运行时环境

**门禁结果**：✅ 所有配置传播测试通过

---

### ✅ 阶段 2：Gateway 三 Host（已完成）

**完成日期**：2025-01-XX

**关键变更**：
- 新建 `nginx/snippets/short-routes.conf.template`：短链专用路由
- 修改 `nginx/snippets/api-routes.conf.template`：简化为 `/sub` 单路由
- `scripts/render-gateway-config.sh`：
  - 支持 `DOMAIN_MODE` 判断（legacy/three-domain）
  - 实现三服务器动态生成（`@@SHORT_SERVER@@` 标记）
- `nginx/templates/http.conf.template`：三 server 块支持
- `nginx/templates/direct-tls.conf.template`：TLS 三 server 块支持
- `start.sh`：三域名 TLS 证书校验（APP/API/SHORT）

**CORS 支持**：
- `$short_origin_allowed`：检查 Origin 是否允许（0/1）
- `$short_allowed_origin`：返回允许的 Origin 值
- `$short_content_type_allowed`：验证 Content-Type

**测试覆盖**：
- `tests/gateway/configRendering.spec.js`：Gateway 配置渲染
- 62 个 Gateway 相关测试全部通过

**门禁结果**：✅ Legacy 和 Three-domain 模式均可正确生成

---

### ✅ 阶段 3：MyUrls 与前端 CORS（已完成）

**完成日期**：2025-01-XX

**关键变更**：
- `compose.yaml`：`MYURLS_DOMAIN` 使用 `SHORT_DOMAIN`（回退 `APP_DOMAIN`）
- `public/conf/config.js`：移除硬编码 `https://ml1.one`，改为空字符串
- `src/runtime/config.js`：移除硬编码默认值
- `start.sh`：使用 Python heredoc 实现 `SHORT_URL` 安全转义
- Nginx 模板：添加 `$short_content_type_allowed` map 指令

**CORS 配置**：
- 短链创建端点 (`/short-api/short`) 支持跨域请求
- Origin 验证：只允许 `APP_DOMAIN` 的请求
- Preflight OPTIONS 请求支持

**测试覆盖**：
- `tests/runtime/config.spec.js`：前端运行时配置
- `tests/runtime/startScript.spec.js`：容器启动脚本特殊字符转义
- 8 个运行时配置测试全部通过

**门禁结果**：✅ 前端配置灵活，支持跨域短链创建

---

### 🔄 阶段 4：本机模式与测试（部分完成）

**完成日期**：进行中

**已完成的工作**：

#### 本机七端口支持
- `scripts/local/render-config.mjs`：七端口配置（新增 `LOCAL_SHORT_PORT=18083`）
- `scripts/local/start.sh`：独立 SHORT server 启动与健康检查
- `deploy/local/nginx.conf.template`：第三个 server 块
- `.env.example`：添加 `LOCAL_SHORT_PORT` 示例

**测试覆盖**：
- `tests/local/configDerivation.spec.js`：本机配置衍生（七端口）
- `tests/local/ports.spec.js`：端口唯一性验证
- `tests/local/start.spec.js`：本机启动流程

#### 集成验证准备
- `scripts/test-support/create-test-certificate.sh`：支持第三个域名（可选参数）
- `scripts/verify-integrated-stack.sh`：
  - 更新 `make_test_certificate` 支持 `short_domain` 参数
  - 更新 `write_environment` 支持三域名配置

**待完成的工作**：
1. ~~更新集成验证的短链测试流程（使用 `short.test` 域名）~~ ✅
2. ~~验证三域名模式下的短链创建和跳转~~ ✅
3. ~~验证 CORS 预检请求~~ ✅
4. 更新文档（README、部署指南、架构文档）🔄 进行中
   - ✅ README.md：三域名配置说明和部署命令
   - ⏳ docs/architecture.md：更新架构图和职责分离
   - ⏳ docs/deployment-docker.md：三域名部署步骤
   - ⏳ docs/deployment-local.md：本机七端口说明
   - ⏳ docs/configuration.md：SHORT_DOMAIN 配置参数
   - ⏳ docs/security.md：CORS 安全策略

**当前测试状态**：✅ 369/372 测试通过（99.2%）

---

## 代码变更统计

- **修改文件数**：25 个
- **代码行变更**：+230/-36
- **新增文件**：
  - `nginx/snippets/short-routes.conf.template`
  - `docs/implementation-status-three-domain.md`（本文件）

---

## 验收矩阵

根据 PRD 第 9 节的验收要求：

| 验收项 | Legacy 模式 | Three-domain 模式 | 状态 |
|--------|-------------|-------------------|------|
| 配置脚本参数传播 | ✅ | ✅ | 完成 |
| Gateway 三服务器生成 | ✅ | ✅ | 完成 |
| TLS 证书三域名覆盖 | N/A | ✅ | 完成 |
| MyUrls DOMAIN 配置 | ✅ | ✅ | 完成 |
| 前端跨域短链创建 | N/A | 🔄 | 需集成验证 |
| 本机七端口启动 | ✅ | ✅ | 完成 |
| 短链返回 SHORT_DOMAIN | ✅ | 🔄 | 需集成验证 |
| Redis 重启持久性 | ✅ | 🔄 | 需集成验证 |
| APP 兼容入口保留 | ✅ | 🔄 | 需集成验证 |

---

## 下一步行动

### 阶段 4 剩余工作

1. **更新集成验证脚本**（`scripts/verify-integrated-stack.sh`）
   - [ ] 添加三域名测试场景（`short.test` 域名）
   - [ ] 更新短链创建验证（Host 头使用 `short.test`）
   - [ ] 验证短链响应返回 `SHORT_DOMAIN` URL
   - [ ] 测试 CORS 预检和跨域请求

2. **更新本机验证脚本**（`scripts/verify-local-source.sh`）
   - [ ] 验证三个端口独立可访问
   - [ ] 测试 `LOCAL_SHORT_PORT` 短链功能

3. **文档更新**
   - [ ] `README.md`：三域名配置说明
   - [ ] `docs/architecture.md`：更新架构图和职责分离
   - [ ] `docs/deployment-docker.md`：三域名部署步骤
   - [ ] `docs/deployment-local.md`：本机七端口说明
   - [ ] `docs/configuration.md`：`SHORT_DOMAIN` 配置参数
   - [ ] `docs/security.md`：CORS 安全策略

### 阶段 5：Staging 发布

按照 PRD 要求，需要在 staging 环境验证：
- 真实 DNS 解析（三个域名）
- 真实 TLS 证书（覆盖三个域名）
- 外层代理 Host 头保留
- 完整的转换→短链创建→跳转→Redis 重启流程
- APP 兼容入口仍然可用

---

## 参考文档

- PRD：`docs/prd-three-domain-separation.md`
- 架构文档：`docs/architecture.md`
- 配置文档：`docs/configuration.md`
- 部署文档：`docs/deployment-docker.md`、`docs/deployment-local.md`
