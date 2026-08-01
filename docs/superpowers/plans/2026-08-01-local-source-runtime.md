# 本机源码运行实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不使用 Docker、不修改用户已有 checkout、不宽泛终止进程的前提下，用四个命令在 macOS、Linux 和 WSL2 安全启动、检查和停止全栈。

**架构：** `.runtime/local/` 是唯一运行目录，保存生成配置、PID/进程特征、日志、Redis 数据和编译产物，并被 Git 忽略。Subweb 用 Vite loopback 运行，MyUrls 和 SubConverter 从固定源码编译，Redis 使用项目专用数据目录，系统 Nginx 使用项目专用 prefix 统一对外。

**技术栈：** POSIX shell、Node.js/npm、Go、CMake/C++、Redis CLI/server、Nginx、Vitest 子进程测试、GitHub Actions macOS/Ubuntu matrix。

---

## 固定本机端口和派生值

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LOCAL_VITE_PORT` | `5173` | Subweb Vite，只供 Nginx 访问 |
| `LOCAL_SUBCONVERTER_PORT` | `25500` | SubConverter，只供 Nginx 访问 |
| `LOCAL_MYURLS_PORT` | `18082` | MyUrls，只供 Nginx 访问 |
| `LOCAL_REDIS_PORT` | `16379` | 项目 Redis，只供 MyUrls 访问 |
| `LOCAL_APP_PORT` | `18080` | 浏览器 APP 入口 |
| `LOCAL_API_PORT` | `18081` | 浏览器 API 入口 |

所有进程绑定 `127.0.0.1`。浏览器公开值必须派生为 `API_URL=http://127.0.0.1:$LOCAL_API_PORT` 和 `SHORT_URL=http://127.0.0.1:$LOCAL_APP_PORT/short-api`；MyUrls 必须使用 `MYURLS_PROTO=http` 和 `MYURLS_DOMAIN=127.0.0.1:$LOCAL_APP_PORT`。

## 任务 1：建立共享运行库和端口所有权契约

**文件：**
- 新建：`scripts/local/lib/common.sh`
- 新建：`scripts/local/lib/ports.sh`
- 新建：`scripts/local/lib/processes.sh`
- 新建：`tests/local/ports.spec.js`
- 新建：`tests/local/processOwnership.spec.js`

- [ ] **步骤 1：先写端口和 PID 安全失败测试**

  用 Node 临时 TCP server 占用随机端口，断言 `assert_port_available "$port" "$variable_name"` 非零退出，错误包含端口和变量名，但 server 仍然存活。

  用一个无关 `sleep` 进程和伪造 PID 文件断言 `stop_owned_process` 拒绝发送信号；再用含 `.runtime/local/$run_id` 唯一命令特征的进程断言先 TERM、有界等待、最后才 KILL。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/local/ports.spec.js tests/local/processOwnership.spec.js
  ```

- [ ] **步骤 3：实现无破坏共享函数**

  - `common.sh`：解析项目绝对路径、安全读取 `.env`中白名单变量、建立权限 `0700` 目录、在 stderr 输出不含秘密的错误；
  - `ports.sh`：优先用 `lsof -nP -iTCP:"$port" -sTCP:LISTEN`报告占用者，无 `lsof` 时用 `nc` 或 shell TCP 探测；只报告，不终止；
  - `processes.sh`：每个 PID 同时记录服务名、绝对运行路径特征、启动时间和期望健康地址。停止前用 `ps -p "$pid" -o command=` 或等价可移植手段匹配特征；不匹配则报告 stale PID 并仅删除该 PID 文件。

- [ ] **步骤 4：扫描禁止命令并提交**

  ```sh
  ! rg -n '\b(pkill|killall)\b|kill .*-1' scripts/local
  npm test -- tests/local/ports.spec.js tests/local/processOwnership.spec.js
  git add scripts/local/lib tests/local/ports.spec.js tests/local/processOwnership.spec.js
  git commit -m "feat: add safe local process and port primitives"
  ```

## 任务 2：实现幂等 bootstrap 和固定源码缓存

**文件：**
- 新建：`scripts/local/bootstrap.sh`
- 新建：`scripts/local/lib/sources.sh`
- 新建：`tests/local/bootstrap.spec.js`
- 修改：`.env.example`
- 修改：`.gitignore`

- [ ] **步骤 1：先写依赖、checkout 不变和幂等失败测试**

  用临时 `PATH` 提供可记录调用的 fake `node`、`npm`、`go`、`cmake`、`redis-server`、`redis-cli`、`nginx`、`git`、`curl`、`lsof`。测试覆盖：

  - 每个缺失工具都一次性列出，不执行 `brew`、`apt`、`sudo`；
  - `MYURLS_SOURCE_DIR` / `SUBCONVERTER_SOURCE_DIR` 指向 checkout 时，校验 `remote.origin.url` 和 HEAD 等于锁定 commit，不执行 checkout/pull/reset；
  - 未提供时，只 clone 到 `${XDG_CACHE_HOME:-$HOME/.cache}/subweb/sources/$service_name/$source_commit` 并 detached checkout 锁定 commit；
  - 重复运行不重新 clone、不轮换秘密、不删除 Redis 数据。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/local/bootstrap.spec.js
  ```

