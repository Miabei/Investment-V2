// Build the full context object fed to the daily analysis AI

import { prisma } from '@/lib/db';
import { fetchIndexQuotes, type IndexQuote } from '@/lib/market/indices';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export interface SectorSummary {
  bucket: string;
  amount: number;
  sharePct: number;
  profit: number;
  fundCount: number;
  avgChangePct: number | null;
  topFunds: Array<{
    fundName: string;
    fundCode: string | null;
    amount: number;
    changePct: number | null;
  }>;
}

export interface DailyContext {
  date: string;
  indices: IndexQuote[];
  portfolioTotals: {
    totalAmount: number;
    totalProfit: number;
    profitRate: number;
  };
  sectors: SectorSummary[];
  quotesDate: string | null; // date of the fund quotes used
}

export async function buildDailyContext(): Promise<DailyContext | null> {
  const batch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) return null;

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: batch.id },
    orderBy: { amount: 'desc' },
  });
  if (holdings.length === 0) return null;

  // Build latest-quote map from MarketQuote table
  const allQuotes = await prisma.marketQuote.findMany({
    orderBy: { date: 'desc' },
  });
  const latestQuote = new Map<string, { changePct: number; date: string }>();
  for (const q of allQuotes) {
    if (!latestQuote.has(q.fundCode)) {
      latestQuote.set(q.fundCode, {
        changePct: Number(q.changePct),
        date: q.date.toISOString().slice(0, 10),
      });
    }
  }

  // Determine quote freshness date
  const quoteDates = Array.from(latestQuote.values()).map(v => v.date);
  const quotesDate =
    quoteDates.length > 0
      ? quoteDates.sort().at(-1) ?? null
      : null;

  // Portfolio totals
  let totalAmount = 0;
  let totalProfit = 0;
  for (const h of holdings) {
    totalAmount += Number(h.amount);
    totalProfit += Number(h.profit);
  }
  const cost = totalAmount - totalProfit;
  const profitRate = cost > 0 ? (totalProfit / cost) * 100 : 0;

  // Sector aggregation
  const sectorMap = new Map<
    string,
    {
      amount: number;
      profit: number;
      funds: Array<{
        fundName: string;
        fundCode: string | null;
        amount: number;
        changePct: number | null;
      }>;
    }
  >();

  for (const h of holdings) {
    const bucket = h.sectorBucket?.trim() || '未分类';
    const cur = sectorMap.get(bucket) ?? { amount: 0, profit: 0, funds: [] };
    cur.amount += Number(h.amount);
    cur.profit += Number(h.profit);
    const qc = h.fundCode ? latestQuote.get(h.fundCode) : undefined;
    cur.funds.push({
      fundName: h.fundName,
      fundCode: h.fundCode,
      amount: Number(h.amount),
      changePct: qc?.changePct ?? null,
    });
    sectorMap.set(bucket, cur);
  }

  const sectors: SectorSummary[] = Array.from(sectorMap.entries())
    .map(([bucket, d]) => {
      const withChanges = d.funds.filter(f => f.changePct !== null);
      const avgChangePct =
        withChanges.length > 0
          ? withChanges.reduce((s, f) => s + (f.changePct ?? 0), 0) /
            withChanges.length
          : null;

      return {
        bucket,
        amount: Number(d.amount.toFixed(2)),
        sharePct: totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(1)) : 0,
        profit: Number(d.profit.toFixed(2)),
        fundCount: d.funds.length,
        avgChangePct: avgChangePct !== null ? Number(avgChangePct.toFixed(2)) : null,
        topFunds: d.funds
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5)
          .map(f => ({ ...f, amount: Number(f.amount.toFixed(2)) })),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const [indices] = await Promise.all([fetchIndexQuotes()]);

  return {
    date: new Date().toISOString().slice(0, 10),
    indices,
    portfolioTotals: {
      totalAmount: Number(totalAmount.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      profitRate: Number(profitRate.toFixed(2)),
    },
    sectors,
    quotesDate,
  };
}
