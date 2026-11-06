import { en } from "./en";

// Interface language (#65). The Chinese text is the key: t("每人最多 {n} 票", { n }).
// Safe for client components (no server-only imports).

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh";
export const LOCALE_COOKIE = "gv_locale";

/**
 * Follow the browser's language when nobody chose one. Off until the whole
 * interface is translated; the cookie works regardless (used by tests).
 */
export const DETECT_BROWSER_LANGUAGE = false;

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** The most preferred language in an Accept-Language header; unknown ones get English. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest.map((r) => /^\s*q=([\d.]+)/.exec(r)?.[1]).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((l) => l.tag && l.tag !== "*" && l.q > 0)
    .sort((a, b) => b.q - a.q);
  if (ranked.length === 0) return DEFAULT_LOCALE;
  return ranked[0].tag.split("-")[0] === "zh" ? "zh" : "en";
}

/** A language someone chose wins; then the browser's (when enabled); then the default. */
export function pickLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
  detect = DETECT_BROWSER_LANGUAGE,
): Locale {
  if (isLocale(cookie)) return cookie;
  return detect ? localeFromAcceptLanguage(acceptLanguage) : DEFAULT_LOCALE;
}

export type Params = Record<string, string | number>;

function fill(source: string, params?: Params) {
  // English plurals: "{n} vote|{n} votes", picked by params.n.
  const forms = source.split("|");
  const text = forms.length === 2 ? forms[params?.n === 1 ? 0 : 1] : source;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in params ? String(params[name]) : all,
  );
}

/** `text` in `locale`, with its {placeholders} filled in. */
export function translate(locale: Locale, text: string, params?: Params): string {
  return fill(locale === "zh" ? text : (en[text] ?? text), params);
}

export type T = (text: string, params?: Params) => string;

export const translator =
  (locale: Locale): T =>
  (text, params) =>
    translate(locale, text, params);

/** Marks text to translate later (module constants); returns it unchanged. */
export const msg = (text: string) => text;

/**
 * An error shown to people: `key` and `params` translate it where it is caught
 * (`err.localize(t)`), and `message` is the Chinese text, for logs and Discord.
 */
export class LocalizedError extends Error {
  constructor(
    readonly key: string,
    readonly params?: Params,
    /** Params that are translation keys themselves. */
    private readonly keyParams: string[] = [],
  ) {
    super(translate(DEFAULT_LOCALE, key, params));
  }

  localize(t: T): string {
    const params = { ...this.params };
    for (const name of this.keyParams) params[name] = t(String(params[name]));
    return t(this.key, params);
  }
}

/** For Intl and toLocale*: formats dates and numbers for the language. */
export const intlLocale = (locale: Locale) => (locale === "zh" ? "zh-CN" : "en-US");
