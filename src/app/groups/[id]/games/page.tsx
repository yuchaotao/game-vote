import { notFound } from "next/navigation";
import { AddGamePanel, GameLibrary } from "@/components/games";
import { requireUser } from "@/lib/auth/session";
import { igdbEnabled, listLibrary } from "@/lib/games/service";
import { isActiveMember } from "@/lib/groups/service";

export const metadata = { title: "游戏库 · Game Vote" };

export default async function GroupGamesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await isActiveMember(id, user.id))) notFound();
  const entries = await listLibrary(id);

  return (
    <div className="space-y-6">
      <AddGamePanel groupId={id} igdb={igdbEnabled()} />
      <GameLibrary groupId={id} entries={entries} />
    </div>
  );
}
