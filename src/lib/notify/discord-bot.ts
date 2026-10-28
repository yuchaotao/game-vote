import { PermanentDeliveryError } from "./rules";

// The Discord bot over the REST API (no gateway connection needed): direct
// messages, channel posts, and the text channels it can see.
// Discord only lets a bot DM users who share a server with it.

type BotOptions = { apiUrl: string; token: string };

// https://discord.com/developers/docs/topics/opcodes-and-status-codes#json
const PERMANENT: Record<number, string> = {
  50007: "无法私信：需要和机器人在同一个 Discord 服务器，并允许服务器成员私信",
  10013: "Discord 用户不存在",
  10003: "Discord 频道不存在（可能已删除）",
  50001: "机器人看不到这个频道",
  50013: "机器人在这个频道没有发言权限",
};

async function discord<T>(
  opts: BotOptions,
  method: "GET" | "POST",
  path: string,
  body: object | undefined,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(`${opts.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bot ${opts.token}`,
      ...(body && { "content-type": "application/json" }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return (await res.json()) as T;
  const err = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  const permanent = err.code !== undefined ? PERMANENT[err.code] : undefined;
  if (permanent) throw new PermanentDeliveryError(permanent);
  if (res.status === 401) throw new PermanentDeliveryError("Discord 机器人令牌无效");
  // 429 (rate limited) and 5xx are worth retrying.
  throw new Error(`Discord ${res.status}${err.message ? `: ${err.message}` : ""}`);
}

export async function sendDiscordDm(
  opts: BotOptions,
  recipientId: string,
  payload: object,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const channel = await discord<{ id: string }>(
    opts,
    "POST",
    "/users/@me/channels",
    { recipient_id: recipientId },
    fetchImpl,
  );
  await discord(opts, "POST", `/channels/${channel.id}/messages`, payload, fetchImpl);
}

export async function postToChannel(
  opts: BotOptions,
  channelId: string,
  payload: object,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await discord(opts, "POST", `/channels/${channelId}/messages`, payload, fetchImpl);
}

export type TextChannel = { id: string; name: string; server: string };

const TEXT = 0;
const ANNOUNCEMENT = 5;

/** Text channels in every server the bot has joined, by server then position. */
export async function listTextChannels(
  opts: BotOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<TextChannel[]> {
  const guilds = await discord<{ id: string; name: string }[]>(
    opts,
    "GET",
    "/users/@me/guilds",
    undefined,
    fetchImpl,
  );
  const perGuild = await Promise.all(
    guilds.map(async (g) => {
      const channels = await discord<
        { id: string; name: string; type: number; position: number }[]
      >(opts, "GET", `/guilds/${g.id}/channels`, undefined, fetchImpl);
      return channels
        .filter((c) => c.type === TEXT || c.type === ANNOUNCEMENT)
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, server: g.name }));
    }),
  );
  return perGuild.flat();
}
