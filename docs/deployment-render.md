# Render 部署

## 当前状态

Render Blueprint 已完成方案设计但尚非正式支持。当前没有提交 `render.yaml`，因为 MyUrls 已发布的锁定版本还不能消费 Render Key Value 提供的 `redis://` / `rediss://` connection string；也没有真实新建、持久性、升级和回滚证据。

## 目标拓扑

计划使用同一 region 的四项资源：唯一 `type: web` 的 gateway、两个 `type: pserv` 私有服务 MyUrls/SubConverter，以及 `type: keyvalue` 且 `ipAllowList: []` 的 Redis。内部服务使用锁定 digest，不能使用可变 tag。

- gateway 从平台 `PORT` 启动并由 Render 管理 TLS。
- 两个私网 upstream 使用 Render `hostport` 引用，不构造公网 URL。
- Key Value 的 `connectionString` 只传给 MyUrls。
- MyUrls Token 由一个服务生成，再通过 `fromService.envVarKey` 供 gateway 引用，不能生成两份。
- `APP_DOMAIN` / `API_DOMAIN` 使用初次部署时的 `sync: false` 输入；Blueprint 不支持任意字符串插值，因此公开 URL 由 gateway 从已校验域名派生。

## 域名、TLS 与操作边界

真实实施时先用 Render 默认域名验证 gateway，再绑定应用和 API 两个自定义域名。平台负责 TLS，MyUrls、SubConverter 和 Key Value 不公开。

正式支持前还需要补齐：Blueprint schema 实测、计费/区域说明、变量录入、状态日志、暂停删除、Key Value 备份、全链路功能、重启持久性、秘密日志检查、digest 升级和回滚。用户必须明确授权 Render Workspace、计费资源和 DNS 写入。

在 MyUrls 发布 Redis URL/TLS 镜像摘要并更新本仓库锁文件之前，不要手工用当前 `v1.11` 冒充兼容版本，也不要把本页描述当成部署成功证明。