- [ ] **步骤 3：实现依赖检查和固定源码策略**

  `bootstrap.sh` 从 `deploy/versions.lock.json` 取 MyUrls/SubConverter commit，先执行全部检查，再创建目录/下载/编译。它必须区分 macOS 和 Linux 错误建议，但建议只显示用户可手动执行的 Homebrew 或 Debian/Ubuntu 命令。Windows 检测到非 WSL 时明确拒绝并指向 WSL2。

  构建输出固定为：

  - `.runtime/local/bin/myurls`：在 MyUrls 源码中执行 `go build -trimpath -o "$PROJECT_ROOT/.runtime/local/bin/myurls" .`；
  - `.runtime/local/build/subconverter/`：`cmake -S "$SUBCONVERTER_SOURCE_DIR" -B "$PROJECT_ROOT/.runtime/local/build/subconverter" -DCMAKE_BUILD_TYPE=Release`，再 `cmake --build "$PROJECT_ROOT/.runtime/local/build/subconverter" --config Release --parallel "$BUILD_JOBS"`；
  - Subweb：只在 `package-lock.json` 变更或 `node_modules` 不完整时执行 `npm ci`。

- [ ] **步骤 4：生成本机秘密和目录**

  调用核心计划的 `scripts/lib/config.sh` 生成 `.runtime/local/secrets.env` 权限 `0600`，存放独立 MyUrls Token 和 Redis 密码；不写入根 `.env`，不在 stdout 显示。建立 `config/`、`pids/`、`logs/`、`redis/`、`bin/`、`build/` 并确保全部被 `.gitignore` 覆盖。

- [ ] **步骤 5：运行幂等测试并提交**

  ```sh
  npm test -- tests/local/bootstrap.spec.js
  git add .env.example .gitignore scripts/local/bootstrap.sh scripts/local/lib/sources.sh tests/local/bootstrap.spec.js
  git commit -m "feat: bootstrap pinned local source dependencies"
  ```

## 任务 3：生成本地配置并实现原子启动

**文件：**
- 新建：`scripts/local/start.sh`
- 新建：`scripts/local/lib/health.sh`
- 新建：`deploy/local/nginx.conf.template`
- 新建：`deploy/local/redis.conf.template`
- 新建：`tests/local/start.spec.js`
- 新建：`tests/local/configDerivation.spec.js`

