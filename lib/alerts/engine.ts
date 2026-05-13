// Alert rule evaluation engine — Module 5
// Checks AlertRules against current MarketQuotes, creates AlertEvents when triggered.

import { prisma } from '@/lib/db';
import type { AlertRule, AlertEvent, Prisma } from '@/app/generated/prisma/client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export interface AlertCondition {
  type: 'drop_pct' | 'rise_pct';
  value: number;
  baseline: 'today' | 'last_week' | 'last_month';
}

export interface AlertEvaluation {
  ruleId: string;
  triggered: boolean;
  matchValue: number; // actual value that met the condition
  context: Record<string, unknown>;
}

/**
 * Parse a rule's condition JSON into a typed object.
 */
export function parseCondition(rule: AlertRule): AlertCondition | null {
  const cond = rule.condition as Record<string, unknown> | null;
  if (!cond) return null;
  const type = cond.type;
  const value = Number(cond.value);
  if ((type !== 'drop_pct' && type !== 'rise_pct') || isNaN(value)) return null;
  return {
    type: type as AlertCondition['type'],
    value,
    baseline: (['today', 'last_week', 'last_month'].includes(cond.baseline as string)
      ? (cond.baseline as AlertCondition['baseline'])
      : 'today'),
  };
}

/**
 * Get the latest quote for a fund code.
 */
async function getLatestQuote(
  fundCode: string,
): Promise<{ nav: number; changePct: number; date: Date } | null> {
  const quote = await prisma.marketQuote.findFirst({
    where: { fundCode },
    orderBy: { date: 'desc' },
  });
  if (!quote) return null;
  return {
    nav: Number(quote.nav),
    changePct: Number(quote.changePct),
    date: quote.date,
  };
}

/**
 * Evaluate a single rule against current market data.
 */
async function evaluateRule(
  rule: AlertRule,
  quotesBySector: Map<string, { avgChangePct: number; funds: Array<{ fundCode: string; changePct: number }> }>,
): Promise<AlertEvaluation | null> {
  const cond = parseCondition(rule);
  if (!cond) return null;

  // FUND-scope: check single fund quote
  if (rule.scope === 'FUND') {
    const quote = await getLatestQuote(rule.targetId);
    if (!quote) return null;

    const triggered =
      (cond.type === 'drop_pct' && quote.changePct <= -cond.value) ||
      (cond.type === 'rise_pct' && quote.changePct >= cond.value);

    if (triggered) {
      return {
        ruleId: rule.id,
        triggered: true,
        matchValue: quote.changePct,
        context: {
          fundCode: rule.targetId,
          changePct: quote.changePct,
          nav: quote.nav,
          date: quote.date.toISOString().slice(0, 10),
        },
      };
    }

    return { ruleId: rule.id, triggered: false, matchValue: quote.changePct, context: {} };
  }

  // SECTOR-scope: check sector average
  if (rule.scope === 'SECTOR') {
    const sector = quotesBySector.get(rule.targetId);
    if (!sector) return null;

    const avg = sector.avgChangePct;
    const triggered =
      (cond.type === 'drop_pct' && avg <= -cond.value) ||
      (cond.type === 'rise_pct' && avg >= cond.value);

    if (triggered) {
      return {
        ruleId: rule.id,
        triggered: true,
        matchValue: avg,
        context: {
          sector: rule.targetId,
          avgChangePct: avg,
          fundCount: sector.funds.length,
          topMovers: sector.funds
            .sort((a, b) => a.changePct - b.changePct)
            .slice(0, 3),
        },
      };
    }

    return { ruleId: rule.id, triggered: false, matchValue: avg, context: {} };
  }

  return null;
}

/**
 * Build sector-level quote aggregation from all holdings + quotes.
 */
async function buildSectorAggregation(): Promise<
  Map<string, { avgChangePct: number; funds: Array<{ fundCode: string; changePct: number }> }>
> {
  const batch = await prisma.importBatch.findFirst({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });
  if (!batch) return new Map();

  const holdings = await prisma.holding.findMany({
    where: { importBatchId: batch.id },
    select: { fundCode: true, sectorBucket: true },
  });

  // Get all quotes
  const quotes = await prisma.marketQuote.findMany({
    orderBy: { date: 'desc' },
  });
  const latestQuote = new Map<string, number>();
  for (const q of quotes) {
    if (!latestQuote.has(q.fundCode)) {
      latestQuote.set(q.fundCode, Number(q.changePct));
    }
  }

  // Aggregate by sector
  const sectorMap = new Map<
    string,
    { changes: number[]; funds: Array<{ fundCode: string; changePct: number }> }
  >();

  for (const h of holdings) {
    const bucket = h.sectorBucket || '未分类';
    const chg = h.fundCode ? latestQuote.get(h.fundCode) : undefined;
    const cur = sectorMap.get(bucket) ?? { changes: [], funds: [] };
    if (chg !== undefined) {
      cur.changes.push(chg);
      cur.funds.push({ fundCode: h.fundCode!, changePct: chg });
    }
    sectorMap.set(bucket, cur);
  }

  const result = new Map<string, { avgChangePct: number; funds: Array<{ fundCode: string; changePct: number }> }>();
  for (const [sector, data] of sectorMap) {
    const avg = data.changes.length > 0
      ? data.changes.reduce((s, c) => s + c, 0) / data.changes.length
      : 0;
    result.set(sector, { avgChangePct: avg, funds: data.funds });
  }
  return result;
}

/**
 * Evaluate all enabled rules. Returns triggered events created.
 */
export async function evaluateAllRules(): Promise<{
  checked: number;
  triggered: number;
  events: AlertEvent[];
}> {
  const rules = await prisma.alertRule.findMany({
    where: { userId: SINGLE_USER_ID, enabled: true },
  });

  if (rules.length === 0) return { checked: 0, triggered: 0, events: [] };

  const sectorAgg = await buildSectorAggregation();
  const events: AlertEvent[] = [];

  for (const rule of rules) {
    const result = await evaluateRule(rule, sectorAgg);
    if (result && result.triggered) {
      // Avoid duplicate: check if this rule already triggered today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const alreadyTriggered = await prisma.alertEvent.findFirst({
        where: {
          ruleId: rule.id,
          triggeredAt: { gte: today },
        },
      });
      if (alreadyTriggered) continue;

      const event = await prisma.alertEvent.create({
        data: {
          ruleId: rule.id,
          payload: result.context as Prisma.InputJsonValue,
        },
      });
      events.push(event);
    }
  }

  return { checked: rules.length, triggered: events.length, events };
}

/**
 * Get unread alert event count (for badge display).
 */
export async function getUnreadCount(): Promise<number> {
  return prisma.alertEvent.count({
    where: {
      rule: { userId: SINGLE_USER_ID },
      read: false,
    },
  });
}
