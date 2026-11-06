import { msg, type T } from "@/lib/i18n";

// User-facing messages for `?error=` / `?linked=` query codes set by auth redirects.
export const AUTH_ERRORS: Record<string, string> = {
  oauth_state: msg("登录请求已过期，请重试。"),
  steam_failed: msg("Steam 验证失败，请重试。"),
  steam_taken: msg("这个 Steam 账号已绑定到其他用户。"),
  discord_failed: msg("Discord 授权失败，请重试。"),
  discord_taken: msg("这个 Discord 账号已绑定到其他用户。"),
  discord_not_linked: msg(
    "这个 Discord 账号还没有绑定任何用户。请先用其他方式登录，再在设置中绑定 Discord。",
  ),
  discord_not_configured: msg("站点尚未配置 Discord 登录。"),
};

export const LINKED_MESSAGES: Record<string, string> = {
  steam: msg("Steam 账号已绑定。"),
  discord: msg("Discord 账号已绑定。"),
};

export function pick(map: Record<string, string>, key: string | string[] | undefined, t: T) {
  return typeof key === "string" && map[key] ? t(map[key]) : undefined;
}
