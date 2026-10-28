import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainAlert, mainStatus } from "./helpers";
import { groupOfTwo } from "./social";

// Steam requests go to e2e/steam-mock.mjs.

test.describe.configure({ timeout: 240_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const board = (page: Page) => page.getByRole("list", { name: "候选游戏" });
const candidate = (page: Page, name: string) =>
  board(page).getByRole("listitem").filter({ hasText: name });

async function addToLibrary(page: Page, path: string, query: string, name: string) {
  await page.goto(`${path}/games`);
  await page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" }).fill(query);
  await page.getByRole("button", { name: "查找" }).click();
  await page.getByRole("button", { name: `添加 ${name}` }).click();
  await expect(mainStatus(page)).toContainText(`已添加《${name}》`);
}

async function startRound(
  page: Page,
  path: string,
  opts: { title?: string; maxVotes?: number } = {},
) {
  await page.goto(`${path}/votes`);
  if (opts.title) await page.getByLabel("标题").fill(opts.title);
  if (opts.maxVotes) await page.getByLabel("每人票数").fill(String(opts.maxVotes));
  await page.getByRole("button", { name: "发起投票" }).click();
  await expect(page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  return page.url();
}

test("a full round: candidates, live votes, limits, end and next round, replay", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await addToLibrary(owner.page, path, "apex", "Apex Legends™");
  await addToLibrary(owner.page, path, "1086940", "博德之门3");

  const roundUrl = await startRound(owner.page, path, { title: "周五玩什么", maxVotes: 2 });
  await expect(owner.page.getByRole("heading", { name: "第 1 轮《周五玩什么》" })).toBeVisible();

  // Candidates from the library...
  await owner.page.getByLabel("从游戏库选择").selectOption({ label: "Apex Legends™" });
  await owner.page.getByRole("button", { name: "加入候选" }).click();
  await expect(candidate(owner.page, "Apex Legends™")).toBeVisible();
  await owner.page.getByRole("button", { name: "加入候选" }).click(); // the remaining one
  await expect(candidate(owner.page, "博德之门3")).toBeVisible();
  await expect(owner.page.getByText("游戏库里的游戏都已经是候选了")).toBeVisible();

  // ...and a brand-new game added from the voting screen lands in the library too.
  await owner.page.getByRole("button", { name: "都找不到？手动添加" }).click();
  await owner.page.getByLabel("游戏名").fill("Battlefield 6");
  await owner.page.getByRole("button", { name: "添加为候选" }).click();
  await expect(mainStatus(owner.page).last()).toContainText(
    "已把《Battlefield 6》加入游戏库和候选",
  );
  await expect(candidate(owner.page, "Battlefield 6")).toBeVisible();

  // The friend votes; the owner sees it without reloading.
  await friend.page.goto(roundUrl);
  await expect(friend.page.getByText("你还剩 2 / 2 票")).toBeVisible();
  await friend.page.getByRole("button", { name: "投票 博德之门3" }).click();
  await expect(friend.page.getByRole("button", { name: "取消投票 博德之门3" })).toBeVisible();
  await expect(candidate(owner.page, "博德之门3")).toContainText("1 票");
  await expect(board(owner.page).getByRole("listitem").first()).toContainText("博德之门3");

  // Per-person limit: two votes, then the rest are disabled; retracting frees one.
  await friend.page.getByRole("button", { name: "投票 Apex Legends™" }).click();
  await expect(friend.page.getByText("你还剩 0 / 2 票")).toBeVisible();
  await expect(friend.page.getByRole("button", { name: "投票 Battlefield 6" })).toBeDisabled();
  await friend.page.getByRole("button", { name: "取消投票 Apex Legends™" }).click();
  await expect(friend.page.getByText("你还剩 1 / 2 票")).toBeVisible();

  // Owner votes too; Battlefield 6 had no votes so its adder may remove it.
  await owner.page.getByRole("button", { name: "投票 博德之门3" }).click();
  await expect(candidate(owner.page, "博德之门3")).toContainText("2 票");
  await candidate(owner.page, "Battlefield 6").getByRole("button", { name: "移除" }).click();
  await expect(candidate(owner.page, "Battlefield 6")).toHaveCount(0);

  // End and start the next round: same candidates, no votes.
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "结束并开启下一轮" }).click();
  await expect(owner.page.getByRole("heading", { name: "第 2 轮投票" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(board(owner.page).getByRole("listitem")).toHaveCount(2);
  await expect(board(owner.page)).not.toContainText("1 票");

  // History: round 1 with its winner, reason and a replay.
  await owner.page.goto(`${path}/votes`);
  const history = owner.page.getByRole("list", { name: "历史投票" });
  await expect(history).toContainText("第 1 轮《周五玩什么》");
  await expect(history).toContainText("🏆 博德之门3");
  await expect(history).toContainText("结束并开启了下一轮");
  await history.getByRole("link").first().click();
  await expect(owner.page.getByText("胜出：")).toContainText("博德之门3");
  const replay = owner.page.getByRole("region", { name: "投票回放" });
  await owner.page.getByLabel("回放进度").fill("0");
  await expect(replay).toContainText("加入候选《Apex Legends™》");
  await owner.page.getByLabel("回放进度").fill("3");
  await expect(replay).toContainText(`${friend.name} 投给了《博德之门3》`);
  const ranking = owner.page.getByRole("list", { name: "当时的排名" });
  await expect(ranking.getByRole("listitem").first()).toContainText("博德之门3");

  // Chat recorded the start and the result.
  await friend.page.goto(`${path}/chat`);
  await expect(friend.page.getByText(`${owner.name} 发起了第 1 轮《周五玩什么》`)).toBeVisible();
  await expect(friend.page.getByText("胜出：《博德之门3》").first()).toBeVisible();
});

test("only one open round; deadlines end rounds; plain end", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const url = await startRound(owner.page, path);

  // While a round is open the votes page links to it instead of offering a new one.
  await friend.page.goto(`${path}/votes`);
  await expect(friend.page.getByRole("button", { name: "发起投票" })).toHaveCount(0);
  await friend.page.getByRole("link", { name: /第 1 轮/ }).click();
  await expect(friend.page).toHaveURL(url);

  // A passed deadline ends the round (by the worker, or on the next view).
  const roundId = url.split("/").pop()!;
  await db.voteRound.update({
    where: { id: roundId },
    data: { deadline: new Date(Date.now() - 1000) },
  });
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", "close-due-rounds"], { stdio: "pipe" });
  await friend.page.reload();
  await expect(friend.page.getByText("到达截止时间")).toBeVisible();
  await expect(friend.page.getByText("没有人投票")).toBeVisible();

  // A new round, ended plainly ("仅结束投票").
  await startRound(owner.page, path);
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "仅结束投票" }).click();
  // The page refreshes into the ended round (the controls and their toast go away).
  await expect(owner.page.getByText("已结束", { exact: true })).toBeVisible();
  await expect(owner.page.getByText(/手动结束/)).toBeVisible();

  // Starting with a deadline in the past is rejected.
  await owner.page.goto(`${path}/votes`);
  await owner.page.getByLabel("截止时间").fill("2020-01-01T10:00");
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(mainAlert(owner.page)).toContainText("截止时间需要在至少 1 分钟之后");
});
