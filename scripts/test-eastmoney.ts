// 东方财富/天天基金非官方接口探针。打印原始响应,我们据此写 parser。
// 用法: npx tsx scripts/test-eastmoney.ts [基金名或代码]
// 默认: 中欧医疗健康混合A

const EM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://fund.eastmoney.com/',
};

async function probe(url: string, label: string, extra?: HeadersInit) {
  console.log(`\n══════════ ${label} ══════════`);
  console.log(`URL: ${url}`);
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { ...EM_HEADERS, ...(extra ?? {}) },
    });
    const ms = Date.now() - t0;
    console.log(`HTTP ${res.status} (${ms} ms)`);
    const text = await res.text();
    console.log(`长度: ${text.length} 字节`);
    console.log('--- 前 800 字符 ---');
    console.log(text.slice(0, 800));
    if (text.length > 800) {
      console.log(`...(共 ${text.length} 字符,只显示前 800)`);
    }
  } catch (err) {
    console.log('错误:', err);
  }
}

async function main() {
  const query = process.argv[2] ?? '中欧医疗健康混合A';
  console.log(`查询: ${query}`);

  // 1. 名字搜索 → 拿基金代码
  await probe(
    `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(query)}`,
    '1. fundsuggest 搜索 (按名称或代码)',
  );

  // 假设第一只基金代码是 003095(中欧医疗健康A)。下面所有接口都打这只
  const code = '003095';
  console.log(`\n>>> 后续测试用代码: ${code}`);

  // 2. 持仓行业配置 (官方 F10 接口)
  await probe(
    `https://api.fund.eastmoney.com/f10/HYPZ/?fundCode=${code}&year=`,
    '2. F10 行业配置 HYPZ',
    { Referer: 'https://fundf10.eastmoney.com/' },
  );

  // 3. 重仓股 (top 10)
  await probe(
    `https://api.fund.eastmoney.com/f10/ccmx/?fundCode=${code}`,
    '3. F10 重仓股 ccmx',
    { Referer: 'https://fundf10.eastmoney.com/' },
  );

  // 4. pingzhongdata - 含基金类型 fundType / 行业 Data_industry
  await probe(
    `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
    '4. pingzhongdata 综合数据 .js',
  );
}

main().catch(err => {
  console.error('总体失败:', err);
  process.exit(1);
});
