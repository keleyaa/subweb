# 运行时配置

Subweb 在浏览器启动时读取 `/conf/config.js` 中的 `window.config`。Vite 会把 `public/conf/config.js` 原样复制到构建产物，因此修改配置后刷新页面即可生效。

```js
window.config = {
  siteName: 'Subweb',
  apiUrl: 'https://converter.example.com',
  shortUrl: '',
  menuItem: [{ title: 'GitHub', link: 'https://github.com/keleyaa/subweb', target: '_blank' }],
  remoteConfigOptions: [],
};
```

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `siteName` | string | 导航品牌名称。 |
| `apiUrl` | string | 兼容订阅转换后端的基础地址。生产环境应使用可从浏览器访问的 HTTPS 地址。 |
| `shortUrl` | string | 可选短链服务基础地址。为空时不显示短链区域；设置后会向 `${shortUrl}/short` 发送转换链接。 |
| `menuItem` | array | 可选导航项。当前极简导航只渲染首个有效的 HTTPS GitHub 链接。 |
| `remoteConfigOptions` | array | 可选远程配置预设，每项使用 `{ value, text }`。默认为空，不会主动连接第三方地址。 |

无效或缺失字段会回退到项目默认值。

## 安全与隐私

- `apiUrl`、`shortUrl` 和 `remoteConfigOptions` 由部署者负责审核。不要把不可信的地址作为默认值发布。
- 使用短链时，转换链接会离开浏览器并提交给该短链服务。Base64 仅用于请求格式，不提供保密性。
- HTTPS 页面调用 HTTP 后端通常会被浏览器拦截为混合内容；生产环境应保持页面、转换后端与短链服务都使用 HTTPS。
