import { expect, test, type Page } from "@playwright/test";
import { mainStatus } from "./helpers";
import { groupOfTwo } from "./social";

// IGDB requests go to e2e/steam-mock.mjs (see playwright.config.ts).

test.describe.configure({ timeout: 180_000 });

const results = (page: Page) => page.getByRole("list", { name: "IGDB 搜索结果" });
const library = (page: Page) => page.getByRole("region", { name: "游戏列表" });

async function searchIgdb(page: Page, term: string) {
  await page.getByRole("tab", { name: "其他平台（IGDB）" }).click();
  await page.getByRole("textbox", { name: "搜索 IGDB" }).fill(term);
  await page.getByRole("button", { name: "查找" }).click();
}

test("add a non-Steam game from IGDB", async ({ browser }) => {
  const { owner, friend, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page.goto(`${path}/games`);
  await searchIgdb(page, "battlefield");

  const bf4 = results(page).getByRole("listitem").filter({ hasText: "Battlefield 4" });
  await expect(bf4).toContainText("2013");
  await expect(bf4).toContainText("PC · PS4");
  // IGDB knows this one is on Steam.
  await expect(
    results(page).getByRole("listitem").filter({ hasText: "Battlefield Apex Crossover" }),
  ).toContainText("Steam 上也有");

  await page.getByRole("button", { name: "添加 Battlefield 4" }).click();
  await expect(mainStatus(page)).toContainText("已添加《Battlefield 4》");
  await expect(bf4).toContainText("已在库中");

  const card = library(page).getByRole("link", { name: /Battlefield 4/ });
  await expect(card).toContainText("IGDB");
  await expect(card).toContainText("IGDB 评分 78");
  await expect(card).toContainText("射击");
  await expect(card).toContainText("多人 · 单人");

  await card.click();
  await expect(page).toHaveURL(/\/games\/\w+$/, { timeout: 30_000 });
  const main = page.getByRole("main");
  await expect(main).toContainText("All-out war on land, sea and air.");
  await expect(main).toContainText("PC · PS4");
  await expect(main).toContainText("DICE");
  await expect(main).toContainText("2013-10-29");
  await page.getByRole("button", { name: "从 IGDB 刷新资料" }).click();
  await expect(mainStatus(page)).toContainText("已从 IGDB 更新");

  // Another member sees it as already added.
  await friend.page.goto(`${path}/games`);
  await searchIgdb(friend.page, "battlefield 4");
  await expect(results(friend.page).getByText("已在库中")).toBeVisible();
});

test("an IGDB result that is on Steam is added as the Steam game", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page.goto(`${path}/games`);
  await searchIgdb(page, "apex crossover");
  await page.getByRole("button", { name: "添加 Battlefield Apex Crossover" }).click();
  await expect(mainStatus(page)).toContainText("已按 Steam 版添加《Apex Legends™》");
  const card = library(page).getByRole("link", { name: /Apex Legends™/ });
  await expect(card).toContainText("Steam");
});
