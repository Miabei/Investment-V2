import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import { z } from 'zod';

// Schema strictly mirrors what 模块一 (the ledger) needs.
// Every field has a description — the AI SDK injects these into the prompt
// so the model knows what each slot means.
const HoldingSchema = z.object({
  fundName: z.string().describe('基金完整名称,如「易方达蓝筹精选混合」'),
  fundCode: z
    .string()
    .nullable()
    .describe('六位基金代码,截图中未显示则填 null'),
  amount: z.number().describe('持有金额(元),保留原始小数位'),
  profit: z.number().describe('持有收益(元),亏损为负数'),
  profitRate: z
    .number()
    .describe('收益率,百分比的数值(例:截图显示 +5.23% 则返回 5.23)'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('该行识别可信度 0-1,模糊或不确定时降低'),
});

const ResponseSchema = z.object({
  holdings: z.array(HoldingSchema),
  notes: z
    .string()
    .nullable()
    .describe('识别中遇到的不确定项或异常,无则 null'),
});

type Args = { imagePath: string };

function parseArgs(): Args {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('用法: pnpm tsx test-recognize.ts <截图路径>');
    console.error('示例: pnpm tsx test-recognize.ts ./samples/alipay-1.png');
    process.exit(1);
  }
  return { imagePath };
}

function loadImage(rawPath: string): { buffer: Buffer; mime: string; full: string } {
  const full = resolve(rawPath);
  if (!existsSync(full)) {
    console.error(`文件不存在: ${full}`);
    process.exit(1);
  }
  const buffer = readFileSync(full);
  const ext = extname(full).slice(1).toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { buffer, mime, full };
}

function loadEnv() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const modelId = process.env.DEEPSEEK_MODEL;
  if (!apiKey) {
    console.error('缺少环境变量 DEEPSEEK_API_KEY,请在 .env 中设置');
    process.exit(1);
  }
  if (!modelId) {
    console.error('缺少环境变量 DEEPSEEK_MODEL,请填入支持图像输入的 model id');
    process.exit(1);
  }
  return { apiKey, baseURL, modelId };
}

async function main() {
  const { imagePath } = parseArgs();
  const { apiKey, baseURL, modelId } = loadEnv();
  const { buffer, mime, full } = loadImage(imagePath);

  const deepseek = createOpenAICompatible({
    name: 'deepseek',
    apiKey,
    baseURL,
  });

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  console.log('---------------------------------------');
  console.log(`模型 : ${modelId}`);
  console.log(`图片 : ${full}`);
  console.log(`大小 : ${(buffer.length / 1024).toFixed(1)} KB  (${mime})`);
  console.log('---------------------------------------');

  const t0 = Date.now();
  const { object, usage } = await generateObject({
    model: deepseek(modelId),
    mode: 'json',
    schema: ResponseSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '这是一张支付宝基金持仓截图。',
              '请提取每一行基金的:基金名称、基金代码(六位数字,截图未显示则填 null)、持有金额、持有收益、收益率。',
              '严格保持原始数字精度,不要四舍五入。亏损为负数。',
              '收益率请以百分比的数值返回(例:截图显示 +5.23% 则返回 5.23)。',
              '对难以确定的行,confidence 给 0.5 以下并在 notes 中说明。',
              '被截图裁切看不到的字段返回 null,不要瞎猜。',
              '如果某些行明显不是基金(例如汇总栏「总收益」「总市值」),请直接跳过,不要纳入 holdings。',
            ].join('\n'),
          },
          { type: 'image', image: dataUrl },
        ],
      },
    ],
  });
  const elapsedMs = Date.now() - t0;

  console.log('\n--- 识别结果 ---');
  console.log(JSON.stringify(object, null, 2));

  console.log('\n--- 统计 ---');
  console.log(`耗时       : ${elapsedMs} ms`);
  console.log(
    `Token      : prompt=${usage.promptTokens}, completion=${usage.completionTokens}, total=${usage.totalTokens}`,
  );
  console.log(`基金条数   : ${object.holdings.length}`);

  const lowConf = object.holdings.filter(h => h.confidence < 0.7);
  if (lowConf.length > 0) {
    console.log(
      `低置信度   : ${lowConf.length} 条 (<0.7) — ${lowConf.map(h => h.fundName).join(', ')}`,
    );
  } else {
    console.log('低置信度   : 无');
  }
  if (object.notes) {
    console.log(`模型备注   : ${object.notes}`);
  }
}

main().catch(err => {
  console.error('\n失败:', err?.message ?? err);
  if (err?.cause) console.error('原因:', err.cause);
  if (err?.responseBody) console.error('响应:', err.responseBody);
  process.exit(1);
});
