import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await prisma.analysisReport.findFirst({
    where: { id, userId: SINGLE_USER_ID },
  });
  if (!report) notFound();

  const snapshot = report.holdingsSnapshot as {
    capturedAt?: string;
    totalAmount?: number;
    totalProfit?: number;
    totalRate?: number;
    byBucket?: Array<{ bucket: string; amount: number }>;
  } | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">分析报告</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(report.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <Link
          href="/analyses"
          className={buttonVariants({ variant: 'outline' })}
        >
          返回列表
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">用户原始问题</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {report.promptRaw}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">优化后的分析提示词</CardTitle>
          <CardDescription>实际发给 LLM 的指令</CardDescription>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-xs text-muted-foreground">
          {report.promptOptimized}
        </CardContent>
      </Card>

      {snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">当时持仓快照</CardTitle>
            <CardDescription>
              {snapshot.capturedAt
                ? `捕获于 ${new Date(snapshot.capturedAt).toLocaleString('zh-CN')}`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">总持仓金额</div>
              <div className="text-lg tabular-nums">
                {snapshot.totalAmount?.toLocaleString('zh-CN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">累计盈亏</div>
              <div
                className={`text-lg tabular-nums ${
                  (snapshot.totalProfit ?? 0) >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {snapshot.totalProfit?.toLocaleString('zh-CN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">总收益率</div>
              <div
                className={`text-lg tabular-nums ${
                  (snapshot.totalRate ?? 0) >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {snapshot.totalRate?.toFixed(2) ?? '-'}%
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">报告正文</CardTitle>
        </CardHeader>
        <CardContent>
          {report.resultMd.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              报告未完成生成或已失败。
            </p>
          ) : (
            <article className="markdown-body max-w-none text-sm leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {report.resultMd}
              </ReactMarkdown>
            </article>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        声明:本报告为 AI 基于历史快照的数据分析,**不构成投资建议**,据此操作风险自担。
      </p>
    </div>
  );
}
