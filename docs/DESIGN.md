# Game Vote — 设计文档

朋友之间用来决定"下一次玩什么"的网站：建群、聊天、维护群游戏库、投票，并自动检测大家是否真的一起玩了。

## 1. 架构

```
            ┌─────────── Caddy (HTTPS, 反向代理) ───────────┐
浏览器 ───▶ │  web: Next.js (页面 + API + WebSocket 聊天)     │
            └───────────────┬───────────────────────────────┘
                            │
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
     PostgreSQL          Redis            worker (BullMQ)
   (所有持久数据)    (队列 / 在线状态 /     ├─ 游玩检测轮询 (Steam API, 每 2 分钟)
                      聊天 pub/sub)        ├─ Discord bot (presence + 私信)
                                           ├─ 通知发送 (邮件 / Discord / Steam bot)
                                           └─ 游戏元数据刷新 (Steam / IGDB)
```

- 语言：TypeScript（前后端统一）
- Web：Next.js App Router，Tailwind CSS
- ORM：Prisma
- 部署：Docker Compose（web, worker, postgres, redis, caddy）

## 2. 账号与登录

- **本站账号**：用户名 + 邮箱 + 密码（argon2 哈希），邮箱验证。
- **Steam 登录**：Steam OpenID 2.0。首次登录自动建号；已有本站账号可在设置中绑定 Steam。
- **Discord 绑定**：OAuth2 绑定 Discord 账号，用于私信通知与 presence 检测。
- 会话：HttpOnly cookie，数据库保存 session。
- 每个用户有唯一 **好友码** `昵称#1234`。

## 3. 好友

邀请方式：

1. **好友码**：输入 `昵称#1234` 发送好友申请，对方接受后成为好友。
2. **邀请链接 / 二维码**：用户生成链接（可设有效期、使用次数）。未注册者点开 → 注册 → 自动成为好友；已注册者点开 → 直接成为好友。
3. **Steam 好友推荐**：绑定 Steam 的用户，展示其 Steam 好友中已注册本站的人，一键申请。

## 4. 群组

- 创建、加入群组 **不限次数**。
- 群主、群成员都可以邀请**自己的好友**入群；**所有入群请求需群主确认**。
- 群主可移除成员、转让群主、解散群。
- 群内聊天：WebSocket 实时；全部消息持久化，任何时候重新登录都能翻看历史（分页向上加载）。
- 系统消息（新游戏加入、投票开始/结束、检测到一起游玩）也写入聊天流。

## 5. 群游戏库

- 来源：Steam、Battlefield/EA、Epic、Battle.net、其他任意（手动）。
- 添加方式：
  - 粘贴 Steam 商店链接 → 解析 appid → 拉取元数据；
  - 站内 Steam 搜索（Steam store search API）；
  - 非 Steam：IGDB 搜索；或完全手动填写。
- 卡片展示：封面、简介、类型/标签、风评（Steam 好评率 + 评价文字，或 IGDB/Metacritic 评分）、价格、多人模式、平台、添加人。
- **游玩记录**：每个游戏显示"什么时间段、哪些群成员一起玩了多久"（时间线）。
- **热度排序**：最近 N 天群成员游玩时长加权 + 投票得票 + 新近添加加成；另可按评分、添加时间、名称排序。
- 任何群成员都可以添加游戏。
- Steam 游戏元数据（商店 `appdetails` + 评测摘要 `appreviews`）全站共享一份，24 小时后过期；添加时过期即重新拉取，worker 每小时刷新一批。评测摘要接口对部分服务器 IP 会重定向，此时退回显示推荐数 / Metacritic。
- 手动添加的游戏只属于创建它的群。添加者或群主可以编辑（仅手动游戏）和移出；移出只删除群与游戏的关联，游戏记录保留给投票 / 游玩历史。

## 6. 投票

