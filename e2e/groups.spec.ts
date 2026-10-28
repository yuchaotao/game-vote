import { expect, test, type Page } from "@playwright/test";
import { mainAlert, mainStatus, uid } from "./helpers";
import { befriend, createGroup, inviteToGroup as invite, newUser, type User } from "./social";

// Each test signs up several users and befriends them; allow time on slow dev machines.
test.describe.configure({ timeout: 180_000 });

const members = (page: Page) => page.getByRole("list", { name: "成员列表" });

test("owner creates a group and pulls a friend in directly", async ({ browser }) => {
  const owner = await newUser(browser);
  const friend = await newUser(browser);
  await befriend(owner, friend);

  const groupName = `群${uid().slice(-5)}`;
  const path = await createGroup(owner, groupName);
  await expect(members(owner.page).getByText("群主")).toBeVisible();

  await invite(owner, path, friend);
  await expect(mainStatus(owner.page).first()).toHaveText(`${friend.name}：已加入群`);
  await expect(members(owner.page).getByText(friend.name)).toBeVisible();

  await friend.page.goto("/groups");
  await friend.page.getByRole("link", { name: new RegExp(groupName) }).click();
  await expect(members(friend.page).getByText(owner.name)).toBeVisible();
  // Members don't get owner controls.
  await expect(friend.page.getByRole("heading", { name: "群设置" })).toHaveCount(0);
  await expect(friend.page.getByRole("button", { name: "移出" })).toHaveCount(0);
});

test("member invites need owner approval; reject and approve", async ({ browser }) => {
  const owner = await newUser(browser);
  const member = await newUser(browser);
  const x = await newUser(browser);
  const y = await newUser(browser);
  await befriend(owner, member);
  await befriend(member, x);
  await befriend(member, y);

  const path = await createGroup(owner, `群${uid().slice(-5)}`);
  await invite(owner, path, member);

  // Member invites two of their own friends (not the owner's friends).
  await member.page.goto(path);
  await member.page.getByRole("checkbox", { name: x.name }).check();
  await member.page.getByRole("checkbox", { name: y.name }).check();
  await member.page.getByRole("button", { name: "邀请", exact: true }).click();
  await expect(mainStatus(member.page).first()).toContainText(`${x.name}：已提交，等待群主确认`);
  await expect(
    member.page.getByRole("heading", { name: "我邀请的（等待群主确认）" }),
  ).toBeVisible();

  // Not a member until approved.
  await x.page.goto(path);
  await expect(x.page.getByText("404")).toBeVisible();

  await owner.page.goto("/groups");
  await expect(owner.page.getByLabel("2 个入群申请待审批")).toBeVisible();
  await expect(owner.page.getByText("2 待审批")).toBeVisible();
  await owner.page.goto(path);
  const requests = owner.page
    .getByRole("heading", { name: "待审批的入群申请" })
    .locator("xpath=..");
  await expect(requests.getByText(`由 ${member.name} 邀请`).first()).toBeVisible();

  const rowOf = (u: User) => requests.getByRole("listitem").filter({ hasText: u.name });
  await rowOf(x).getByRole("button", { name: "同意" }).click();
  await expect(members(owner.page).getByText(x.name)).toBeVisible();
  await rowOf(y).getByRole("button", { name: "拒绝" }).click();
  await expect(owner.page.getByRole("heading", { name: "待审批的入群申请" })).toHaveCount(0);
  await expect(members(owner.page).getByText(y.name)).toHaveCount(0);
  await expect(owner.page.getByLabel(/个入群申请待审批/)).toHaveCount(0);

  await x.page.goto(path);
  await expect(members(x.page).getByText(x.name)).toBeVisible();
  await y.page.goto(path);
  await expect(y.page.getByText("404")).toBeVisible();
});

test("member can withdraw their own pending invitation", async ({ browser }) => {
  const owner = await newUser(browser);
  const member = await newUser(browser);
  const x = await newUser(browser);
  await befriend(owner, member);
  await befriend(member, x);
  const path = await createGroup(owner, `群${uid().slice(-5)}`);
  await invite(owner, path, member);
  await invite(member, path, x);

  await member.page.getByRole("button", { name: "撤回" }).click();
  await expect(member.page.getByRole("heading", { name: /我邀请的/ })).toHaveCount(0);
  // x is invitable again.
  await expect(member.page.getByRole("checkbox", { name: x.name })).toBeVisible();
});

test("remove member, transfer ownership, leave, dissolve", async ({ browser }) => {
  const owner = await newUser(browser);
  const b = await newUser(browser);
  const c = await newUser(browser);
  await befriend(owner, b);
  await befriend(owner, c);
  const groupName = `群${uid().slice(-5)}`;
  const path = await createGroup(owner, groupName);
  await invite(owner, path, b);
  await invite(owner, path, c);

  // Owner can't leave while others remain.
  await expect(owner.page.getByRole("button", { name: "退出群" })).toHaveCount(0);

  owner.page.once("dialog", (d) => d.accept());
  await members(owner.page)
    .getByRole("listitem")
    .filter({ hasText: c.name })
    .getByRole("button", { name: "移出" })
    .click();
  await expect(members(owner.page).getByText(c.name)).toHaveCount(0);
  await c.page.goto(path);
  await expect(c.page.getByText("404")).toBeVisible();

  owner.page.once("dialog", (d) => d.accept());
  await members(owner.page)
    .getByRole("listitem")
    .filter({ hasText: b.name })
    .getByRole("button", { name: "设为群主" })
    .click();
  await expect(owner.page.getByRole("heading", { name: "群设置" })).toHaveCount(0);

  // Former owner is now a regular member and can leave.
  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: "退出群" }).click();
  await expect(owner.page).toHaveURL(/\/groups\?left=1/);
  await expect(owner.page.getByRole("link", { name: new RegExp(groupName) })).toHaveCount(0);

  // New owner edits the group, then dissolves it.
  await b.page.goto(path);
  await expect(b.page.getByRole("heading", { name: "群设置" })).toBeVisible();
  await b.page.getByLabel("群名", { exact: true }).fill(`${groupName}改`);
  await b.page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(b.page.getByRole("heading", { level: 1, name: `${groupName}改` })).toBeVisible();

  b.page.once("dialog", (d) => d.accept());
  await b.page.getByRole("button", { name: "解散群" }).click();
  await expect(b.page).toHaveURL(/\/groups\?dissolved=1/);
  await b.page.goto(path);
  await expect(b.page.getByText("404")).toBeVisible();
});

test("validation and access control", async ({ browser }) => {
  const owner = await newUser(browser);
  await owner.page.goto("/groups");
  await owner.page.getByLabel("群名").fill("   ");
  await owner.page.getByRole("button", { name: "创建群" }).click();
  await expect(mainAlert(owner.page)).toHaveText("群名不能为空");

  const path = await createGroup(owner, `群${uid().slice(-5)}`);
  await expect(owner.page.getByText("没有可以邀请的好友")).toBeVisible();

  const stranger = await newUser(browser);
  await stranger.page.goto(path);
  await expect(stranger.page.getByText("404")).toBeVisible();
});
