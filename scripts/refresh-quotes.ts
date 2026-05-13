// 批量:解析基金名称→代码 → 拉取行情 → 写入 MarketQuote
// 用法: npx tsx scripts/refresh-quotes.ts

import 'dotenv/config';
import { prisma } from '@/lib/db';
import { emSearchFund, pmap } from '@/lib/market/eastmoney';
import { fetchFundEstimate, fetchLatestNav } from '@/lib/market/quotes';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

async function main() {
  // 取所有不重复基金名
  const names = await prisma.holding.findMany({
    where: { userId: SINGLE_USER_ID },
    distinct: ['fundName'],
    select: { fundName: true, fundCode: true },
  });

  console.log(`总共 ${names.length} 只基金\n`);

  // 阶段 1: 把没有 code 的通过 EM 搜索补上
  const codeMap = new Map<string, string>();
  for (const h of names) {
    if (h.fundCode) codeMap.set(h.fundName, h.fundCode);
  }

  const needResolve = names.filter(h => !h.fundCode);
  console.log(`[1/2] EM 搜索补代码: ${needResolve.length} 只 (concurrency=5)...`);

  const resolved = await pmap(needResolve, 5, async ({ fundName }) => {
    try {
      const em = await emSearchFund(fundName);
      if (em) return { fundName, code: em.code };
      console.warn(`  未找到: ${fundName.slice(0, 30)}`);
      return { fundName, code: null };
    } catch {
      console.warn(`  搜索失败: ${fundName.slice(0, 30)}`);
      return { fundName, code: null };
    }
  });

  let resolvedCount = 0;
  for (const r of resolved) {
    if (r.code) {
      codeMap.set(r.fundName, r.code);
      // 同时写回 Holding.fundCode
      await prisma.holding.updateMany({
        where: { userId: SINGLE_USER_ID, fundName: r.fundName, fundCode: null },
        data: { fundCode: r.code },
      });
      resolvedCount++;
    }
  }
  console.log(`  成功解析: ${resolvedCount} / ${needResolve.length}\n`);

  // 阶段 2: 拉取行情
  const uniqueCodes = Array.from(new Set(codeMap.values()));
  console.log(`[2/2] 拉取行情: ${uniqueCodes.length} 只 (concurrency=5)...`);

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
      console.warn(`  行情获取失败 ${code}: ${String(e).slice(0, 60)}`);
    }
  });

  console.log(`  获取: ${quotesFetched}, 入库: ${quotesStored}\n`);

  // 汇总
  const quotes = await prisma.marketQuote.findMany({
    where: { date: { gte: new Date(Date.now() - 7 * 86400000) } },
    orderBy: { date: 'desc' },
  });

  console.log(`=== 最近行情 (近 7 天, 共 ${quotes.length} 条) ===`);
  const latest = new Map<string, (typeof quotes)[number]>();
  for (const q of quotes) {
    if (!latest.has(q.fundCode)) latest.set(q.fundCode, q);
  }

  const quoteSummary: Array<{ code: string; nav: number; changePct: number }> = [];
  for (const [code, q] of latest) {
    quoteSummary.push({
      code,
      nav: Number(q.nav),
      changePct: Number(q.changePct),
    });
  }
  quoteSummary.sort((a, b) => b.changePct - a.changePct);

  const upCount = quoteSummary.filter(q => q.changePct > 0).length;
  const downCount = quoteSummary.filter(q => q.changePct < 0).length;
  const flatCount = quoteSummary.filter(q => q.changePct === 0).length;
  console.log(`  涨: ${upCount}, 跌: ${downCount}, 平: ${flatCount}`);
  quoteSummary.slice(0, 5).forEach(q => {
    console.log(`  ${q.code}  NAV=${q.nav.toFixed(4)}  ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`);
  });
  if (quoteSummary.length > 5) console.log(`  ... 还有 ${quoteSummary.length - 5} 只`);

  console.log('\n✓ 行情刷新完成');
}

main()
  .catch(err => {
    console.error('\n失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
