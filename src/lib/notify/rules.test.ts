import { describe, expect, it, vi } from "vitest";
import { sendDiscordDm } from "./discord-bot";
import {
  discordPayload,
  effectivePreferences,
  MAX_ATTEMPTS,
  PermanentDeliveryError,
  renderEmail,
  retryDelay,
} from "./rules";

describe("effectivePreferences", () => {
  it("uses the defaults: requests by email and Discord, vote news only on Discord", () => {
    const p = effectivePreferences([]);
    expect(p["FRIEND_REQUEST:EMAIL"]).toBe(true);
    expect(p["JOIN_REQUEST:DISCORD"]).toBe(true);
    expect(p["NEW_ROUND:EMAIL"]).toBe(false);
    expect(p["VOTE_PROMPT:DISCORD"]).toBe(true);
  });

  it("stored choices win over defaults", () => {
    const p = effectivePreferences([
      { event: "NEW_ROUND", channel: "EMAIL", enabled: true },
      { event: "FRIEND_REQUEST", channel: "DISCORD", enabled: false },
    ]);
    expect(p["NEW_ROUND:EMAIL"]).toBe(true);
    expect(p["FRIEND_REQUEST:DISCORD"]).toBe(false);
    expect(p["FRIEND_REQUEST:EMAIL"]).toBe(true);
  });
});

describe("retryDelay", () => {
  it("backs off and stays at the longest delay", () => {
    expect(retryDelay(1)).toBe(60_000);
    expect(retryDelay(2)).toBe(5 * 60_000);
    expect(retryDelay(MAX_ATTEMPTS)).toBe(2 * 60 * 60_000);
    expect(retryDelay(10)).toBe(2 * 60 * 60_000);
  });
});

describe("renderEmail", () => {
  const m = {
    title: "<b>小明</b> 想加你为好友",
    body: "a & b",
    url: "https://x.test/friends?a=1&b=2",
  };

  it("escapes user text in the HTML part", () => {
    const { subject, html, text } = renderEmail(m, "https://x.test/settings");
    expect(subject).toBe("Game Vote：<b>小明</b> 想加你为好友");
    expect(html).toContain("&#60;b&#62;小明&#60;/b&#62;");
    expect(html).not.toContain("<b>小明");
    expect(html).toContain('href="https://x.test/friends?a=1&#38;b=2"');
    expect(text).toContain("https://x.test/friends?a=1&b=2");
    expect(text).toContain("https://x.test/settings");
  });

  it("Discord embeds link back to the page", () => {
    expect(discordPayload(m).embeds[0]).toMatchObject({ title: m.title, url: m.url });
  });
});

describe("sendDiscordDm", () => {
  const opts = { apiUrl: "https://discord.test/api", token: "t" };
  const reply = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("opens a DM channel, then posts the message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { id: "dm1" }))
      .mockResolvedValueOnce(reply(200, { id: "m1" }));
    await sendDiscordDm(opts, "42", { content: "hi" }, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://discord.test/api/users/@me/channels");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ recipient_id: "42" });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bot t");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://discord.test/api/channels/dm1/messages");
  });

  it("can't-DM is permanent; rate limits are retried", async () => {
    await expect(
      sendDiscordDm(opts, "42", {}, vi.fn().mockResolvedValue(reply(403, { code: 50007 }))),
    ).rejects.toBeInstanceOf(PermanentDeliveryError);
    const limited = sendDiscordDm(opts, "42", {}, vi.fn().mockResolvedValue(reply(429, {})));
    await expect(limited).rejects.toThrow("Discord 429");
    await expect(limited).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });
});
