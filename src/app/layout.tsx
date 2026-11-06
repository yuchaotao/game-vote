import type { Metadata } from "next";
import { RememberPage } from "@/components/home";
import { I18nProvider } from "@/components/i18n";
import { SiteHeader } from "@/components/site-header";
import { getLocale, getT } from "@/lib/i18n/server";
import { intlLocale } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: "Game Vote", description: t("和朋友一起投票决定下一次玩什么游戏") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={intlLocale(locale)}>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <I18nProvider locale={locale}>
          <SiteHeader />
          <RememberPage />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
