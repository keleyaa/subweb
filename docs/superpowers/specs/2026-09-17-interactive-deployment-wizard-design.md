# 交互式部署向导设计

## 状态

已批准，待实施计划。

## 目标

让人工首次部署可通过一条简短命令完成，同时保留现有生产部署的不可变镜像、版本锁、显式短链 profile、秘密处理和原子配置写入约束。

目标入口：

```sh
./scripts/subweb.sh install
```

该命令在交互终端启动向导。部署者输入具体 Gateway 版本 `vX.Y.Z`，向导将其解析为不可变 manifest digest，并最终把 digest 写入 `.env`。部署者不需要手工复制长 digest。

## 背景

当前 `subweb.sh install` 已经会生成 `.env`、验证 Compose、拉取镜像并等待服务健康，但人工调用仍需提供 APP/API/SHORT 域名、Turnstile Site Key 和完整 Gateway 镜像 digest。完整 digest 是正确的最终部署身份，却不适合作为手工输入。

Release workflow 已验证 `vX.Y.Z` tag 对应的 Gateway 多平台 manifest，并在 GHCR 和 Docker Hub 发布该 tag。tag 本身仍是可变名称，不能作为部署配置的最终值；向导必须在安装时把用户选择的版本解析为 digest 并保存 digest。

## 非目标

- 不引入 `latest`、自动选择最新版本或未确认的默认 Gateway 版本。
- 不以 `curl | sh`、GitHub API、静态版本映射文件或额外 SaaS 作为部署依赖。
- 不改变 `--image`、`--turnstile-secret-key-stdin` 或现有 CI 自动化调用的行为。
- 不让部署者手工选择或覆盖 Redis、SubConverter、MyUrls 镜像；三者继续由 `deploy/versions.lock.json` 的受管运行时镜像合同生成。
- 不修改短链启用四服务合同、短链关闭两服务合同、网络边界或回滚合同。

## 使用接口

### 交互模式

当且仅当命令为 `./scripts/subweb.sh install` 且没有额外参数，并且标准输入和错误输出均为终端时，`subweb.sh` 执行新的向导脚本。

向导按以下顺序收集输入：

1. `APP_DOMAIN`。
2. `API_DOMAIN`。
3. 是否启用短链。
4. 启用短链时：`SHORT_DOMAIN` 和 Turnstile Site Key。
5. 可选的 `TRUSTED_PROXY_CIDR`；空值表示不信任外层代理。
6. Gateway 版本，格式必须为 `vX.Y.Z`。

向导不收集 Turnstile Secret Key。向导完成公开输入的确认后，沿用 `configure.sh` 的既有隐藏终端输入逻辑，或在现有非交互路径通过 `--turnstile-secret-key-stdin` 接收该秘密。

向导解析版本后显示以下不含秘密的摘要，并要求明确确认：

- APP/API/SHORT 域名；
- 短链启用或关闭 profile；
- Gateway 输入版本；
- 解析得到的 `ghcr.io/keleyaa/subweb@sha256:...` 引用；
- 可选可信代理 CIDR 是否设置。

确认后，向导调用现有 `docker-deploy.sh`。向导不直接写 `.env`、不直接调用 `docker compose`，也不重写配置或验证规则。

如果无参数 `install` 在非交互环境中调用，脚本必须立即失败并提示调用方传入现有部署参数，而不能等待输入或猜测默认值。

### 显式版本参数

`docker-deploy.sh` 新增：

```text
--version vX.Y.Z
```

- `--version` 与 `--image` 互斥，必须且只能提供其中一项。
- `--image` 保持现有的不可变 digest 或受支持 `sha-...` 候选引用规则，供 CI 和已有自动化使用。
- `--version` 仅接受与 release workflow 一致的 `^v[0-9]+\.[0-9]+\.[0-9]+$`。
- `--version` 解析成功后转化为内部 `--image ghcr.io/keleyaa/subweb@sha256:<digest>` 输入，后续配置和启动路径与现有 `--image` 完全相同。

因此手工用户可以使用向导，自动化用户也可以选择：

```sh
./scripts/subweb.sh install \
  --version v1.2.3 \
  --app-domain app.example.com \
  --api-domain api.example.com \
  --short-domain short.example.com \
  --turnstile-site-key "$TURNSTILE_SITE_KEY" \
  --turnstile-secret-key-stdin
```

## 版本解析合同

