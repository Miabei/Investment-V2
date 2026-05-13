// 东方财富 / 天天基金非官方接口封装
// 实测来源 2026-05-08。这些接口未公开文档,随时可能变,做防御式解析。

const HEADERS_BASE = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://fund.eastmoney.com/',
};

const HEADERS_F10 = {
  ...HEADERS_BASE,
  Referer: 'https://fundf10.eastmoney.com/',
};

export interface EmFund {
  code: string;
  name: string;
  ftype: string; // 投资类型,例如「混合型-偏股」「QDII-股票」「货币型」「债券型」「指数型」
}

export interface EmIndustry {
  name: string; // 行业名称(国家统计局门类,如「制造业」「科学研究和技术服务业」)
  ratioPct: number; // 占净值比例(0-100)
}

/** 按名称或代码搜索基金,返回首条匹配 */
export async function emSearchFund(query: string): Promise<EmFund | null> {
  const cleaned = query.replace(/\s+/g, '').trim(); // EM 名字无空格
  if (!cleaned) return null;
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(cleaned)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS_BASE, cache: 'no-store' });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const first = json?.Datas?.[0];
  if (!first) return null;
  const base = first.FundBaseInfo ?? {};
  const code = String(first.CODE ?? '').trim();
  if (!code) return null;
  return {
    code,
    name: String(first.NAME ?? base.SHORTNAME ?? '').trim(),
    ftype: String(base.FTYPE ?? '').trim(),
  };
}

/** 获取基金最近一期持仓行业配置(按比例降序) */
export async function emGetIndustries(code: string): Promise<EmIndustry[]> {
  const url = `https://api.fund.eastmoney.com/f10/HYPZ/?fundCode=${code}&year=`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS_F10, cache: 'no-store' });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const list: unknown[] = json?.Data?.QuarterInfos?.[0]?.HYPZInfo ?? [];
  return list
    .map(it => {
      const x = it as Record<string, unknown>;
      return {
        name: String(x.HYMC ?? '').trim(),
        ratioPct: Number(x.ZJZBL ?? 0),
      };
    })
    .filter(it => it.name && it.ratioPct > 0)
    .sort((a, b) => b.ratioPct - a.ratioPct);
}

/** 一站式:基金名/代码 → 投资类型 + 持仓行业 */
export async function emClassifyFund(query: string): Promise<{
  fund: EmFund;
  industries: EmIndustry[];
} | null> {
  const fund = await emSearchFund(query);
  if (!fund) return null;
  const industries = await emGetIndustries(fund.code);
  return { fund, industries };
}

/** 把 EM 数据格式化为 sector 字符串(写入 Holding.sector) */
export function formatEmSector(em: {
  fund: EmFund;
  industries: EmIndustry[];
}): string {
  const { fund, industries } = em;
  const top = industries.slice(0, 3);
  const industryText = top
    .map(i => `${i.name}${i.ratioPct.toFixed(1)}%`)
    .join('、');
  const ftype = fund.ftype || '未分类';
  if (!industryText) return ftype; // 货币/债券基金通常无 HYPZ 数据
  return `${ftype} · ${industryText}`;
}

/** 简单并发控制,避免 60 只基金顺序请求等 30 秒 */
export async function pmap<T, R>(
  items: T[],
  concurrency: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}
