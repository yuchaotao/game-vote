import { expect, test, type Page } from "@playwright/test";
import { mainStatus } from "./helpers";
import { groupOfTwo } from "./social";

// Phone layout checks. Screenshots go to test-results/screens (uploaded by CI)
// so the real rendering can be looked at.

test.describe.configure({ timeout: 180_000 });

const PHONE = { width: 375, height: 812 };

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

test("voting on a phone: cards stack, nothing overlaps or scrolls sideways", async ({
  browser,
}) => {
  const { owner, friend, path } = await groupOfTwo(browser);
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
  await owner.page.goto(`${path}/votes`);
  await owner.page.getByRole("button", { name: "发起投票" }).click();
  await expect(owner.page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  const roundUrl = owner.page.url();
  for (let i = 0; i < 2; i++) {
    await owner.page.getByRole("button", { name: "加入候选" }).click();
    await expect(
      owner.page.getByRole("list", { name: "候选游戏" }).getByRole("listitem"),
    ).toHaveCount(i + 1);
  }

  const page = friend.page;
  await page.setViewportSize(PHONE);
  await page.goto(roundUrl);
  await page.getByRole("button", { name: "投票 博德之门3" }).click();
  await expect(page.getByRole("button", { name: "取消投票 博德之门3" })).toBeVisible();

  await noSideways(page);
  for (const card of await page
    .getByRole("list", { name: "候选游戏" })
    .getByRole("listitem")
    .all()) {
    const name = (await card.locator(".font-medium").first().boundingBox())!;
    const button = (await card.getByRole("button", { name: /投票/ }).boundingBox())!;
    // The button sits below the name on a phone, not squeezed beside it.
    expect(button.y, "button below the name").toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(name.width, "name has room").toBeGreaterThan(150);
  }
  await shot(page, "round-phone");

  await page.goto(`${new URL(roundUrl).pathname.replace(/\/[^/]+$/, "")}`);
  await noSideways(page);
  await shot(page, "votes-phone");
  await page.goto(`${path}/games`);
  await noSideways(page);
  await shot(page, "games-phone");
  await page.goto(path);
  await noSideways(page);
  await shot(page, "members-phone");

  // Desktop keeps one row per card.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(roundUrl);
  await shot(page, "round-desktop");
});
