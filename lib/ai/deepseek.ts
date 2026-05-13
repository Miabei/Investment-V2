import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, streamText } from 'ai';
import { z } from 'zod';
import { SECTOR_BUCKETS, isSectorBucket } from '@/lib/portfolio/buckets';

// ────── 列映射 schema ──────
// 每个字段返回的应是「原始列头」中已存在的字符串,完整匹配。
export const ColumnMappingSchema = z.object({
  fundName: z.string().describe('原始列名,对应基金名称'),
  fundCode: z
    .string()
    .nullable()
    .describe('原始列名,对应六位基金代码;若文件中无此列,填 null'),
  amount: z.string().describe('原始列名,对应持仓金额(单位:元)'),
  profit: z
    .string()
    .nullable()
    .describe('原始列名,对应累计盈亏(元);若文件只有「昨日收益」「日涨跌」等而无累计盈亏列,填 null'),
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

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// ────── 自由文本抽取持仓 schema ──────
export const ExtractedHoldingsSchema = z.object({
  holdings: z.array(
    z.object({
      fundName: z.string().describe('基金完整名称'),
      fundCode: z
        .string()
        .nullable()
        .describe('六位基金代码;无则 null'),
      amount: z.number().describe('持有金额(元)'),
      profit: z.number().describe('累计盈亏(元),亏损为负数'),
      profitRate: z
        .number()
        .nullable()
        .describe('收益率,百分比的数值;无则 null'),
      sector: z
        .string()
        .nullable()
        .describe('行业/领域描述;无则 null'),
    }),
  ),
  notes: z
    .string()
    .nullable()
    .describe('抽取过程中的不确定项或说明,无则 null'),
});

export type ExtractedHoldings = z.infer<typeof ExtractedHoldingsSchema>;

// ────── 基金行业分类 schema ──────
export const SectorClassificationSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      sector: z
        .string()
        .describe(
          '一句话短语描述该基金的主要投资领域,例如「港股科技互联网龙头」「医药生物全产业链」「半导体设备国产替代」;判断不出时填「未识别」',
        ),
    }),
  ),
});

export type SectorClassification = z.infer<
  typeof SectorClassificationSchema
>;

// ────── DeepSeek provider 单例 ──────
let _provider: ReturnType<typeof createOpenAICompatible> | undefined;

function getProvider() {
  if (_provider) return _provider;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置');
  _provider = createOpenAICompatible({ name: 'deepseek', apiKey, baseURL });
  return _provider;
}

function getModelId(): string {
  const m = process.env.DEEPSEEK_MODEL;
  if (!m) throw new Error('DEEPSEEK_MODEL 未配置');
  return m;
}

// ────── 推断列映射 ──────
export async function inferColumnMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<ColumnMapping> {
  const provider = getProvider();
  const prompt = [
    '你是表格列名映射助手。任务:把用户文件的列头映射到我们的标准字段,以 JSON 形式返回。',
    '',
    '严格要求:',
    '1. 必须返回下列固定结构的 JSON,**键名 (key) 完全使用英文,如 fundName / amount,不要翻译成中文,不要改写**。',
    '2. 字段的「值 (value)」是「原始列头数组」中已存在的字符串,完整匹配(含空格、括号、单位)。例如原列名是「持有金额 (元)」就原样返回 "持有金额 (元)",不要写成 "持有金额"。',
    '3. 没有对应列的字段返回 null,不要硬塞。',
    '4. junkRowIndices 是需要跳过的数据行索引数组(0-based,不含 header),如「合计」「总计」「副标题」「空行」对应的 row 索引。无则 [].',
    '',
    '返回的 JSON 结构必须严格如下(以下值仅为示例,你应按实际情况填):',
    '```',
    JSON.stringify(
      {
        fundName: '<原始列名:基金名称>',
        fundCode: '<原始列名:六位基金代码;无则 null>',
        amount: '<原始列名:持仓金额>',
        profit: '<原始列名:累计盈亏;无累计盈亏列(只有日收益等)则 null>',
        profitRate: '<原始列名:收益率;无则 null>',
        sector: '<原始列名:行业/领域描述;无则 null>',
        junkRowIndices: [],
        notes: null,
      },
      null,
      2,
    ),
    '```',
    '',
    '原始列头(JSON 数组):',
    JSON.stringify(headers),
    '',
    '前 5 行数据样本(从 row0 开始):',
    sampleRows
      .slice(0, 5)
      .map((r, i) => `  row${i}: ${JSON.stringify(r)}`)
      .join('\n'),
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: ColumnMappingSchema,
    prompt,
  });

  return object;
}

