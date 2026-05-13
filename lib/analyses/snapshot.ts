import { prisma } from '@/lib/db';
import type { HoldingsSnapshotForAnalysis } from '@/lib/ai/deepseek';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

/** 从最新 ImportBatch 构造 LLM 需要的持仓快照 */
export async function buildHoldingsSnapshot(): Promise<HoldingsSnapshotForAnalysis | null> {
  const latestBatch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!latestBatch) return null;

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: latestBatch.id },
    orderBy: { amount: 'desc' },
  });
  if (holdings.length === 0) return null;

  // 总指标
  let totalAmount = 0;
  let totalProfit = 0;
  for (const h of holdings) {
    totalAmount += Number(h.amount.toString());
    totalProfit += Number(h.profit.toString());
  }
  const cost = totalAmount - totalProfit;
  const totalRate = cost > 0 ? (totalProfit / cost) * 100 : 0;

  // 按桶聚合
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
  const byBucket = Array.from(aggMap.entries())
    .map(([bucket, d]) => ({
      bucket,
      ...d,
      amount: Number(d.amount.toFixed(2)),
      profit: Number(d.profit.toFixed(2)),
      sharePct:
        totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // 前 20 大持仓
  const topHoldings = holdings.slice(0, 20).map(h => ({
    fundName: h.fundName,
    fundCode: h.fundCode,
    amount: Number(h.amount.toString()),
    profit: Number(h.profit.toString()),
    profitRate: h.profitRate ? Number(h.profitRate.toString()) : null,
    sectorBucket: h.sectorBucket,
    sector: h.sector,
  }));

  return {
    capturedAt: new Date().toISOString(),
    totalAmount: Number(totalAmount.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalRate: Number(totalRate.toFixed(2)),
    byBucket,
    topHoldings,
  };
}
