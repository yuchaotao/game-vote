"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translator, type Locale, type T } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Gives client components the language the server picked for this request. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

export function useT(): T {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
