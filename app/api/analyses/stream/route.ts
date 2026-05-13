import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { streamAnalysisReport } from '@/lib/ai/deepseek';
import { buildHoldingsSnapshot } from '@/lib/analyses/snapshot';
import type { Prisma } from '@/app/generated/prisma/client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

const BodySchema = z.object({
  rawPrompt: z.string().min(1),
  optimizedPrompt: z.string().min(1),
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { rawPrompt, optimizedPrompt } = parsed.data;

  const snapshot = await buildHoldingsSnapshot();
  if (!snapshot) {
    return NextResponse.json(
      { error: '当前没有持仓数据,先去导入' },
      { status: 400 },
    );
  }

  // 先建一行 PENDING(resultMd 暂为空)
  const row = await prisma.analysisReport.create({
    data: {
      userId: SINGLE_USER_ID,
      promptRaw: rawPrompt,
      promptOptimized: optimizedPrompt,
      holdingsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      resultMd: '',
    },
  });

  let acc = '';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamAnalysisReport(
          optimizedPrompt,
          snapshot,
        )) {
          acc += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        // 流完整结束 → 把累积内容落库
        await prisma.analysisReport.update({
          where: { id: row.id },
          data: { resultMd: acc },
        });
        controller.close();
      } catch (err) {
        // 部分内容也保存,前端能看到截断
        await prisma.analysisReport
          .update({
            where: { id: row.id },
            data: { resultMd: acc + '\n\n[流式中断: ' + String(err) + ']' },
          })
          .catch(() => {});
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Analysis-Id': row.id,
      'X-Accel-Buffering': 'no',
    },
  });
}
