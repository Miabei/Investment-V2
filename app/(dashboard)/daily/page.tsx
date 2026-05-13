import { prisma } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import DailyClient from './_components/daily-client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';

export default async function DailyPage() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [todayReport, pastReports] = await Promise.all([
    prisma.dailyReport.findFirst({
      where: {
        userId: SINGLE_USER_ID,
        date: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.dailyReport.findMany({
      where: {
        userId: SINGLE_USER_ID,
        date: { lt: todayStart },
      },
      orderBy: { date: 'desc' },
      take: 10,
      select: { id: true, date: true, resultMd: true, createdAt: true },
    }),
  ]);

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">每日日报</h1>
          <p className="text-sm text-muted-foreground">
            {dateStr} · 基于大盘指数 + 当前持仓行情自动生成
          </p>
        </div>
        <DailyClient hasToday={!!(todayReport?.resultMd)} />
      </div>

      {/* Today's report */}
      {todayReport?.resultMd ? (
        <Card>
          <CardHeader>
            <CardTitle>
              今日日报 · {todayReport.date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
            </CardTitle>
            <CardDescription>
              生成于 {new Date(todayReport.createdAt).toLocaleTimeString('zh-CN')} · {todayReport.resultMd.length} 字
            </CardDescription>
          </CardHeader>
          <CardContent>
            <article className="markdown-body max-w-none text-sm leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {todayReport.resultMd}
              </ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>今日日报未生成</CardTitle>
            <CardDescription>
              点击右上角「生成今日日报」，AI 将抓取大盘指数并结合你的持仓生成报告。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Past reports */}
      {pastReports.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">历史日报</h2>
          {pastReports.map(r => (
            <Card key={r.id} className="cursor-default">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">
                  {r.date.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short',
                  })}
                </CardTitle>
                <CardDescription className="text-xs">
                  生成于 {new Date(r.createdAt).toLocaleString('zh-CN')} · {r.resultMd.length} 字
                </CardDescription>
              </CardHeader>
              {r.resultMd && (
                <CardContent className="text-xs text-muted-foreground line-clamp-2 pb-3">
                  {r.resultMd.replace(/[#*`>_~\-|]+/g, '').replace(/\n+/g, ' ').slice(0, 200)}…
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
