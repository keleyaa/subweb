# 单一 HTTP Docker 集成验证

验证脚本启动完整 Compose 栈：`gateway`、`request-policy`、`subconverter`、`myurls-app`、`myurls-short` 与 `redis`。所有公开请求仍只经 Gateway 的单一 HTTP 入口；Request Policy Service 与 HTTPS CONNECT egress proxy 仅在内部网络可达。

运行：

```sh
npm run verify:integration
```

脚本在项目隔离 Docker network 中执行，并为每次运行选择未占用的私有 `/29` 网段，避免与本机其他 Compose 项目冲突。它不会删除或修改其他项目的容器、网络或卷。

## 覆盖范围

- Gateway、Request Policy、SubConverter、两个 MyUrls v2 实例和 Redis 均达到健康状态；
- APP、API、SHORT Host 路由与单一 HTTP 行为；
- `/sub` 经 Request Policy 拒绝私网、非 HTTPS、危险端口与超限输入；
- SubConverter 只可通过内部 HTTPS CONNECT egress proxy 访问远程 HTTPS，未直接加入默认出站网络；
- APP 创建短链、SHORT 跳转与 v2 JSON 响应；
- 所有公开路径只使用 Gateway 的监听端口，MyUrls、Redis、SubConverter、Request Policy 与 egress proxy 不发布宿主机端口；
- Redis 短暂重启后 MyUrls 与 Request Policy 的恢复；
- Gateway、Request Policy、MyUrls 与 SubConverter 日志不出现订阅 URL、挑战 Token、Redis 密码、IP 哈希秘密或真实短码；
- 容器、网络与临时 volume 在退出后由脚本按本次项目名前缀清理。

MyUrls 创建与解析检查使用 APP / SHORT 域名 Host，转换接口使用 API Host。验证配置的域名只在脚本隔离环境中使用，不能作为生产部署值。
