import { db } from "@/lib/db";
import { isActiveMember, latestActiveGroupId } from "@/lib/groups/service";
import { groupOf, isGroupTab, rememberable } from "./rules";
import { LocalizedError } from "@/lib/i18n";

/**
 * Where "/" sends a signed-in user: their chosen home page, else the last page
 * visited on this device, else the most active group's chat. Pages of groups
 * they have left are skipped. Null means they have no group yet.
 */
export async function homeTarget(
  userId: string,
  homePath: string | null,
  lastPath: string | undefined,
): Promise<string | null> {
  for (const path of [homePath, lastPath]) {
    if (!path || !rememberable(path)) continue;
    const group = groupOf(path);
    if (!group || (await isActiveMember(group, userId))) return path;
  }
  const groupId = await latestActiveGroupId(userId);
  return groupId ? `/groups/${groupId}/chat` : null;
}

export class HomePageError extends LocalizedError {}

/** Sets the default home page: a tab of one of the user's groups, or null for the last visited. */
export async function setHomePath(userId: string, path: string | null) {
  if (path !== null) {
    const group = groupOf(path);
    if (!isGroupTab(path) || !group) throw new HomePageError("无效的首页");
    if (!(await isActiveMember(group, userId))) throw new HomePageError("你已不在这个群里");
  }
  await db.user.update({ where: { id: userId }, data: { homePath: path } });
}
