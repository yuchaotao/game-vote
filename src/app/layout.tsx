import type { Metadata } from "next";
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
