import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  visitor,
  fillRegisterForm,
  friendCodeOf,
  logout,
  mainAlert,
  mainStatus,
  register,
  submitLogin,
  uid,
} from "./helpers";

// Each test signs up several users; give them more time on slow dev machines.
test.describe.configure({ timeout: 120_000 });

/** A signed-in user in their own browser context (separate cookies). */
async function newUser(browser: Browser) {
  const page = await visitor(browser);
  const username = uid();
  await register(page, username);
  const code = await friendCodeOf(page);
  return { page, username, code, name: `测试${username.slice(-4)}` };
}

async function sendRequest(page: Page, code: string) {
  await page.goto("/friends");
  await page.getByLabel("好友码").fill(code);
  await page.getByRole("button", { name: "发送申请" }).click();
  // Wait for the server's answer before anyone else looks at the result.
  await expect(mainStatus(page).or(mainAlert(page))).toBeVisible();
}

const friendsList = (page: Page) =>
  page.getByRole("heading", { name: /我的好友/ }).locator("xpath=ancestor::section");

test("request by friend code, accept, then remove", async ({ browser }) => {
  const a = await newUser(browser);
  const b = await newUser(browser);

  await sendRequest(a.page, b.code);
  await expect(mainStatus(a.page)).toHaveText(`已向 ${b.name} 发送好友申请`);
  await expect(a.page.getByRole("heading", { name: "等待对方确认" })).toBeVisible();

  await b.page.goto("/friends");
  await expect(b.page.getByLabel("1 个好友申请")).toBeVisible();
  await expect(b.page.getByRole("heading", { name: /收到的申请/ })).toBeVisible();
  await b.page.getByRole("button", { name: "接受" }).click();
  await expect(friendsList(b.page).getByText(a.name)).toBeVisible();
  await expect(b.page.getByLabel(/个好友申请/)).toHaveCount(0);

  await a.page.goto("/friends");
  await expect(friendsList(a.page).getByText(b.name)).toBeVisible();
  await expect(a.page.getByRole("heading", { name: "等待对方确认" })).toHaveCount(0);

  a.page.once("dialog", (d) => d.accept());
  await friendsList(a.page).getByRole("button", { name: "删除" }).click();
  await expect(friendsList(a.page).getByText("还没有好友")).toBeVisible();

  await b.page.goto("/friends");
  await expect(friendsList(b.page).getByText("还没有好友")).toBeVisible();
});

test("mutual requests become friends immediately", async ({ browser }) => {
  const a = await newUser(browser);
  const b = await newUser(browser);

  await sendRequest(a.page, b.code);
  await sendRequest(b.page, a.code);
  await expect(mainStatus(b.page)).toHaveText(`${a.name} 也向你发过申请，你们已成为好友`);
  await expect(friendsList(b.page).getByText(a.name)).toBeVisible();
});

test("friend code validation", async ({ browser }) => {
  const a = await newUser(browser);
  const b = await newUser(browser);

  await sendRequest(a.page, "nobody_here#0000");
  await expect(mainAlert(a.page)).toHaveText("找不到这个好友码，格式应为 用户名#1234");

  await sendRequest(a.page, a.code);
  await expect(mainAlert(a.page)).toHaveText("不能添加自己为好友");

  await sendRequest(a.page, b.code.toUpperCase());
  await expect(mainStatus(a.page)).toHaveText(`已向 ${b.name} 发送好友申请`);
  await sendRequest(a.page, b.code);
  await expect(mainAlert(a.page)).toHaveText("已经发送过申请，等待对方确认");
});

test("decline and cancel", async ({ browser }) => {
  const a = await newUser(browser);
  const b = await newUser(browser);
  const c = await newUser(browser);

  await sendRequest(a.page, b.code);
  await b.page.goto("/friends");
  await b.page.getByRole("button", { name: "拒绝" }).click();
  await expect(b.page.getByRole("heading", { name: /收到的申请/ })).toHaveCount(0);
  await expect(friendsList(b.page).getByText("还没有好友")).toBeVisible();

  await sendRequest(a.page, c.code);
  await a.page.getByRole("button", { name: "撤回" }).first().click();
  await expect(a.page.getByRole("heading", { name: "等待对方确认" })).toHaveCount(0);
  await c.page.goto("/friends");
  await expect(c.page.getByRole("heading", { name: /收到的申请/ })).toHaveCount(0);

  // After a decline, a new request can be sent.
  await sendRequest(a.page, b.code);
  await expect(mainStatus(a.page)).toHaveText(`已向 ${b.name} 发送好友申请`);
});

