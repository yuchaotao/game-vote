import { expect, test } from "@playwright/test";
import { login, logout, register, uid } from "./helpers";
import { latestLink } from "./mail";

test("register, see friend code, logout, log back in by username and email", async ({ page }) => {
  const username = uid();
  await register(page, username);

  await expect(page.getByText("你的邮箱还未验证")).toBeVisible();
  await expect(page.getByText(new RegExp(`${username}#\\d{4}`))).toBeVisible();

  await logout(page);
  await expect(page.getByRole("banner").getByRole("link", { name: "注册" })).toBeVisible();

  await login(page, username, "wrong-password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("用户名/邮箱或密码错误");

  await login(page, username.toUpperCase(), "password123");
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();

  await logout(page);
  await login(page, `${username}@example.test`, "password123");
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();
});

test("rejects duplicate username and email", async ({ page, browser }) => {
  const username = uid();
  await register(page, username);

  const other = await browser.newPage();
  await other.goto("/register");
  await other.getByLabel("用户名").fill(username);
  await other.getByLabel("邮箱").fill(`${uid()}@example.test`);
  await other.getByLabel("密码").fill("password123");
  await other.getByRole("button", { name: "注册" }).click();
  await expect(other.getByRole("main").getByRole("alert")).toHaveText("用户名已被占用");

  await other.getByLabel("用户名").fill(uid());
  await other.getByLabel("邮箱").fill(`${username}@example.test`);
  await other.getByLabel("密码").fill("password123");
  await other.getByRole("button", { name: "注册" }).click();
  await expect(other.getByRole("main").getByRole("alert")).toHaveText("该邮箱已注册");
});

test("settings: update profile and change password", async ({ page }) => {
  const username = uid();
  await register(page, username);
  await page.goto("/settings");

  await page.getByLabel("昵称").fill("新昵称");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存");
  await expect(page.getByRole("banner").getByText("新昵称")).toBeVisible();

  await page.getByLabel("当前密码").fill("not-it");
  await page.getByLabel("新密码").fill("newpassword456");
  await page.getByRole("button", { name: "修改密码" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("当前密码不正确");

  await page.getByLabel("当前密码").fill("password123");
  await page.getByLabel("新密码").fill("newpassword456");
  await page.getByRole("button", { name: "修改密码" }).click();
  await expect(page.getByText("密码已修改")).toBeVisible();

  await logout(page);
  await login(page, username, "newpassword456");
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();
});

test("protected and guest-only redirects", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);

  await register(page, uid());
  await page.goto("/login");
  await expect(page).toHaveURL("/");
});

test("forgot password gives a generic answer", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("注册邮箱").fill("nobody@example.test");
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("status")).toContainText("如果该邮箱已注册");
});

test("reset link without a valid token fails safely", async ({ page }) => {
  await page.goto("/reset-password?token=bogus");
  await page.getByLabel("新密码").fill("whatever123");
  await page.getByRole("button", { name: "重置密码" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "链接无效或已过期，请重新申请",
  );
});

test("Steam sign-in redirects to Steam OpenID with a state cookie", async ({ request }) => {
  const res = await request.get("/api/auth/steam?intent=login", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = new URL(res.headers()["location"]);
  expect(location.origin).toBe("https://steamcommunity.com");
  expect(location.searchParams.get("openid.return_to")).toMatch(
    /\/api\/auth\/steam\/callback\?state=[\w-]+$/,
  );
  expect(res.headers()["set-cookie"]).toContain("gv_oauth=");
});

test("Steam callback with a forged assertion is rejected", async ({ page }) => {
  await page.goto("/api/auth/steam/callback?state=forged&openid.mode=id_res");
  await expect(page).toHaveURL(/\/login\?error=oauth_state/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("登录请求已过期，请重试。");
});

test("email verification link verifies the address once", async ({ page }) => {
  const username = uid();
  await register(page, username);
  await expect(page.getByText("你的邮箱还未验证")).toBeVisible();

  const link = await latestLink(`${username}@example.test`, "验证你的邮箱");
  await page.goto(link);
  await expect(page.getByRole("main").getByRole("status")).toHaveText("邮箱验证成功！");

  await page.goto("/");
  await expect(page.getByText("你的邮箱还未验证")).toHaveCount(0);

  // Single use.
  await page.goto(link);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("链接无效或已过期");
});

test("password reset via emailed link signs out and accepts the new password", async ({ page }) => {
  const username = uid();
  const email = `${username}@example.test`;
  await register(page, username);
  await logout(page);

  await page.goto("/forgot-password");
  await page.getByLabel("注册邮箱").fill(email);
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("如果该邮箱已注册");

  const link = await latestLink(email, "重置密码");
  await page.goto(link);
  await page.getByLabel("新密码").fill("resetpass789");
  await page.getByRole("button", { name: "重置密码" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText("密码已重置")).toBeVisible();

  await login(page, username, "password123");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("用户名/邮箱或密码错误");
  await login(page, username, "resetpass789");
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();
});
