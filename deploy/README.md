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
deploy/deploy.sh
```

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

## 更新

```bash
/opt/game-vote/deploy/deploy.sh
```

拉取 `main` → 备份数据库 → 构建镜像 → 重启（启动时自动执行数据库迁移）→ 等待健康检查通过。

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
```
