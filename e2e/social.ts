import { expect, type Browser, type Page } from "@playwright/test";
import { friendCodeOf, mainStatus, register, uid, visitor } from "./helpers";

// Multi-user setup shared by group / chat / voting tests.

export type User = { page: Page; name: string; code: string };

/** Signs up a new user in their own browser context. */
export async function newUser(browser: Browser): Promise<User> {
  const page = await visitor(browser);
  const username = uid();
  await register(page, username);
  return { page, name: `测试${username.slice(-4)}`, code: await friendCodeOf(page) };
}

export async function befriend(a: User, b: User) {
  await a.page.goto("/friends");
  await a.page.getByLabel("好友码").fill(b.code);
  await a.page.getByRole("button", { name: "发送申请" }).click();
  await expect(mainStatus(a.page)).toBeVisible();
  await b.page.goto("/friends");
  await b.page.getByRole("button", { name: "接受" }).click();
  await expect(b.page.getByRole("heading", { name: /收到的申请/ })).toHaveCount(0);
}

/** Creates a group and returns its path (/groups/<id>). */
export async function createGroup(owner: User, name: string): Promise<string> {
  await owner.page.goto("/groups");
  await owner.page.getByLabel("群名").fill(name);
  await owner.page.getByLabel("简介（可选）").fill("周末一起玩");
  await owner.page.getByRole("button", { name: "创建群" }).click();
  await expect(owner.page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(owner.page.url()).pathname;
}

export async function inviteToGroup(inviter: User, groupPath: string, friend: User) {
  await inviter.page.goto(groupPath);
  await inviter.page.getByRole("checkbox", { name: friend.name }).check();
  await inviter.page.getByRole("button", { name: "邀请", exact: true }).click();
  await expect(mainStatus(inviter.page).first()).toBeVisible();
}

/** Owner + one friend in a fresh group. */
export async function groupOfTwo(browser: Browser) {
  const owner = await newUser(browser);
  const friend = await newUser(browser);
  await befriend(owner, friend);
  const path = await createGroup(owner, `群${uid().slice(-5)}`);
  await inviteToGroup(owner, path, friend);
  return { owner, friend, path };
}
