import { notFound } from "next/navigation";
import { ChatPanel } from "@/components/chat";
import { requireUser } from "@/lib/auth/session";
import { listMessages } from "@/lib/chat/service";
import { getGroupForMember } from "@/lib/groups/service";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("聊天")} · Game Vote` };
}

export default async function GroupChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const group = await getGroupForMember(id, user.id);
  if (!group) notFound();
  const { messages, hasMore } = await listMessages(id);

  return (
    <ChatPanel
      groupId={id}
      meId={user.id}
      meName={user.displayName}
      memberNames={group.members.map((m) => m.user.displayName)}
      initial={messages}
      initialHasMore={hasMore}
    />
  );
}
