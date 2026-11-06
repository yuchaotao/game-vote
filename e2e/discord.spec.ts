import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo, type User } from "./social";

// Voting from Discord buttons (#47). Discord's side is e2e/steam-mock.mjs; clicks
// are posted to the interactions endpoint signed with a test-only key whose
// public half is DISCORD_PUBLIC_KEY in playwright.config.ts.

test.describe.configure({ timeout: 180_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const mockUrl = process.env.STEAM_API_URL!;
const TEST_KEY = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBfMAeeW/JE+VX9c8I3gY2Z+hS16s4/Md+JgOgW4uo9Q
-----END PRIVATE KEY-----`);

function runJob(name: string, data?: object) {
  execFileSync(
    "npx",
    ["tsx", "src/worker/run-once.ts", name, ...(data ? [JSON.stringify(data)] : [])],
    { env: process.env, stdio: "pipe" },
  );
}

async function interact(body: object, signWith = TEST_KEY) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + raw), signWith).toString("hex");
  return fetch("http://localhost:3000/api/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body: raw,
  });
}

const click = async (discordId: string, customId: string) =>
  (await (
    await interact({ type: 3, member: { user: { id: discordId } }, data: { custom_id: customId } })
  ).json()) as { type: number; data: { content: string; flags: number } };

type Message = {
  id: string;
  content?: string;
  embeds: { title: string; description: string }[];
  components: { components: { label: string; custom_id?: string; url?: string }[] }[];
};

async function messages(channelId: string) {
  return (await (
    await fetch(`${mockUrl}/mock/discord/messages?channel=${channelId}`)
  ).json()) as Message[];
}

const userIdOf = async (u: User) =>
  (await db.user.findUniqueOrThrow({ where: { username: u.code.split("#")[0] } })).id;

async function linkDiscord(u: User) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await db.account.create({
    data: { userId: await userIdOf(u), provider: "discord", providerAccountId: id },
  });
  return id;
}

test("the endpoint checks Discord's signature and answers pings", async () => {
  const ping = await interact({ type: 1 });
  expect(await ping.json()).toEqual({ type: 1 });
  const other = createPrivateKey({
    key: Buffer.from("302e020100300506032b657004220420" + "11".repeat(32), "hex"),
    format: "der",
    type: "pkcs8",
  });
  expect((await interact({ type: 1 }, other)).status).toBe(401);
});

test("vote from the live Discord message; it follows changes from either side", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const groupId = path.split("/").pop()!;
  const friendDiscord = await linkDiscord(friend);
  await db.group.update({
    where: { id: groupId },
    data: { discordChannelId: "100", discordChannelLabel: "测试服务器 · #general" },
  });

  // A round with one candidate.
  await owner.page.goto(`${path}/games`);
  await owner.page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" }).fill("apex");
  await owner.page.getByRole("button", { name: "查找" }).click();
  await owner.page.getByRole("button", { name: "添加 Apex Legends™" }).click();
  await expect(mainStatus(owner.page)).toBeVisible();
  await owner.page.goto(`${path}/votes`);
  await owner.page.getByLabel("匿名投票").uncheck();
  await owner.page.getByLabel("同一个游戏可以投多票").uncheck();
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  const roundId = owner.page.url().split("/").pop()!;
  await owner.page.getByRole("button", { name: "加入候选" }).click();
  await expect(owner.page.getByRole("list", { name: "候选游戏" })).toContainText("Apex Legends™");

  // The round's channel post is the live message, with a button per candidate.
  runJob("send-notifications");
  const post = (await messages("100"))
    .filter((m) => m.embeds[0]?.title.includes("第 1 轮投票"))
    .at(-1)!;
  expect(post.content).toBe(`<@${friendDiscord}>`);
  const button = post.components[0].components[0];
  expect(button.label).toBe("Apex Legends™ · 0");
  const round = await db.voteRound.findUniqueOrThrow({ where: { id: roundId } });
  expect(round.discordMessageId).toBe(post.id);

  // The friend votes in Discord; only they see the reply; the message updates.
  const reply = await click(friendDiscord, button.custom_id!);
  expect(reply.data).toMatchObject({
    flags: 64,
    content: "✅ 已投给《Apex Legends™》（还剩 1 / 2 票）",
  });
  runJob("sync-discord-round", { roundId });
  const live = async () => (await messages("100")).find((m) => m.id === post.id)!;
  expect((await live()).components[0].components[0].label).toBe("Apex Legends™ · 1");
  await friend.page.goto(`${path}/votes/${roundId}`);
  await expect(friend.page.getByRole("button", { name: "取消投票 Apex Legends™" })).toBeVisible();

  // A second click takes the vote back.
  expect((await click(friendDiscord, button.custom_id!)).data.content).toContain("已取消");

  // Ending the round on the website freezes the message with the result.
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByText("管理投票", { exact: true }).click();
  await owner.page.getByRole("button", { name: "仅结束投票" }).click();
  await expect(owner.page.getByText("已结束", { exact: true })).toBeVisible();
  runJob("sync-discord-round", { roundId });
  const ended = await live();
  expect(ended.embeds[0].title).toContain("已结束");
  expect(ended.components).toHaveLength(1); // only the link to the site
  expect((await click(friendDiscord, button.custom_id!)).data.content).toContain("已经结束");

  // Someone without a linked account, or not in the group, is told so privately.
  expect((await click("424242", button.custom_id!)).data).toMatchObject({ flags: 64 });
  expect((await click("424242", button.custom_id!)).data.content).toContain("还没有绑定");
});
