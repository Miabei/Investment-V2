'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { parseNumber } from '@/lib/import/numbers';
import type { ColumnMapping } from '@/lib/ai/deepseek';
import type { HoldingInput } from '@/lib/import/save-import';
import {
  inferMappingAction,
  saveImportAction,
  extractHoldingsAction,
} from '../actions';

type ParsedFile = {
  headers: string[];
  rows: string[][];
  format: 'CSV' | 'XLSX';
  fileName: string;
};

type Source = 'file' | 'paste';
type Phase =
  | 'idle'
  | 'parsing'
  | 'parsed'
  | 'mapping'
  | 'extracting'
  | 'reviewing'
  | 'saving';

const STD_FIELDS = [
  { key: 'fundName', label: '基金名称', required: true },
  { key: 'fundCode', label: '基金代码', required: false },
  { key: 'amount', label: '持有金额', required: true },
  { key: 'profit', label: '累计盈亏', required: true },
  { key: 'profitRate', label: '收益率 (%)', required: false },
  { key: 'sector', label: '行业/领域', required: false },
] as const;

type StdFieldKey = (typeof STD_FIELDS)[number]['key'];

async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') {
    const text = (await file.text()).replace(/^﻿/, '');
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (result.data.length < 2) throw new Error('CSV 没有数据行');
    return {
      headers: result.data[0]!.map(c => String(c)),
      rows: result.data.slice(1).map(r => r.map(c => String(c))),
      format: 'CSV',
      fileName: file.name,
    };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('Excel 没有 sheet');
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName]!, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (aoa.length < 2) throw new Error('Excel 没有数据行');
    return {
      headers: (aoa[0] ?? []).map(c => String(c)),
      rows: aoa.slice(1).map(r => r.map(c => String(c))),
      format: 'XLSX',
      fileName: file.name,
    };
  }
  throw new Error(`不支持的文件类型: .${ext} (仅支持 .csv / .xlsx / .xls)`);
}

