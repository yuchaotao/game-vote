import { expect, test, type Page } from "@playwright/test";
import { logout, register, submitLogin, uid } from "./helpers";
import { groupOfTwo } from "./social";

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

/** Opens a page and waits until it has been remembered as the last visited. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "gv_last")?.value)
    .toBe(encodeURIComponent(path));
}

test("signed in, home returns to the last page visited, or the chosen default", async ({
  browser,
}) => {
  const { owner, path } = await groupOfTwo(browser);
  const page = owner.page;

  // The last group page or friends page visited on this device.
  await visit(page, `${path}/votes`);
  await page.goto("/");
  await expect(page).toHaveURL(`${path}/votes`);
  await visit(page, "/friends");
  await page.goto("/settings"); // not remembered
  await page.goto("/");
  await expect(page).toHaveURL("/friends");

  // A fixed default wins over the last visited page.
  await page.goto("/settings");
  await page.getByLabel("默认首页").selectOption(`${path}/games`);
  await page.getByRole("button", { name: "保存默认首页" }).click();
  await expect(page.getByText("已设置默认首页")).toBeVisible();
  await visit(page, `${path}/chat`);
  await page.goto("/");
  await expect(page).toHaveURL(`${path}/games`);

  // Back to "always the last visited".
  await page.goto("/settings");
  await page.getByLabel("默认首页").selectOption({ label: "总是显示最近访问" });
  await page.getByRole("button", { name: "保存默认首页" }).click();
  await expect(page.getByText("首页将显示最近访问的页面")).toBeVisible();
  await visit(page, `${path}/chat`);
  await page.goto("/");
  await expect(page).toHaveURL(`${path}/chat`);
});