// ────── 从粘贴的自由文本抽取持仓 ──────
export async function extractHoldingsFromText(
  text: string,
): Promise<ExtractedHoldings> {
  const provider = getProvider();
  const prompt = [
    '你是投资台账数据抽取助手。从用户粘贴的文字中抽取所有基金持仓信息,以 JSON 形式返回。',
    '',
    '用户文字可能来自:',
    '- 从 Excel / Google Sheets 复制(每行一只基金,字段间用 Tab、空格或符号分隔)',
    '- 网页表格直接选中复制',
    '- 自由格式描述(例如「我买了易方达蓝筹 25000 元 亏了 2400」)',
    '- 截图 OCR 后的不规范文本',
    '',
    '抽取规则:',
    '1. 每只基金一条记录。必须包含 fundName(基金名称)和 amount(持仓金额),其他字段尽量提取。',
    '2. 数字保留原始精度,不四舍五入。亏损为负数。',
    '3. 收益率以百分比的数值返回(例:截图显示 -8.96% 则返回 -8.96)。',
    '4. 找不到的字段填 null,不要瞎猜。',
    '5. 跳过显然不是基金的内容(汇总「合计」、标题、广告、截图水印)。',
    '6. 在 notes 中说明你的提取依据或不确定项。',
    '',
    '返回的 JSON 结构必须严格如下(键名必须英文,值按实际填):',
    '```',
    JSON.stringify(
      {
        holdings: [
          {
            fundName: '<基金名称>',
            fundCode: '<六位代码或 null>',
            amount: 0,
            profit: 0,
            profitRate: 0,
            sector: '<领域描述或 null>',
          },
        ],
        notes: null,
      },
      null,
      2,
    ),
    '```',
    '',
    '用户粘贴的文字(三个反引号之间):',
    '```',
    text,
    '```',
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: ExtractedHoldingsSchema,
    prompt,
  });

  return object;
}

// ────── 把基金归入固定桶(模块二饼图用)──────
export const BucketizationSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      bucket: z
        .string()
        .describe(
          '从给定的桶列表中选一个最贴近的;实在拿不准用「其他主题」',
        ),
    }),
  ),
});

export async function bucketizeFunds(
  items: Array<{ fundName: string; sectorHint: string | null }>,
): Promise<Array<{ fundName: string; bucket: string }>> {
  if (items.length === 0) return [];

  const provider = getProvider();
  const indexed = items.map((it, i) => ({ index: i, ...it }));

  const prompt = [
    '你是基金分类助手。把下面每只基金归入给定的桶之一,以 JSON 形式返回。',
    '',
    '可选桶列表(必须从中选一个,**严格匹配字符串**,不能改写):',
    JSON.stringify(SECTOR_BUCKETS),
    '',
    '判断依据(综合):',
    '1. fundName 中的关键词:「医疗」「医药」→ 医药生物;「白酒」「消费」「家电」→ 消费白酒;「半导体」「芯片」「AI」「电子」「机器人」→ A股硬科技;「恒生」「港股科技」「中概互联网」→ 港股科技互联网;「美股」「纳斯达克」「全球」「QDII」(科技/消费类)→ 美股全球;「沪深300」「中证500」「上证50」「创业板」「100 指数」→ 宽基指数;「军工」「国防」「航天」「卫星」→ 军工;「新能源」「光伏」「锂电」「电池」「碳中和」→ 新能源;「有色」「稀土」「金属」「化工」「煤炭」→ 周期资源;「银行」「金融」「券商」「保险」→ 金融;「房地产」「建筑」「基建」「通信设备」(基建侧)→ 地产基建;「债」「债券」「信用」→ 债券;「货币」「天添益」→ 货币',
    '2. sectorHint(若提供)给出 EM 投资类型 + 持仓行业,作为辅助',
    '3. 港股价值(金融/能源/低估值)与港股科技要区分:港股价值常见于「港股通」「价值发现」之类',
    '4. 都判不出 → 「其他主题」',
    '',
    '严格要求:',
    '- 返回 {"results": [{"index": 数字, "bucket": "桶名"}, ...]}',
    '- bucket 字段必须**严格匹配**桶列表中的字符串(中文、空格、不能错)',
    '- 不要发明新桶',
    '',
    '基金列表(JSON):',
    JSON.stringify(indexed, null, 2),
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: BucketizationSchema,
    prompt,
  });

  return object.results
    .filter(r => r.index >= 0 && r.index < items.length)
    .map(r => ({
      fundName: items[r.index]!.fundName,
      bucket: isSectorBucket(r.bucket) ? r.bucket : '其他主题',
    }));
}

