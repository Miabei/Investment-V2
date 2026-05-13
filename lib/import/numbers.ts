// 把「+1.03%」「-8.96%」「2,300.40」「¥1,000」清成纯数字
// 返回 null 表示该单元格本来就空 / 解析不出。
export function parseNumber(s: string | null | undefined): number | null {
  if (s == null) return null;
  const trimmed = String(s).trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '--') return null;
  const cleaned = trimmed.replace(/[+,%¥￥\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
