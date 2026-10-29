import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo, type User } from "./social";

// Steam status from e2e/steam-mock.mjs; worker jobs run on demand.

test.describe.configure({ timeout: 240_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const mockUrl = process.env.STEAM_API_URL!;
const APEX = { gameid: "1172470", gameextrainfo: "Apex Legends™", personastate: 1 };

function runJob(name: string) {
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

const userIdOf = async (u: User) =>
  (await db.user.findUniqueOrThrow({ where: { username: u.code.split("#")[0] } })).id;

async function linkSteam(u: User) {
  const steamId = `7656119${Math.floor(Math.random() * 1e10)
    .toString()
    .padStart(10, "0")}`;
  await db.account.create({
    data: { userId: await userIdOf(u), provider: "steam", providerAccountId: steamId },
  });
  return steamId;
}

/** Group of two, Apex in the library and as the only candidate of an open round. */
async function setUp(browser: Parameters<typeof groupOfTwo>[0]) {
  const { owner, friend, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page.goto(`${path}/games`);
  await page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" }).fill("apex");
  await page.getByRole("button", { name: "查找" }).click();
  await page.getByRole("button", { name: "添加 Apex Legends™" }).click();
  await expect(mainStatus(page)).toBeVisible();
  await page.goto(`${path}/votes`);
  await page.getByLabel("匿名投票").uncheck();
  await page.getByRole("button", { name: "发起投票" }).click();
  await expect(page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "加入候选" }).click();
  await expect(page.getByRole("list", { name: "候选游戏" })).toContainText("Apex Legends™");
  const steam = [await linkSteam(owner), await linkSteam(friend)];
  return { owner, friend, path, steam, roundUrl: page.url() };
}

/** Both play Apex; pretend they started `minutes` ago. */
async function playTogether(steam: string[], users: User[], minutes: number) {
  await setSteam(Object.fromEntries(steam.map((s) => [s, APEX])));
  runJob("poll-presence");
  const ids = await Promise.all(users.map(userIdOf));
  await db.playSession.updateMany({
    where: { userId: { in: ids }, endedAt: null },
    data: { startedAt: new Date(Date.now() - minutes * 60_000) },
  });
  runJob("poll-presence");
}

const banner = (page: Page) => page.getByRole("region", { name: "新投票提示" });

test("no prompt before 20 minutes; continue dismisses it for this session", async ({ browser }) => {
  const { owner, friend, path, steam } = await setUp(browser);

  await playTogether(steam, [owner, friend], 15);
  runJob("check-prompts");
  await owner.page.goto(path);
  await expect(banner(owner.page)).toHaveCount(0);

  await playTogether(steam, [owner, friend], 25);
  runJob("check-prompts");
  await friend.page.goto(`${path}/chat`);
  // The banner shows on every group page, and chat explains it.
  await expect(banner(friend.page)).toContainText("2/2 名成员正在一起玩《Apex Legends™》");
  await expect(
    friend.page.getByText(/检测到 2\/2 名成员正在一起玩《Apex Legends™》/),
  ).toBeVisible();

  await banner(friend.page).getByRole("button", { name: "继续当前投票" }).click();
  await expect(banner(friend.page)).toHaveCount(0);
  await expect(friend.page.getByText(`${friend.name} 选择继续当前投票`)).toBeVisible();

  // Same session: no second prompt.
  runJob("check-prompts");
  await owner.page.goto(path);
  await expect(banner(owner.page)).toHaveCount(0);
  const groupId = path.split("/").pop()!;
  expect(await db.votePrompt.count({ where: { round: { groupId } } })).toBe(1);
});

test("end the vote and start the next round from the prompt", async ({ browser }) => {
  const { owner, friend, path, steam, roundUrl } = await setUp(browser);
  await friend.page.goto(roundUrl);
  await friend.page.getByRole("button", { name: "投票 Apex Legends™" }).click();
  await expect(friend.page.getByText("你还剩 2 / 3 票")).toBeVisible();

  await playTogether(steam, [owner, friend], 25);
  runJob("check-prompts");
  await owner.page.goto(`${path}/games`);
  await banner(owner.page).getByRole("button", { name: "结束投票并开启下一轮" }).click();
  await expect(owner.page.getByRole("heading", { name: "第 2 轮投票" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(banner(owner.page)).toHaveCount(0);

  await owner.page.goto(roundUrl);
  await expect(owner.page.getByText("胜出：")).toContainText("Apex Legends™");
  await expect(owner.page.getByText("检测到大家在一起玩")).toBeVisible();
});
