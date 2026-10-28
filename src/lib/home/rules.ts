// Where the home page sends a signed-in user (#41). Pure: shared by the
// browser (remembering pages) and the server (redirecting).

/** Per-device cookie holding the last page worth returning to. */
export const LAST_PAGE_COOKIE = "gv_last";

/** A group's tabs, in display order. */
export const GROUP_TABS = [
  { label: "成员", path: "" },
  { label: "聊天", path: "/chat" },
  { label: "游戏库", path: "/games" },
  { label: "投票", path: "/votes" },
] as const;

// Group list, friends, and anything inside a group (a game, a round). Not
// settings, sign-in, invites and other one-off pages.
const REMEMBER = [
  /^\/groups$/,
  /^\/friends$/,
  /^\/groups\/[\w-]+(\/(chat|games|votes)(\/[\w-]+)?)?$/,
];

export function rememberable(path: string): boolean {
  return REMEMBER.some((r) => r.test(path));
}

/** The group a page belongs to, if any. */
export function groupOf(path: string): string | null {
  return /^\/groups\/([\w-]+)/.exec(path)?.[1] ?? null;
}

/** A default home page must be one of a group's tabs. */
export function isGroupTab(path: string): boolean {
  const group = groupOf(path);
  return group !== null && GROUP_TABS.some((t) => path === `/groups/${group}${t.path}`);
}
