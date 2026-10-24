// Discord OAuth2 (authorization code flow), scope `identify`.

const DISCORD_API = "https://discord.com/api/v10";

export function discordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

export function discordAvatarUrl(user: DiscordUser): string | undefined {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
    : undefined;
}

export async function exchangeDiscordCode(
  code: string,
  opts: { clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUser | null> {
  const tokenRes = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  });
  if (!tokenRes.ok) return null;
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return null;

  const userRes = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return null;
  return (await userRes.json()) as DiscordUser;
}
