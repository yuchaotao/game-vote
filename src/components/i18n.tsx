"use client";

import { createContext, Fragment, useContext, useMemo } from "react";
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

/**
 * A translated sentence with elements in it: {name} placeholders in `text` are
 * replaced by the matching value, which may be a link, a <strong>, and so on.
 */
export function Trans({ text, values }: { text: string; values: Record<string, React.ReactNode> }) {
  const t = useT();
  const parts = t(text).split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{i % 2 ? values[part] : part}</Fragment>
      ))}
    </>
  );
}
