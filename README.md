# Game Vote

和朋友一起投票决定下一次玩什么游戏。

- Steam / 本站账号登录，好友系统
- 群组 + 持久化群聊
- 群游戏库（Steam、Battlefield、任意来源），封面、风评、类型、游玩记录、热度排序
- 投票轮次、历史回放，自动检测一起游玩并提示开启新投票
- 邮件 / Discord / Steam 通知

详细设计见 [docs/DESIGN.md](docs/DESIGN.md)。开发进度见 [Issues](../../issues)。

## 本地开发

需要 Node.js 22 和 Docker。

```bash
cp .env.example .env            # 填入 SESSION_SECRET（openssl rand -hex 32）
npm install
docker compose up -d            # 启动 postgres + redis
npm run db:migrate              # 应用数据库迁移
npm run dev                     # Web: http://localhost:3000
npm run worker:dev              # 后台 worker（另开一个终端）
```

检查：`curl localhost:3000/api/health` 应返回 `"ok": true`，worker 运行后 `workerHeartbeat` 会有时间戳。

全部容器化运行：`docker compose --profile app up -d --build`

常用命令：`npm run lint` · `npm run typecheck` · `npm test` · `npm run format`
