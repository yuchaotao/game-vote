// Steam Web API: who is online and what they are playing (GetPlayerSummaries).

export type SteamPresence = {
  steamId: string;
  /** 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5 looking to trade, 6 looking to play. */
  personaState: number;
  /** 3 = public profile; anything else hides game details. */
  visibility: number;
  /** Steam appid of the game being played; null when not in a game (or non-Steam game). */
  appId: string | null;
  gameName: string | null;
  personaName: string | null;
  avatarUrl: string | null;
};

type RawPlayer = {
  steamid: string;
  personastate?: number;
  communityvisibilitystate?: number;
  gameid?: string;
  gameextrainfo?: string;
  personaname?: string;
  avatarfull?: string;
};

const BATCH = 100; // API limit per call

export function mapPlayer(p: RawPlayer): SteamPresence {
  // Non-Steam shortcuts get a 64-bit "gameid"; only real appids map to store games.
  const appId = p.gameid && /^\d{1,10}$/.test(p.gameid) ? p.gameid : null;
  return {
    steamId: p.steamid,
    personaState: p.personastate ?? 0,
    visibility: p.communityvisibilitystate ?? 1,
    appId,
    gameName: appId ? (p.gameextrainfo ?? null) : null,
    personaName: p.personaname?.trim() || null,
    avatarUrl: p.avatarfull || null,
  };
}

/**
 * Fetches presence for many SteamIDs. Returns null if any batch fails, so a
 * Steam outage never looks like everyone stopped playing.
 */
export async function getSteamPresence(
  steamIds: string[],
  {
    apiKey,
    baseUrl,
    fetchImpl = fetch,
  }: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch },
): Promise<SteamPresence[] | null> {
  const out: SteamPresence[] = [];
  for (let i = 0; i < steamIds.length; i += BATCH) {
    const ids = steamIds.slice(i, i + BATCH).join(",");
    const url = `${baseUrl}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${ids}`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: { players?: RawPlayer[] } };
      if (!data.response?.players) return null;
      out.push(...data.response.players.map(mapPlayer));
    } catch {
      return null;
    }
  }
  return out;
}
