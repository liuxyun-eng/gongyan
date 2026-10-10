import type { Metadata } from "next";
import "./globals.css";
import "./simple-pages.css";
import "@/app/chat-shell.css";
import "katex/dist/katex.min.css";
import "@/app/readonly-conversations.css";

export const metadata: Metadata = {
  title: "共研 · AI 项目协作",
  description: "分享 Codex Markdown 与关联文件，和课题组一起阅读研究过程。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
