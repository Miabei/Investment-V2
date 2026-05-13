import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import { z } from 'zod';

// ----- 标准字段映射 schema -----
// 每个字段返回的应是 *原始列头中已存在的字符串*,完整匹配。
const ColumnMappingSchema = z.object({
  fundName: z.string().describe('原始列名,对应基金名称'),
  fundCode: z
    .string()
    .nullable()
    .describe('原始列名,对应六位基金代码;若文件中无此列,填 null'),
  amount: z.string().describe('原始列名,对应持仓金额(单位:元)'),
  profit: z.string().describe('原始列名,对应累计盈亏(元)'),
  profitRate: z
    .string()
    .nullable()
    .describe('原始列名,对应收益率;若文件中无此列,填 null'),
  sector: z
    .string()
    .nullable()
    .describe('原始列名,对应行业/领域描述;若文件中无此列,填 null'),
  junkRowIndices: z
    .array(z.number().int().nonnegative())
    .describe(
      '应跳过的数据行索引(0-based,不含 header),如汇总行「合计」「总计」、副标题行、空行',
    ),
  notes: z.string().nullable().describe('其他说明,无则 null'),
});

type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// ----- 文件解析 -----
function parseFile(path: string): { headers: string[]; rows: string[][] } {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === 'csv') {
    const text = readFileSync(path, 'utf-8').replace(/^﻿/, ''); // 去 BOM
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (result.errors.length > 0) {
      console.warn(
        '[CSV 解析警告]',
        result.errors.slice(0, 3).map(e => e.message).join('; '),
      );
    }
    const data = result.data;
    if (data.length === 0) return { headers: [], rows: [] };
    const headers = data[0]!.map(c => String(c));
    const rows = data.slice(1).map(row => row.map(c => String(c)));
    return { headers, rows };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.readFile(path);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('Excel 文件没有 sheet');
    const sheet = workbook.Sheets[sheetName]!;
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    const headers = (aoa[0] ?? []).map(c => String(c));
    const rows = aoa.slice(1).map(row => row.map(c => String(c)));
    return { headers, rows };
  }
  throw new Error(`不支持的文件类型: .${ext} (目前仅支持 .csv / .xlsx / .xls)`);
}

