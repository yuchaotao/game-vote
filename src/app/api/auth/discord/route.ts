import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { discordAuthorizeUrl } from "@/lib/auth/discord";
import { beginOAuth } from "@/lib/auth/oauth-state";

// GET /api/auth/discord?intent=login|link
export async function GET(req: NextRequest) {
  const { APP_URL, DISCORD_CLIENT_ID } = env();
  const intent = req.nextUrl.searchParams.get("intent") === "link" ? "link" : "login";
  if (!DISCORD_CLIENT_ID) {
    const page = intent === "link" ? "/settings" : "/login";
    return NextResponse.redirect(new URL(`${page}?error=discord_not_configured`, APP_URL));
  }
  const state = await beginOAuth("discord", intent, req.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(
    discordAuthorizeUrl(DISCORD_CLIENT_ID, `${APP_URL}/api/auth/discord/callback`, state),
  );
}
