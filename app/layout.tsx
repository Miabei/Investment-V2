import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Investment V2',
  description: '个人投资监控系统',
};

// 不用 next/font/google,因为国内访问 fonts.googleapis.com 被墙。
// 用系统字体栈,中文用「微软雅黑/苹方」,等宽字段用 Consolas/Menlo。
const fontVars = {
  '--font-sans':
    `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif`,
  '--font-mono':
    `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace`,
} as React.CSSProperties;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" style={fontVars}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
