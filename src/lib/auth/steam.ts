// Steam sign-in via OpenID 2.0.
// https://steamcommunity.com/dev — Steam only supports the identifier_select flow.

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${params}`;
}

export function steamIdFromClaimedId(claimedId: string | null): string | null {
  return claimedId ? (CLAIMED_ID_RE.exec(claimedId)?.[1] ?? null) : null;
}

/**
 * Verifies an OpenID positive assertion with Steam and returns the 64-bit SteamID.
 * `expectedReturnTo` guards against assertions minted for another site.
 */
export async function verifySteamAssertion(
  query: URLSearchParams,
  expectedReturnTo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (query.get("openid.mode") !== "id_res") return null;
  if (query.get("openid.op_endpoint") !== STEAM_OPENID) return null;

  const returnTo = query.get("openid.return_to");
  if (!returnTo || returnTo.split("?")[0] !== expectedReturnTo.split("?")[0]) return null;

  const steamId = steamIdFromClaimedId(query.get("openid.claimed_id"));
  if (!steamId || query.get("openid.identity") !== query.get("openid.claimed_id")) return null;

  const body = new URLSearchParams();
  for (const [k, v] of query) if (k.startsWith("openid.")) body.set(k, v);
  body.set("openid.mode", "check_authentication");

  const res = await fetchImpl(STEAM_OPENID, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const text = await res.text();
  return /^is_valid\s*:\s*true$/m.test(text) ? steamId : null;
}

export type SteamPlayer = { steamid: string; personaname: string; avatarfull?: string };

/** Fetches public profile info. Returns null without an API key or on failure. */
export async function getSteamPlayer(
  steamId: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SteamPlayer | null> {
  if (!apiKey) return null;
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: { players?: SteamPlayer[] } };
    return data.response?.players?.[0] ?? null;
  } catch {
    return null;
  }
}

export type SteamFriendList =
  { ok: true; steamIds: string[] } | { ok: false; reason: "no-key" | "private" | "error" };

/** Fetches a user's Steam friend list. Requires the friend list to be public. */
export async function getSteamFriendIds(
  steamId: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SteamFriendList> {
  if (!apiKey) return { ok: false, reason: "no-key" };
  const url = `https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&relationship=friend`;
  try {
    const res = await fetchImpl(url);
    // Steam answers 401 when the friend list is private.
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "private" };
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as { friendslist?: { friends?: { steamid: string }[] } };
    return { ok: true, steamIds: data.friendslist?.friends?.map((f) => f.steamid) ?? [] };
  } catch {
    return { ok: false, reason: "error" };
  }
}
