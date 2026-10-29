import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { latestLink } from "./mail";
import { groupOfTwo, newUser, type User } from "./social";

// Email goes to Mailpit, Discord DMs to e2e/steam-mock.mjs; the send job runs on demand.

test.describe.configure({ timeout: 120_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const mockUrl = process.env.STEAM_API_URL!;

function sendNotifications() {
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", "send-notifications"], {
    env: process.env,
    stdio: "pipe",
  });
}

const usernameOf = (u: User) => u.code.split("#")[0];
const userIdOf = async (u: User) =>
  (await db.user.findUniqueOrThrow({ where: { username: usernameOf(u) } })).id;

async function verifyEmail(u: User) {
  await db.user.update({ where: { id: await userIdOf(u) }, data: { emailVerifiedAt: new Date() } });
  return `${usernameOf(u)}@example.test`;
}

/** Links a Discord account; ids starting with 999 can't be DMed (see the mock). */
async function linkDiscord(u: User, prefix = "") {
  const id = `${prefix}${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  await db.account.create({
    data: { userId: await userIdOf(u), provider: "discord", providerAccountId: id },
  });
  return id;
}

async function dmsTo(discordId: string) {
  const res = await fetch(`${mockUrl}/mock/discord/messages?recipient=${discordId}`);
  return (await res.json()) as { embeds: { title: string; url: string }[] }[];
}

async function sendFriendRequest(from: User, to: User) {
  await from.page.goto("/friends");
  await from.page.getByLabel("好友码").fill(to.code);
  await from.page.getByRole("button", { name: "发送申请" }).click();
  await expect(mainStatus(from.page)).toBeVisible();
}

test("preferences start from the defaults and can be changed", async ({ browser }) => {
  const u = await newUser(browser);
  await u.page.goto("/settings");
  const box = (name: string) => u.page.getByRole("checkbox", { name, exact: true });
  await expect(box("好友申请 · 邮件")).toBeChecked();
  await expect(box("新投票 · Discord 私信")).toBeChecked();
  await expect(box("新投票 · 邮件")).not.toBeChecked();
  await expect(u.page.getByText("邮件：验证邮箱后才会发送邮件。")).toBeVisible();

  await box("新投票 · 邮件").check();
  await box("好友申请 · Discord 私信").uncheck();
  await u.page.getByRole("button", { name: "保存通知设置" }).click();
  await expect(u.page.getByText("通知设置已保存")).toBeVisible();

  await u.page.reload();
  await expect(box("新投票 · 邮件")).toBeChecked();
  await expect(box("好友申请 · Discord 私信")).not.toBeChecked();
});

test("a friend request is emailed, and shows in the recipient's history", async ({ browser }) => {
  const [a, b] = [await newUser(browser), await newUser(browser)];
  const email = await verifyEmail(b);
  await sendFriendRequest(a, b);
  sendNotifications();

  const link = await latestLink(email, `${a.name} 想加你为好友`);
  expect(link).toMatch(/\/friends$/);
  await b.page.goto("/settings");
  const history = b.page.getByRole("region", { name: "最近的通知" });
  await expect(history).toContainText(`${a.name} 想加你为好友`);
  await expect(history).toContainText("已发送");
});

test("a new round is sent to the other members over Discord", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const [ownerDiscord, friendDiscord] = [await linkDiscord(owner), await linkDiscord(friend)];

  await owner.page.goto(`${path}/votes`);
  await owner.page.getByLabel("匿名投票").uncheck();
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  sendNotifications();

  const [dm] = await dmsTo(friendDiscord);
  expect(dm.embeds[0].title).toContain("发起了第 1 轮投票");
  expect(dm.embeds[0].url).toBe(`http://localhost:3000${new URL(owner.page.url()).pathname}`);
  // The starter isn't told about their own round.
  expect(await dmsTo(ownerDiscord)).toHaveLength(0);
});

test("a Discord user the bot can't reach is a permanent failure", async ({ browser }) => {
  const [a, b] = [await newUser(browser), await newUser(browser)];
  await linkDiscord(b, "999");
  await sendFriendRequest(a, b);
  sendNotifications();

  await b.page.goto("/settings");
  const history = b.page.getByRole("region", { name: "最近的通知" });
  await expect(history).toContainText("发送失败");
  await expect(history).toContainText("需要和机器人在同一个 Discord 服务器");
});

async function channelMessages(channelId: string) {
  const res = await fetch(`${mockUrl}/mock/discord/messages?channel=${channelId}`);
  return (await res.json()) as {
    content?: string;
    embeds?: { title: string }[];
    allowed_mentions?: { users: string[] };
  }[];
}

test("with a Discord channel linked, group events go there and @mention members", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const friendDiscord = await linkDiscord(friend);

  // The owner picks a channel; one the bot can't write in is refused.
  await owner.page.goto(path);
  const picker = owner.page.getByLabel("Discord 频道");
  await expect(picker.locator("option")).toHaveText([
    "不发到频道（成员各自收私信）",
    "测试服务器 · #general",
    "测试服务器 · #只读公告",
  ]);
  await picker.selectOption({ label: "测试服务器 · #只读公告" });
  await owner.page.getByRole("button", { name: "保存频道" }).click();
  await expect(owner.page.getByRole("main").getByRole("alert")).toContainText("没有发言权限");

  await picker.selectOption({ label: "测试服务器 · #general" });
  await owner.page.getByRole("button", { name: "保存频道" }).click();
  await expect(owner.page.getByText("已连接 Discord 频道")).toBeVisible();
  const before = (await channelMessages("100")).length;
  expect((await channelMessages("100")).at(-1)?.content).toContain("已连接 Game Vote 群");

  // A new round: one channel post mentioning the friend, and no DM.
  await owner.page.goto(`${path}/votes`);
  await owner.page.getByLabel("匿名投票").uncheck();
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  sendNotifications();

  const posts = (await channelMessages("100")).slice(before);
  expect(posts).toHaveLength(1);
  expect(posts[0].content).toBe(`<@${friendDiscord}>`);
  expect(posts[0].allowed_mentions?.users).toEqual([friendDiscord]);
  // The post is the round's live vote message (#47).
  expect(posts[0].embeds?.[0].title).toContain("第 1 轮投票");
  expect(await dmsTo(friendDiscord)).toHaveLength(0);

  // The owner sees it went out; members see where notifications go.
  await owner.page.goto(path);
  await expect(owner.page.getByText(/最近一条：.*发起了第 1 轮投票/)).toContainText("已发送");
  await friend.page.goto(path);
  await expect(
    friend.page.getByText("本群的投票通知会发到 Discord 频道 测试服务器 · #general"),
  ).toBeVisible();
});
