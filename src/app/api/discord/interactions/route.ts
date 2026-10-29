import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { applicationPublicKey, verifyDiscordSignature } from "@/lib/notify/discord-bot";
import { handleInteraction } from "@/lib/votes/discord";

// Discord Interactions endpoint (#47): button clicks on vote and prompt messages.
// Set as the application's Interactions Endpoint URL in the Discord developer portal.

export const dynamic = "force-dynamic";

let publicKey: string | undefined;

/** The application's public key: DISCORD_PUBLIC_KEY, or asked from Discord once. */
async function key(): Promise<string | undefined> {
  const e = env();
  if (e.DISCORD_PUBLIC_KEY) return e.DISCORD_PUBLIC_KEY;
  if (!publicKey && e.DISCORD_BOT_TOKEN) {
    publicKey = await applicationPublicKey({
      apiUrl: e.DISCORD_API_URL,
      token: e.DISCORD_BOT_TOKEN,
    });
  }
  return publicKey;
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const k = await key().catch(() => undefined);
  if (!k || !signature || !timestamp || !verifyDiscordSignature(k, signature, timestamp, body)) {
    return new NextResponse("invalid request signature", { status: 401 });
  }
  return NextResponse.json(await handleInteraction(JSON.parse(body)));
}
