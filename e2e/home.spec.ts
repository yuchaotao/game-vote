import { expect, test, type Page } from "@playwright/test";
import { logout, register, submitLogin, uid } from "./helpers";
import { createGroup, groupOfTwo } from "./social";

const composer = (page: Page) => page.getByRole("textbox", { name: "输入消息" });

test("signed out, the home page pitches the site and signs you in", async ({ page }) => {
  const username = uid();
  await register(page, username);
  await logout(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("今晚玩什么？");
  await expect(page.getByRole("figure", { name: "投票示例" })).toBeVisible();
  await expect(page.getByRole("link", { name: "通过 Steam 登录" })).toBeVisible();

  await submitLogin(page, username, "password123");
  // No group yet: the getting-started page.
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "去建群" })).toBeVisible();
});

test("signed in, the home page opens the most recently active group's chat", async ({
  browser,
}) => {
  const { owner, path: first } = await groupOfTwo(browser);
  // A newer group: its "created" message makes it the most recent.
  const second = await createGroup(owner, `群${uid().slice(-5)}`);
  await owner.page.goto("/");
  await expect(owner.page).toHaveURL(`${second}/chat`);

  // Talking in the first group makes that one the most recent.
  await owner.page.goto(`${first}/chat`);
  await composer(owner.page).fill("今晚开黑？");
  await composer(owner.page).press("Enter");
  await expect(composer(owner.page)).toHaveValue("");
  await owner.page.goto("/");
  await expect(owner.page).toHaveURL(`${first}/chat`);
});
