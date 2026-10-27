// Pure helpers for chat messages (shared by server and client).

export const MAX_MESSAGE_LENGTH = 2000;

export type Segment =
  | { type: "text"; text: string }
  | { type: "link"; href: string }
  | { type: "mention"; name: string };

// URLs are ASCII-only, so a link ends at the first CJK character or full-width
// punctuation — Chinese text often follows a URL with no space ("…/730/，不错").
const URL_RE = /https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/g;
// ASCII punctuation that usually ends a sentence rather than the URL.
const TRAILING_PUNCT = /[.,;:!?)\]']+$/;

/**
 * Splits a message into text, links and @mentions of known member names.
 * Only http(s) URLs become links; mentions match the longest member name.
 */
export function segmentMessage(body: string, memberNames: string[] = []): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    const raw = m[0];
    const href = raw.replace(TRAILING_PUNCT, "");
    const start = m.index!;
    pushText(out, body.slice(last, start), memberNames);
    out.push({ type: "link", href });
    last = start + href.length;
  }
  pushText(out, body.slice(last), memberNames);
  return out;
}

function pushText(out: Segment[], text: string, names: string[]) {
  if (!text) return;
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  let buf = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@") {
      const name = sorted.find((n) => text.startsWith(n, i + 1));
      if (name) {
        if (buf) out.push({ type: "text", text: buf });
        buf = "";
        out.push({ type: "mention", name });
        i += name.length + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push({ type: "text", text: buf });
}

/** Normalizes user input; returns null if empty or too long. */
export function normalizeBody(raw: string): string | null {
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (!body || body.length > MAX_MESSAGE_LENGTH) return null;
  return body;
}

export type ChatMessageDTO = {
  id: string;
  type: "USER" | "SYSTEM";
  body: string;
  createdAt: string;
  author: { id: string; displayName: string; avatarUrl: string | null } | null;
};

/** Merges messages by id, sorted oldest first (SSE and pagination can overlap). */
export function mergeMessages(a: ChatMessageDTO[], b: ChatMessageDTO[]): ChatMessageDTO[] {
  const byId = new Map<string, ChatMessageDTO>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort(
    (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id),
  );
}
