import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { groupOfTwo, newUser } from "./social";

test.describe.configure({ timeout: 180_000 });

const log = (page: Page) => page.getByRole("log", { name: "消息" });
const composer = (page: Page) => page.getByRole("textbox", { name: "输入消息" });

async function openChat(page: Page, groupPath: string) {
  await page.goto(`${groupPath}/chat`);
  await expect(page.getByText("实时", { exact: true })).toBeVisible();
}

async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("");
}

test("messages arrive live for other members and persist", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await openChat(owner.page, path);
  await openChat(friend.page, path);

  // System messages from group setup are part of the history.
  await expect(log(friend.page).getByText(`${owner.name} 创建了群`)).toBeVisible();
  await expect(
    log(friend.page).getByText(`${owner.name} 邀请 ${friend.name} 加入了群`),
  ).toBeVisible();

  await say(owner.page, "今晚 9 点开黑？");
  // Delivered over SSE: no reload on the friend's side.
  await expect(log(friend.page).getByText("今晚 9 点开黑？")).toBeVisible();

  await say(friend.page, `@${owner.name} 可以！看看这个 https://store.steampowered.com/app/730/`);
  const reply = log(owner.page)
    .getByRole("article", { name: new RegExp(friend.name) })
    .last();
  await expect(reply.getByText(`@${owner.name}`)).toBeVisible();
  const link = reply.getByRole("link", { name: "https://store.steampowered.com/app/730/" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // Shift+Enter makes a newline instead of sending.
  await composer(owner.page).fill("第一行");
  await composer(owner.page).press("Shift+Enter");
  await composer(owner.page).pressSequentially("第二行");
  await expect(composer(owner.page)).toHaveValue("第一行\n第二行");
  await composer(owner.page).press("Enter");
  await expect(log(friend.page).getByText(/第一行\s*第二行/)).toBeVisible();

  // Everything is still there after logging back in / reloading.
  await friend.page.reload();
  await expect(log(friend.page).getByText("今晚 9 点开黑？")).toBeVisible();
  await expect(log(friend.page).getByText(/第一行\s*第二行/)).toBeVisible();
});

test("unread counts show on the group list and tab, and clear when read", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await openChat(owner.page, path);
  await friend.page.goto("/groups");

  await say(owner.page, "有人吗");
  await say(owner.page, "上线了");

  await friend.page.reload();
  await expect(friend.page.getByText("2 条未读")).toBeVisible();
  await friend.page.goto(path);
  await expect(friend.page.getByLabel("2 条未读消息")).toBeVisible();

  await openChat(friend.page, path);
  await expect(log(friend.page).getByText("上线了")).toBeVisible();
  await expect
    .poll(async () => {
      await friend.page.goto("/groups");
      return friend.page.getByText(/条未读/).count();
    })
    .toBe(0);
});

test("older history loads on demand without gaps", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  const groupId = path.split("/").pop()!;

  // Seed 120 messages directly (sending through the UI is rate limited).
  const db = new PrismaClient();
  try {
    const { ownerId: authorId } = await db.group.findUniqueOrThrow({ where: { id: groupId } });
    const base = Date.now() - 3600_000;
    await db.chatMessage.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        groupId,
        authorId,
        body: `历史消息 #${i + 1}`,
        // Pairs share a timestamp to exercise the (createdAt, id) cursor.
        createdAt: new Date(base + Math.floor(i / 2) * 1000),
      })),
    });
  } finally {
    await db.$disconnect();
  }

  // Page size 50: the 2 setup system messages + seeded #73–#120 load first.
  await openChat(owner.page, path);
  await expect(log(owner.page).getByText("历史消息 #120", { exact: true })).toBeVisible();
  await expect(log(owner.page).getByText("历史消息 #73", { exact: true })).toBeAttached();
  await expect(log(owner.page).getByText("历史消息 #72", { exact: true })).toHaveCount(0);

  await owner.page.getByRole("button", { name: "加载更早的消息" }).click();
  await expect(log(owner.page).getByText("历史消息 #23", { exact: true })).toBeAttached();
  await expect(log(owner.page).getByText("历史消息 #22", { exact: true })).toHaveCount(0);
  await owner.page.getByRole("button", { name: "加载更早的消息" }).click();
  await expect(log(owner.page).getByText("已经到最早的消息了")).toBeVisible();

  // Every seeded message appears exactly once.
  const bodies = await log(owner.page)
    .getByText(/^历史消息 #\d+$/)
    .allTextContents();
  expect(bodies).toHaveLength(120);
  expect(new Set(bodies).size).toBe(120);
});

test("only members can read or stream a group's chat", async ({ browser }) => {
  const { path } = await groupOfTwo(browser);
  const groupId = path.split("/").pop()!;
  const stranger = await newUser(browser);

  await stranger.page.goto(`${path}/chat`);
  await expect(stranger.page.getByText("404")).toBeVisible();
  const res = await stranger.page.request.get(`/api/groups/${groupId}/events`);
  expect(res.status()).toBe(403);

  const anon = await browser.newPage();
  expect((await anon.request.get(`/api/groups/${groupId}/events`)).status()).toBe(401);
});
