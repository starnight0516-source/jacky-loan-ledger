import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jacky 貸款利息管理系統",
  description: "貸款額度、每日利息、月底結算與繳款管理。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
