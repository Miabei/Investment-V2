// Core daily pipeline — callable from API routes and CLI scripts

import { prisma } from '@/lib/db';
import { emSearchFund, pmap } from '@/lib/market/eastmoney';
import { fetchFundEstimate, fetchLatestNav, getSectorChangeAggregation } from '@/lib/market/quotes';
import { generateSectorInsight } from '@/lib/ai/deepseek';
import { evaluateAllRules } from '@/lib/alerts/engine';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';
const SECTOR_INSIGHT_THRESHOLD = 2;

export interface PipelineResult {
  quotesFetched: number;
  quotesStored: number;
  insightsGenerated: number;
  alertsChecked: number;
  alertsTriggered: number;
}

async function getLatestHoldings() {
  const batch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) return [];
  return prisma.holding.findMany({
    where: { importBatchId: batch.id },
    select: { fundName: true, fundCode: true, sectorBucket: true },
  });
}

export async function runDailyPipeline(): Promise<PipelineResult> {
  const holdings = await getLatestHoldings();
  if (holdings.length === 0) {
    return { quotesFetched: 0, quotesStored: 0, insightsGenerated: 0, alertsChecked: 0, alertsTriggered: 0 };
  }

  // ── Step 1: resolve fund codes + refresh quotes ──
  const codeMap = new Map<string, string>();
  const needResolve: string[] = [];
  for (const h of holdings) {
    if (h.fundCode) codeMap.set(h.fundName, h.fundCode);
    else needResolve.push(h.fundName);
  }

  if (needResolve.length > 0) {
    const resolved = await pmap(needResolve, 5, async name => {
      try {
        const em = await emSearchFund(name);
        return em ? { name, code: em.code } : { name, code: null };
      } catch {
        return { name, code: null };
      }
    });
    for (const r of resolved) {
      if (r.code) codeMap.set(r.name, r.code);
    }
  }

  const uniqueCodes = Array.from(new Set(codeMap.values()));
  let quotesFetched = 0;
  let quotesStored = 0;

  await pmap(uniqueCodes, 5, async code => {
    try {
      const [est, nav] = await Promise.all([fetchFundEstimate(code), fetchLatestNav(code)]);
      quotesFetched++;
      const navValue = (est && est.lastNav > 0 ? est.lastNav : 0) || nav?.nav || 0;
      const changePct = est?.estimateChangePct ?? nav?.changePct ?? 0;
      const dateStr = nav?.date || est?.lastNavDate || new Date().toISOString().slice(0, 10);
      if (navValue > 0) {
        await prisma.marketQuote.upsert({
          where: { fundCode_date: { fundCode: code, date: new Date(dateStr) } },
          update: { nav: navValue, changePct },
          create: { fundCode: code, date: new Date(dateStr), nav: navValue, changePct },
        });
        quotesStored++;
      }
    } catch { /* skip failed fund */ }
  });

  // ── Step 2: AI sector insights for significant movers ──
  const sectorAgg = await getSectorChangeAggregation();
  const significant = sectorAgg.filter(s => Math.abs(s.avgChangePct) >= SECTOR_INSIGHT_THRESHOLD);
  let insightsGenerated = 0;

  if (significant.length > 0) {
    const allQuotes = await prisma.marketQuote.findMany({ orderBy: { date: 'desc' } });
    const quoteMap = new Map<string, number>();
    for (const q of allQuotes) {
      if (!quoteMap.has(q.fundCode)) quoteMap.set(q.fundCode, Number(q.changePct));
    }

    for (const sector of significant) {
      const topFunds = holdings
        .filter(h => (h.sectorBucket || '未分类') === sector.bucket)
        .flatMap(h => {
          const chg = h.fundCode ? quoteMap.get(h.fundCode) : undefined;
          return chg !== undefined ? [{ fundName: h.fundName, changePct: chg }] : [];
        })
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 5);

      try {
        const insight = await generateSectorInsight(sector.bucket, {
          avgChangePct: sector.avgChangePct,
          fundCount: sector.fundCount,
          topFunds,
        });
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await prisma.sectorInsight.upsert({
          where: { sector_date: { sector: sector.bucket, date: today } },
          update: { insight },
          create: { sector: sector.bucket, date: today, insight },
        });
        insightsGenerated++;
      } catch { /* skip failed insight */ }
    }
  }

  // ── Step 3: evaluate alert rules ──
  const { checked, triggered } = await evaluateAllRules();

  return { quotesFetched, quotesStored, insightsGenerated, alertsChecked: checked, alertsTriggered: triggered };
}