// ────── 模块三:Prompt 优化 + 流式分析报告 ──────
export const PromptOptimizationSchema = z.object({
  optimized: z
    .string()
    .describe('优化后的提示词,作为下一步分析报告生成的实际输入'),
  explanation: z
    .string()
    .describe('给用户看的优化理由,1-3 句话,中文'),
});

export type PromptOptimization = z.infer<typeof PromptOptimizationSchema>;

export async function optimizeAnalysisPrompt(
  rawPrompt: string,
  context: {
    totalAmount: number;
    bucketCount: number;
    topBuckets: string[];
  },
): Promise<PromptOptimization> {
  const provider = getProvider();
  const prompt = [
    '你是投资分析提示词优化助手。用户给了一段原始问题,你帮他改写成更聚焦、可分析的提示词,以 JSON 形式返回。',
    '',
    '用户的持仓概况(供你优化时参考,不要直接抄进 optimized):',
    `- 总持仓金额: ${context.totalAmount.toFixed(2)} 元`,
    `- 涉及分类桶: ${context.bucketCount} 个`,
    `- 前几大分类: ${context.topBuckets.join('、') || '(暂无)'}`,
    '',
    '原始问题:',
    `"""${rawPrompt}"""`,
    '',
    '优化原则:',
    '1. 保留用户的核心意图,不要替他做决定',
    '2. 把模糊词换成可计算/可观察的指标(例如「太集中」→「单一桶持仓占比是否超过 30%」)',
    '3. 明确分析维度:集中度 / 行业暴露 / 收益贡献 / 风险因子 / 配置建议',
    '4. 要求输出固定结构:概况 / 风险 / 机会 / 建议',
    '',
    '严格要求:',
    '- 返回 JSON: {"optimized": "...", "explanation": "..."}',
    '- optimized 是一段完整的、可直接发给 LLM 的中文分析指令',
    '- explanation 是给用户看的解释,1-3 句话',
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: PromptOptimizationSchema,
    prompt,
  });
  return object;
}

export interface HoldingsSnapshotForAnalysis {
  capturedAt: string;
  totalAmount: number;
  totalProfit: number;
  totalRate: number;
  byBucket: Array<{
    bucket: string;
    count: number;
    amount: number;
    profit: number;
    sharePct: number;
  }>;
  topHoldings: Array<{
    fundName: string;
    fundCode: string | null;
    amount: number;
    profit: number;
    profitRate: number | null;
    sectorBucket: string | null;
    sector: string | null;
  }>;
}

export async function* streamAnalysisReport(
  optimizedPrompt: string,
  snapshot: HoldingsSnapshotForAnalysis,
): AsyncIterable<string> {
  const provider = getProvider();

  const systemMsg = [
    '你是个人投资分析助手。基于用户提供的持仓数据,严格按以下结构输出 Markdown 分析报告:',
    '',
    '## 概况',
    '## 风险',
    '## 机会',
    '## 建议',
    '',
    '每个章节都要有,内容要具体到某个分类桶或基金名,不要空泛。',
    '声明:本报告仅为数据分析,不构成投资建议。',
  ].join('\n');

  const userMsg = [
    `# 用户的分析诉求`,
    optimizedPrompt,
    '',
    `# 当前持仓快照(${snapshot.capturedAt})`,
    `总持仓金额: ${snapshot.totalAmount.toFixed(2)} 元`,
    `累计盈亏: ${snapshot.totalProfit.toFixed(2)} 元`,
    `加权收益率: ${snapshot.totalRate.toFixed(2)}%`,
    '',
    '## 按分类桶聚合',
    '```json',
    JSON.stringify(snapshot.byBucket, null, 2),
    '```',
    '',
    `## 主要持仓 (前 ${snapshot.topHoldings.length} 只,按金额降序)`,
    '```json',
    JSON.stringify(snapshot.topHoldings, null, 2),
    '```',
  ].join('\n');

  const result = streamText({
    model: provider(getModelId()),
    system: systemMsg,
    prompt: userMsg,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

// ────── 给一组基金批量推断行业领域 ──────
export async function classifyFundSectors(
  fundNames: string[],
): Promise<Array<{ fundName: string; sector: string }>> {
  if (fundNames.length === 0) return [];

  const provider = getProvider();
  const indexed = fundNames.map((name, i) => ({ index: i, fundName: name }));

  const prompt = [
    '你是基金行业分类助手。给你一批基金名称(每个带 index),请为每只基金给出投资领域描述,以 JSON 形式返回。',
    '',
    '严格要求:',
    '1. 必须返回固定结构:`{"results": [{"index": 数字, "sector": "字符串"}, ...]}`,键名英文。',
    '2. results 数组的每一项对应输入里某个 index;尽量覆盖全部输入,顺序无所谓但 index 不能搞错。',
    '3. sector 是 1 句话短语,描述基金的主要投资领域,例如「港股科技互联网龙头」「医药生物全产业链」「半导体设备国产替代」「全球美股科技」「白酒消费」「军工航天」。',
    '4. 不能判断的(基金名很奇怪)填 "未识别",不要瞎编。',
    '',
    '输入(JSON 数组):',
    JSON.stringify(indexed, null, 2),
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: SectorClassificationSchema,
    prompt,
  });

  // 把 index 映射回 fundName
  return object.results
    .filter(r => r.index >= 0 && r.index < fundNames.length)
    .map(r => ({ fundName: fundNames[r.index]!, sector: r.sector }));
}

// ────── 模块五:AI 提醒规则建议 ──────
export const AlertSuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      scope: z.enum(['FUND', 'SECTOR']),
      targetId: z.string().describe('fundCode(基金) 或 sectorBucket(板块)名'),
      targetLabel: z.string().describe('用于 UI 展示(基金名或板块中文名)'),
      condition: z.object({
        type: z.enum(['drop_pct', 'rise_pct']),
        value: z.number().describe('触发阈值,百分比的数值(如 5 表示 5%)'),
        baseline: z.enum(['today', 'last_week', 'last_month']),
      }),
      reason: z.string().describe('给用户的推荐理由,1-2 句中文'),
    }),
  ),
});

