import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/ledger', label: '台账', enabled: true },
  { href: '/portfolio', label: '组合', enabled: true },
  { href: '/analyses', label: 'AI 分析', enabled: true },
  { href: '/sectors', label: '板块', enabled: true },
  { href: '/alerts', label: '提醒', enabled: true },
  { href: '/daily', label: '日报', enabled: true },
] as const;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/ledger" className="text-lg font-semibold">
            Investment V2
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {NAV.map(item =>
              item.enabled ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="text-foreground/80 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  className="cursor-not-allowed text-muted-foreground/60"
                  title="W4+ 才会启用"
                >
                  {item.label}
                </span>
              ),
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
