# 三域名文档更新指南

本文档列出了三域名架构实施后，各文档需要更新的要点。

---

## docs/architecture.md

### 需要更新的章节

#### 1. 架构图和域名职责

**当前**：描述双域名架构（APP_DOMAIN + API_DOMAIN）

**更新为**：
- 三域名模式（推荐）：
  - `APP_DOMAIN`：前端应用（HTML/CSS/JS）
  - `API_DOMAIN`：转换后端（SubConverter）
  - `SHORT_DOMAIN`：短链服务（MyUrls）
- Legacy 双域名模式：
  - `APP_DOMAIN`：前端应用 + 短链服务（兼容入口）
  - `API_DOMAIN`：转换后端

#### 2. Gateway 路由表

**添加**：
```
三域名模式：
- APP_DOMAIN:
  - / → 前端静态资源
  - /short-api/* → 兼容入口（迁移期）
  
- API_DOMAIN:
  - /sub → SubConverter
  - /healthz → 健康检查
  
- SHORT_DOMAIN:
  - /short-api/short → 短链创建（CORS）
  - /:key → 短链跳转
  - /healthz → 健康检查
```

#### 3. CORS 策略

**添加**：
- `SHORT_DOMAIN` 的 `/short-api/short` 端点允许来自 `APP_DOMAIN` 的跨域请求
- Origin 验证：只接受 `APP_DOMAIN`
- Content-Type 验证：只接受 `application/x-www-form-urlencoded`
- 支持 OPTIONS 预检请求

---

## docs/deployment-local.md

### 需要更新的章节

#### 1. 端口列表

**当前**：六个端口

**更新为**：七个端口
```
LOCAL_VITE_PORT=5173        # Vite 开发服务器
LOCAL_SUBCONVERTER_PORT=25500  # SubConverter
LOCAL_MYURLS_PORT=18082     # MyUrls
LOCAL_REDIS_PORT=16379      # Redis
LOCAL_APP_PORT=18080        # 前端 Gateway（Nginx）
LOCAL_API_PORT=18081        # 转换后端 Gateway（Nginx）
LOCAL_SHORT_PORT=18083      # 短链服务 Gateway（Nginx）⭐ 新增
```

#### 2. 访问地址

**添加**：
- 前端：`http://127.0.0.1:18080/`
- 转换 API：`http://127.0.0.1:18081/sub?...`
- 短链服务：`http://127.0.0.1:18083/short-api/short`（创建）
- 短链跳转：`http://127.0.0.1:18083/:key`（跳转）

---

## docs/configuration.md

### 需要添加的配置项

#### SHORT_DOMAIN

**类型**：字符串（域名）  
**默认值**：回退到 `APP_DOMAIN`（legacy 模式）  
**示例**：`s.ml1.one`

**说明**：
- 短链服务的独立域名
- 设置后启用三域名模式，短链返回 `https://SHORT_DOMAIN/:key`
- 未设置时使用 legacy 双域名模式，短链返回 `https://APP_DOMAIN/:key`

#### LOCAL_SHORT_PORT

**类型**：整数（端口号）  
**默认值**：`18083`  
**范围**：1024-65535

**说明**：
- 本机短链服务的端口
- 与其他六个端口一起，必须唯一且未被占用

---

## docs/security.md

### 需要添加的章节

#### CORS 安全策略

**三域名模式下的跨域请求**：

1. **Origin 验证**：
   - Gateway 只允许来自 `APP_DOMAIN` 的请求
   - 拒绝其他 Origin 的请求（403 Forbidden）

2. **预检请求**：
   - 支持 OPTIONS 方法的预检请求
   - 返回允许的方法：`POST, OPTIONS`
   - 返回允许的头：`Content-Type`

3. **Content-Type 验证**：
   - 只接受 `application/x-www-form-urlencoded`
   - 拒绝其他 Content-Type（415 Unsupported Media Type）

4. **限流**：
   - 短链创建：20 请求/分钟/IP

#### APP 兼容入口（迁移期）

**迁移策略**：

三域名部署后，`https://APP_DOMAIN/short-api/short` 和 `https://APP_DOMAIN/:key` 仍然可用：

1. **目的**：兼容已分享的旧短链，允许渐进式迁移
2. **路由优先级**：新短链返回 `SHORT_DOMAIN` URL，旧短链继续跳转
3. **何时移除**：确认没有旧短链在使用后
4. **移除方式**：修改 `nginx/snippets/app-routes.conf.template`

---

## 实施检查清单

- [x] README.md 更新
- [x] docs/deployment-docker.md 更新
- [x] docs/implementation-status-three-domain.md 创建
- [ ] docs/architecture.md 更新
- [ ] docs/deployment-local.md 更新
- [ ] docs/configuration.md 更新
- [ ] docs/security.md 更新

---

**注意**：本指南提供更新要点；实际更新时需要保持文档原有的语气、格式和详细程度。
