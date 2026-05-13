'use client';

import dynamic from 'next/dynamic';
import type { EChartsOption } from 'echarts';
import { BUCKET_COLORS, type SectorBucket } from '@/lib/portfolio/buckets';

// echarts-for-react 直接 import 会把整个 echarts 拉进 RSC bundle,
// 用 next/dynamic 避免 SSR + 减小首屏。
const ReactECharts = dynamic(() => import('echarts-for-react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
      加载图表中…
    </div>
  ),
});

function colorFor(bucket: string): string {
  return (BUCKET_COLORS as Record<string, string>)[bucket] ?? '#9e9e9e';
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type BucketDatum = {
  bucket: string;
  count: number;
  amount: number;
  profit: number;
};

// ────────── 饼图:持仓金额构成 ──────────
export function BucketPieChart({ data }: { data: BucketDatum[] }) {
  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = params as { name: string; value: number; percent: number };
        return `<b>${p.name}</b><br/>金额: ${fmtMoney(p.value)} 元<br/>占比: ${p.percent.toFixed(1)}%`;
      },
    },
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      bottom: 0,
      pageButtonItemGap: 5,
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        name: '持仓金额',
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          formatter: '{b}\n{d}%',
          fontSize: 11,
          color: '#444',
        },
        labelLine: { length: 8, length2: 8 },
        data: data.map(d => ({
          name: d.bucket,
          value: Math.round(d.amount * 100) / 100,
          itemStyle: { color: colorFor(d.bucket) },
        })),
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 460 }} />;
}

// ────────── 横向柱图:累计盈亏 ──────────
export function BucketProfitBarChart({ data }: { data: BucketDatum[] }) {
  const sorted = [...data].sort((a, b) => b.profit - a.profit);
  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const p = arr[0] as { name: string; value: number };
        return `<b>${p.name}</b><br/>累计盈亏: ${fmtMoney(p.value)} 元`;
      },
    },
    grid: { left: 100, right: 80, top: 20, bottom: 40 },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) =>
          v >= 10000 || v <= -10000
            ? `${(v / 10000).toFixed(1)}万`
            : v.toFixed(0),
      },
      splitLine: { lineStyle: { color: '#eee' } },
    },
    yAxis: {
      type: 'category',
      data: sorted.map(d => d.bucket),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '累计盈亏',
        type: 'bar',
        data: sorted.map(d => ({
          value: Math.round(d.profit * 100) / 100,
          itemStyle: {
            color: d.profit >= 0 ? '#16a34a' : '#dc2626',
            borderRadius: 3,
          },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params) => {
            const p = params as { value: number };
            return p.value >= 0
              ? `+${fmtMoney(p.value)}`
              : fmtMoney(p.value);
          },
          fontSize: 11,
          color: '#666',
        },
        barMaxWidth: 22,
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 460 }} />;
}
