import { expect, test } from "@playwright/test";
import { fillRegisterForm, mainAlert, uid, visitor } from "./helpers";

// Runs only with BASE_PATH set (see playwright.config.ts): the app is built and
// served under a sub-path, as in production (https://www.yuchaotao.com/game-vote).
const B = process.env.BASE_PATH!;
const APP_URL = process.env.APP_URL!;

test("site root outside the base path is not served", async ({ request }) => {
  expect((await request.get("/")).status()).toBe(404);
  expect((await request.get(`${B}/api/health`)).ok()).toBe(true);
});

test("links, server actions and redirects stay under the base path", async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto(`${B}/`);
  await expect(page.getByRole("banner").getByRole("link", { name: "注册" })).toHaveAttribute(
    "href",
    `${B}/register`,
  );

  // Protected page redirects to the prefixed login.
  await page.goto(`${B}/settings`);
  await expect(page).toHaveURL(`${B}/login`);
  await expect(page.getByRole("link", { name: "通过 Steam 登录" })).toHaveAttribute(
    "href",
    `${B}/api/auth/steam?intent=login`,
  );

  // Sign-up is a server action; it must post to and redirect within the base path.
  await page.goto(`${B}/register`);
  await fillRegisterForm(page, uid());
  // With a base path the home page is `/game-vote` (no trailing slash).
  await expect(page).toHaveURL(B);
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();

  await page.getByRole("banner").getByRole("link", { name: "群组" }).click();
  await expect(page).toHaveURL(`${B}/groups`);

  // Invite links are absolute URLs under the base path.
  await page.goto(`${B}/friends`);
  await page.getByRole("button", { name: "生成邀请链接" }).click();
  await expect(page.locator("code", { hasText: "/invite/" }).first()).toHaveText(
    new RegExp(`^${APP_URL}/invite/[\\w-]+$`),
  );

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(`${B}/login`);
});

test("Steam OpenID uses the prefixed callback and the origin as realm", async ({ request }) => {
  const res = await request.get(`${B}/api/auth/steam?intent=login`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = new URL(res.headers()["location"]);
  expect(location.searchParams.get("openid.return_to")).toMatch(
    new RegExp(`^${APP_URL}/api/auth/steam/callback\\?state=`),
  );
  expect(location.searchParams.get("openid.realm")).toBe(new URL(APP_URL).origin);
});

test("auth callback errors redirect under the base path", async ({ page }) => {
  await page.goto(`${B}/api/auth/steam/callback?state=forged`);
  await expect(page).toHaveURL(`${B}/login?error=oauth_state`);
  await expect(mainAlert(page)).toHaveText("登录请求已过期，请重试。");
});
