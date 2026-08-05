# 安全边界

## 暴露面

生产环境只公开 gateway。Docker `behind-proxy` 固定绑定 loopback，`direct-tls` 只公开 80/443；Redis、MyUrls 和 SubConverter 不映射宿主机端口。

gateway 根据 Host 分离应用与 API，并在 `/short-api/` 代理中注入 MyUrls Token。浏览器、`/conf/config.js` 和响应正文都不应包含该 Token、Redis 密码或私网连接串。外层代理必须保留 Host，不应删除项目返回的 CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。HSTS 只有在整个域名确定长期使用 HTTPS 后才应由最外层 TLS 入口启用。

## 敏感数据

- 订阅 URL 可能包含访问凭据。SubConverter 会接收它，创建短链时 MyUrls/Redis 也会保存包含它的长链接。
- Base64 不是加密。短码是“持有即可访问”的凭据；一旦泄漏，持有者通常可以访问跳转目标。
- `.env`、`.runtime/`、证书私钥、平台变量、Redis 备份和测试哨兵不得提交或粘贴到公开日志。
- 网关和后端日志应只记录时间、方法、路由模板、状态和耗时等必要信息，禁止记录完整 query、请求体、Authorization、Redis URL、真实短码、客户端 IP 或 User-Agent。
- Subweb 不信任 SubConverter 上游的参数白名单脱敏。Docker 与本机源码模式都在 SubConverter 标准输出进入日志前移除完整 URI、`url`/`link` 等请求来源参数和 Authorization 值；即使订阅服务使用非标准 Token 参数名，日志也不应保留可访问的订阅地址。
- 生产环境固定使用 `Asia/Shanghai`。运行时从上游默认配置重新生成受控的 SubConverter 偏好文件，强制 `log_level = "warn"`、`print_debug_info = false`，不会复用命名卷中可能开启 verbose 的旧配置。
- 历史日志不可能由新版本自动追溯脱敏。若旧日志出现真实订阅 URL，先在订阅提供方轮换凭据，再按部署文档删除旧 SubConverter 容器或本机日志；已被导出到备份或第三方日志平台的副本也必须单独处理。

## 供应链

Gateway、SubConverter 和 Redis 的外部生产镜像由 [`deploy/versions.lock.json`](../deploy/versions.lock.json) 固定 tag、commit、manifest digest 和平台 digest。MyUrls 是明确例外：Compose 默认引用其稳定发行推进的 `latest`，而集成验证使用锁文件中的已验证基线。更新时验证上游发布、许可证、架构摘要、容器健康、集成测试和漏洞扫描；需要生产回滚时使用 `MYURLS_IMAGE` 指定 digest，不依赖可变 tag。发布流程应保留 SBOM、provenance 和源码 SHA 对应关系。

远程配置由第三方维护，可能继续引用其他规则集。选择预设等于授权转换后端读取这些来源；部署者应定期审查[远程配置来源](remote-config-sources.md)。

## 秘密生命周期

`configure.sh` 首次生成独立 64 位十六进制 MyUrls Token 与 Redis 密码，再次执行默认复用。只有计划停写、备份并同步重建所有消费者时才使用 `--rotate-secrets`。疑似泄漏时：关闭短链创建入口、保存必要的脱敏证据、轮换 Token；若 Redis 凭据泄漏，同时更换密码并检查数据访问范围。远程平台凭据泄漏还需要在平台侧撤销，删除本地文件不能撤销远程秘密。

## 发布前检查

至少验证：内部端口未公开、Host 路由严格、短链创建无 Token 泄漏、日志无订阅哨兵、镜像摘要与锁文件一致、前端产物无秘密/私网路径、Redis 数据有可恢复备份。发现异常时先停止写入，不要用删除卷或强制重建掩盖问题。
