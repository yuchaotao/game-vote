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
import { Avatar, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { getGroupForMember, invitableFriends } from "@/lib/groups/service";

export default async function GroupMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [group, friends] = await Promise.all([
    getGroupForMember(id, user.id),
    invitableFriends(id, user.id),
  ]);
  if (!group) notFound();

  const visibleRequests = group.isOwner
    ? group.joinRequests
    : group.joinRequests.filter((r) => r.invitedById === user.id);

  return (
    <div className="space-y-6">
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
        <h2 className="text-lg font-semibold">邀请好友入群</h2>
        <InviteFriendsForm groupId={id} friends={friends} isOwner={group.isOwner} />
      </Card>

      {group.isOwner && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">群设置</h2>
          <GroupInfoForm groupId={id} name={group.name} description={group.description} />
        </Card>
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
