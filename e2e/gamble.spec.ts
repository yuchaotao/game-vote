import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo, type User } from "./social";

// 赌一把 / 偷梁换柱 and the lucky coin (#57). Outcomes are random, so each test sets
// the coin to 100% (always wins) or 0% (always loses) first.

test.describe.configure({ timeout: 240_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const board = (page: Page) => page.getByRole("list", { name: "候选游戏" });

test("gamble to peek once, switch a vote, get caught, and watch the coin change", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const groupId = path.split("/").pop()!;
  const user = async (u: User) =>
    db.user.findUniqueOrThrow({ where: { username: u.code.split("#")[0] } });
  const [o, f] = [await user(owner), await user(friend)];
  const setLuck = (userId: string, luck: number) =>
    db.groupMember.update({ where: { groupId_userId: { groupId, userId } }, data: { luck } });
  const luckOf = async (userId: string) =>
    (await db.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId, userId } } }))
      .luck;

  for (const term of ["apex", "1086940"]) {
    await owner.page.goto(`${path}/games`);
    await owner.page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" }).fill(term);
    await owner.page.getByRole("button", { name: "查找" }).click();
    await owner.page
      .getByRole("button", { name: /^添加 / })
      .first()
      .click();
    await expect(mainStatus(owner.page)).toBeVisible();
  }
  // Anonymous (default), repeats allowed (default), 2 votes each.
  await owner.page.goto(`${path}/votes`);
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  const roundUrl = owner.page.url();
  const roundId = roundUrl.split("/").pop()!;
  for (let i = 0; i < 2; i++) {
    await owner.page.getByRole("button", { name: "加入候选" }).click();
    await expect(board(owner.page).getByRole("listitem")).toHaveCount(i + 1);
  }

  // Owner: one vote for 博德之门3. Friend: one each for Apex and 博德之门3. So 博德之门3
  // has 2 votes in all, while nobody has 2 of their own on a game: "2 票" on the
  // board means totals are showing (your own stepper counts always are).
  await owner.page.getByRole("button", { name: "加一票 博德之门3" }).click();
  await expect(owner.page.getByText("你还剩 1 / 2 票")).toBeVisible();
  await friend.page.goto(roundUrl);
  await friend.page.getByRole("button", { name: "加一票 Apex Legends™" }).click();
  await expect(friend.page.getByText("你还剩 1 / 2 票")).toBeVisible();
  await friend.page.getByRole("button", { name: "加一票 博德之门3" }).click();
  await expect(friend.page.getByText("你还剩 0 / 2 票")).toBeVisible();

  // Everyone starts with a 50% coin, shown on the members list.
  await owner.page.goto(path);
  await expect(owner.page.getByRole("img", { name: "幸运硬币：铜币 50%" })).toHaveCount(2);

  // The owner's 赌一把 fails: everyone hears about it; luck drops by 1.
  await setLuck(o.id, 0);
  await owner.page.goto(roundUrl);
  await expect(owner.page.getByText("成功率 0%")).toBeVisible();
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "🎲 赌一把" }).click();
  await expect(owner.page.getByText("赌输了")).toBeVisible();
  await expect(owner.page.getByRole("button", { name: "🎲 这轮已赌过" })).toBeDisabled();
  await expect(board(owner.page)).not.toContainText("2 票");
  expect(await luckOf(o.id)).toBe(10); // never below 10%
  await friend.page.goto(`${path}/chat`);
  await expect(
    friend.page.getByText(`${o.displayName} 想偷看第 1 轮投票的结果，赌输了！`),
  ).toBeVisible();

  // The friend's 赌一把 wins: the results show this once, then hide again.
  await setLuck(f.id, 100);
  await friend.page.goto(roundUrl);
  await expect(friend.page.getByRole("list", { name: "被抓到的小动作" })).toContainText(
    `🎲 ${o.displayName} 偷看失败`,
  );
  friend.page.once("dialog", (d) => d.accept());
  await friend.page.getByRole("button", { name: "🎲 赌一把" }).click();
  await expect(friend.page.getByText("赌赢了！这些结果只显示这一次")).toBeVisible();
  await expect(board(friend.page)).toContainText("2 票");
  await friend.page.reload();
  await expect(board(friend.page)).not.toContainText("2 票");
  await expect(friend.page.getByRole("button", { name: "🎲 这轮已赌过" })).toBeDisabled();
  expect(await luckOf(f.id)).toBe(90); // capped

  // The friend's 偷梁换柱 wins: the owner's vote for 博德之门3 becomes Apex, quietly.
  await setLuck(f.id, 100);
  await friend.page.reload();
  friend.page.once("dialog", (d) => d.accept());
  await friend.page.getByRole("button", { name: "😈 偷梁换柱" }).click();
  await expect(
    friend.page.getByText("偷梁换柱成功！你悄悄把一张别人的票换成了《Apex Legends™》"),
  ).toBeVisible();
  const ownerVotes = await db.voteBallot.findMany({
    where: { roundId, userId: o.id },
    include: { game: true },
  });
  expect(ownerVotes.map((b) => [b.game.name, b.count])).toEqual([["Apex Legends™", 1]]);
  await owner.page.goto(path + "/chat");
  await expect(owner.page.getByText(/尝试改/)).toHaveCount(0);

  // The owner's 偷梁换柱 fails: everyone sees whose vote they went for.
  await setLuck(o.id, 0);
  await owner.page.goto(roundUrl);
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "😈 偷梁换柱" }).click();
  await expect(owner.page.getByText("失手了")).toBeVisible();
  await friend.page.goto(roundUrl);
  await expect(friend.page.getByRole("list", { name: "被抓到的小动作" })).toContainText(
    `😈 ${o.displayName} 尝试改 ${f.displayName} 的票`,
  );

  // The coin shows the new luck on the members list.
  await friend.page.goto(path);
  await expect(friend.page.getByRole("img", { name: "幸运硬币：彩虹幸运币 90%" })).toBeVisible();
  await expect(friend.page.getByRole("img", { name: "幸运硬币：生锈的铜币 10%" })).toBeVisible();
  await friend.page.screenshot({ path: "test-results/screens/luck-members.png", fullPage: true });

  // After the reveal the replay shows the switched vote.
  await db.voteRound.update({
    where: { id: roundId },
    data: { deadline: new Date(Date.now() - 1000) },
  });
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", "close-due-rounds"], { stdio: "pipe" });
  await friend.page.goto(roundUrl);
  await expect(friend.page.getByText("已揭榜")).toBeVisible();
  await expect(
    friend.page.getByText(/偷梁换柱：把 .+ 的一票从《博德之门3》换成了《Apex Legends™》/),
  ).toBeVisible();
});
