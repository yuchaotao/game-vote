import { expect } from "@playwright/test";

// Reads mail captured by Mailpit (docker compose --profile dev).
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Summary = { ID: string; Subject: string };

/** Waits for the newest email to `to` whose subject contains `subject`, returns its first link. */
export async function latestLink(to: string, subject: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const q = encodeURIComponent(`to:"${to}"`);
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}`);
        const { messages } = (await res.json()) as { messages: Summary[] };
        const msg = messages.find((m) => m.Subject.includes(subject));
        if (!msg) return undefined;
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
          Text: string;
        };
        link = /https?:\/\/\S+/.exec(full.Text)?.[0];
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return link!;
}
