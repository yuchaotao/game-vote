import { createPublicKey, verify } from "node:crypto";
import { PermanentDeliveryError } from "./rules";
import { msg } from "@/lib/i18n";

// The Discord bot over the REST API (no gateway connection needed): direct
// messages, channel posts, and the text channels it can see.
// Discord only lets a bot DM users who share a server with it.

type BotOptions = { apiUrl: string; token: string };

// https://discord.com/developers/docs/topics/opcodes-and-status-codes#json
const PERMANENT: Record<number, string> = {
  50007: msg("无法私信：需要和机器人在同一个 Discord 服务器，并允许服务器成员私信"),
  10013: msg("Discord 用户不存在"),
  10003: msg("Discord 频道不存在（可能已删除）"),
  50001: msg("机器人看不到这个频道"),
  50013: msg("机器人在这个频道没有发言权限"),
};

async function discord<T>(
  opts: BotOptions,
  method: "GET" | "POST" | "PATCH",
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
  if (res.status === 401) throw new PermanentDeliveryError(msg("Discord 机器人令牌无效"));
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
): Promise<{ id: string }> {
  return discord(opts, "POST", `/channels/${channelId}/messages`, payload, fetchImpl);
}

export async function editMessage(
  opts: BotOptions,
  channelId: string,
  messageId: string,
  payload: object,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await discord(opts, "PATCH", `/channels/${channelId}/messages/${messageId}`, payload, fetchImpl);
}

/** The application's Ed25519 public key (hex), for checking interaction signatures. */
export async function applicationPublicKey(
  opts: BotOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const app = await discord<{ verify_key: string }>(
    opts,
    "GET",
    "/applications/@me",
    undefined,
    fetchImpl,
  );
  return app.verify_key;
}

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Checks Discord's X-Signature-Ed25519 over timestamp + body. */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(timestamp + body), key, signature);
  } catch {
    return false;
  }
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
