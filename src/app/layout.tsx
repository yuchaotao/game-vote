import type { Metadata } from "next";
import { RememberPage } from "@/components/home";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Vote",
  description: "和朋友一起投票决定下一次玩什么游戏",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <SiteHeader />
        <RememberPage />
        {children}
      </body>
    </html>
  );
}
