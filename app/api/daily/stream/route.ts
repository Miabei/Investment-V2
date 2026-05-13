import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { streamDailyAnalysis } from '@/lib/ai/deepseek';
import { buildDailyContext } from '@/lib/daily/builder';
import type { Prisma } from '@/app/generated/prisma/client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const ctx = await buildDailyContext();
  if (!ctx) {
    return NextResponse.json(
      { error: '当前没有持仓数据,先去台账导入' },
      { status: 400 },
    );
  }

  const today = new Date(ctx.date);

  // Upsert: one report per day; regenerating overwrites
  const row = await prisma.dailyReport.upsert({
    where: { userId_date: { userId: SINGLE_USER_ID, date: today } },
    create: {
      userId: SINGLE_USER_ID,
      date: today,
      indexSnapshot: ctx.indices as unknown as Prisma.InputJsonValue,
      portfolioData: ctx as unknown as Prisma.InputJsonValue,
      resultMd: '',
    },
    update: {
      indexSnapshot: ctx.indices as unknown as Prisma.InputJsonValue,
      portfolioData: ctx as unknown as Prisma.InputJsonValue,
      resultMd: '',
      createdAt: new Date(),
    },
  });

  let acc = '';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamDailyAnalysis(ctx)) {
          acc += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        await prisma.dailyReport.update({
          where: { id: row.id },
          data: { resultMd: acc },
        });
        controller.close();
      } catch (err) {
        await prisma.dailyReport
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
      'X-Report-Id': row.id,
      'X-Accel-Buffering': 'no',
    },
  });
}
