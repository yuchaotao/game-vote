import { PermanentDeliveryError } from "./rules";

// Discord bot direct messages over the REST API (no gateway connection needed).
// Discord only lets a bot DM users who share a server with it.

// https://discord.com/developers/docs/topics/opcodes-and-status-codes#json
const CANNOT_DM = 50007;
const UNKNOWN_USER = 10013;

export async function sendDiscordDm(
  opts: { apiUrl: string; token: string },
  recipientId: string,
  payload: object,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const call = async (path: string, body: object) => {
    const res = await fetchImpl(`${opts.apiUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bot ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return (await res.json()) as { id: string };
    const err = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    if (err.code === CANNOT_DM) {
      throw new PermanentDeliveryError(
        "无法私信：需要和机器人在同一个 Discord 服务器，并允许服务器成员私信",
      );
    }
    if (err.code === UNKNOWN_USER) throw new PermanentDeliveryError("Discord 用户不存在");
    if (res.status === 401) throw new PermanentDeliveryError("Discord 机器人令牌无效");
    // 429 (rate limited) and 5xx are worth retrying.
    throw new Error(`Discord ${res.status}${err.message ? `: ${err.message}` : ""}`);
  };

  const channel = await call("/users/@me/channels", { recipient_id: recipientId });
  await call(`/channels/${channel.id}/messages`, payload);
}
