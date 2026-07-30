# 运行时配置

Subweb 在浏览器启动时读取 `/conf/config.js` 中的 `window.config`。Vite 会把 `public/conf/config.js` 原样复制到构建产物，因此修改配置后刷新页面即可生效。

```js
window.config = {
  siteName: 'ML1',
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

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `siteName` | string | 运行时兼容字段，不再驱动页面内导航文字。 |
| `apiUrl` | string | 兼容订阅转换后端的基础地址，默认值为 `https://api.ml1.one`。生产环境应使用可从浏览器访问的 HTTPS 地址。 |
| `shortUrl` | string | 短链服务基础地址，默认值为 `https://ml1.one`。为空时不显示短链区域；设置后会向 `${shortUrl}/short` 发送转换链接。 |
| `menuItem` | array | 可选 GitHub 项目来源。首个安全的 HTTPS GitHub URL 仅显示为页脚 GitHub 项目，不再是顶部导航项。 |
| `remoteConfigOptions` | array | 可选远程配置预设，每项使用 `{ value, text }`。默认列表见 [远程配置来源](remote-config-sources.md)，只有用户在页面中选择后才会使用。 |

选择器中的“后端默认配置”会省略 `config` 参数，由转换后端使用自身默认规则。无效或缺失字段会回退到项目默认值。

## 安全与隐私

- `apiUrl`、`shortUrl` 和 `remoteConfigOptions` 由部署者负责审核。选择远程配置会让转换后端读取第三方规则及其可能引用的下游规则集。
- 使用短链时，转换链接会离开浏览器并提交给该短链服务。Base64 仅用于请求格式，不提供保密性。
- HTTPS 页面调用 HTTP 后端通常会被浏览器拦截为混合内容；生产环境应保持页面、转换后端与短链服务都使用 HTTPS。
