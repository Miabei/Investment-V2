import Link from 'next/link';
import { prisma } from '@/lib/db';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';

export default async function AnalysesListPage() {
  const reports = await prisma.analysisReport.findMany({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI 投资分析</h1>
          <p className="text-sm text-muted-foreground">
            把你的疑问交给 AI 结合当前持仓做分析报告。每份报告都会保存当时的持仓快照,日后可复盘。
          </p>
        </div>
        <Link href="/analyses/new" className={buttonVariants()}>
          新建分析
        </Link>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>还没有报告</CardTitle>
            <CardDescription>点右上角「新建分析」开始第一次。</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <Link key={r.id} href={`/analyses/${r.id}`}>
              <Card className="cursor-pointer transition hover:bg-muted/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">
                    {r.promptRaw.slice(0, 80)}
                    {r.promptRaw.length > 80 ? '…' : ''}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-3 text-xs">
                    <span>{new Date(r.createdAt).toLocaleString('zh-CN')}</span>
                    <span>·</span>
                    <span>
                      {r.resultMd.length === 0
                        ? '生成中或失败'
                        : `${r.resultMd.length} 字`}
                    </span>
                  </CardDescription>
                </CardHeader>
                {r.resultMd.length > 0 ? (
                  <CardContent className="line-clamp-3 text-xs text-muted-foreground">
                    {r.resultMd
                      .replace(/[#*`>_~\-]+/g, '')
                      .replace(/\n+/g, ' ')
                      .slice(0, 200)}
                    …
                  </CardContent>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
