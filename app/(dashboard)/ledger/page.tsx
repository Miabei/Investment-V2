import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ClassifyButton } from './_components/classify-button';

// 该页运行时从 Postgres 读数据,禁止静态预渲染
export const dynamic = 'force-dynamic';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

function fmt(value: { toString(): string } | null | undefined): string {
  if (value == null) return '-';
  const n = Number(value.toString());
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(value: { toString(): string } | null | undefined): string {
  if (value == null) return '-';
  const n = Number(value.toString());
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default async function LedgerPage() {
  const batches = await prisma.importBatch.findMany({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { holdings: true } } },
    take: 10,
  });

  const latestBatch = batches[0];
  const holdings = latestBatch
    ? await prisma.holding.findMany({
        where: { importBatchId: latestBatch.id },
        orderBy: { amount: 'desc' },
      })
    : [];

  // 全用户范围内 sector 或 sectorBucket 为空的持仓数(任一缺都需要补)
  const missingSectorCount = await prisma.holding.count({
    where: {
      userId: SINGLE_USER_ID,
      OR: [
        { sector: null },
        { sector: '' },
        { sectorBucket: null },
        { sectorBucket: '' },
      ],
    },
  });

  const totalAmount = holdings.reduce(
    (s, h) => s + Number(h.amount.toString()),
    0,
  );
  const totalProfit = holdings.reduce(
    (s, h) => s + Number(h.profit.toString()),
    0,
  );
  const cost = totalAmount - totalProfit;
  const totalRate = cost > 0 ? (totalProfit / cost) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">投资台账</h1>
          <p className="text-sm text-muted-foreground">
            从 CSV / Excel 导入,或手动录入持仓数据。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ClassifyButton count={missingSectorCount} />
          <Link href="/ledger/import" className={buttonVariants()}>
            导入新数据
          </Link>
        </div>
      </div>

      {latestBatch ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>持仓基金数</CardDescription>
                <CardTitle className="text-3xl">{holdings.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>持有金额(元)</CardDescription>
                <CardTitle className="text-3xl">{fmt(totalAmount)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>累计盈亏(元)</CardDescription>
                <CardTitle
                  className={`text-3xl ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {fmt(totalProfit)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>总收益率(按金额加权)</CardDescription>
                <CardTitle
                  className={`text-3xl ${totalRate >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {fmtPct(totalRate)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>当前持仓 — 最新批次</CardTitle>
              <CardDescription>
                {new Date(latestBatch.createdAt).toLocaleString('zh-CN')} ·{' '}
                {latestBatch.format} 导入 · 共 {holdings.length} 只基金
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>基金名称</TableHead>
                    <TableHead className="w-24">代码</TableHead>
                    <TableHead className="text-right">持有金额</TableHead>
                    <TableHead className="text-right">累计盈亏</TableHead>
                    <TableHead className="text-right">收益率</TableHead>
                    <TableHead>领域</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((h, i) => {
                    const profit = Number(h.profit.toString());
                    const rate = Number(h.profitRate.toString());
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {h.fundName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {h.fundCode ?? '-'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(h.amount)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {fmt(h.profit)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${rate >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {fmtPct(rate)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                          {h.sector ?? '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {batches.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>历史导入</CardTitle>
                <CardDescription>近 10 次导入</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">条数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">
                          {new Date(b.createdAt).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell>{b.format}</TableCell>
                        <TableCell>{b.status}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b._count.holdings}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>还没有持仓数据</CardTitle>
            <CardDescription>
              点右上角「导入新数据」上传 CSV 或 Excel 文件。
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
