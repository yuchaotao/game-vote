import { expect, type Browser, type Page } from "@playwright/test";

export const uid = () => `e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

export async function register(page: Page, username: string, password = "password123") {
  await page.goto("/register");
  await fillRegisterForm(page, username, password);
  await expect(page.getByRole("heading", { name: /欢迎/ })).toBeVisible();
}

/** Fills and submits the sign-up form on the current page. */
export async function fillRegisterForm(page: Page, username: string, password = "password123") {
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("昵称").fill(`测试${username.slice(-4)}`);
  await page.getByLabel("邮箱").fill(`${username}@example.test`);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册" }).click();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function login(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await submitLogin(page, identifier, password);
}

export async function submitLogin(page: Page, identifier: string, password: string) {
  await page.getByLabel("用户名或邮箱").fill(identifier);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

/** The current user's friend code as shown in settings. */
export async function friendCodeOf(page: Page): Promise<string> {
  await page.goto("/settings");
  return (await page.getByRole("main").locator("code").first().textContent())!.trim();
}

export const mainAlert = (page: Page) => page.getByRole("main").getByRole("alert");
export const mainStatus = (page: Page) => page.getByRole("main").getByRole("status");

/**
 * A fresh browser context posing as a distinct client IP, so per-IP rate limits
 * treat simulated users like separate real visitors.
 */
export async function visitor(browser: Browser): Promise<Page> {
  const ip = `10.${rand()}.${rand()}.${rand()}`;
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  return context.newPage();
}

const rand = () => Math.floor(Math.random() * 254) + 1;