export default function ImportPage() {
  const router = useRouter();
  const [source, setSource] = useState<Source>('file');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // 文件模式状态
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  // 粘贴模式状态
  const [pasteText, setPasteText] = useState<string>('');
  const [extracted, setExtracted] = useState<HoldingInput[]>([]);
  const [extractNotes, setExtractNotes] = useState<string | null>(null);

  // 共享:审核阶段被勾选「跳过」的行
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());

  function resetAll() {
    setPhase('idle');
    setError(null);
    setParsed(null);
    setMapping(null);
    setPasteText('');
    setExtracted([]);
    setExtractNotes(null);
    setExcludedRows(new Set());
  }

  function handleSourceChange(s: string) {
    if (s !== 'file' && s !== 'paste') return;
    setSource(s);
    resetAll();
  }

  // ────── 文件流程 ──────
  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setPhase('parsing');
    try {
      const data = await parseFile(file);
      setParsed(data);
      setMapping(null);
      setExcludedRows(new Set());
      setPhase('parsed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        '.xlsx',
      ],
    },
    maxFiles: 1,
    disabled:
      phase === 'parsing' ||
      phase === 'mapping' ||
      phase === 'extracting' ||
      phase === 'saving',
  });

  async function runMapping() {
    if (!parsed) return;
    setPhase('mapping');
    setError(null);
    try {
      const result = await inferMappingAction(
        parsed.headers,
        parsed.rows.slice(0, 5),
      );
      setMapping(result);
      setExcludedRows(new Set(result.junkRowIndices));
      setPhase('reviewing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('parsed');
    }
  }

  function updateMapping(field: StdFieldKey, value: string | null) {
    if (!mapping) return;
    setMapping({ ...mapping, [field]: value });
  }

  // ────── 粘贴流程 ──────
  async function runExtract() {
    if (!pasteText.trim()) return;
    setPhase('extracting');
    setError(null);
    try {
      const result = await extractHoldingsAction(pasteText);
      setExtracted(
        result.holdings.map(h => ({
          fundName: h.fundName,
          fundCode: h.fundCode,
          amount: h.amount,
          profit: h.profit,
          profitRate: h.profitRate,
          sector: h.sector,
        })),
      );
      setExtractNotes(result.notes);
      setExcludedRows(new Set());
      setPhase('reviewing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }

  // ────── 审核区 (两种来源共享) ──────
  type ReviewRow = HoldingInput & { rowIdx: number; excluded: boolean };

  const reviewRows: ReviewRow[] = useMemo(() => {
    if (source === 'file' && parsed && mapping) {
      const idx = (col: string | null) =>
        col ? parsed.headers.indexOf(col) : -1;
      const I = {
        name: idx(mapping.fundName),
        code: idx(mapping.fundCode),
        amount: idx(mapping.amount),
        profit: idx(mapping.profit),
        rate: idx(mapping.profitRate),
        sector: idx(mapping.sector),
      };
      return parsed.rows.map((row, rowIdx) => ({
        rowIdx,
        excluded: excludedRows.has(rowIdx),
        fundName: I.name >= 0 ? (row[I.name] ?? '').trim() : '',
        fundCode: I.code >= 0 ? row[I.code] || null : null,
        amount: I.amount >= 0 ? (parseNumber(row[I.amount]) ?? 0) : 0,
        profit: I.profit >= 0 ? (parseNumber(row[I.profit]) ?? 0) : 0,
        profitRate: I.rate >= 0 ? parseNumber(row[I.rate]) : null,
        sector: I.sector >= 0 ? row[I.sector] || null : null,
      }));
    }
    if (source === 'paste' && extracted.length > 0) {
      return extracted.map((h, rowIdx) => ({
        ...h,
        rowIdx,
        excluded: excludedRows.has(rowIdx),
      }));
    }
    return [];
  }, [source, parsed, mapping, extracted, excludedRows]);

  function toggleRow(rowIdx: number) {
    setExcludedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  }

  const validHoldings = reviewRows.filter(
    h => !h.excluded && h.fundName.length > 0,
  );

  const canSave =
    validHoldings.length > 0 &&
    (source === 'paste' ||
      (mapping?.fundName && mapping?.amount && mapping?.profit));

  async function handleSave() {
    if (!canSave) return;
    setPhase('saving');
    setError(null);
    try {
      await saveImportAction({
        format: source === 'file' && parsed ? parsed.format : 'MANUAL',
        rawHeaders: source === 'file' && parsed ? parsed.headers : null,
        columnMapping: source === 'file' ? mapping : null,
        holdings: validHoldings.map(h => ({
          fundName: h.fundName,
          fundCode: h.fundCode,
          amount: h.amount,
          profit: h.profit,
          profitRate: h.profitRate,
          sector: h.sector,
        })),
      });
      router.push('/ledger');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('reviewing');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">导入持仓数据</h1>
          <p className="text-sm text-muted-foreground">
            上传 CSV / Excel,或直接粘贴文字。AI 帮你梳理后人工校对再保存。
          </p>
        </div>
        <Link
          href="/ledger"
          className={buttonVariants({ variant: 'outline' })}
        >
          返回台账
        </Link>
      </div>

      <Tabs value={source} onValueChange={handleSourceChange}>
        <TabsList>
          <TabsTrigger value="file">上传文件</TabsTrigger>
          <TabsTrigger value="paste">粘贴文字</TabsTrigger>
        </TabsList>

        {/* ───── 文件流程 ───── */}
        <TabsContent value="file" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. 上传文件</CardTitle>
              <CardDescription>支持 CSV、Excel(.xlsx / .xls)</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                className={`flex h-32 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/30 hover:border-muted-foreground/60'
                }`}
              >
                <input {...getInputProps()} />
                {phase === 'parsing' ? (
                  <p className="text-sm text-muted-foreground">解析中…</p>
                ) : parsed ? (
                  <p className="text-sm">
                    <span className="font-medium">{parsed.fileName}</span>
                    <span className="ml-2 text-muted-foreground">
                      {parsed.headers.length} 列 · {parsed.rows.length} 行 ·{' '}
                      {parsed.format}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isDragActive
                      ? '松开放置文件'
                      : '拖入或点击选择 CSV / Excel 文件'}
                  </p>
                )}
              </div>
              {error && phase !== 'reviewing' ? (
                <p className="mt-3 text-sm text-red-600">错误: {error}</p>
              ) : null}
            </CardContent>
          </Card>

          {parsed ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>2. 原始数据预览</CardTitle>
                  <CardDescription>前 5 行 (LLM 也只看这些做映射)</CardDescription>
                </div>
                {phase === 'parsed' || phase === 'mapping' ? (
                  <Button onClick={runMapping} disabled={phase === 'mapping'}>
                    {phase === 'mapping' ? 'AI 推断中… (~10s)' : 'AI 自动映射'}
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      {parsed.headers.map((h, i) => (
                        <TableHead key={i} className="whitespace-nowrap">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">
                          {i}
                        </TableCell>
                        {row.map((cell, j) => (
                          <TableCell
                            key={j}
                            className="max-w-xs truncate text-xs"
                            title={cell}
                          >
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {parsed && mapping ? (
            <Card>
              <CardHeader>
                <CardTitle>3. 列映射</CardTitle>
                <CardDescription>
                  AI 推断出的对应关系,如果有错可下拉修改。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {STD_FIELDS.map(f => {
                    const current = mapping[f.key];
                    return (
                      <div key={f.key} className="space-y-1.5">
                        <Label>
                          {f.label}
                          {f.required ? (
                            <span className="ml-1 text-red-500">*</span>
                          ) : null}
                        </Label>
                        <select
                          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                          value={current ?? '__none__'}
                          onChange={e =>
                            updateMapping(
                              f.key,
                              e.target.value === '__none__'
                                ? null
                                : e.target.value,
                            )
                          }
                        >
                          <option value="__none__">— 不映射 —</option>
                          {parsed.headers.map(h => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {mapping.notes ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    AI 备注: {mapping.notes}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* ───── 粘贴流程 ───── */}
        <TabsContent value="paste" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. 粘贴文字</CardTitle>
              <CardDescription>
                可以从 Excel / 网页表 / 任何文字直接复制粘贴。AI 会从中识别基金信息。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={`例:\n天弘恒生科技 ETF 联接 (QDII) C  25490.60  -2459.40  -8.96%\n易方达中概互联网 ETF 联接  23756.81  -2328.29  -9.28%\n...\n\n或者写自由文字也行,例如「我买了易方达蓝筹 25000 元 亏了 2400」`}
                className="min-h-48 font-mono text-xs"
                disabled={phase === 'extracting' || phase === 'saving'}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {pasteText.length > 0
                    ? `${pasteText.length} 字 / ${pasteText.split('\n').length} 行`
                    : ''}
                </p>
                <Button
                  onClick={runExtract}
                  disabled={
                    !pasteText.trim() ||
                    phase === 'extracting' ||
                    phase === 'saving'
                  }
                >
                  {phase === 'extracting' ? 'AI 抽取中… (~15s)' : 'AI 抽取持仓'}
                </Button>
              </div>
              {error && phase !== 'reviewing' ? (
                <p className="text-sm text-red-600">错误: {error}</p>
              ) : null}
              {extractNotes ? (
                <p className="text-xs text-muted-foreground">
                  AI 备注: {extractNotes}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ───── 共享:标准化结果(两种来源都汇到这里)───── */}
      {reviewRows.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>
                {source === 'file' ? '4' : '2'}. 标准化结果
              </CardTitle>
              <CardDescription>
                即将保存 {validHoldings.length} 条 (已跳过 {excludedRows.size} 条)
              </CardDescription>
            </div>
            <Button
              onClick={handleSave}
              disabled={!canSave || phase === 'saving'}
            >
              {phase === 'saving' ? '保存中…' : `保存 ${validHoldings.length} 条`}
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">跳过</TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>基金名称</TableHead>
                  <TableHead>代码</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead className="text-right">盈亏</TableHead>
                  <TableHead className="text-right">收益率</TableHead>
                  <TableHead>领域</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewRows.map(h => (
                  <TableRow
                    key={h.rowIdx}
                    className={h.excluded ? 'opacity-40 line-through' : ''}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={h.excluded}
                        onChange={() => toggleRow(h.rowIdx)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.rowIdx}
                    </TableCell>
                    <TableCell className="font-medium">
                      {h.fundName || (
                        <span className="text-red-500">(空)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.fundCode ?? '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.amount.toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${h.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {h.profit.toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${(h.profitRate ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {h.profitRate != null ? h.profitRate.toFixed(2) : '-'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {h.sector ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {error && phase === 'reviewing' ? (
              <p className="mt-3 text-sm text-red-600">保存失败: {error}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
