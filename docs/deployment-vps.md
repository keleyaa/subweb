# 单台 Linux VPS 部署

本页定义主机层部署合同。应用仍由仓库的 `scripts/subweb.sh` 和锁定的 Compose/release 合同负责；systemd 不实现第二套部署逻辑。支持 Debian 12 和 Ubuntu 24.04 LTS，使用 systemd、Docker Engine 27+、Docker Compose v2 和外部 Nginx。TLS、DNS、SSH、主机防火墙和证书续期属于管理员职责。

## 主机布局和权限

- `/opt/subweb`：经过审查的 release checkout，由 `root:subweb` 持有，目录 `0750`。
- `/opt/subweb/.env`：普通非符号链接文件，所有者 `subweb:subweb`，权限 `0600`。
- `/opt/subweb/.runtime`、`/opt/subweb/.local`：`subweb:subweb`、`0700`，用于验证器或本地运行时状态。
- `/var/lib/subweb-backups`：`subweb:subweb`、`0700`；若使用远端挂载，必须把它放在 `BACKUP_REMOTE_MOUNT` 之下。
- `/etc/subweb/backup.env`：`root:root`、`0600`，只存备份策略和 age recipient/identity 路径，不存 Redis 密码。

主机安装由 checkout 中的以下命令完成。命令不会生成 `.env`，也不会删除现有 Compose volume：

```sh
sudo SUBWEB_SOURCE=/srv/releases/subweb-vX.Y.Z \
  /srv/releases/subweb-vX.Y.Z/scripts/vps/install.sh
sudo /opt/subweb/scripts/vps/check-host.sh
```

`install.sh` 创建 `subweb` 系统用户并加入 Docker group，安装 systemd、logrotate 和 Nginx 配置，执行 `systemctl daemon-reload`，但不会自动启动服务。加入 Docker group 后需重新建立 systemd 服务进程的用户会话；systemd unit 使用 `User=subweb`，因此启动前必须确认 `id subweb` 已包含 `docker` group。

## systemd 生命周期

`subweb.service` 是唯一的应用 owner：它调用 `/opt/subweb/scripts/subweb.sh up` 和 `down`，启动失败最多按 systemd 的 `StartLimitBurst=3` 保护，不会执行 `down --volumes`。普通停止、重启和升级均保留 Redis named volume。systemd 管理命令：

```sh
sudo systemctl enable --now subweb.service
sudo systemctl status subweb.service
sudo systemctl restart subweb.service
sudo systemctl stop subweb.service
sudo journalctl -u subweb.service -n 200 --no-pager
```

升级前先把新 release 放入 `/srv/releases`，核对 release 对应的 Git tag 和不可变 Gateway manifest digest，然后在维护窗口执行：

```sh
sudo systemctl stop subweb.service
sudo rsync -a --delete --exclude=.env --exclude=.runtime/ /srv/releases/subweb-vX.Y.Z/ /opt/subweb/
sudo chown -R root:subweb /opt/subweb
sudo chown subweb:subweb /opt/subweb/.env
sudo chmod 0600 /opt/subweb/.env
sudo /opt/subweb/scripts/vps/check-host.sh
sudo systemctl start subweb.service
sudo -u subweb sh -c 'cd /opt/subweb && npm run verify:integration'
```

若新版本启动失败，保留旧 checkout 和 Redis volume，停止服务并把 `/opt/subweb` 恢复到上一个已验证 release；不要删除 volume 或重写 RDB。`subweb.sh upgrade` 的失败输出必须先被记录，再按 [维护与验证](maintenance.md) 的恢复边界处理。

## 备份和恢复验证

备份使用 `subweb.sh backup` 生成 RDB，然后必须满足以下至少一个条件后才允许 retention 删除旧备份：

1. 配置 `AGE_RECIPIENT`，在保留前把备份加密；或
2. 配置已挂载的 `BACKUP_REMOTE_MOUNT`，并且 `BACKUP_DIRECTORY` 位于该挂载点下。

