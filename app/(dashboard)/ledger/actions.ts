'use server';

import { revalidatePath } from 'next/cache';
import {
  inferColumnMapping,
  extractHoldingsFromText,
  classifyFundSectors,
  bucketizeFunds,
  type ColumnMapping,
  type ExtractedHoldings,
} from '@/lib/ai/deepseek';
import {
  saveImport,
  type SaveImportArgs,
  type HoldingInput,
} from '@/lib/import/save-import';
import {
  emClassifyFund,
  formatEmSector,
  pmap,
} from '@/lib/market/eastmoney';
import { prisma } from '@/lib/db';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export async function inferMappingAction(
  headers: string[],
  sampleRows: string[][],
): Promise<ColumnMapping> {
  return inferColumnMapping(headers, sampleRows);
}

export async function extractHoldingsAction(
  text: string,
): Promise<ExtractedHoldings> {
  return extractHoldingsFromText(text);
}

export async function classifyMissingSectorsAction(): Promise<{
  uniqueFunds: number;
  fromEastmoney: number;
  fromLlm: number;
  bucketed: number;
  rowsUpdated: number;
}> {
  // 找出 sector 或 sectorBucket 任一为空的持仓
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
  if (uniqueNames.length === 0) {
    return {
      uniqueFunds: 0,
      fromEastmoney: 0,
      fromLlm: 0,
      bucketed: 0,
      rowsUpdated: 0,
    };
  }

  // 哪些 fund 已经有 sector 文本(为了节省后面 EM/LLM 调用,只补缺的)
  const existingSectors = new Map<string, string>();
  for (const m of missing) {
    if (m.sector && !existingSectors.has(m.fundName)) {
      existingSectors.set(m.fundName, m.sector);
    }
  }
  const namesNeedSector = uniqueNames.filter(n => !existingSectors.has(n));

  // ────── 阶段 1:补 sector 文本(EM 主路 + LLM 兜底)──────
  const emAttempts = await pmap(namesNeedSector, 5, async name => {
    try {
      const em = await emClassifyFund(name);
      if (!em) return { name, sector: null as string | null };
      if (!em.fund.ftype && em.industries.length === 0) {
        return { name, sector: null };
      }
      return { name, sector: formatEmSector(em) };
    } catch {
      return { name, sector: null };
    }
  });

  const emResolved = emAttempts.filter(
    (a): a is { name: string; sector: string } => a.sector !== null,
  );
  const llmFallbackNames = emAttempts
    .filter(a => a.sector === null)
    .map(a => a.name);

  const llmResolved =
    llmFallbackNames.length > 0
      ? await classifyFundSectors(llmFallbackNames)
      : [];

  // 写回 sector
  const sectorByName = new Map<string, string>();
  for (const r of emResolved) sectorByName.set(r.name, r.sector);
  for (const r of llmResolved) {
    if (r.sector && r.sector !== '未识别') {
      sectorByName.set(r.fundName, r.sector);
    }
  }
  // 也把已有的 sector 拉进来,后面 bucketize 用
  for (const [name, sec] of existingSectors) {
    sectorByName.set(name, sec);
  }

  let sectorRowsUpdated = 0;
  for (const [fundName, sector] of sectorByName) {
    if (existingSectors.has(fundName)) continue; // 已有的不动
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

  // ────── 阶段 2:把所有缺 bucket 的归到固定桶 ──────
  const bucketItems = uniqueNames.map(name => ({
    fundName: name,
    sectorHint: sectorByName.get(name) ?? null,
  }));
  const bucketResults =
    bucketItems.length > 0 ? await bucketizeFunds(bucketItems) : [];

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

  revalidatePath('/ledger');
  return {
    uniqueFunds: uniqueNames.length,
    fromEastmoney: emResolved.length,
    fromLlm: llmResolved.filter(r => r.sector !== '未识别').length,
    bucketed: bucketResults.length,
    rowsUpdated: sectorRowsUpdated + bucketRowsUpdated,
  };
}

export async function saveImportAction(args: {
  format: 'CSV' | 'XLSX' | 'MANUAL';
  rawHeaders?: string[] | null;
  columnMapping?: ColumnMapping | null;
  holdings: HoldingInput[];
}): Promise<{ batchId: string; holdingsCount: number }> {
  const batch = await saveImport({
    format: args.format,
    fileUrl: null,
    rawHeaders: args.rawHeaders ?? null,
    columnMapping: args.columnMapping ?? null,
    holdings: args.holdings,
  } satisfies SaveImportArgs);
  revalidatePath('/ledger');
  return { batchId: batch.id, holdingsCount: args.holdings.length };
}
