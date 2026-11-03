# 生产部署

线上地址：**https://www.yuchaotao.com/game-vote**

```
互联网 ──443──▶ CT 101 web (192.168.0.201)            CT 102 game-vote (192.168.0.202)
               Caddy: www.yuchaotao.com                /opt/game-vote（生产，本目录）
                 /sc2-card/*  → 静态文件                  web    :8080 → 容器 :3000
                 /game-vote*  → 192.168.0.202:8080 ──▶   worker
                                                         postgres / redis（不对宿主机开放端口）
                                                       /root/game-vote（开发，:3000，独立数据库）
```

HTTPS 证书由 CT 101 的 Caddy 自动申请和续期；本应用只提供 HTTP。

## 首次部署

```bash
git clone https://github.com/yuchaotao/game-vote.git /opt/game-vote
cd /opt/game-vote
cp .env.example deploy/.env.prod   # 按下文填写
docker login ghcr.io -u yuchaotao  # 见下文「镜像仓库登录」
deploy/deploy.sh
```

### 镜像仓库登录

生产镜像由 GitHub Actions 构建（`main` 上所有检查和 e2e 通过后），推送到私有仓库
`ghcr.io/yuchaotao/game-vote`，标签为 `sha-<commit>` 和 `main`。CT 102 需要登录一次才能拉取：

1. GitHub → Settings → Developer settings → Personal access tokens (classic)，新建 token，只勾选 `read:packages`
2. 在 CT 102 上执行 `docker login ghcr.io -u yuchaotao`，密码处粘贴 token（保存在 `/root/.docker/config.json`）

`deploy/.env.prod` 中与开发环境不同的部分：

```bash
APP_URL=https://www.yuchaotao.com/game-vote
BASE_PATH=/game-vote
WEB_PORT=8080
SESSION_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
# DATABASE_URL / REDIS_URL 由 compose 覆盖，无需修改
# SMTP_*、STEAM_API_KEY、DISCORD_* 填真实值
```

外部服务需要登记的回调地址：

- Discord 应用 → OAuth2 → Redirects：`https://www.yuchaotao.com/game-vote/api/auth/discord/callback`

### Discord 通知机器人

1. Discord 应用 → Bot → Reset Token，填入 `.env.prod` 的 `DISCORD_BOT_TOKEN`
2. OAuth2 → URL Generator：勾选 `bot`，权限不用勾，用生成的链接把机器人加进大家共用的服务器
3. Discord 只允许机器人私信同一服务器的成员；成员在该服务器的隐私设置里需允许「服务器成员私信」
4. 发送记录和失败原因在数据库 `Notification` 表里，用户也能在 设置 → 通知 → 最近的通知 看到
5. 频道里的投票按钮（#47）：General Information → Interactions Endpoint URL 填 `https://www.yuchaotao.com/game-vote/api/discord/interactions`（部署后再填，保存时 Discord 会立即校验）

## 更新

```bash
/opt/game-vote/deploy/deploy.sh
```

拉取 `main` → 拉取该 commit 的镜像（CI 还没构建完会等待，最多 30 分钟）→ 备份数据库 → 重启（启动时自动执行数据库迁移）→ 等待健康检查通过 → 清理旧镜像（保留最近 3 个）。

- `--build`：不拉取，在本机构建镜像（GHCR 不可用时的后备，比较吃资源）
- 回滚：`git checkout <旧 commit>` 后执行 `deploy/deploy.sh --no-pull`。注意数据库迁移不会回退，回滚前确认旧版本兼容当前的表结构，必要时从备份恢复

## 备份

- `deploy/backup.sh`：`pg_dump` 压缩后写入 `/var/backups/game-vote`，保留 14 天
- 每天 04:30 由 systemd timer 自动执行，每次部署前也会执行
- 安装 timer：

  ```bash
  cp deploy/game-vote-backup.{service,timer} /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now game-vote-backup.timer
  ```

- 恢复：

  ```bash
  gunzip -c /var/backups/game-vote/gamevote-<时间>.sql.gz | \
    docker compose -p game-vote-prod --env-file deploy/.env.prod \
      -f docker-compose.yml -f deploy/docker-compose.prod.yml \
      exec -T postgres psql -U gamevote -d gamevote
  ```

## 动态 DNS（DuckDNS）

`www.yuchaotao.com` 是 `yuchaotao.duckdns.org` 的 CNAME。运营商换了公网 IP 而 DuckDNS 没更新时，外网就访问不到网站（2026-11-03 发生过一次，见 #55）。

- `deploy/duckdns-update.sh`：把 `yuchaotao.duckdns.org` 更新为当前公网 IP；IP 变化时写入日志
- 每 5 分钟由 systemd timer 执行（开机 1 分钟后先执行一次）
- token 保存在 `/etc/duckdns/token`（只有 root 可读），不进仓库，脚本也不会打印。首次设置（在 CT 102 上，输入时不回显）：

  ```bash
  install -d -m 700 /etc/duckdns
  read -rs -p "DuckDNS token: " t && printf '%s' "$t" > /etc/duckdns/token && unset t && chmod 600 /etc/duckdns/token && echo
  ```

- 安装 timer：

  ```bash
  cp deploy/game-vote-duckdns.{service,timer} /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now game-vote-duckdns.timer
  ```

- 查看：`systemctl list-timers game-vote-duckdns.timer`、`journalctl -u game-vote-duckdns -n 20`

## CT 101 的 Caddy 配置

`/etc/caddy/Caddyfile` 的 `www.yuchaotao.com` 站点块中加入（与 `/sc2-card` 规则互不影响）：

```caddyfile
www.yuchaotao.com {
	handle /game-vote* {
		reverse_proxy 192.168.0.202:8080
	}
	import sc2
}
```

修改后：`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`

## 常用命令

```bash
cd /opt/game-vote
C="docker compose -p game-vote-prod --env-file deploy/.env.prod -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile app"
$C ps                 # 状态
$C logs -f web        # 日志
$C restart worker     # 重启 worker
$C exec worker node dist/worker/run-once.js poll-presence   # 立即运行一次某个后台任务
```
