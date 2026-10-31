import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mainStatus } from "./helpers";
import { groupOfTwo, type User } from "./social";

// Several votes on one game (#53): the website's stepper and Discord's private −1 / +1.

test.describe.configure({ timeout: 180_000 });

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

const mockUrl = process.env.STEAM_API_URL!;
// Test-only key; its public half is DISCORD_PUBLIC_KEY in playwright.config.ts.
const TEST_KEY = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBfMAeeW/JE+VX9c8I3gY2Z+hS16s4/Md+JgOgW4uo9Q
-----END PRIVATE KEY-----`);

const board = (page: Page) => page.getByRole("list", { name: "候选游戏" });

async function click(discordId: string, customId: string) {
  const raw = JSON.stringify({
    type: 3,
    member: { user: { id: discordId } },
    data: { custom_id: customId },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch("http://localhost:3000/api/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sign(null, Buffer.from(timestamp + raw), TEST_KEY).toString("hex"),
      "x-signature-timestamp": timestamp,
    },
    body: raw,
  });
  return (await res.json()) as {
    type: number;
    data: {
      content: string;
      components: { components: { custom_id: string; disabled?: boolean }[] }[];
    };
  };
}

async function linkDiscord(u: User) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const { id: userId } = await db.user.findUniqueOrThrow({
    where: { username: u.code.split("#")[0] },
  });
  await db.account.create({ data: { userId, provider: "discord", providerAccountId: id } });
  return id;
}

test("stack votes on one game on the website and from Discord", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const groupId = path.split("/").pop()!;
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

  // The round's live message goes to a linked channel.
  await db.group.update({
    where: { id: groupId },
    data: { discordChannelId: "100", discordChannelLabel: "测试服务器 · #general" },
  });
  // Defaults: repeats allowed, 2 votes each. (Public, to see the counts.)
  await owner.page.goto(`${path}/votes`);
  await expect(owner.page.getByLabel("同一个游戏可以投多票")).toBeChecked();
  await expect(owner.page.getByLabel("每人票数")).toHaveValue("2");
  await owner.page.getByLabel("匿名投票").uncheck();
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  const roundUrl = owner.page.url();
  const roundId = roundUrl.split("/").pop()!;
  for (let i = 0; i < 2; i++) {
    await owner.page.getByRole("button", { name: "加入候选" }).click();
    await expect(board(owner.page).getByRole("listitem")).toHaveCount(i + 1);
  }
  await expect(owner.page.getByText("可重复投同一个游戏")).toBeVisible();

  // The friend puts both votes on 博德之门3 with +, then takes one back with −.
  const page = friend.page;
  await page.goto(roundUrl);
  const plus = page.getByRole("button", { name: "加一票 博德之门3" });
  const minus = page.getByRole("button", { name: "撤回一票 博德之门3" });
  await expect(minus).toBeDisabled();
  await plus.click();
  await expect(page.getByText("你还剩 1 / 2 票")).toBeVisible();
  await plus.click();
  await expect(page.getByText("你还剩 0 / 2 票")).toBeVisible();
  const bg3 = board(page).getByRole("listitem").filter({ hasText: "博德之门3" });
  await expect(bg3).toContainText("2 票");
  await expect(bg3.getByText("×2")).toBeVisible();
  await expect(plus).toBeDisabled();
  await expect(page.getByRole("button", { name: "加一票 Apex Legends™" })).toBeDisabled();
  await minus.click();
  await expect(page.getByText("你还剩 1 / 2 票")).toBeVisible();
  await expect(bg3.getByText("×2")).toHaveCount(0);

  // From Discord: the game button adds a vote; the private reply's +1 / −1 adjust it.
  const ownerDiscord = await linkDiscord(owner);
  const apex = await db.game.findFirstOrThrow({ where: { name: "Apex Legends™" } });
  const first = await click(ownerDiscord, `vote:${roundId}:${apex.id}`);
  expect(first.type).toBe(4);
  expect(first.data.content).toContain("你给《Apex Legends™》投了 **1** 票（还剩 1 / 2 票）");
  const again = await click(ownerDiscord, `vadd:${roundId}:${apex.id}`);
  expect(again.type).toBe(7); // updates that reply in place
  expect(again.data.content).toContain("投了 **2** 票（还剩 0 / 2 票）");
  expect(again.data.components[0].components[1].disabled).toBe(true);
  const over = await click(ownerDiscord, `vadd:${roundId}:${apex.id}`);
  expect(over.data.content).toContain("每人最多 2 票");
  const back = await click(ownerDiscord, `vsub:${roundId}:${apex.id}`);
  expect(back.data.content).toContain("投了 **1** 票");

  await page.reload();
  await expect(board(page).getByRole("listitem").filter({ hasText: "Apex" })).toContainText("1 票");
  // The live message in the channel says repeats are allowed.
  execFileSync("npx", ["tsx", "src/worker/run-once.ts", "send-notifications"], {
    env: process.env,
    stdio: "pipe",
  });
  const posts = (await (await fetch(`${mockUrl}/mock/discord/messages?channel=100`)).json()) as {
    embeds: { footer?: { text: string } }[];
  }[];
  expect(posts.some((p) => p.embeds[0]?.footer?.text.includes("可以重复投同一个游戏"))).toBe(true);
});
