import { cookies } from "next/headers";
import { randomToken } from "./crypto";
import { secureCookies } from "./session";

// Short-lived cookie tying an OAuth/OpenID callback to the browser that started it.
const STATE_COOKIE = "gv_oauth";

export type OAuthIntent = "login" | "link";
type StatePayload = { state: string; provider: string; intent: OAuthIntent };

export async function beginOAuth(provider: string, intent: OAuthIntent): Promise<string> {
  const state = randomToken(16);
  const payload: StatePayload = { state, provider, intent };
  (await cookies()).set(STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 10 * 60,
  });
  return state;
}

/** Validates and clears the state cookie. Returns the intent, or null on mismatch. */
export async function finishOAuth(
  provider: string,
  state: string | null,
): Promise<OAuthIntent | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!raw || !state) return null;
  try {
    const payload = JSON.parse(raw) as StatePayload;
    return payload.state === state && payload.provider === provider ? payload.intent : null;
  } catch {
    return null;
  }
}
