import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { discordAvatarUrl, exchangeDiscordCode } from "@/lib/auth/discord";
import { finishOAuth } from "@/lib/auth/oauth-state";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { findUserByAccount, linkAccount } from "@/lib/auth/users";

export async function GET(req: NextRequest) {
  const { APP_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = env();
  const to = (path: string) => NextResponse.redirect(new URL(path, APP_URL));
  const query = req.nextUrl.searchParams;

  const oauth = await finishOAuth("discord", query.get("state"));
  if (!oauth) return to("/login?error=oauth_state");
  const { intent, next } = oauth;
  const failPage = intent === "link" ? "/settings" : "/login";

  const code = query.get("code");
  if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return to(`${failPage}?error=discord_failed`);
  }
  const discordUser = await exchangeDiscordCode(code, {
    clientId: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    redirectUri: `${APP_URL}/api/auth/discord/callback`,
  });
  if (!discordUser) return to(`${failPage}?error=discord_failed`);

  if (intent === "link") {
    const user = await getCurrentUser();
    if (!user) return to("/login");
    const result = await linkAccount(user.id, {
      provider: "discord",
      providerAccountId: discordUser.id,
      displayName: discordUser.global_name ?? discordUser.username,
      avatarUrl: discordAvatarUrl(discordUser),
    });
    return to(
      result === "linked" || result === "already-linked"
        ? "/settings?linked=discord"
        : "/settings?error=discord_taken",
    );
  }

  // Discord is a secondary login: only for accounts that already linked it.
  const user = await findUserByAccount("discord", discordUser.id);
  if (!user) return to("/login?error=discord_not_linked");
  await createSession(user.id);
  return to(next ?? "/");
}
