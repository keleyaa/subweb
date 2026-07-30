# 运行时配置

Subweb 在浏览器启动时读取 `/conf/config.js` 中的 `window.config`。Vite 会把 `public/conf/config.js` 原样复制到构建产物；修改部署目录中的该文件并刷新页面即可生效，不需要重新编译。

```js
window.config = {
  apiUrl: 'https://api.ml1.one',
  shortUrl: 'https://ml1.one',
  menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
  remoteConfigOptions: [
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini',
      text: 'ACL4SSR Online',
    },
    {
      value: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini',
      text: 'ACL4SSR Online Full',
    },
    {
      value: 'https://raw.githubusercontent.com/FDUZS/subconverter-config/main/config.ini',
      text: 'FDUZS 流媒体与 AI',
    },
    {
      value: 'https://raw.githubusercontent.com/BeingFun/config4subconverter/main/customize.ini',
      text: 'BeingFun Clash / Sing-box',
    },
  ],
};
```

## 字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `apiUrl` | string | 转换后端基础地址。必须是完整 HTTP(S) URL，不允许前后空格或用户名密码；无效时回退到 `https://api.ml1.one`。 |
| `shortUrl` | string | 短链服务基础地址。使用与 `apiUrl` 相同的 URL 规则；空字符串会关闭短链区域，无效非空值回退到 `https://ml1.one`。 |
| `menuItem` | array | 页脚 GitHub 项目来源。只保留标题非空、地址为 `https://github.com/<owner>/<repo>` 仓库根路径且不含查询或 fragment 的条目；空数组会隐藏页脚链接。 |
| `remoteConfigOptions` | array | 远程配置预设，每项为 `{ value, text }`。只保留名称非空且地址为完整 HTTP(S) URL 的条目。 |

字段类型错误或配置对象缺失时使用项目默认值；数组中的无效成员会被过滤。选择“后端默认配置”会省略 `config` 参数，由转换后端使用自身默认规则。

页面会把 `/sub` 或 `/short` 追加到服务地址的路径末尾，并保留已有查询参数；URL fragment 不会发送到服务端。例如 `https://example.com/base?token=value` 会形成 `https://example.com/base/sub?token=value&...`。手动输入的远程配置同样必须通过完整 HTTP(S) URL 校验。

## 容器环境变量

容器启动脚本支持：

| 环境变量 | 作用 |
| --- | --- |
| `API_URL` | 覆盖 `apiUrl`。 |
| `SHORT_URL` | 覆盖 `shortUrl`；传入空字符串可关闭短链。 |

环境变量会在容器启动时安全写入 `/usr/share/nginx/html/conf/config.js`。值不能包含换行符。页面名称固定为 `Subconverter Web`，不存在 `SITE_NAME` 配置。

如果把完整配置目录只读挂载到容器，不要同时传入 `API_URL` 或 `SHORT_URL`，否则启动脚本无法写入挂载文件并会主动失败。

## 安全与隐私

- `/conf/config.js` 是浏览器可直接访问的公开文件，不能存放订阅地址、访问令牌、密码或其他秘密。
- `apiUrl`、`shortUrl` 和远程配置来源由部署者负责审核。生产环境应使用浏览器可访问的 HTTPS 地址。
- 转换后端和短链服务需要允许页面来源发起跨域请求；HTTPS 页面调用 HTTP 服务通常会被浏览器作为混合内容拦截。
- 选择远程配置会让转换后端读取第三方规则及其下游规则集。来源和许可证见[远程配置来源](remote-config-sources.md)。
- 使用短链会把完整转换链接提交给短链服务；Base64 编码不提供保密性。
