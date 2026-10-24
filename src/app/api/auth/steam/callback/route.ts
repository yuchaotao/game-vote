import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { finishOAuth } from "@/lib/auth/oauth-state";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { getSteamPlayer, verifySteamAssertion } from "@/lib/auth/steam";
import {
  createUserFromProfile,
  findUserByAccount,
  linkAccount,
  type ExternalProfile,
} from "@/lib/auth/users";

export async function GET(req: NextRequest) {
  const { APP_URL, STEAM_API_KEY } = env();
  const to = (path: string) => NextResponse.redirect(new URL(path, APP_URL));
  const query = req.nextUrl.searchParams;

  const intent = await finishOAuth("steam", query.get("state"));
  if (!intent) return to("/login?error=oauth_state");

  const steamId = await verifySteamAssertion(query, `${APP_URL}/api/auth/steam/callback`);
  if (!steamId)
    return to(intent === "link" ? "/settings?error=steam_failed" : "/login?error=steam_failed");

  const player = await getSteamPlayer(steamId, STEAM_API_KEY);
  const profile: ExternalProfile = {
    provider: "steam",
    providerAccountId: steamId,
    displayName: player?.personaname ?? `steam${steamId.slice(-6)}`,
    avatarUrl: player?.avatarfull,
  };

  if (intent === "link") {
    const user = await getCurrentUser();
    if (!user) return to("/login");
    const result = await linkAccount(user.id, profile);
    return to(
      result === "linked" || result === "already-linked"
        ? "/settings?linked=steam"
        : "/settings?error=steam_taken",
    );
  }

  const user =
    (await findUserByAccount("steam", steamId)) ?? (await createUserFromProfile(profile));
  await createSession(user.id);
  return to("/");
}
