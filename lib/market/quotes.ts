// 基金行情数据获取 — Module 4
// 东方财富非官方接口,防御式解析

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://fund.eastmoney.com/',
};

export interface FundQuote {
  fundCode: string;
  fundName: string;
  date: string; // YYYY-MM-DD
  nav: number; // 最新单位净值
  navDate: string; // 净值日期
  estimateNav?: number; // 盘中估算净值(仅交易时段有)
  estimateChangePct?: number; // 估算涨跌幅
  lastNavChangePct?: number; // 上一个交易日涨跌幅
}

export interface FundRealTimeEstimate {
  fundCode: string;
  fundName: string;
  estimateTime: string; // 估算时间
  estimateNav: number; // 估算净值
  estimateChangePct: number; // 估算涨跌幅(%)
  lastNav: number; // 上一交易日净值
  lastNavDate: string;
}

/**
 * 获取基金盘中实时估算(天天基金 fundgz 接口)。
 * 仅在交易日 9:30-15:00 有意义,非交易时段返回上一次估算或最后一笔。
 */
export async function fetchFundEstimate(
  code: string,
): Promise<FundRealTimeEstimate | null> {
  const url = `https://fundgz.1234567.com.cn/js/${code}.js`;
  let text: string;
  try {
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }

  // 响应是 JSONP: jsonpgz({...});
  const match = text.match(/jsonpgz\((\{[\s\S]*\})\)/);
  if (!match?.[1]) return null;

  try {
    const raw = JSON.parse(match[1]);
    return {
      fundCode: String(raw.fundcode ?? code),
      fundName: String(raw.name ?? ''),
      estimateTime: String(raw.gztime ?? ''),
      estimateNav: Number(raw.gsz ?? 0),
      estimateChangePct: Number(raw.gszzl ?? 0),
      lastNav: Number(raw.dwjz ?? 0),
      lastNavDate: String(raw.jzrq ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * 从东方财富基金列表接口获取最近一个交易日净值。
 * 用于非交易时段或作为补充数据。
 */
export async function fetchLatestNav(
  code: string,
): Promise<{ nav: number; date: string; changePct: number } | null> {
  // EM 基金详情页有一个轻量 JSON API
  const url = `https://api.fund.eastmoney.com/f10/lsjz/?fundCode=${code}&pageIndex=1&pageSize=1`;
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Referer: `https://fundf10.eastmoney.com/jjjz_${code}.html` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const list: unknown[] = json?.Data?.LSJZList ?? [];
    if (list.length === 0) return null;
    const latest = list[0] as Record<string, unknown>;
    return {
      nav: Number(latest.DWJZ ?? 0),
      date: String(latest.FSRQ ?? ''),
      changePct: Number(latest.JZZZL ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * 一站式:获取基金最新行情(优先实时估算,否则用最新净值)
 */
export async function fetchFundQuote(code: string): Promise<FundQuote | null> {
  const estimate = await fetchFundEstimate(code);
  const nav = await fetchLatestNav(code);

  if (!estimate && !nav) return null;

  // 估算数据里的 lastNav 可能比 Lsjz 接口的新鲜
  const navValue =
    (estimate && estimate.lastNav > 0 ? estimate.lastNav : 0) ||
    nav?.nav ||
    0;
  const navDate =
    estimate?.lastNavDate || nav?.date || '';

  return {
    fundCode: code,
    fundName: estimate?.fundName || '',
    date: new Date().toISOString().slice(0, 10),
    nav: navValue,
    navDate,
    estimateNav: estimate?.estimateNav,
    estimateChangePct: estimate?.estimateChangePct,
    lastNavChangePct: nav?.changePct,
  };
}

// ───── Redis 缓存层 (60s TTL,盘中实时估值缓存) ─────
import { redis } from '@/lib/redis';

const QUOTE_CACHE_TTL = 60; // 秒

function quoteCacheKey(code: string): string {
  return `quote:${code}`;
}

/** 带 Redis 缓存的单只基金行情获取 */
export async function fetchFundQuoteCached(code: string): Promise<FundQuote | null> {
  try {
    const cached = await redis.get(quoteCacheKey(code));
    if (cached) return JSON.parse(cached) as FundQuote;
  } catch {
    // Redis 不可用时降级为直接请求
  }

  const quote = await fetchFundQuote(code);
  if (quote) {
    try {
      await redis.setex(quoteCacheKey(code), QUOTE_CACHE_TTL, JSON.stringify(quote));
    } catch {
      // 静默
    }
  }
  return quote;
}

/** 按 sector bucket 聚合行情,用于判定异常波动 */
export async function getSectorChangeAggregation(): Promise<
  Array<{ bucket: string; avgChangePct: number; fundCount: number }>
> {
  const { prisma } = await import('@/lib/db');
  const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

  const batch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) return [];

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: batch.id },
    select: { fundCode: true, sectorBucket: true },
  });

  const quotes = await prisma.marketQuote.findMany({
    orderBy: { date: 'desc' },
  });
  const latestQuote = new Map<string, number>();
  for (const q of quotes) {
    if (!latestQuote.has(q.fundCode)) {
      latestQuote.set(q.fundCode, Number(q.changePct));
    }
  }

  const sectorMap = new Map<string, { changes: number[] }>();
  for (const h of holdings) {
    const bucket = h.sectorBucket || '未分类';
    const chg = h.fundCode ? latestQuote.get(h.fundCode) : undefined;
    if (chg !== undefined) {
      const cur = sectorMap.get(bucket) ?? { changes: [] };
      cur.changes.push(chg);
      sectorMap.set(bucket, cur);
    }
  }

  return Array.from(sectorMap.entries()).map(([bucket, d]) => ({
    bucket,
    avgChangePct: d.changes.reduce((s, c) => s + c, 0) / d.changes.length,
    fundCount: d.changes.length,
  }));
}

/**
 * 批量获取,带简单并发控制
 */
export async function fetchQuotes(
  codes: string[],
  concurrency = 5,
): Promise<Map<string, FundQuote>> {
  const results = new Map<string, FundQuote>();
  if (codes.length === 0) return results;

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, codes.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= codes.length) return;
      const code = codes[i]!;
      const quote = await fetchFundQuote(code);
      if (quote) results.set(code, quote);
    }
  });
  await Promise.all(workers);
  return results;
}
