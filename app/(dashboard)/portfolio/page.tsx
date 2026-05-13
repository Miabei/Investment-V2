import Link from 'next/link';
import { prisma } from '@/lib/db';
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
import { buttonVariants } from '@/components/ui/button';
import {
  BucketPieChart,
  BucketProfitBarChart,
  type BucketDatum,
} from './_components/portfolio-charts';
import { BUCKET_COLORS } from '@/lib/portfolio/buckets';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';

function fmt(value: { toString(): string } | number): string {
  const n = typeof value === 'number' ? value : Number(value.toString());
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default async function PortfolioPage() {
  // 取最新批次的持仓作为「当前组合」
  const latestBatch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestBatch) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>还没有持仓数据</CardTitle>
          <CardDescription>
            <Link href="/ledger/import" className="underline">
              先去导入一次
            </Link>
            ,然后回来看可视化看板。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: latestBatch.id },
  });

  const unbucketed = holdings.filter(
    h => !h.sectorBucket || h.sectorBucket.trim() === '',
  );

  // ────── 聚合:by sectorBucket ──────
  const aggMap = new Map<
    string,
    { count: number; amount: number; profit: number }
  >();
  for (const h of holdings) {
    const bucket =
      h.sectorBucket && h.sectorBucket.trim() !== ''
        ? h.sectorBucket
        : '未分类';
    const cur = aggMap.get(bucket) ?? { count: 0, amount: 0, profit: 0 };
    cur.count += 1;
    cur.amount += Number(h.amount.toString());
    cur.profit += Number(h.profit.toString());
    aggMap.set(bucket, cur);
  }
  const buckets: BucketDatum[] = Array.from(aggMap.entries())
    .map(([bucket, d]) => ({ bucket, ...d }))
    .sort((a, b) => b.amount - a.amount);

  // ────── 总指标 ──────
  const totalAmount = buckets.reduce((s, b) => s + b.amount, 0);
  const totalProfit = buckets.reduce((s, b) => s + b.profit, 0);
  const cost = totalAmount - totalProfit;
  const totalRate = cost > 0 ? (totalProfit / cost) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">投资组合</h1>
          <p className="text-sm text-muted-foreground">
            最新批次:{new Date(latestBatch.createdAt).toLocaleString('zh-CN')}{' '}
            · 共 {holdings.length} 只基金
            {unbucketed.length > 0 ? (
              <span className="ml-2 text-amber-600">
                (其中 {unbucketed.length} 只未分类,
                <Link href="/ledger" className="underline">
                  去 /ledger 点「AI 自动补全」
                </Link>
                )
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href="/ledger"
          className={buttonVariants({ variant: 'outline' })}
        >
          返回台账
        </Link>
      </div>

      {/* ────── 4 张指标卡 ────── */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>持仓总金额</CardDescription>
            <CardTitle className="text-3xl">{fmt(totalAmount)}</CardTitle>
            <p className="text-xs text-muted-foreground">元</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>累计盈亏</CardDescription>
            <CardTitle
              className={`text-3xl ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {fmt(totalProfit)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">元</p>
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
            <p className="text-xs text-muted-foreground">盈亏 / 成本</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>覆盖分类</CardDescription>
            <CardTitle className="text-3xl">{buckets.length}</CardTitle>
            <p className="text-xs text-muted-foreground">个桶</p>
          </CardHeader>
        </Card>
      </div>

      {/* ────── 图表 ────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>持仓金额构成</CardTitle>
            <CardDescription>按行业分类桶 × 持仓金额占比</CardDescription>
          </CardHeader>
          <CardContent>
            <BucketPieChart data={buckets} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>各分类累计盈亏</CardTitle>
            <CardDescription>
              横向柱图,按盈亏降序;绿涨红跌
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BucketProfitBarChart data={buckets} />
          </CardContent>
        </Card>
      </div>

      {/* ────── 各桶内单只基金明细 ────── */}
      {buckets.map(b => {
        const fundsInBucket = holdings
          .filter(h => {
            const hBucket = h.sectorBucket && h.sectorBucket.trim() !== ''
              ? h.sectorBucket
              : '未分类';
            return hBucket === b.bucket;
          })
          .sort((a, b) => Number(b.amount) - Number(a.amount));
        return (
          <Card key={`funds-${b.bucket}`}>
            <CardHeader>
              <CardTitle className="text-base">
                <span
                  className="mr-2 inline-block h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: (BUCKET_COLORS as Record<string, string>)[b.bucket] ?? '#9e9e9e',
                  }}
                />
                {b.bucket} · {fundsInBucket.length} 只
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>基金名称</TableHead>
                    <TableHead className="w-24">代码</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead className="text-right">盈亏</TableHead>
                    <TableHead className="text-right">收益率</TableHead>
                    <TableHead>投资领域</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fundsInBucket.map((h, i) => {
                    const profit = Number(h.profit.toString());
                    const rate = h.profitRate ? Number(h.profitRate.toString()) : null;
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{h.fundName}</TableCell>
                        <TableCell className="text-muted-foreground">{h.fundCode ?? '-'}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(h.amount)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(profit)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${(rate ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {rate != null ? fmtPct(rate) : '-'}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{h.sector ?? '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {/* ────── 分桶汇总表 ────── */}
      <Card>
        <CardHeader>
          <CardTitle>分类汇总</CardTitle>
          <CardDescription>各桶的基金数 / 金额 / 盈亏 / 收益率</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>分类桶</TableHead>
                <TableHead className="text-right">基金数</TableHead>
                <TableHead className="text-right">持仓金额</TableHead>
                <TableHead className="text-right">占比</TableHead>
                <TableHead className="text-right">累计盈亏</TableHead>
                <TableHead className="text-right">收益率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map(b => {
                const ratio = totalAmount > 0 ? (b.amount / totalAmount) * 100 : 0;
                const bucketCost = b.amount - b.profit;
                const bucketRate =
                  bucketCost > 0 ? (b.profit / bucketCost) * 100 : 0;
                return (
                  <TableRow key={b.bucket}>
                    <TableCell className="font-medium">{b.bucket}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(b.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {ratio.toFixed(1)}%
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${b.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {fmt(b.profit)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${bucketRate >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {fmtPct(bucketRate)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