export type AlertSuggestion = z.infer<typeof AlertSuggestionSchema>['suggestions'][number];

export async function suggestAlertRules(
  context: {
    sectors: Array<{
      bucket: string;
      avgChangePct: number;
      fundCount: number;
    }>;
    topLosers: Array<{
      fundName: string;
      fundCode: string;
      changePct: number;
      sectorBucket: string;
    }>;
    existingRuleTargets: string[];
  },
): Promise<AlertSuggestion[]> {
  const provider = getProvider();

  const prompt = [
    '你是投资提醒顾问。根据用户当前持仓的涨跌情况,建议 3-5 条提醒规则。以 JSON 形式返回。',
    '',
    '建议原则:',
    '1. 优先关注跌幅较大的板块或基金,建议 drop_pct 类规则',
    '2. 也可以关注涨幅异常的,建议 rise_pct 类规则',
    '3. 阈值要合理:轻微波动(1-2%)不建议,建议 3-8% 的阈值',
    '4. 已有规则的 target 不要重复建议',
    '5. reason 要具体,说明为什么关注(例如"该板块连续多日下跌,已接近历史支撑位")',
    '',
    '当前板块涨跌:',
    JSON.stringify(context.sectors, null, 2),
    '',
    '跌幅最大的几只基金:',
    JSON.stringify(context.topLosers.slice(0, 10), null, 2),
    '',
    `已有规则覆盖的 target: ${JSON.stringify(context.existingRuleTargets)}`,
    '',
    '返回 JSON:',
    '{"suggestions": [{"scope": "FUND"|"SECTOR", "targetId": "...", "targetLabel": "...", "condition": {"type": "drop_pct"|"rise_pct", "value": 数字, "baseline": "today"}, "reason": "理由"}, ...]}',
    '',
    'targetId: FUND 类用 6 位 fundCode; SECTOR 类用 sectorBucket 中文名(如"港股科技互联网")',
    'targetLabel: 基金名或板块中文名',
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: AlertSuggestionSchema,
    prompt,
  });

  return object.suggestions;
}

// ────── 模块六:每日日报 ──────
import type { DailyContext } from '@/lib/daily/builder';

