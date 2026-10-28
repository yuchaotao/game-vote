import { notFound } from "next/navigation";
import {
  CancelJoinRequestButton,
  DissolveGroupButton,
  GroupInfoForm,
  InviteFriendsForm,
  JoinRequestActions,
  LeaveGroupButton,
  MemberOwnerActions,
} from "@/components/groups";
import { DiscordChannelForm } from "@/components/discord-channel";
import { AutoRefresh, CheckInCard, PresenceBadge, TogetherList } from "@/components/play";
import { Avatar, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { listLibrary } from "@/lib/games/service";
import {
  discordChannelOptions,
  getGroupForMember,
  invitableFriends,
  lastChannelPost,
} from "@/lib/groups/service";
import { groupTogether, openCheckIn, presenceFor } from "@/lib/play/service";

export default async function GroupMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [group, friends] = await Promise.all([
    getGroupForMember(id, user.id),
    invitableFriends(id, user.id),
  ]);
  if (!group) notFound();
  const [presence, checkIn, together, library, channels, lastPost] = await Promise.all([
    presenceFor(group.members.map((m) => m.user.id)),
    openCheckIn(user.id),
    groupTogether(id, { limit: 5 }),
    listLibrary(id),
    group.isOwner ? discordChannelOptions() : null,
    group.isOwner && group.discordChannelId ? lastChannelPost(id) : null,
  ]);

  const visibleRequests = group.isOwner
    ? group.joinRequests
    : group.joinRequests.filter((r) => r.invitedById === user.id);

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {visibleRequests.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">
            {group.isOwner ? "待审批的入群申请" : "我邀请的（等待群主确认）"}
          </h2>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visibleRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={r.user.avatarUrl} name={r.user.displayName} size={36} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.user.displayName}</p>
                    <p className="text-xs text-zinc-500">由 {r.invitedBy.displayName} 邀请</p>
                  </div>
                </div>
                {group.isOwner ? (
                  <JoinRequestActions groupId={id} requestId={r.id} />
                ) : (
                  <CancelJoinRequestButton groupId={id} requestId={r.id} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">
          成员 <span className="text-sm text-zinc-500">({group.members.length})</span>
        </h2>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="成员列表">
          {group.members.map(({ user: m, joinedAt }) => {
            const isOwner = m.id === group.ownerId;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={m.avatarUrl} name={m.displayName} size={36} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {m.displayName}
                      {isOwner && (
                        <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          群主
                        </span>
                      )}
                      {m.id === user.id && <span className="text-xs text-zinc-500">（我）</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {joinedAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 加入
                    </p>
                    <PresenceBadge presence={presence[m.id]} />
                  </div>
                </div>
                {group.isOwner && !isOwner && (
                  <MemberOwnerActions groupId={id} memberId={m.id} name={m.displayName} />
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">开黑签到</h2>
        <CheckInCard
          groupId={id}
          games={library.map((e) => ({ id: e.game.id, name: e.game.name }))}
          current={
            checkIn
              ? { gameId: checkIn.game.id, name: checkIn.game.name, since: checkIn.startedAt }
              : null
          }
        />
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">最近一起玩</h2>
        <TogetherList
          groupId={id}
          items={together}
          empty="近 30 天还没有检测到群成员一起玩。两人以上同时玩同一个游戏 5 分钟以上会记录在这里。"
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">邀请好友入群</h2>
        <InviteFriendsForm groupId={id} friends={friends} isOwner={group.isOwner} />
      </Card>

      {group.isOwner && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">群设置</h2>
          <GroupInfoForm groupId={id} name={group.name} description={group.description} />
        </Card>
      )}

      {group.isOwner ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Discord 频道通知</h2>
          <DiscordChannelForm
            groupId={id}
            current={
              group.discordChannelId
                ? { id: group.discordChannelId, label: group.discordChannelLabel ?? "已连接的频道" }
                : null
            }
            options={channels && "options" in channels ? channels.options : null}
            unavailable={channels && "error" in channels ? channels.error : undefined}
            last={lastPost}
          />
        </Card>
      ) : (
        group.discordChannelLabel && (
          <p className="text-xs text-zinc-500">
            本群的投票通知会发到 Discord 频道 {group.discordChannelLabel}。
          </p>
        )
      )}

      <div className="flex justify-end">
        {group.isOwner ? (
          group.members.length > 1 ? (
            <p className="text-xs text-zinc-500">
              群主退群前需先把群主转让给其他成员。也可以
              <DissolveGroupButton groupId={id} name={group.name} />
            </p>
          ) : (
            <DissolveGroupButton groupId={id} name={group.name} />
          )
        ) : (
          <LeaveGroupButton groupId={id} />
        )}
      </div>
    </div>
  );
}
