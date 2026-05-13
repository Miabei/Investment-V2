// 批量分类:EM 主体数据 → LLM 兜底 → LLM 归桶
// 用法: npx tsx scripts/classify-all.ts

import 'dotenv/config';
import { prisma } from '@/lib/db';
import {
  emClassifyFund,
  formatEmSector,
  pmap,
} from '@/lib/market/eastmoney';
import { classifyFundSectors, bucketizeFunds } from '@/lib/ai/deepseek';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

async function main() {
  // 找出 sector 或 sectorBucket 为空的持仓
  const missing = await prisma.holding.findMany({
    where: {
      userId: SINGLE_USER_ID,
      OR: [
        { sector: null },
        { sector: '' },
        { sectorBucket: null },
        { sectorBucket: '' },
      ],
    },
    select: { fundName: true, sector: true, sectorBucket: true },
  });

  const uniqueNames = Array.from(
    new Set(missing.map(m => m.fundName).filter(n => n.length > 0)),
  );
  console.log(`需要分类的基金: ${uniqueNames.length} 只\n`);

  const existingSectors = new Map<string, string>();
  for (const m of missing) {
    if (m.sector && !existingSectors.has(m.fundName)) {
      existingSectors.set(m.fundName, m.sector);
    }
  }
  const namesNeedSector = uniqueNames.filter(n => !existingSectors.has(n));
  console.log(`已有 sector 文本: ${uniqueNames.length - namesNeedSector.length} 只`);
  console.log(`需要补 sector: ${namesNeedSector.length} 只\n`);

  // 阶段 1: EM 分类
  console.log('[1/3] 东方财富分类 (concurrency=5)...');
  const emAttempts = await pmap(namesNeedSector, 5, async name => {
    try {
      const em = await emClassifyFund(name);
      if (!em) return { name, sector: null as string | null };
      if (!em.fund.ftype && em.industries.length === 0) {
        return { name, sector: null };
      }
      return { name, sector: formatEmSector(em) };
    } catch (e) {
      console.warn(`  EM 失败: ${name} — ${String(e).slice(0, 60)}`);
      return { name, sector: null };
    }
  });

  const emResolved = emAttempts.filter(
    (a): a is { name: string; sector: string } => a.sector !== null,
  );
  const llmFallbackNames = emAttempts
    .filter(a => a.sector === null)
    .map(a => a.name);

  console.log(`  EM 有数据: ${emResolved.length} 只`);
  console.log(`  需要 LLM 兜底: ${llmFallbackNames.length} 只\n`);

  // 阶段 2: LLM 兜底
  let llmResolved: Array<{ fundName: string; sector: string }> = [];
  if (llmFallbackNames.length > 0) {
    console.log('[2/3] LLM 分类兜底...');
    llmResolved = await classifyFundSectors(llmFallbackNames);
    const usable = llmResolved.filter(r => r.sector !== '未识别');
    console.log(`  LLM 有结果: ${usable.length} 只\n`);
  }

  // 写回 sector
  const sectorByName = new Map<string, string>();
  for (const r of emResolved) sectorByName.set(r.name, r.sector);
  for (const r of llmResolved) {
    if (r.sector && r.sector !== '未识别') {
      sectorByName.set(r.fundName, r.sector);
    }
  }
  for (const [name, sec] of existingSectors) {
    sectorByName.set(name, sec);
  }

  let sectorRowsUpdated = 0;
  for (const [fundName, sector] of sectorByName) {
    if (existingSectors.has(fundName)) continue;
    const result = await prisma.holding.updateMany({
      where: {
        userId: SINGLE_USER_ID,
        fundName,
        OR: [{ sector: null }, { sector: '' }],
      },
      data: { sector },
    });
    sectorRowsUpdated += result.count;
  }
  console.log(`写回 sector: ${sectorRowsUpdated} 行\n`);

  // 阶段 3: Bucket 分类
  console.log('[3/3] LLM 桶分类...');
  const bucketItems = uniqueNames.map(name => ({
    fundName: name,
    sectorHint: sectorByName.get(name) ?? null,
  }));
  const bucketResults = await bucketizeFunds(bucketItems);

  let bucketRowsUpdated = 0;
  for (const { fundName, bucket } of bucketResults) {
    const result = await prisma.holding.updateMany({
      where: {
        userId: SINGLE_USER_ID,
        fundName,
        OR: [{ sectorBucket: null }, { sectorBucket: '' }],
      },
      data: { sectorBucket: bucket },
    });
    bucketRowsUpdated += result.count;
  }
  console.log(`写回 sectorBucket: ${bucketRowsUpdated} 行\n`);

  // 汇总
  const buckets = await prisma.holding.groupBy({
    by: ['sectorBucket'],
    where: { userId: SINGLE_USER_ID },
    _count: true,
    _sum: { amount: true, profit: true },
  });
  console.log('=== 分类结果 ===');
  buckets
    .sort((a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0))
    .forEach(b => {
      console.log(
        `  ${b.sectorBucket ?? '(空)'.padEnd(14)} ${b._count} 只  金额=${Number(b._sum.amount ?? 0).toFixed(2)}  盈亏=${Number(b._sum.profit ?? 0).toFixed(2)}`,
      );
    });

  console.log('\n✓ 分类完成');
}

main()
  .catch(err => {
    console.error('\n失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
