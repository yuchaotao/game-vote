import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { beginOAuth } from "@/lib/auth/oauth-state";
import { steamLoginUrl } from "@/lib/auth/steam";
import { absoluteUrl } from "@/lib/urls";

// GET /api/auth/steam?intent=login|link
export async function GET(req: NextRequest) {
  const intent = req.nextUrl.searchParams.get("intent") === "link" ? "link" : "login";
  const state = await beginOAuth("steam", intent, req.nextUrl.searchParams.get("next"));
  const returnTo = absoluteUrl(`/api/auth/steam/callback?state=${state}`);
  // The realm (shown on Steam's login page) is the site origin; return_to sits under it.
  return NextResponse.redirect(steamLoginUrl(returnTo, new URL(env().APP_URL).origin));
}
