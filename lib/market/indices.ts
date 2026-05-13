// Major market index data from EastMoney push2 API

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://www.eastmoney.com/',
};

export interface IndexQuote {
  name: string;
  code: string;
  price: number;
  changePct: number;
  changeAmt: number;
}

const WATCHED_INDICES = [
  { name: '上证指数', secid: '1.000001' },
  { name: '深证成指', secid: '0.399001' },
  { name: '创业板指', secid: '0.399006' },
  { name: '科创50',   secid: '1.000688' },
  { name: '恒生科技', secid: '116.HSTECH' },
  { name: '恒生指数', secid: '116.HSI' },
];

async function fetchOne(secid: string, name: string): Promise<IndexQuote | null> {
  const url =
    `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f43,f169,f170` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  try {
    const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const d = json?.data;
    if (!d || d.f43 == null || d.f43 === '-') return null;
    return {
      name,
      code: String(d.f57 ?? ''),
      price: Number(d.f43) / 100,
      changePct: Number(d.f170) / 100,
      changeAmt: Number(d.f169) / 100,
    };
  } catch {
    return null;
  }
}

export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  const results = await Promise.all(
    WATCHED_INDICES.map(idx => fetchOne(idx.secid, idx.name)),
  );
  return results.filter((r): r is IndexQuote => r !== null);
}
