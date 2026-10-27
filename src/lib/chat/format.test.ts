import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  mergeMessages,
  normalizeBody,
  segmentMessage,
  type ChatMessageDTO,
} from "./format";

describe("segmentMessage", () => {
  it("returns plain text as one segment", () => {
    expect(segmentMessage("今晚玩什么？")).toEqual([{ type: "text", text: "今晚玩什么？" }]);
  });

  it("extracts links and trims trailing punctuation", () => {
    expect(segmentMessage("看这个 https://store.steampowered.com/app/730/，不错！")).toEqual([
      { type: "text", text: "看这个 " },
      { type: "link", href: "https://store.steampowered.com/app/730/" },
      { type: "text", text: "，不错！" },
    ]);
  });

  it("keeps query strings and handles several links", () => {
    const segs = segmentMessage("a http://x.io/p?q=1&r=2 b https://y.io");
    expect(segs.filter((s) => s.type === "link")).toEqual([
      { type: "link", href: "http://x.io/p?q=1&r=2" },
      { type: "link", href: "https://y.io" },
    ]);
  });

  it("does not linkify other schemes", () => {
    expect(segmentMessage("javascript:alert(1)")).toEqual([
      { type: "text", text: "javascript:alert(1)" },
    ]);
  });

  it("highlights mentions of known members, preferring the longest name", () => {
    expect(segmentMessage("@小明同学 和 @小明 来不来", ["小明", "小明同学"])).toEqual([
      { type: "mention", name: "小明同学" },
      { type: "text", text: " 和 " },
      { type: "mention", name: "小明" },
      { type: "text", text: " 来不来" },
    ]);
  });

  it("leaves unknown @handles and emails alone", () => {
    expect(segmentMessage("@nobody a@b.com", ["小明"])).toEqual([
      { type: "text", text: "@nobody a@b.com" },
    ]);
  });
});

describe("normalizeBody", () => {
  it("trims and normalizes newlines", () => {
    expect(normalizeBody("  hi\r\nthere  ")).toBe("hi\nthere");
  });
  it("rejects empty and over-long messages", () => {
    expect(normalizeBody("   ")).toBeNull();
    expect(normalizeBody("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBeNull();
    expect(normalizeBody("x".repeat(MAX_MESSAGE_LENGTH))).not.toBeNull();
  });
});

describe("mergeMessages", () => {
  const msg = (id: string, createdAt: string): ChatMessageDTO => ({
    id,
    createdAt,
    type: "USER",
    body: id,
    author: null,
  });

  it("dedupes by id and sorts oldest first", () => {
    const a = [msg("2", "2026-10-28T10:00:02Z"), msg("1", "2026-10-28T10:00:01Z")];
    const b = [msg("2", "2026-10-28T10:00:02Z"), msg("3", "2026-10-28T10:00:03Z")];
    expect(mergeMessages(a, b).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });
});

describe("segmentMessage edge cases", () => {
  it("ends a link at CJK text with no space", () => {
    expect(segmentMessage("链接https://a.io/x这个")).toEqual([
      { type: "text", text: "链接" },
      { type: "link", href: "https://a.io/x" },
      { type: "text", text: "这个" },
    ]);
  });
  it("drops a trailing ASCII period or bracket", () => {
    expect(segmentMessage("(see https://a.io/x).")[1]).toEqual({
      type: "link",
      href: "https://a.io/x",
    });
  });
});