版本解析以 GHCR 的发布 tag 为唯一在线查询来源：

```sh
docker buildx imagetools inspect \
  ghcr.io/keleyaa/subweb:vX.Y.Z \
  --format '{{.Manifest.Digest}}'
```

解析器必须：

1. 先验证版本格式，随后才调用 Docker。
2. 要求 `docker buildx` 可用；缺失时给出明确修复提示。
3. 只接受匹配 `sha256:[0-9a-f]{64}` 的 manifest digest。
4. 将结果组合为 `ghcr.io/keleyaa/subweb@sha256:<digest>`。
5. 拒绝不存在的 tag、注册表认证/网络错误、空输出和格式不正确的输出。
6. 在解析、输入验证和用户确认全部成功前，不创建或修改 `.env`，不拉取镜像，不启动容器。

版本 tag 只是便捷输入，不能被写入 `.env`。`.env`、Compose、升级和 rollback 始终只消费已解析的不可变引用。

## Profile 行为

短链开启时，向导传递 `--short-links-enabled true`、SHORT 域名和 Turnstile Site Key。现有配置器继续选择 `compose.yaml`，其最终服务集合为 Gateway、SubConverter、MyUrls 和 Redis。

短链关闭时，向导传递 `--short-links-enabled false`，且不得询问、读取或传递 SHORT 域名、Turnstile Site Key 或 Secret Key。现有配置器继续选择 `compose.disabled-short-links.yaml`，其最终服务集合为 Gateway 和 SubConverter。

两种模式中的 Redis、SubConverter 和 MyUrls 镜像值均继续由 `runtime-image-contract.mjs` 从 `deploy/versions.lock.json` 生成。

## 错误处理

- 缺少终端、输入为空、确认拒绝、版本格式不正确或版本解析失败：退出非零且不产生部署副作用。
- 域名、端口、API URL、代理 CIDR 和 feature flag 继续由 `configure.sh` 执行权威校验和原子 `.env` 写入。
- 版本解析成功后，若配置、Compose 验证、镜像拉取或健康检查失败，复用既有 `docker-deploy.sh` 的错误和数据保护行为。
- Secret Key 不得进入参数列表、确认摘要、错误输出或日志。

## 实现边界

预计新增一个专注于终端交互与版本解析的 shell 脚本。它的职责仅为收集非秘密输入、解析版本、显示确认和调用部署入口。

现有职责保持不变：

- `subweb.sh`：命令分发和无参数交互模式选择。
- `docker-deploy.sh`：部署参数解析、镜像输入归一化、配置、Compose 验证、拉取和启动。
- `configure.sh`：输入校验和原子 `.env` 写入。
- `runtime-image-contract.mjs`：外部运行时镜像和 rollback JSON 的唯一生成器。
- `validate-compose.sh`：最终 Compose 合同验证。

## 验证策略

新增或扩展 shell 集成测试，至少覆盖：

1. 无参数 `install` 在 TTY 中调用向导，在非 TTY 中 fail closed。
2. 向导将 `vX.Y.Z` 解析为校验过的 digest 并把该 digest 传给既有部署入口。
3. `--version` 成功解析后与显式 `--image` 走相同配置和 Compose 路径。
4. `--version` 与 `--image` 同时出现时失败。
5. 非语义版本、缺少 Buildx、注册表失败、空 digest 和格式错误 digest 均失败，且不修改 `.env`。
6. 短链关闭路径不请求或传递短链与 Turnstile 字段。
7. 确认拒绝时不修改 `.env`、不拉取镜像、不启动容器。
8. 现有显式 `--image` 自动化安装测试继续通过。
9. 文档明确版本号只是输入，部署持久化值是 digest。

完成实现后运行受影响回归、`npm run verify:docs`、`npm run verify:ci`，以及 release 或生产相关变更所要求的验证门禁。

## 验收标准

1. 人工部署者只需运行 `./scripts/subweb.sh install`，在终端逐项输入公开配置和明确版本即可完成安装。
2. 人工部署者不需要复制或输入长 digest。
3. `.env` 中的 `SUBWEB_IMAGE` 始终是不可变引用，不是 `vX.Y.Z` 或 `latest`。
4. 自动化调用仍可使用现有参数和 stdin secret 路径，不会进入向导。
5. 短链开启和关闭 profile 均保持原有服务、网络、秘密和运行时镜像合同。
6. 任何版本解析或用户确认失败都不会改变部署状态。
