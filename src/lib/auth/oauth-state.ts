import { cookies } from "next/headers";
import { safeNext } from "@/lib/friends/rules";
import { randomToken } from "./crypto";
import { secureCookies } from "./session";

// Short-lived cookie tying an OAuth/OpenID callback to the browser that started it.
const STATE_COOKIE = "gv_oauth";

export type OAuthIntent = "login" | "link";
type StatePayload = { state: string; provider: string; intent: OAuthIntent; next?: string };
export type OAuthResult = { intent: OAuthIntent; next: string | null };

/** `next` is where to send the user after a successful login (same-site paths only). */
export async function beginOAuth(
  provider: string,
  intent: OAuthIntent,
  next?: string | null,
): Promise<string> {
  const state = randomToken(16);
  const payload: StatePayload = { state, provider, intent, next: safeNext(next) ?? undefined };
  (await cookies()).set(STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 10 * 60,
  });
  return state;
}

/** Validates and clears the state cookie. Returns null on mismatch. */
export async function finishOAuth(
  provider: string,
  state: string | null,
): Promise<OAuthResult | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!raw || !state) return null;
  try {
    const payload = JSON.parse(raw) as StatePayload;
    if (payload.state !== state || payload.provider !== provider) return null;
    return { intent: payload.intent, next: safeNext(payload.next) };
  } catch {
    return null;
  }
}
