// 每日自动化流水线
// 用法: npx tsx scripts/daily-pipeline.ts
// 设计给 cron / scheduled task 每天收盘后 (15:30) 运行

import 'dotenv/config';
import { prisma } from '@/lib/db';
import { emSearchFund, pmap } from '@/lib/market/eastmoney';
import { fetchFundEstimate, fetchLatestNav, getSectorChangeAggregation } from '@/lib/market/quotes';
import { generateSectorInsight } from '@/lib/ai/deepseek';
import { evaluateAllRules } from '@/lib/alerts/engine';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';
const SECTOR_INSIGHT_THRESHOLD = 2; // 板块涨跌幅超过 ±2% 才生成 AI 解读

async function main() {
  console.log('═══════════════════════════════════');
  console.log(`  每日流水线 — ${new Date().toLocaleString('zh-CN')}`);
  console.log('═══════════════════════════════════\n');

  // ══════ 第 1 步:刷新行情 ══════
  console.log('[1/4] 刷新行情…');

  const holdings = await getLatestHoldings();
  if (holdings.length === 0) {
    console.log('  没有持仓数据,跳过。\n');
    return;
  }

  // 解析基金代码(对没有 code 的,EM 搜索补上)
  const codeMap = new Map<string, string>();
  const needResolve: string[] = [];
  for (const h of holdings) {
    if (h.fundCode) {
      codeMap.set(h.fundName, h.fundCode);
    } else {
      needResolve.push(h.fundName);
    }
  }

  if (needResolve.length > 0) {
    console.log(`  解析 ${needResolve.length} 只基金代码…`);
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
  console.log(`  拉取 ${uniqueCodes.length} 只基金行情…`);

  let quotesFetched = 0;
  let quotesStored = 0;

  await pmap(uniqueCodes, 5, async code => {
    try {
      const [est, nav] = await Promise.all([
        fetchFundEstimate(code),
        fetchLatestNav(code),
      ]);
      quotesFetched++;

      const navValue = (est && est.lastNav > 0 ? est.lastNav : 0) || nav?.nav || 0;
      const changePct = est?.estimateChangePct ?? nav?.changePct ?? 0;
      const dateStr = nav?.date || est?.lastNavDate || new Date().toISOString().slice(0, 10);

      if (navValue > 0) {
        await prisma.marketQuote.upsert({
          where: { fundCode_date: { fundCode: code, date: new Date(dateStr) } },
          update: { nav: navValue, changePct },
          create: {
            fundCode: code,
            date: new Date(dateStr),
            nav: navValue,
            changePct,
          },
        });
        quotesStored++;
      }
    } catch (e) {
      console.warn(`    ${code} 失败: ${String(e).slice(0, 40)}`);
    }
  });

  console.log(`  获取 ${quotesFetched}, 入库 ${quotesStored}\n`);

  // ══════ 第 2 步:AI 板块解读 ══════
  console.log('[2/4] AI 板块解读…');

  const sectorAgg = await getSectorChangeAggregation();
  const significant = sectorAgg.filter(
    s => Math.abs(s.avgChangePct) >= SECTOR_INSIGHT_THRESHOLD,
  );

  if (significant.length === 0) {
    console.log(`  没有板块涨跌超过 ±${SECTOR_INSIGHT_THRESHOLD}%,跳过。\n`);
  } else {
    console.log(`  ${significant.length} 个板块异常波动:\n`);

    // Get top funds per sector for context
    const quoteMap = new Map<string, number>();
    const quotes = await prisma.marketQuote.findMany({ orderBy: { date: 'desc' } });
    for (const q of quotes) {
      if (!quoteMap.has(q.fundCode)) quoteMap.set(q.fundCode, Number(q.changePct));
    }

    let insightsGenerated = 0;
    for (const sector of significant) {
      // Find funds in this sector with quotes
      const sectorFunds: Array<{ fundName: string; changePct: number }> = [];

      const fundNames = holdings
        .filter(h => (h.sectorBucket || '未分类') === sector.bucket)
        .map(h => ({ fundName: h.fundName, fundCode: h.fundCode }));

      for (const f of fundNames) {
        const chg = f.fundCode ? quoteMap.get(f.fundCode) : undefined;
        if (chg !== undefined) {
          sectorFunds.push({ fundName: f.fundName, changePct: chg });
        }
      }
      sectorFunds.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

      try {
        const insight = await generateSectorInsight(sector.bucket, {
          avgChangePct: sector.avgChangePct,
          fundCount: sector.fundCount,
          topFunds: sectorFunds.slice(0, 5),
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await prisma.sectorInsight.upsert({
          where: { sector_date: { sector: sector.bucket, date: today } },
          update: { insight },
          create: { sector: sector.bucket, date: today, insight },
        });

        console.log(`  ${sector.bucket}: ${sector.avgChangePct >= 0 ? '+' : ''}${sector.avgChangePct.toFixed(2)}%`);
        console.log(`    → ${insight}`);
        insightsGenerated++;
      } catch (e) {
        console.warn(`    ${sector.bucket} 解读失败: ${String(e).slice(0, 60)}`);
      }
    }
    console.log(`\n  生成 ${insightsGenerated} 条解读\n`);
  }

  // ══════ 第 3 步:评估提醒 ══════
  console.log('[3/4] 评估提醒规则…');
  const { checked, triggered, events } = await evaluateAllRules();
  console.log(`  检查 ${checked} 条, 触发 ${triggered} 条`);

  if (events.length > 0) {
    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | null;
      const val = payload?.changePct ?? payload?.avgChangePct ?? '?';
      console.log(`    ⚡ 触发: ${typeof val === 'number' ? val.toFixed(2) + '%' : val}`);
    }
  }
  console.log('');

  // ══════ 第 4 步:汇总 ══════
  console.log('[4/4] 汇总…');
  const upCount = sectorAgg.filter(s => s.avgChangePct > 0).length;
  const downCount = sectorAgg.filter(s => s.avgChangePct < 0).length;
  const topGainer = sectorAgg.reduce((a, b) => (a.avgChangePct > b.avgChangePct ? a : b), sectorAgg[0]!);
  const topLoser = sectorAgg.reduce((a, b) => (a.avgChangePct < b.avgChangePct ? a : b), sectorAgg[0]!);

  console.log(`  板块: ${upCount} 涨 / ${downCount} 跌`);
  console.log(`  领涨: ${topGainer.bucket} ${topGainer.avgChangePct >= 0 ? '+' : ''}${topGainer.avgChangePct.toFixed(2)}%`);
  console.log(`  领跌: ${topLoser.bucket} ${topLoser.avgChangePct.toFixed(2)}%`);
  console.log('');

  console.log('═══════════════════════════════════');
  console.log('  流水线完成');
  console.log('═══════════════════════════════════');
}

async function getLatestHoldings(): Promise<
  Array<{ fundName: string; fundCode: string | null; sectorBucket: string | null }>
> {
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

main()
  .catch(err => {
    console.error('\n流水线失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
