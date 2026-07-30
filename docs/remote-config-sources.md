# 远程配置来源

Subweb 的“后端默认配置”不会加载外部规则。下列预设只在用户主动选择后，以 `config` 参数传给转换后端；它们不是本项目源码的一部分，也可能在上游更新后改变行为。

| 页面名称 | 配置地址 | 来源仓库 | 许可证 |
| --- | --- | --- | --- |
| ACL4SSR Online | <https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini> | [ACL4SSR/ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) | CC-BY-SA-4.0 |
| ACL4SSR Online Full | <https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini> | [ACL4SSR/ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) | CC-BY-SA-4.0 |
| FDUZS 流媒体与 AI | <https://raw.githubusercontent.com/FDUZS/subconverter-config/main/config.ini> | [FDUZS/subconverter-config](https://github.com/FDUZS/subconverter-config) | GPL-3.0 |
| BeingFun Clash / Sing-box | <https://raw.githubusercontent.com/BeingFun/config4subconverter/main/customize.ini> | [BeingFun/config4subconverter](https://github.com/BeingFun/config4subconverter) | GPL-3.0 |

上述文件在 2026-07-31 已检查为可访问的 `[custom]` 格式。它们会引用其他公开规则集，因此使用前应阅读各自仓库及其下游来源的说明和许可证。

若要增加或移除预设，应同步更新 `public/conf/config.js`、`src/runtime/config.js`、本文件和对应测试。不要把用户订阅、访问令牌、私有地址或未经核验的个人配置作为默认预设提交。
