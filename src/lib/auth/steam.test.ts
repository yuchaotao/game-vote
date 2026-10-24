import { describe, expect, it, vi } from "vitest";
import { getSteamPlayer, steamIdFromClaimedId, steamLoginUrl, verifySteamAssertion } from "./steam";

const RETURN_TO = "https://vote.example.com/api/auth/steam/callback";
const STEAM_ID = "76561197960287930";

function assertion(overrides: Record<string, string> = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": claimed,
    "openid.identity": claimed,
    "openid.return_to": `${RETURN_TO}?state=abc`,
    "openid.response_nonce": "2026-10-24T00:00:00Zxyz",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  });
}

const steamSays = (body: string) =>
  vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

describe("steamLoginUrl", () => {
  it("uses identifier_select and our return_to", () => {
    const url = new URL(steamLoginUrl(`${RETURN_TO}?state=abc`, "https://vote.example.com"));
    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.return_to")).toBe(`${RETURN_TO}?state=abc`);
    expect(url.searchParams.get("openid.claimed_id")).toContain("identifier_select");
  });
});

describe("steamIdFromClaimedId", () => {
  it("extracts the 17-digit id", () => {
    expect(steamIdFromClaimedId(`https://steamcommunity.com/openid/id/${STEAM_ID}`)).toBe(STEAM_ID);
  });
  it("rejects other hosts", () => {
    expect(steamIdFromClaimedId(`https://evil.com/openid/id/${STEAM_ID}`)).toBeNull();
  });
});

describe("verifySteamAssertion", () => {
  it("returns the SteamID when Steam confirms", async () => {
    const fetchImpl = steamSays("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
    await expect(verifySteamAssertion(assertion(), RETURN_TO, fetchImpl)).resolves.toBe(STEAM_ID);

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new URLSearchParams(init.body).get("openid.mode")).toBe("check_authentication");
  });

  it("returns null when Steam rejects", async () => {
    const fetchImpl = steamSays("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n");
    await expect(verifySteamAssertion(assertion(), RETURN_TO, fetchImpl)).resolves.toBeNull();
  });

  it("rejects assertions for another site without calling Steam", async () => {
    const fetchImpl = steamSays("is_valid:true");
    const q = assertion({ "openid.return_to": "https://evil.com/api/auth/steam/callback" });
    await expect(verifySteamAssertion(q, RETURN_TO, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a forged op_endpoint", async () => {
    const fetchImpl = steamSays("is_valid:true");
    const q = assertion({ "openid.op_endpoint": "https://evil.com/openid/login" });
    await expect(verifySteamAssertion(q, RETURN_TO, fetchImpl)).resolves.toBeNull();
  });

  it("rejects mismatched identity and claimed_id", async () => {
    const fetchImpl = steamSays("is_valid:true");
    const q = assertion({
      "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931",
    });
    await expect(verifySteamAssertion(q, RETURN_TO, fetchImpl)).resolves.toBeNull();
  });
});

describe("getSteamPlayer", () => {
  it("returns null without an API key", async () => {
    await expect(getSteamPlayer(STEAM_ID, undefined)).resolves.toBeNull();
  });
  it("returns the first player", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ response: { players: [{ steamid: STEAM_ID, personaname: "Gabe" }] } }),
    ) as unknown as typeof fetch;
    await expect(getSteamPlayer(STEAM_ID, "key", fetchImpl)).resolves.toMatchObject({
      personaname: "Gabe",
    });
  });
});
