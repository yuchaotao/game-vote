import { cookies, headers } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, pickLocale, translator, type Locale, type T } from "./index";

/** This request's language (server components and actions). */
export const getLocale = cache(async (): Promise<Locale> => {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return pickLocale(jar.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
});

export async function getT(): Promise<T> {
  return translator(await getLocale());
}
