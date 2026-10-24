// User-facing messages for `?error=` / `?linked=` query codes set by auth redirects.
export const AUTH_ERRORS: Record<string, string> = {
  oauth_state: "登录请求已过期，请重试。",
  steam_failed: "Steam 验证失败，请重试。",
  steam_taken: "这个 Steam 账号已绑定到其他用户。",
  discord_failed: "Discord 授权失败，请重试。",
  discord_taken: "这个 Discord 账号已绑定到其他用户。",
  discord_not_linked:
    "这个 Discord 账号还没有绑定任何用户。请先用其他方式登录，再在设置中绑定 Discord。",
  discord_not_configured: "站点尚未配置 Discord 登录。",
};

export const LINKED_MESSAGES: Record<string, string> = {
  steam: "Steam 账号已绑定。",
  discord: "Discord 账号已绑定。",
};

export function pick(map: Record<string, string>, key: string | string[] | undefined) {
  return typeof key === "string" ? map[key] : undefined;
}
