'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { suggestAlertRules, type AlertSuggestion } from '@/lib/ai/deepseek';
import type { Prisma } from '@/app/generated/prisma/client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export async function createRuleAction(args: {
  source: 'AI_SUGGESTED' | 'USER';
  scope: 'FUND' | 'SECTOR';
  targetId: string;
  condition: { type: string; value: number; baseline: string };
}): Promise<void> {
  await prisma.alertRule.create({
    data: {
      userId: SINGLE_USER_ID,
      source: args.source as 'AI_SUGGESTED' | 'USER',
      scope: args.scope as 'FUND' | 'SECTOR',
      targetId: args.targetId,
      condition: args.condition as Prisma.InputJsonValue,
    },
  });
  revalidatePath('/alerts');
}

export async function toggleRuleAction(ruleId: string, enabled: boolean): Promise<void> {
  await prisma.alertRule.update({
    where: { id: ruleId },
    data: { enabled },
  });
  revalidatePath('/alerts');
}

export async function deleteRuleAction(ruleId: string): Promise<void> {
  await prisma.alertEvent.deleteMany({ where: { ruleId } });
  await prisma.alertRule.delete({ where: { id: ruleId } });
  revalidatePath('/alerts');
}

export async function markEventReadAction(eventId: string): Promise<void> {
  await prisma.alertEvent.update({
    where: { id: eventId },
    data: { read: true },
  });
  revalidatePath('/alerts');
}

export async function markAllReadAction(): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: { userId: SINGLE_USER_ID },
    select: { id: true },
  });
  await prisma.alertEvent.updateMany({
    where: { ruleId: { in: rules.map(r => r.id) }, read: false },
    data: { read: true },
  });
  revalidatePath('/alerts');
}

export async function aiSuggestRulesAction(): Promise<AlertSuggestion[]> {
  // Build context for AI
  const batch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) return [];

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: batch.id },
    select: { fundName: true, fundCode: true, amount: true, sectorBucket: true },
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

  // Sector aggregation
  const sectorMap = new Map<string, { changes: number[]; count: number }>();
  const fundQuotes: Array<{
    fundName: string;
    fundCode: string;
    changePct: number;
    sectorBucket: string;
  }> = [];

  for (const h of holdings) {
    const chg = h.fundCode ? latestQuote.get(h.fundCode) : undefined;
    if (chg !== undefined && h.fundCode) {
      fundQuotes.push({
        fundName: h.fundName,
        fundCode: h.fundCode,
        changePct: chg,
        sectorBucket: h.sectorBucket || '未分类',
      });
      const bucket = h.sectorBucket || '未分类';
      const cur = sectorMap.get(bucket) ?? { changes: [], count: 0 };
      cur.changes.push(chg);
      cur.count += 1;
      sectorMap.set(bucket, cur);
    }
  }

  const sectors = Array.from(sectorMap.entries()).map(([bucket, d]) => ({
    bucket,
    avgChangePct: d.changes.reduce((s, c) => s + c, 0) / d.changes.length,
    fundCount: d.count,
  }));

  const topLosers = fundQuotes
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 10);

  // Existing rules
  const existingRules = await prisma.alertRule.findMany({
    where: { userId: SINGLE_USER_ID },
    select: { targetId: true },
  });
  const existingTargets = existingRules.map(r => r.targetId);

  return suggestAlertRules({ sectors, topLosers, existingRuleTargets: existingTargets });
}
