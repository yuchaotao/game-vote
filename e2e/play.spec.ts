import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo, type User } from "./social";

// Steam status comes from e2e/steam-mock.mjs; the worker's poll is run on demand.

test.describe.configure({ timeout: 180_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const mockUrl = process.env.STEAM_API_URL!;
const APEX = { gameid: "1172470", gameextrainfo: "Apex Legends™" };

function runJob(name: string) {
  // A dummy key: requests only ever go to the mock.
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", name], {
    env: { ...process.env, STEAM_API_KEY: "e2e-test-key" },
    stdio: "pipe",
  });
}

async function setSteam(players: Record<string, object>) {
  const res = await fetch(`${mockUrl}/mock/players`, {
    method: "POST",
    body: JSON.stringify(players),
  });
  expect(res.ok).toBe(true);
}

async function userIdOf(u: User) {
  const user = await db.user.findUniqueOrThrow({ where: { username: u.code.split("#")[0] } });
  return user.id;
}

/** Links a fake Steam account and returns its SteamID. */
async function linkSteam(u: User) {
  const steamId = `7656119${Math.floor(Math.random() * 1e10)
    .toString()
    .padStart(10, "0")}`;
  await db.account.create({
    data: { userId: await userIdOf(u), provider: "steam", providerAccountId: steamId },
  });
  return steamId;
}

async function addApex(page: Page, path: string) {
  await page.goto(`${path}/games`);
  await page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" }).fill("apex");
  await page.getByRole("button", { name: "查找" }).click();
  await page.getByRole("button", { name: "添加 Apex Legends™" }).click();
  await expect(mainStatus(page)).toContainText("已添加");
}

const memberList = (page: Page) => page.getByRole("list", { name: "成员列表" });
const together = (page: Page) => page.getByRole("list", { name: "一起玩的记录" });

test("Steam detection: live status, then a together session on the timeline", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await addApex(owner.page, path);
  const [a, b] = [await linkSteam(owner), await linkSteam(friend)];

  await setSteam({ [a]: { ...APEX, personastate: 1 }, [b]: { ...APEX, personastate: 1 } });
  runJob("poll-presence");

  await owner.page.goto(path);
  await expect(memberList(owner.page).getByText("正在玩《Apex Legends™》")).toHaveCount(2);

  // Pretend they started 40 minutes ago, then both quit.
  const ids = [await userIdOf(owner), await userIdOf(friend)];
  await db.playSession.updateMany({
    where: { userId: { in: ids }, endedAt: null },
    // Half a minute extra so the rounded-down duration still reads 40 minutes.
    data: { startedAt: new Date(Date.now() - 40.5 * 60_000) },
  });
  await setSteam({
    [a]: { gameid: undefined, personastate: 1 },
    [b]: { gameid: undefined, personastate: 0 },
  });
  runJob("poll-presence");

  await owner.page.reload();
  await expect(memberList(owner.page).getByText("正在玩")).toHaveCount(0);
  await expect(memberList(owner.page).getByText("Steam 在线")).toHaveCount(1);
  const recent = together(owner.page).getByRole("listitem");
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText("Apex Legends™");
  await expect(recent).toContainText("40 分钟");
  await expect(recent).toContainText(owner.name);
  await expect(recent).toContainText(friend.name);

  await recent.getByRole("link").click();
  await expect(owner.page).toHaveURL(/\/games\/\w+$/, { timeout: 30_000 });
  await expect(together(owner.page)).toContainText("40 分钟");
  const totals = owner.page.getByRole("list", { name: "成员游玩时长" });
  await expect(totals.getByRole("listitem")).toHaveCount(2);
  await expect(totals).toContainText("40 分钟");
});

test("manual check-in shows to the group and can be ended", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await addApex(owner.page, path);

  await friend.page.goto(path);
  await friend.page.getByLabel("签到的游戏").selectOption({ label: "Apex Legends™" });
  await friend.page.getByRole("button", { name: "我在玩" }).click();
  await expect(mainStatus(friend.page)).toContainText("已签到：正在玩《Apex Legends™》");
  await expect(friend.page.getByText("你正在玩《Apex Legends™》")).toBeVisible();

  await owner.page.goto(path);
  await expect(memberList(owner.page).getByText("正在玩《Apex Legends™》（签到）")).toBeVisible();
  await owner.page.goto("/friends");
  await expect(owner.page.getByText("正在玩《Apex Legends™》（签到）")).toBeVisible();
  await owner.page.goto(`${path}/chat`);
  await expect(owner.page.getByText(`${friend.name} 签到：正在玩《Apex Legends™》`)).toBeVisible();

  await friend.page.getByRole("button", { name: "结束签到" }).click();
  await expect(mainStatus(friend.page)).toContainText("已结束签到");
  await owner.page.goto(path);
  await expect(memberList(owner.page).getByText("正在玩")).toHaveCount(0);
});

test("settings explains when Steam can't see your games; names follow Steam", async ({
  browser,
}) => {
  const { owner, friend } = await groupOfTwo(browser);
  const [a, b] = [await linkSteam(owner), await linkSteam(friend)];
  await setSteam({
    [a]: { personastate: 1, communityvisibilitystate: 1 },
    [b]: { ...APEX, personastate: 1, personaname: "Steam上的名字" },
  });
  runJob("poll-presence");

  await owner.page.goto("/settings");
  await expect(owner.page.getByRole("main")).toContainText("Steam 资料不是公开的");
  await friend.page.goto("/settings");
  await expect(friend.page.getByRole("main")).toContainText("最近检测到：《Apex Legends™》");
  // The linked account shows the current Steam name; the custom site name is kept.
  await expect(friend.page.getByRole("main")).toContainText("· Steam上的名字");
  await expect(friend.page.getByRole("heading", { level: 1, name: friend.name })).toBeVisible();
});
