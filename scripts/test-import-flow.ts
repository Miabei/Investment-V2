// 端到端验证模块一后端:解析 CSV → 调 DeepSeek 列映射 → 入库 → 验证读回
// 用法: npx tsx scripts/test-import-flow.ts [csv 路径]
// 默认: test-recognize/InvestmentList_20260507.csv

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { prisma } from '@/lib/db';
import { inferColumnMapping } from '@/lib/ai/deepseek';
import { saveImport } from '@/lib/import/save-import';
import { parseNumber } from '@/lib/import/numbers';

async function main() {
  const csvPath = resolve(
    process.argv[2] ?? 'test-recognize/InvestmentList_20260507.csv',
  );
  console.log(`读取: ${csvPath}\n`);

  const text = readFileSync(csvPath, 'utf-8').replace(/^﻿/, '');
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (result.errors.length > 0) {
    console.warn('CSV 警告:', result.errors.slice(0, 3).map(e => e.message));
  }
  const data = result.data;
  if (data.length < 2) throw new Error('CSV 没有数据行');

  const headers = data[0]!.map(c => String(c));
  const rows = data.slice(1).map(r => r.map(c => String(c)));

  console.log(`列头: ${headers.length} 列, 数据行: ${rows.length}`);
  headers.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));

  // ────── 1. 列映射 ──────
  console.log('\n[1/3] 调用 DeepSeek 推断列映射...');
  const t0 = Date.now();
  const mapping = await inferColumnMapping(headers, rows);
  console.log(`完成 (${Date.now() - t0} ms)`);
  console.log(JSON.stringify(mapping, null, 2));

  // ────── 2. 应用映射 ──────
  console.log('\n[2/3] 应用映射,组装 Holdings...');
  const idx = (col: string | null) => (col ? headers.indexOf(col) : -1);
  const I = {
    name: idx(mapping.fundName),
    code: idx(mapping.fundCode),
    amount: idx(mapping.amount),
    profit: idx(mapping.profit),
    rate: idx(mapping.profitRate),
    sector: idx(mapping.sector),
  };

  const holdings = rows
    .map((row, rowIdx) => ({ row, rowIdx }))
    .filter(({ rowIdx }) => !mapping.junkRowIndices.includes(rowIdx))
    .map(({ row }) => ({
      fundName: I.name >= 0 ? (row[I.name] ?? '').trim() : '',
      fundCode: I.code >= 0 ? (row[I.code] ?? null) : null,
      amount: I.amount >= 0 ? (parseNumber(row[I.amount]) ?? 0) : 0,
      profit: I.profit >= 0 ? (parseNumber(row[I.profit]) ?? 0) : 0,
      profitRate: I.rate >= 0 ? parseNumber(row[I.rate]) : null,
      sector: I.sector >= 0 ? (row[I.sector] ?? null) : null,
    }))
    .filter(h => h.fundName.length > 0);

  console.log(`组装完成: ${holdings.length} / ${rows.length} 条`);

  // ────── 3. 入库 ──────
  console.log('\n[3/3] 写入数据库...');
  const t1 = Date.now();
  const batch = await saveImport({
    format: 'CSV',
    fileUrl: null,
    rawHeaders: headers,
    columnMapping: mapping,
    holdings,
  });
  console.log(`完成 (${Date.now() - t1} ms),ImportBatch id = ${batch.id}`);

  // ────── 验证从 DB 读回 ──────
  console.log('\n--- 验证: 从 DB 读回 ---');
  const dbBatch = await prisma.importBatch.findUnique({
    where: { id: batch.id },
  });
  if (!dbBatch) {
    console.error('找不到刚写入的 ImportBatch');
    process.exit(1);
  }

  const totalCount = await prisma.holding.count({
    where: { importBatchId: batch.id },
  });
  const agg = await prisma.holding.aggregate({
    where: { importBatchId: batch.id },
    _sum: { amount: true, profit: true },
  });
  const sample = await prisma.holding.findMany({
    where: { importBatchId: batch.id },
    take: 5,
    orderBy: { amount: 'desc' },
  });

  console.log(`Batch 状态  : ${dbBatch.status}`);
  console.log(`Holdings 数 : ${totalCount}`);
  console.log(`总持有金额  : ${agg._sum.amount?.toString()} 元`);
  console.log(`总累计盈亏  : ${agg._sum.profit?.toString()} 元`);
  console.log(`Top 5 (按金额降序):`);
  sample.forEach(h => {
    const sectorPreview = h.sector ? h.sector.slice(0, 24) : '';
    console.log(
      `  ${h.fundName.padEnd(36)} amount=${h.amount} profit=${h.profit} sector="${sectorPreview}..."`,
    );
  });

  console.log('\n✓ 端到端验证通过');
}

main()
  .catch(err => {
    console.error('\n失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
