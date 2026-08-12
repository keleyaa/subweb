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
- 短链创建接口由 MyUrls 固定启用 `5 RPS/10 burst` 限流；SubConverter 转换接口由网关按来源地址固定启用 `60 RPS/10 burst` 限流，避免公开服务被无限刷请求。已有外层反向代理时，网关看到的来源地址可能是代理地址，应在外层继续配置按真实客户端限流。
- 生产环境固定使用 `Asia/Shanghai`。运行时从上游默认配置重新生成受控的 SubConverter 偏好文件，强制 `log_level = "warn"`、`print_debug_info = false`，不会复用命名卷中可能开启 verbose 的旧配置。
- 历史日志不可能由新版本自动追溯脱敏。若旧日志出现真实订阅 URL，先在订阅提供方轮换凭据，再按部署文档删除旧 SubConverter 容器或本机日志；已被导出到备份或第三方日志平台的副本也必须单独处理。

## 主动攻击与滥用边界

- SubConverter 会按用户提交的订阅 URL 和远程配置地址发起外部请求。这是转换功能本身的必要行为，也意味着公开实例存在 SSRF、恶意远程配置、超大响应和外部请求耗尽风险。网关限流不是网络隔离；生产主机应通过防火墙或专用出口限制容器只能访问业务所需的外部网络，不要把内部管理网段暴露给该出口。
- 短链是设计上的开放重定向服务。任何获得短码的人都可以跳转到保存的目标，且公开创建接口可能被用于钓鱼链接或流量滥用。启用应用层 Token、保留 MyUrls 和网关限流、监控 429/5xx，并在外层代理增加 WAF/域名策略；不要把短链当成访问控制或恶意 URL 检测。
- 用户可以手动输入后端 API 地址。浏览器会直接向该地址发送订阅内容，因此生产地址只接受 HTTPS；HTTP 仅允许本机 `127.0.0.1` 或 `localhost` 开发服务。使用者仍必须确认地址可信，不要把不受信任的公共 API 作为默认服务。

## 供应链

Gateway 与所有外部生产镜像（Redis、SubConverter-Extended、Nginx 基础镜像、MyUrls）在 Compose 中默认跟随各自 `latest` 浮动标签；[`deploy/versions.lock.json`](../deploy/versions.lock.json) 保留已验证基线（tag、commit、manifest digest 和平台 digest）——MyUrls 集成测试直接消费其 digest，其余服务作为回滚参考。更新镜像时验证上游发布、许可证、架构摘要、容器健康、集成测试和漏洞扫描，并运行 `verify:integration:*` 确认无回归；CI 的 trivy 步骤会扫描运行时跟随的三个 latest 镜像，有 CRITICAL/HIGH 漏洞时发布门禁失败。

跟随 `latest` 意味着供应链不可完全复现，也无法依赖镜像 tag 精确回滚。对公开生产服务，需要受控回滚时应在 `.env` 中通过 `SUBWEB_IMAGE`/`MYURLS_IMAGE`/`REDIS_IMAGE`/`SUBCONVERTER_IMAGE` 指定已验证 digest；SBOM、provenance 和源码 SHA 对应关系可作为定位回滚点的补充。发布流程仍应保留这些产物。SubConverter 镜像更新后必须重建 `subconverter-runtime` 卷（见[部署文档](deployment-docker.md)）。

远程配置由第三方维护，可能继续引用其他规则集。选择预设等于授权转换后端读取这些来源；部署者应定期审查[远程配置来源](remote-config-sources.md)。

## 秘密生命周期

`configure.sh` 首次生成独立 64 位十六进制 MyUrls Token 与 Redis 密码，再次执行默认复用。只有计划停写、备份并同步重建所有消费者时才使用 `--rotate-secrets`。疑似泄漏时：关闭短链创建入口、保存必要的脱敏证据、轮换 Token；若 Redis 凭据泄漏，同时更换密码并检查数据访问范围。远程平台凭据泄漏还需要在平台侧撤销，删除本地文件不能撤销远程秘密。

## 发布前检查

至少验证：内部端口未公开、Host 路由严格、短链创建无 Token 泄漏、日志无订阅哨兵、镜像摘要与锁文件一致、前端产物无秘密/私网路径、Redis 数据有可恢复备份。发现异常时先停止写入，不要用删除卷或强制重建掩盖问题。
