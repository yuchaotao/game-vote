import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { discordAuthorizeUrl } from "@/lib/auth/discord";
import { beginOAuth } from "@/lib/auth/oauth-state";
import { absoluteUrl } from "@/lib/urls";

// GET /api/auth/discord?intent=login|link
export async function GET(req: NextRequest) {
  const { DISCORD_CLIENT_ID } = env();
  const intent = req.nextUrl.searchParams.get("intent") === "link" ? "link" : "login";
  if (!DISCORD_CLIENT_ID) {
    const page = intent === "link" ? "/settings" : "/login";
    return NextResponse.redirect(absoluteUrl(`${page}?error=discord_not_configured`));
  }
  const state = await beginOAuth("discord", intent, req.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(
    discordAuthorizeUrl(DISCORD_CLIENT_ID, absoluteUrl("/api/auth/discord/callback"), state),
  );
}
