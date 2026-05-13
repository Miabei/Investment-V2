'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BUCKET_COLORS } from '@/lib/portfolio/buckets';

export interface FundRow {
  fundName: string;
  fundCode: string | null;
  bucket: string;
  nav: number;
  changePct: number;
  amount: number;
}

type SortKey = 'changePct' | 'amount' | 'bucket';
type SortDir = 'asc' | 'desc';

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function colorFor(bucket: string): string {
  return (BUCKET_COLORS as Record<string, string>)[bucket] ?? '#9e9e9e';
}

export function SortableFundTable({ funds }: { funds: FundRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const arr = [...funds];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'changePct') cmp = a.changePct - b.changePct;
      else if (sortKey === 'amount') cmp = a.amount - b.amount;
      else cmp = a.bucket.localeCompare(b.bucket);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [funds, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortArrow({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-0.5 text-muted-foreground/40">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead
            className="cursor-pointer select-none hover:text-foreground"
            onClick={() => handleSort('bucket')}
          >
            分类桶<SortArrow col="bucket" />
          </TableHead>
          <TableHead>基金名称</TableHead>
          <TableHead>代码</TableHead>
          <TableHead className="text-right">净值</TableHead>
          <TableHead
            className="cursor-pointer select-none text-right hover:text-foreground"
            onClick={() => handleSort('changePct')}
          >
            涨跌幅<SortArrow col="changePct" />
          </TableHead>
          <TableHead
            className="cursor-pointer select-none text-right hover:text-foreground"
            onClick={() => handleSort('amount')}
          >
            持仓金额<SortArrow col="amount" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((f, i) => (
          <TableRow key={`${f.fundCode ?? f.fundName}-${f.bucket}-${i}`}>
            <TableCell>
              <span className="text-xs" style={{ color: colorFor(f.bucket) }}>
                {f.bucket}
              </span>
            </TableCell>
            <TableCell className="max-w-48 truncate font-medium" title={f.fundName}>
              {f.fundName}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {f.fundCode ?? '-'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {f.nav > 0 ? f.nav.toFixed(4) : '-'}
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${f.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {f.nav > 0 ? fmtPct(f.changePct) : '-'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmt(f.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