export async function* streamDailyAnalysis(
  ctx: DailyContext,
): AsyncIterable<string> {
  const provider = getProvider();

  const indexTable =
    ctx.indices.length > 0
      ? [
          '| 指数 | 收盘 | 涨跌幅 |',
          '|:---|---:|---:|',
          ...ctx.indices.map(
            idx =>
              `| ${idx.name} | ${idx.price.toFixed(2)} | ${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}% |`,
          ),
        ].join('\n')
      : '（今日指数数据暂未获取）';

  const sectorBlock = ctx.sectors
    .map(s => {
      const chgStr =
        s.avgChangePct !== null
          ? `${s.avgChangePct >= 0 ? '+' : ''}${s.avgChangePct.toFixed(2)}%`
          : '暂无行情';
      const fundList = s.topFunds
        .map(
          f =>
            `    - ${f.fundName}（持仓 ${f.amount.toLocaleString('zh-CN')} 元` +
            (f.changePct !== null
              ? `，今日 ${f.changePct >= 0 ? '+' : ''}${f.changePct.toFixed(2)}%`
              : '') +
            '）',
        )
        .join('\n');
      return [
        `## ${s.bucket}`,
        `持仓 ${s.amount.toLocaleString('zh-CN')} 元（占比 ${s.sharePct}%），今日均涨跌：${chgStr}`,
        '主要持仓：',
        fundList,
      ].join('\n');
    })
    .join('\n\n');

  const systemMsg = [
    '你是专业的个人投资日报助手。基于用户今日持仓表现和大盘数据,生成一份结构清晰的个人投资日报,Markdown 格式输出。',
    '',
    '报告必须包含以下五个章节,每章节都要有具体数据支撑,不能空泛:',
    '',
    '**今日定性**（一行,用 ** 加粗核心判断,格式: 今日（M月D日）市场，用一句话定性：**...**）',
    '',
    '---',
    '',
    '### 一、大盘速览',
    '插入下方我提供的指数表格,并补充 1-2 句整体判断。',
    '',
    '### 二、板块诊断',
    '逐一分析用户持有的每个板块：持仓规模、今日表现、近期势头、操作建议（持有/减仓/加仓/观察）。',
    '如无行情数据,基于板块特性和持仓比例给出定性判断。',
    '',
    '### 三、执行清单',
    '以 Markdown 表格呈现,列出所有持仓超过 2000 元的基金：',
    '| 持仓标的 | 持仓(元) | 今日涨跌 | 今日建议 | 操作逻辑 |',
    '|:---|---:|:---:|:---:|:---|',
    '',
    '### 四、投资建议',
    '3-5 条具体可操作建议,聚焦在：止盈纪律、加仓时机、集中度风险、再平衡。',
    '',
    '### 五、监控重点',
    '| 板块 | 今日表现 | 仓位占比 | 今日操作 | 下步信号 |',
    '|:---|:---:|:---:|:---:|:---|',
  ].join('\n');

  const userMsg = [
    `# 今日数据（${ctx.date}）`,
    '',
    '## 大盘指数',
    indexTable,
    '',
    `## 组合概况`,
    `总持仓：${ctx.portfolioTotals.totalAmount.toLocaleString('zh-CN')} 元`,
    `累计盈亏：${ctx.portfolioTotals.totalProfit >= 0 ? '+' : ''}${ctx.portfolioTotals.totalProfit.toLocaleString('zh-CN')} 元`,
    `收益率：${ctx.portfolioTotals.profitRate >= 0 ? '+' : ''}${ctx.portfolioTotals.profitRate.toFixed(2)}%`,
    ctx.quotesDate ? `行情数据截至：${ctx.quotesDate}` : '（行情数据暂无）',
    '',
    '## 各板块详情',
    sectorBlock,
  ].join('\n');

  const result = streamText({
    model: provider(getModelId()),
    system: systemMsg,
    prompt: userMsg,
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

// ────── 模块四:AI 板块解读 ──────
export const SectorInsightSchema = z.object({
  insight: z.string().describe('一句话中文解读该板块今日涨跌原因,50 字以内'),
});

export async function generateSectorInsight(
  bucket: string,
  context: {
    avgChangePct: number;
    fundCount: number;
    topFunds: Array<{ fundName: string; changePct: number }>;
  },
): Promise<string> {
  const provider = getProvider();
  const direction = context.avgChangePct >= 0 ? '上涨' : '下跌';

  const prompt = [
    `你是投资市场解读助手。请为"${bucket}"板块今日${direction} ${Math.abs(context.avgChangePct).toFixed(2)}% 这一现象,给出一个简短的归因(30–50 字中文)。`,
    '',
    `该板块有 ${context.fundCount} 只基金。`,
    '涨跌最大的几只:',
    ...context.topFunds.map(f => `  - ${f.fundName}: ${f.changePct >= 0 ? '+' : ''}${f.changePct.toFixed(2)}%`),
    '',
    '要求:只说最可能的 1 个原因,不要面面俱到。句式自然,不要模板化。',
  ].join('\n');

  const { object } = await generateObject({
    model: provider(getModelId()),
    schema: SectorInsightSchema,
    prompt,
  });

  return object.insight;
}