配置模板位于 [`deploy/vps/backup.env.example`](../deploy/vps/backup.env.example)：

```sh
sudo install -o root -g root -m 0600 deploy/vps/backup.env.example /etc/subweb/backup.env
sudoedit /etc/subweb/backup.env
sudo install -d -o subweb -g subweb -m 0700 /var/lib/subweb-backups
```

`subweb-backup.timer` 每日 03:15 运行，带 15 分钟随机延迟；`subweb-backup-verify.timer` 每月第一个星期日 04:15 在隔离 Docker 容器中校验最新 RDB，若备份加密则先使用 `AGE_IDENTITY_FILE` 解密到临时文件。两者均设置 `Persistent=true`，主机离线后会在恢复时补跑。

```sh
sudo systemctl enable --now subweb-backup.timer subweb-backup-verify.timer
sudo systemctl start subweb-backup.service
sudo systemctl start subweb-backup-verify.service
sudo journalctl -u subweb-backup.service -u subweb-backup-verify.service --since today --no-pager
```

恢复演练是非破坏性的 RDB 加载验证；真正恢复生产数据仍需显式停止写入并运行：

```sh
sudo -u subweb /opt/subweb/scripts/subweb.sh restore \
  --backup /var/lib/subweb-backups/subweb-redis-YYYYMMDDTHHMMSSZ.rdb \
  --confirm-stop-writes
```

恢复前复制当前 RDB，恢复失败时使用脚本保留的恢复前快照回滚。任何删除 volume 的操作都是独立的、人工确认的灾备动作，不属于 systemd、定时备份或升级流程。

## 日志、磁盘和外部 TLS

Compose 已为所有服务固定 `json-file`：每个容器 `10m`、最多 `3` 个文件。主机层的 `/etc/logrotate.d/subweb` 仅轮转可选的 `/var/log/subweb/*.log`，不直接操作 Docker 数据目录。管理员必须监控 `/var/lib/docker` 和备份文件系统；`check-host.sh` 默认要求 `/opt/subweb` 所在文件系统至少有 10 GiB 可用空间，可用 `MIN_FREE_KIB` 调整但不应低于发布容量需求。

Nginx 模板位于 [`deploy/nginx/subweb.conf`](../deploy/nginx/subweb.conf)，只代理到 `127.0.0.1:18080`，保留 Host 和转发链，并把 HTTP 重定向到 HTTPS。启用前替换三个域名和证书路径，并按实际代理网段配置 `TRUSTED_PROXY_CIDR`；不要把容器端口绑定到公网。

```sh
sudo ln -s /etc/nginx/sites-available/subweb /etc/nginx/sites-enabled/subweb
sudo nginx -t
sudo systemctl reload nginx
```

## 首次部署检查表

1. DNS 已指向 VPS，SSH 仅允许密钥认证，防火墙只开放 SSH、80、443。
2. Docker Engine、Compose v2、Node.js 24+、Nginx、systemd、`age`（若加密）和 `rsync` 已安装。`configure.sh` 必须先用本机 Node 校验 `deploy/versions.lock.json` 并生成受管 runtime 镜像设置，缺少或版本过低时会在请求 Turnstile Secret Key 前停止。
3. `SUBWEB_SOURCE` 来自已审查的 release，Gateway 使用 release 对应的不可变 manifest digest。
4. `.env` 已由 `configure.sh` 生成并通过 `check-host.sh` 的普通文件/`0600` 检查。
5. Nginx `nginx -t`、`scripts/subweb.sh verify`、systemd status 和三域名 HTTPS smoke 均通过。
6. 备份 timer、验证 timer、磁盘监控和证书续期监控均已启用。

## 故障与灾备证据

每次首次部署、升级、回滚或灾备演练至少保留：release tag、Gateway digest、`git rev-parse HEAD`、`systemctl status`、`subweb.sh status`、备份路径及 SHA-256、验证命令输出、Nginx 配置测试结果和发生时间。不要把 `.env`、Redis 密码、Turnstile 私钥、age identity 或完整短码写入工单、日志或截图。
