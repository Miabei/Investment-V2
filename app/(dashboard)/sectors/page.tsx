import { prisma } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BUCKET_COLORS } from '@/lib/portfolio/buckets';
import { SortableFundTable, type FundRow } from './_components/sortable-fund-table';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';

interface SectorRow {
  bucket: string;
  count: number;
  amount: number;
  avgChangePct: number;
  upCount: number;
  downCount: number;
  funds: FundRow[];
}

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function colorFor(bucket: string): string {
  return (BUCKET_COLORS as Record<string, string>)[bucket] ?? '#9e9e9e';
}

export default async function SectorsPage() {
  // 只看最新批次,与台账/组合保持一致
  const latestBatch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });

  const holdings = await prisma.holding.findMany({
    where: {
      userId: SINGLE_USER_ID,
      importBatchId: latestBatch?.id,
    },
    select: {
      fundName: true,
      fundCode: true,
      amount: true,
      sectorBucket: true,
    },
  });

  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>还没有持仓数据</CardTitle>
          <CardDescription>先去导入持仓数据。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // 获取 AI 板块解读(当天)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const insights = await prisma.sectorInsight.findMany({
    where: { date: { gte: today } },
  });
  const insightMap = new Map(insights.map(i => [i.sector, i.insight]));

  // 获取最新行情(每个 fundCode 取最新一条)
  const quotes = await prisma.marketQuote.findMany({
    orderBy: { date: 'desc' },
  });
  const latestQuote = new Map<string, { nav: number; changePct: number }>();
  for (const q of quotes) {
    if (!latestQuote.has(q.fundCode)) {
      latestQuote.set(q.fundCode, {
        nav: Number(q.nav),
        changePct: Number(q.changePct),
      });
    }
  }

  // 按 bucket 聚合(保持每行独立,不合并)
  const aggMap = new Map<string, SectorRow>();
  const allFundRows: FundRow[] = [];

  for (const h of holdings) {
    const bucket = h.sectorBucket && h.sectorBucket.trim() !== '' ? h.sectorBucket : '未分类';
    const cur = aggMap.get(bucket) ?? {
      bucket,
      count: 0,
      amount: 0,
      avgChangePct: 0,
      upCount: 0,
      downCount: 0,
      funds: [],
    };

    const quote = h.fundCode ? latestQuote.get(h.fundCode) : null;
    cur.count += 1;
    cur.amount += Number(h.amount);
    if (quote) {
      if (quote.changePct > 0) cur.upCount += 1;
      else if (quote.changePct < 0) cur.downCount += 1;
    }

    const row: FundRow = {
      fundName: h.fundName,
      fundCode: h.fundCode,
      bucket,
      nav: quote?.nav ?? 0,
      changePct: quote?.changePct ?? 0,
      amount: Number(h.amount),
    };
    cur.funds.push(row);
    allFundRows.push(row);
    aggMap.set(bucket, cur);
  }

  // 计算每桶加权平均涨跌幅
  for (const row of aggMap.values()) {
    const fundsWithQuote = row.funds.filter(f => f.nav > 0);
    if (fundsWithQuote.length > 0) {
      row.avgChangePct =
        fundsWithQuote.reduce((s, f) => s + f.changePct, 0) /
        fundsWithQuote.length;
    }
  }

  const sorted = Array.from(aggMap.values())
    .sort((a, b) => b.amount - a.amount);

  const totalAmount = sorted.reduce((s, b) => s + b.amount, 0);
  const fundCount = holdings.length;
  const fundsWithQuote = allFundRows.filter(f => f.nav > 0);
  const overallAvgChange =
    fundsWithQuote.length > 0
      ? fundsWithQuote.reduce((s, f) => s + f.changePct, 0) / fundsWithQuote.length
      : 0;

  const dateLabel = quotes[0]
    ? new Date(quotes[0].date).toLocaleDateString('zh-CN')
    : '暂无行情';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">板块涨跌看板</h1>
          <p className="text-sm text-muted-foreground">
            按你的持仓分类桶,展示各板块今日涨跌。行情来源:天天基金估算。
            <span className="ml-2 text-xs">({dateLabel})</span>
          </p>
        </div>
      </div>

      {/* Overview card */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            整体加权平均涨跌 · {fundsWithQuote.length} 只有行情 / {fundCount} 只持仓
          </CardDescription>
          <CardTitle
            className={`text-4xl ${overallAvgChange >= 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {fmtPct(overallAvgChange)}
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Per-sector cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map(row => {
          const hasQuote = row.funds.some(f => f.nav > 0);
          return (
            <Card key={row.bucket}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: colorFor(row.bucket) }}
                  />
                  <CardTitle className="text-base">{row.bucket}</CardTitle>
                </div>
                <CardDescription>
                  {row.count} 只 · {fmt(row.amount)} 元 · 占比{' '}
                  {(totalAmount > 0 ? (row.amount / totalAmount) * 100 : 0).toFixed(1)}%
                </CardDescription>
              </CardHeader>
              <CardContent>
                {hasQuote ? (
                  <>
                    <div
                      className={`text-2xl font-semibold ${row.avgChangePct >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {fmtPct(row.avgChangePct)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      涨 {row.upCount} · 跌 {row.downCount}
                    </p>
                    {insightMap.has(row.bucket) ? (
                      <p className="mt-2 text-xs text-muted-foreground italic border-t pt-2">
                        AI: {insightMap.get(row.bucket)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无行情数据</p>
                )}
                <div className="mt-3 space-y-1">
                  {row.funds.slice(0, 5).map((f, i) => (
                    <div
                      key={`${f.fundCode ?? f.fundName}-${i}`}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="max-w-40 truncate" title={f.fundName}>
                        {f.fundName}
                      </span>
                      {f.nav > 0 ? (
                        <span
                          className={`tabular-nums ${f.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {fmtPct(f.changePct)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                  ))}
                  {row.funds.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      ...还有 {row.funds.length - 5} 只
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Sortable full table */}
      <Card>
        <CardHeader>
          <CardTitle>全部持仓 · 今日行情</CardTitle>
          <CardDescription>
            点击「涨跌幅」「持仓金额」「分类桶」列头排序
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SortableFundTable funds={allFundRows} />
        </CardContent>
      </Card>
    </div>
  );
}