/** Creates an invite on /friends and returns its path. */
async function createInvite(page: Page, maxUses: string) {
  await page.goto("/friends");
  await page.getByLabel("可用次数").selectOption(maxUses);
  await page.getByRole("button", { name: "生成邀请链接" }).click();
  await expect(mainStatus(page)).toHaveText("邀请链接已创建");
  const url = await page.locator("code", { hasText: "/invite/" }).first().textContent();
  return new URL(url!).pathname;
}

test("new user signs up through a single-use invite and becomes a friend", async ({ browser }) => {
  const a = await newUser(browser);
  const invitePath = await createInvite(a.page, "1");

  const guest = await visitor(browser);
  await guest.goto(invitePath);
  await expect(guest.getByText(`${a.name} 邀请你成为好友`)).toBeVisible();
  await guest.getByRole("link", { name: "注册并成为好友" }).click();
  await expect(guest.getByText(`${a.name} 邀请你加入 Game Vote`)).toBeVisible();

  const username = uid();
  await fillRegisterForm(guest, username);
  await expect(guest).toHaveURL(/\/friends\?added=/);
  await expect(mainStatus(guest).first()).toHaveText(`你和 ${a.name} 已成为好友！`);
  await expect(friendsList(guest).getByText(a.name)).toBeVisible();

  // The link had one use.
  await a.page.goto("/friends");
  await expect(a.page.getByText("次数已用完 · 已用 1/1 次")).toBeVisible();
  const late = await visitor(browser);
  await late.goto(invitePath);
  await expect(mainAlert(late)).toHaveText("这个邀请链接的使用次数已用完。");
});

test("existing user logs in through an invite and accepts it", async ({ browser }) => {
  const a = await newUser(browser);
  const b = await newUser(browser);
  await logout(b.page);
  const invitePath = await createInvite(a.page, "unlimited");

  await b.page.goto(invitePath);
  await b.page.getByRole("link", { name: "已有账号？登录" }).click();
  await submitLogin(b.page, b.username, "password123");
  await expect(b.page).toHaveURL(invitePath);

  await b.page.getByRole("button", { name: "接受邀请，成为好友" }).click();
  await expect(mainStatus(b.page).first()).toHaveText(`你和 ${a.name} 已成为好友！`);

  await b.page.goto(invitePath);
  await expect(mainStatus(b.page)).toHaveText("你们已经是好友了。");
  await a.page.goto(invitePath);
  await expect(mainStatus(a.page)).toHaveText("这是你自己的邀请链接，把它发给朋友吧。");
});

test("revoked invites stop working", async ({ browser }) => {
  const a = await newUser(browser);
  const invitePath = await createInvite(a.page, "5");
  await a.page.getByRole("button", { name: "作废" }).first().click();
  await expect(a.page.locator("code", { hasText: invitePath })).toHaveCount(0);

  const guest = await visitor(browser);
  await guest.goto(invitePath);
  await expect(mainAlert(guest)).toHaveText("这个邀请链接已被作废。");
  await guest.goto("/invite/does-not-exist");
  await expect(mainAlert(guest)).toHaveText("邀请链接不存在。");
});

test("Steam suggestions prompt to link Steam when not linked", async ({ browser }) => {
  const a = await newUser(browser);
  await a.page.goto("/friends");
  await expect(a.page.getByText("绑定 Steam 后，可以找到已注册本站的 Steam 好友。")).toBeVisible();
  await expect(a.page.getByRole("link", { name: "绑定 Steam" })).toHaveAttribute(
    "href",
    "/api/auth/steam?intent=link",
  );
});
