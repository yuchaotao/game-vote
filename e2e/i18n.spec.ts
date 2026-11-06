import { expect, test } from "@playwright/test";
import { groupOfTwo } from "./social";

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

test("signed-in pages in English: friends, groups, chat, settings", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page
    .context()
    .addCookies([{ name: "gv_locale", value: "en", url: "http://localhost:3000" }]);

  await page.goto("/friends");
  await expect(page.getByRole("heading", { level: 1, name: "Friends" })).toBeVisible();
  await expect(page.getByLabel("Friend code")).toBeVisible();
  await page.goto("/groups");
  await expect(page.getByRole("heading", { name: "Create a new group" })).toBeVisible();
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Group sections" })).toContainText("Library");
  await expect(page.getByRole("list", { name: "Member list" })).toContainText("(me)");
  await page.goto(`${path}/chat`);
  await expect(page.getByRole("textbox", { name: "Type a message" })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Linked accounts" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "New vote · Email" })).not.toBeChecked();
  await expect(page.getByLabel("Default home page")).toBeVisible();
});

test("votes and the game library in English", async ({ browser }) => {
  const { owner, path } = await groupOfTwo(browser);
  const page = owner.page;
  await page
    .context()
    .addCookies([{ name: "gv_locale", value: "en", url: "http://localhost:3000" }]);

  await page.goto(`${path}/games`);
  await page.getByRole("textbox", { name: "Search Steam or paste a link" }).fill("apex");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Add Apex Legends™" }).click();
  await expect(page.getByRole("region", { name: "Game list" })).toContainText("Apex Legends™");

  await page.goto(`${path}/votes`);
  await expect(page.getByLabel("Anonymous vote")).toBeChecked();
  await expect(page.getByLabel("Votes per person")).toHaveValue("2");
  await expect(page.getByLabel("Attempts per round")).toHaveValue("5");
  await page.getByRole("button", { name: "Start a vote" }).click();
  await expect(page).toHaveURL(/\/votes\/\w+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(page.getByText("Anonymous, in progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "🎲 Gamble · 5 left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "😈 Switcheroo · 5 left" })).toBeDisabled();
  await page.getByRole("button", { name: "Add all (1)" }).click();
  await expect(page.getByRole("button", { name: "Add a vote for Apex Legends™" })).toBeEnabled();
  await page.screenshot({ path: "test-results/screens/round-english.png", fullPage: true });
});
