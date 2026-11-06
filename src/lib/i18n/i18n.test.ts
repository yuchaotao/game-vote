import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import {
  LocalizedError,
  localeFromAcceptLanguage,
  pickLocale,
  translate,
  translator,
} from "./index";

describe("picking the language", () => {
  it("follows the browser's most preferred language", () => {
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("en;q=0.5,zh-TW;q=0.9")).toBe("zh");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("")).toBe("zh");
    expect(localeFromAcceptLanguage("*")).toBe("zh");
  });

  it("puts someone's own choice first", () => {
    expect(pickLocale("en", "zh-CN", true)).toBe("en");
    expect(pickLocale("zh", "en-US", true)).toBe("zh");
    expect(pickLocale("xx", "en-US", true)).toBe("en");
    expect(pickLocale(undefined, "en-US", false)).toBe("zh");
    expect(pickLocale("en", "zh-CN", false)).toBe("en");
  });
});

describe("translate", () => {
  it("fills placeholders in either language", () => {
    expect(translate("zh", "至少 8 位")).toBe("至少 8 位");
    expect(translate("en", "至少 8 位")).toBe("At least 8 characters");
    expect(translate("zh", "{n} 个好友申请", { n: 2 })).toBe("2 个好友申请");
    expect(translate("en", "{n} 个好友申请", { n: 2 })).toBe("2 friend requests");
    expect(translate("en", "{n} 个好友申请", { n: 1 })).toBe("1 friend request");
  });

  it("falls back to the source text", () => {
    expect(translate("en", "没有翻译的文字")).toBe("没有翻译的文字");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** Every literal given to t(), msg() or <T text="…">. */
function usedKeys() {
  const keys = new Set<string>();
  const patterns = [
    /\b(?:t|msg)\(\s*"((?:[^"\\]|\\.)*)"/g,
    /<Trans\s+text="([^"]+)"/g,
    /new (?:Vote|Group|Game|Play|HomePage)Error\(\s*"((?:[^"\\]|\\.)*)"/g,
  ];
  for (const file of sources("src")) {
    const code = readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of code.matchAll(re)) keys.add(JSON.parse(`"${m[1]}"`));
    }
  }
  return [...keys];
}

describe("LocalizedError", () => {
  it("keeps Chinese as its message and translates where it is caught", () => {
    const err = new LocalizedError("《{name}》已经是候选了", { name: "Dota 2" });
    expect(err.message).toBe("《Dota 2》已经是候选了");
    expect(err.localize(translator("en"))).toBe("Dota 2 is already a candidate");
    expect(err.localize(translator("zh"))).toBe("《Dota 2》已经是候选了");
  });

  it("translates params that are keys themselves, and no others", () => {
    const err = new LocalizedError(
      "无法在 #{channel} 发消息：{reason}",
      { channel: "投票", reason: "机器人看不到这个频道" },
      ["reason"],
    );
    expect(err.localize(translator("en"))).toBe(
      "Can't post in #投票: The bot can't see this channel",
    );
  });
});

describe("the English dictionary", () => {
  const placeholders = (s: string) =>
    [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

  it("has every text the code asks for", () => {
    expect(usedKeys().filter((key) => !(key in en))).toEqual([]);
  });

  it("uses the same placeholders as the source", () => {
    const wrong = Object.entries(en).filter(
      ([zh, english]) => placeholders(zh).join() !== placeholders(english).join(),
    );
    expect(wrong).toEqual([]);
  });

  it("contains no Chinese", () => {
    expect(Object.values(en).filter((s) => /[一-鿿]/.test(s))).toEqual([]);
  });
});
