import { expect, test } from "@playwright/test";

// The interface language (#65). Chinese stays the default until the whole
// interface is translated; a cookie selects English.

test("English pages when the language cookie says so", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  // No cookie yet: still Chinese, whatever the browser says (detection is off).
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("今晚玩什么？");

  await context.addCookies([{ name: "gv_locale", value: "en", url: "http://localhost:3000" }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What's tonight's game?");
  await expect(page.getByRole("link", { name: "Log in with Steam" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page).toHaveTitle("Sign up · Game Vote");
  await page.goto("/forgot-password");
  await expect(page.getByRole("button", { name: "Send reset email" })).toBeVisible();
  await context.close();
});