- [ ] **步骤 1：先写启动顺序、派生 URL 和失败回收测试**

  使用 fake 进程和可控健康响应，断言严格顺序为 Redis → MyUrls → SubConverter → Vite → Nginx；前一项未 healthy 不启动后一项。在第 3 个服务故意失败时，只终止本次新启动的前 2 个，不动启动前已经存在的进程。

  对默认和六个自定义端口断言所有派生值，包括 Vite `config.js`、Nginx upstream/listen、MyUrls domain/proto、Redis 连接和健康地址。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/local/start.spec.js tests/local/configDerivation.spec.js
  ```

- [ ] **步骤 3：实现专用 Redis 和 Nginx 配置**

  Redis 配置必须包含 `bind 127.0.0.1`、`protected-mode yes`、非默认端口、`requirepass`、项目数据目录、AOF/RDB 持久和日志路径。Nginx 用 `-p "$PROJECT_ROOT/.runtime/local/nginx" -c "$PROJECT_ROOT/.runtime/local/config/nginx.conf"` 运行，同时监听 APP/API loopback 端口，路由和脱敏规则与 Docker gateway 共享生成逻辑，不手工复制一份易漂移规则。

- [ ] **步骤 4：实现有界等待的原子启动**

  `start.sh` 执行：

  1. 确认 bootstrap 产物和秘密存在；
  2. 一次性检查六个端口，任一占用即不启动任何进程；
  3. 原子生成所有配置并先执行 `redis-server --test-memory`（支持时）、`nginx -t`、SubConverter 配置语法检查；
  4. 按顺序在新进程组启动，每个健康检查指数退避，单服务总等待不超过 30 秒；
  5. 全部成功后才保留 PID 清单，并只输出两个公开 loopback URL 和日志目录。

  Vite 命令固定为 `npm run serve -- --host 127.0.0.1 --port "$LOCAL_VITE_PORT" --strictPort`，不向 LAN 开放。

- [ ] **步骤 5：运行绿灯并提交**

  ```sh
  npm test -- tests/local/start.spec.js tests/local/configDerivation.spec.js
  git add scripts/local/start.sh scripts/local/lib/health.sh deploy/local tests/local/start.spec.js tests/local/configDerivation.spec.js
  git commit -m "feat: start the integrated stack from local sources"
  ```

## 任务 4：实现真实状态检查和安全停止

**文件：**
- 新建：`scripts/local/status.sh`
- 新建：`scripts/local/stop.sh`
- 新建：`tests/local/status.spec.js`
- 新建：`tests/local/stop.spec.js`

- [ ] **步骤 1：先写“PID 存活不等于健康”失败测试**

  测试至少覆盖：PID 不存在、PID 被其他进程复用、进程存在但 HTTP/Redis 失败、五个进程和六个健康项全通过。`status.sh` 在任一必需项不健康时非零退出。

  `stop.sh` 要求按 Nginx → Vite → SubConverter → MyUrls → Redis 逆序停止，删除 PID/生成配置但保留 `redis/`、编译产物和日志。再次执行必须幂等成功。

- [ ] **步骤 2：运行测试并确认红灯**

  ```sh
  npm test -- tests/local/status.spec.js tests/local/stop.spec.js
  ```

- [ ] **步骤 3：实现聚合健康和优雅停止**

  `status.sh` 逐项输出 `running/healthy/unhealthy/stale/stopped`，不显示秘密或完整进程环境。Redis 用认证 `PING`，MyUrls `/healthz` 必须实际经 Redis，SubConverter 用任务 1 已验证的最小探测，Nginx 分别检查 APP/API 入口。

  `stop.sh` 只调用 `stop_owned_process`；TERM 后最多等待 10 秒，仍存活才对该已确认 PID 发 KILL。有 stale PID 时报警但继续检查其他服务。

- [ ] **步骤 4：运行绿灯并提交**

  ```sh
  npm test -- tests/local/status.spec.js tests/local/stop.spec.js
  ! rg -n '\b(pkill|killall)\b' scripts/local
  git add scripts/local/status.sh scripts/local/stop.sh tests/local/status.spec.js tests/local/stop.spec.js
  git commit -m "feat: report and stop owned local services safely"
  ```

## 任务 5：执行真实 macOS/Linux 端到端验证

**文件：**
- 新建：`scripts/verify-local-source.sh`
- 新建：`.github/workflows/local-source.yml`
- 新建：`tests/project/localWorkflow.spec.js`
- 新建：`docs/validation/local-source.md`

- [ ] **步骤 1：先写 CI 范围契约失败测试**

  断言 workflow 至少有 `macos-15` 和 `ubuntu-24.04` matrix，在固定工具版本下执行 bootstrap 两次、start、status、功能哨兵、stop、端口释放和 Redis 重启持久性。workflow 不使用 `sudo` 启动业务进程，清理步骤始终运行且只调用 `scripts/local/stop.sh`。

- [ ] **步骤 2：实现本机验证脚本**

  `scripts/verify-local-source.sh` 覆盖：

  - bootstrap 重复执行时产物 digest 不变；
  - 默认端口完整转换、创建短链和跳转；
  - 重启 Redis/MyUrls 后旧短链仍存在；
  - 六个自定义端口下公开 URL 和 ShortUrl 全部更新；
  - 逐一占用六个默认端口时 start 失败且占用进程不受影响；
  - stop 后六个端口都释放，数据目录保留，无存活 PID 文件。

- [ ] **步骤 3：在 macOS 和 Linux 真实运行**

  ```sh
  ./scripts/local/bootstrap.sh
  ./scripts/local/bootstrap.sh
  ./scripts/local/start.sh
  ./scripts/local/status.sh
  ./scripts/verify-local-source.sh
  ./scripts/local/stop.sh
  ./scripts/local/stop.sh
  ```

  本地缺少另一系统时，只将实际运行的系统写为已通过，等 GitHub Actions 对另一系统的结果完成后再更新证据。

- [ ] **步骤 4：保存无秘密证据并提交**

  `docs/validation/local-source.md` 记录 OS/架构、工具版本、锁定 commit、命令和退出码，不收录 `.runtime` 内容、日志全文、Token、Redis 密码或哨兵 URL。

  ```sh
  git add scripts/verify-local-source.sh .github/workflows/local-source.yml tests/project/localWorkflow.spec.js docs/validation/local-source.md
  git commit -m "test: verify local source lifecycle on macos and linux"
  ```

## 本计划审查门禁

- [ ] 四个用户命令严格是 `bootstrap.sh`、`start.sh`、`status.sh`、`stop.sh`，不要求手工按顺序启动五个进程。
- [ ] 脚本不安装依赖、不调用管理员权限、不修改用户已有 checkout 或系统服务。
- [ ] 任一端口冲突在启动第一个进程前失败，且不向占用者发信号。
- [ ] 中途失败只回收本次启动的进程；停止前同时验证 PID 和命令特征。
- [ ] `status.sh` 同时验证进程、HTTP 与 Redis，不用“PID 存在”代替健康。
- [ ] 自定义任一端口后，Nginx、Subweb 公开配置、MyUrls 返回域名和所有健康地址一起更新。
