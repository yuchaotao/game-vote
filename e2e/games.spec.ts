import { expect, test, type Page } from "@playwright/test";
import { mainAlert, mainStatus } from "./helpers";
import { groupOfTwo, newUser } from "./social";

// Steam requests go to e2e/steam-mock.mjs (see playwright.config.ts).

test.describe.configure({ timeout: 180_000 });

const finder = (page: Page) => page.getByRole("textbox", { name: "搜索 Steam 或粘贴链接" });
const results = (page: Page) => page.getByRole("list", { name: "Steam 搜索结果" });
const library = (page: Page) => page.getByRole("region", { name: "游戏列表" });

async function find(page: Page, query: string) {
  await finder(page).fill(query);
  await page.getByRole("button", { name: "查找" }).click();
}

test("search Steam, add a game, and see it as another member", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await owner.page.goto(`${path}/games`);
  await expect(owner.page.getByText("游戏库还是空的")).toBeVisible();

  await find(owner.page, "apex");
  await owner.page.getByRole("button", { name: "添加 Apex Legends™" }).click();
  await expect(mainStatus(owner.page)).toContainText("已添加《Apex Legends™》");
  await expect(results(owner.page).getByText("已在库中")).toBeVisible();

  const card = library(owner.page).getByRole("link", { name: /Apex Legends™/ });
  await expect(card).toContainText("免费");
  await expect(card).toContainText("动作");
  await expect(card).toContainText("多人 · 合作 · 线上玩家对战");
  // The review endpoint "redirected", so the card falls back to Metacritic.
  await expect(card).toContainText("Metacritic 88");
  await expect(card).toContainText(`${owner.name} 添加`);

  // The other member sees it in the library, gets a chat notice, and can't add it twice.
  await friend.page.goto(`${path}/games`);
  await expect(library(friend.page).getByRole("link", { name: /Apex Legends™/ })).toBeVisible();
  await find(friend.page, "apex");
  await expect(results(friend.page).getByText("已在库中")).toBeVisible();
  await friend.page.goto(`${path}/chat`);
  await expect(
    friend.page.getByText(`${owner.name} 把《Apex Legends™》加入了游戏库`),
  ).toBeVisible();
});

test("add by pasting a store link and view the details", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page.goto(`${path}/games`);

  await find(page, "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/");
  await expect(results(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "添加 博德之门3" }).click();
  await expect(mainStatus(page)).toContainText("已添加《博德之门3》");

  await library(page)
    .getByRole("link", { name: /博德之门3/ })
    .click();
  // First visit to a detail page: the dev server may still be compiling it.
  await expect(page).toHaveURL(/\/games\/\w+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: "博德之门3" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("好评如潮 96%");
  await expect(main).toContainText("1,000 篇评测");
  await expect(main).toContainText("-20%");
  await expect(main).toContainText("47.99");
  await expect(main).toContainText("召集你的队伍");
  await expect(main).toContainText("多人 · 在线合作 · 单人");
  await expect(main).toContainText("Larian Studios");
  await expect(page.getByRole("link", { name: "在 Steam 上查看" })).toHaveAttribute(
    "href",
    "https://store.steampowered.com/app/1086940/",
  );
  await expect(page.getByRole("list", { name: "截图" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "从 Steam 刷新资料" }).click();
  await expect(mainStatus(page)).toContainText("已从 Steam 更新");
});

test("rejects unknown apps and non-games", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  await owner.page.goto(`${path}/games`);
  await find(owner.page, "https://store.steampowered.com/app/9999999/");
  await expect(mainAlert(owner.page)).toContainText("在 Steam 上找不到这个游戏");
  await find(owner.page, "2000");
  await expect(mainAlert(owner.page)).toContainText("这不是游戏");
});

test("manual games: add, duplicate check, edit, permissions, remove", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const page = friend.page;
  await page.goto(`${path}/games`);
  await page.getByRole("button", { name: "都找不到？手动添加" }).click();
  await page.getByLabel("游戏名").fill("Battlefield 6");
  await page.getByLabel("平台 / 启动器").fill("EA App，PC");
  await page.getByLabel("类型").fill("射击");
  await page.getByLabel("游玩方式").fill("多人, 在线合作");
  await page.getByLabel("简介").fill("64 人大战场");
  await page.getByRole("button", { name: "添加到游戏库" }).click();
  await expect(mainStatus(page)).toContainText("已添加《Battlefield 6》");
  // The form is cleared for the next game.
  await expect(page.getByLabel("游戏名")).toHaveValue("");

  await page.getByLabel("游戏名").fill("battlefield  6");
  await page.getByRole("button", { name: "添加到游戏库" }).click();
  await expect(mainAlert(page)).toContainText("游戏库里已经有");

  const card = library(page).getByRole("link", { name: /Battlefield 6/ });
  await expect(card).toContainText("手动添加");
  await card.click();
  await expect(page).toHaveURL(/\/games\/\w+$/);
  await expect(page.getByRole("main")).toContainText("EA App · PC");
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("游戏名").fill("Battlefield 6 战地风云");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "Battlefield 6 战地风云" })).toBeVisible();

  // Non-members can't see the library or its games.
  const detailUrl = page.url();
  const stranger = await newUser(browser);
  await stranger.page.goto(`${path}/games`);
  await expect(stranger.page.getByText("404")).toBeVisible();
  await stranger.page.goto(detailUrl);
  await expect(stranger.page.getByText("404")).toBeVisible();

  // The owner may remove a game a member added.
  await owner.page.goto(detailUrl);
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "移出游戏库" }).click();
  await expect(owner.page).toHaveURL(new RegExp(`${path}/games$`));
  await expect(owner.page.getByText("游戏库还是空的")).toBeVisible();
});

test("only the adder or the owner sees remove", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  await owner.page.goto(`${path}/games`);
  await find(owner.page, "apex");
  await owner.page.getByRole("button", { name: "添加 Apex Legends™" }).click();
  await expect(mainStatus(owner.page)).toBeVisible();

  await friend.page.goto(`${path}/games`);
  await library(friend.page)
    .getByRole("link", { name: /Apex Legends™/ })
    .click();
  await expect(friend.page.getByRole("button", { name: "从 Steam 刷新资料" })).toBeVisible();
  await expect(friend.page.getByRole("button", { name: "移出游戏库" })).toHaveCount(0);
  await expect(friend.page.getByRole("button", { name: "编辑" })).toHaveCount(0);
});