// 把「+1.03%」「-8.96%」「2,300.40」这类清成纯数字
function parseNumber(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  const cleaned = String(s).replace(/[+,%¥￥\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法: npx tsx test-import.ts <CSV 或 XLSX 路径>');
    console.error('示例: npx tsx test-import.ts InvestmentList_20260507.csv');
    process.exit(1);
  }
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    console.error(`文件不存在: ${fullPath}`);
    process.exit(1);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const modelId = process.env.DEEPSEEK_MODEL;
  if (!apiKey) {
    console.error('缺少 DEEPSEEK_API_KEY');
    process.exit(1);
  }
  if (!modelId) {
    console.error('缺少 DEEPSEEK_MODEL');
    process.exit(1);
  }

  const { headers, rows } = parseFile(fullPath);

  console.log('---------------------------------------');
  console.log(`文件     : ${fullPath}`);
  console.log(`列头数   : ${headers.length}`);
  console.log(`数据行数 : ${rows.length}`);
  console.log(`模型     : ${modelId}`);
  console.log('---------------------------------------\n');

  console.log('--- 原始列头 ---');
  headers.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));

  console.log('\n--- 前 3 行数据样本 ---');
  rows.slice(0, 3).forEach((row, i) => {
    console.log(`  row${i}: ${JSON.stringify(row)}`);
  });

  // ----- 调 DeepSeek -----
  const deepseek = createOpenAICompatible({ name: 'deepseek', apiKey, baseURL });

  const sampleRows = rows.slice(0, 5);
  const promptText = [
    '你是表格列名映射助手。任务:把用户上传的投资台账文件的列头映射到我们的标准字段。',
    '',
    '严格要求:',
    '1. 返回值必须是「原始列头数组」中已存在的字符串,完整匹配(包括空格、括号、单位)。',
    '2. 不要发明、改写、缩写、翻译列名。例如原列名是「持有金额 (元)」就原样返回,不要返回「持有金额」。',
    '3. 没有对应的字段返回 null,不要硬塞。',
    '4. 同时识别需要跳过的非数据行(汇总行如「合计」「总计」、副标题行、空行),用 0-based 行索引数组返回(数据行索引,不含 header)。',
    '',
    '原始列头:',
    JSON.stringify(headers),
    '',
    '前 5 行数据样本(从 row0 开始):',
    sampleRows.map((r, i) => `  row${i}: ${JSON.stringify(r)}`).join('\n'),
  ].join('\n');

  console.log('\n--- 调用 DeepSeek 推断列映射... ---');
  const t0 = Date.now();
  const { object, usage } = await generateObject({
    model: deepseek(modelId),
    mode: 'json',
    schema: ColumnMappingSchema,
    prompt: promptText,
  });
  const elapsedMs = Date.now() - t0;

  console.log('\n--- 列映射结果 ---');
  console.log(JSON.stringify(object, null, 2));

  // 校验:返回的列名是否都真的在 headers 中
  const validColumns = new Set(headers);
  const issues: string[] = [];
  const checkField = (name: keyof ColumnMapping, value: string | null) => {
    if (value !== null && !validColumns.has(value)) {
      issues.push(`字段 ${String(name)}: "${value}" 不在原始列头中`);
    }
  };
  checkField('fundName', object.fundName);
  checkField('fundCode', object.fundCode);
  checkField('amount', object.amount);
  checkField('profit', object.profit);
  checkField('profitRate', object.profitRate);
  checkField('sector', object.sector);

  if (issues.length > 0) {
    console.log('\n[列名匹配警告]');
    issues.forEach(s => console.log('  -', s));
  } else {
    console.log('\n[列名校验] 全部通过 (映射的列名都存在于原始列头)');
  }

  // ----- 应用映射,展示前 10 行标准化结果 -----
  const idx = (col: string | null) => (col ? headers.indexOf(col) : -1);
  const i_name = idx(object.fundName);
  const i_code = idx(object.fundCode);
  const i_amount = idx(object.amount);
  const i_profit = idx(object.profit);
  const i_rate = idx(object.profitRate);
  const i_sector = idx(object.sector);

  console.log('\n--- 按映射解析后的标准化台账(前 10 行) ---');
  rows.slice(0, 10).forEach((row, i) => {
    if (object.junkRowIndices.includes(i)) {
      console.log(`  row${i} [跳过-汇总/标题行]`);
      return;
    }
    const std = {
      fundName: i_name >= 0 ? row[i_name] : null,
      fundCode: i_code >= 0 ? row[i_code] : null,
      amount: i_amount >= 0 ? parseNumber(row[i_amount]) : null,
      profit: i_profit >= 0 ? parseNumber(row[i_profit]) : null,
      profitRate: i_rate >= 0 ? parseNumber(row[i_rate]) : null,
      sector: i_sector >= 0 ? row[i_sector] : null,
    };
    console.log(`  row${i}: ${JSON.stringify(std, null, 0)}`);
  });

  // ----- 整体合计校验 -----
  const allHoldings = rows
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => !object.junkRowIndices.includes(i))
    .map(({ row }) => ({
      amount: i_amount >= 0 ? parseNumber(row[i_amount]) : null,
      profit: i_profit >= 0 ? parseNumber(row[i_profit]) : null,
    }));
  const totalAmount = allHoldings.reduce((s, h) => s + (h.amount ?? 0), 0);
  const totalProfit = allHoldings.reduce((s, h) => s + (h.profit ?? 0), 0);
  const validRows = allHoldings.filter(h => h.amount !== null).length;

  console.log('\n--- 全量解析统计 ---');
  console.log(`有效行数   : ${validRows} / ${rows.length}`);
  console.log(`总持有金额 : ${totalAmount.toFixed(2)} 元`);
  console.log(`总累计盈亏 : ${totalProfit.toFixed(2)} 元`);
  console.log(
    `总收益率   : ${totalAmount > 0 ? ((totalProfit / (totalAmount - totalProfit)) * 100).toFixed(2) : 'N/A'} % (盈亏 / 成本)`,
  );

  console.log('\n--- 调用统计 ---');
  console.log(`耗时       : ${elapsedMs} ms`);
  console.log(
    `Token      : prompt=${usage.promptTokens}, completion=${usage.completionTokens}, total=${usage.totalTokens}`,
  );
  if (object.notes) console.log(`模型备注   : ${object.notes}`);
}

main().catch(err => {
  console.error('\n失败:', err?.message ?? err);
  if (err?.cause) console.error('原因:', err.cause);
  if (err?.responseBody) console.error('响应:', err.responseBody);
  process.exit(1);
});
