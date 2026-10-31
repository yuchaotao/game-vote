import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo } from "./social";

// Anonymous rounds (#51): hidden results, peeking, and the reveal.

test.describe.configure({ timeout: 180_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const board = (page: Page) => page.getByRole("list", { name: "候选游戏" });

test("anonymous by default: hidden until revealed; peeking is public; the reveal plays once", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const ownerName = (
    await db.user.findUniqueOrThrow({
      where: { username: owner.code.split("#")[0] },
    })
  ).displayName;
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

  // The form defaults to anonymous with a Friday reveal already filled in.
  await owner.page.goto(`${path}/votes`);
  await expect(owner.page.getByLabel("匿名投票")).toBeChecked();
  await expect(owner.page.getByLabel("揭榜时间")).not.toHaveValue("");
  await owner.page.getByLabel("同一个游戏可以投多票").uncheck();
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  const roundUrl = owner.page.url();
  const roundId = roundUrl.split("/").pop()!;
  for (let i = 0; i < 2; i++) {
    await owner.page.getByRole("button", { name: "加入候选" }).click();
    await expect(board(owner.page).getByRole("listitem")).toHaveCount(i + 1);
  }
  await expect(owner.page.getByText("匿名进行中")).toBeVisible();

  // The friend votes: they see their own vote, but no counts or ranks.
  await friend.page.goto(roundUrl);
  await friend.page.getByRole("button", { name: "投票 博德之门3" }).click();
  await expect(friend.page.getByRole("button", { name: "取消投票 博德之门3" })).toBeVisible();
  await expect(board(friend.page)).not.toContainText(/d+ 票/);
  await expect(friend.page.getByText("1 / 2 人已投")).toBeVisible();
  await owner.page.reload();
  await expect(board(owner.page)).not.toContainText(/d+ 票/);

  // The owner peeks: they see the counts; everyone sees that they peeked.
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "👀 偷看结果" }).click();
  await expect(board(owner.page)).toContainText("1 票");
  await expect(owner.page.getByText("你偷看了结果")).toBeVisible();
  await friend.page.reload();
  await expect(friend.page.getByText(`👀 偷看过：${ownerName}`)).toBeVisible();
  await expect(board(friend.page)).not.toContainText(/d+ 票/);
  await friend.page.goto(`${path}/chat`);
  await expect(friend.page.getByText(`${ownerName} 偷看了第 1 轮投票的投票结果`)).toBeVisible();

  // Reveal time: the round ends and everyone sees the result.
  await db.voteRound.update({
    where: { id: roundId },
    data: { deadline: new Date(Date.now() - 1000) },
  });
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", "close-due-rounds"], { stdio: "pipe" });

  // The first look plays the reveal: confetti and the winner's entrance.
  await friend.page.goto(roundUrl);
  await expect(friend.page.getByText("已揭榜")).toBeVisible();
  await expect(friend.page.getByText("到点揭榜")).toBeVisible();
  await expect(friend.page.locator("[data-reveal-confetti]")).toHaveCount(1);
  const winner = board(friend.page).locator("li[data-winner]");
  await expect(winner).toContainText("博德之门3");
  await expect(winner).toHaveClass(/reveal-winner/);
  await expect(board(friend.page)).toContainText("1 票");
  await expect(friend.page.getByText(`👀 揭榜前偷看过：${ownerName}`)).toBeVisible();
  await friend.page.screenshot({ path: "test-results/screens/reveal.png", fullPage: true });

  // Only once.
  await friend.page.reload();
  await expect(friend.page.getByText("已揭榜")).toBeVisible();
  await expect(friend.page.locator("[data-reveal-confetti]")).toHaveCount(0);
  await expect(board(friend.page).locator("li[data-winner]")).toHaveCount(0);
});
