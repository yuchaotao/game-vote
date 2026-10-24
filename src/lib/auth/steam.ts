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