- 每个群同一时间最多一个进行中的投票轮次。
- 成员可从游戏库选游戏加入本轮候选；也可在投票界面直接新增游戏（自动同步进群游戏库）。
- 每人可投票数可配置（默认：多选，每人最多 3 票）。
- 投票发起时触发通知：**邮件、Steam 消息、Discord 私信**（用户可在设置中逐项开关）。
- **所有投票历史永久保留**，可回放：按时间线重现每张票的投出顺序与排名变化。

### 6.1 自动检测与新投票提示

条件（同时满足）：

1. **超过半数群成员** 同时在玩同一个游戏；
2. 持续 **超过 20 分钟**；
3. 该游戏在当前投票中 **排名前 2**。

满足后**不会自动开启下一轮**，而是在群内发出"新投票提示"（并推送通知）。任何成员都可以选择：

- **继续当前投票**（忽略提示）
- **结束投票并开启下一轮**（主按钮）
- 仅结束当前投票（次要选项，视觉弱化）

同一轮投票对同一游戏的提示只发一次，被"继续"后需再次满足条件（新的游玩会话）才会重新提示。

## 7. 游玩检测

| 来源    | 方法                                                   | 前提                                                     |
| ------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Steam   | `GetPlayerSummaries` 的 `gameid`，worker 每 2 分钟轮询 | Steam 资料与游戏详情公开                                 |
| Discord | bot 读取成员 presence（"正在玩"）                      | 用户与 bot 同在一个 Discord 服务器，开启 Presence intent |
| 手动    | "开黑签到"按钮                                         | 无                                                       |

检测结果写入 `PlaySession`（用户、游戏、开始、结束、来源），再按群聚合为"群游玩会话"。

## 8. 通知

| 渠道    | 实现                                         | 说明                                                 |
| ------- | -------------------------------------------- | ---------------------------------------------------- |
| 邮件    | SMTP（nodemailer）                           | 需配置 SMTP                                          |
| Discord | bot 私信                                     | 用户需绑定 Discord 且与 bot 有共同服务器             |
| Steam   | 专用 Steam bot 账号（steam-user 库，非官方） | 用户需加 bot 为 Steam 好友；有被限制风险，默认可关闭 |

## 9. 主要数据模型（概要）

User, Account(provider: steam/discord/local), Session, FriendCode, Friendship, FriendRequest, InviteLink,
Group, GroupMember(role), GroupJoinRequest(status, invitedBy),
ChatMessage(type: user/system),
Game(source, externalId, metadata JSON, reviewScore …), GroupGame(addedBy),
PlaySession(user, game, start, end, source), GroupPlaySession,
VoteRound(status, startedAt, endedAt, endReason), VoteCandidate, VoteBallot(user, candidate, castAt),
VotePrompt(round, game, status), NotificationPreference, NotificationLog.

## 10. 配置（.env）

`DATABASE_URL`, `REDIS_URL`, `APP_URL`, `SESSION_SECRET`,
`STEAM_API_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`,
`IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `STEAM_BOT_USERNAME`, `STEAM_BOT_PASSWORD`（可选）。
`STEAM_STORE_COUNTRY`（Steam 价格所用地区，默认 `us`）；`STEAM_STORE_URL` 仅供测试指向 Steam 商店的本地模拟。

## 11. 开发路线（每项对应一个 issue + PR）

1. 项目脚手架、Docker Compose、CI
2. 账号系统：本站注册登录 + Steam 登录 + Discord 绑定
3. 好友系统：好友码、邀请链接、Steam 好友推荐
4. 群组：创建、邀请、群主审批、成员管理
5. 群聊天：实时 + 持久化历史
6. 群游戏库：Steam 链接/搜索、IGDB、手动添加、游戏卡片 UI
7. 游玩检测：Steam 轮询、Discord presence、手动签到、游玩时间线
8. 热度排序
9. 投票：轮次、候选、投票、直接新增游戏、历史回放
10. 自动检测新投票提示
11. 通知：邮件、Discord、Steam bot、偏好设置
12. 生产部署：Caddy HTTPS、备份、上线
