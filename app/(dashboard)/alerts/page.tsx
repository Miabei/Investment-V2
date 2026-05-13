import { prisma } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AlertRuleList } from './_components/rule-list';
import { AlertEventList } from './_components/event-list';
import { AiSuggestButton } from './_components/ai-suggest-button';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const rules = await prisma.alertRule.findMany({
    where: { userId: SINGLE_USER_ID },
    orderBy: { createdAt: 'desc' },
  });

  const events = await prisma.alertEvent.findMany({
    where: { rule: { userId: SINGLE_USER_ID } },
    orderBy: { triggeredAt: 'desc' },
    take: 50,
    include: { rule: { select: { scope: true, targetId: true } } },
  });

  // Resolve target labels (fund name or sector bucket stays as-is)
  const fundNames = new Map<string, string>();
  if (rules.length > 0) {
    const batch = await prisma.importBatch.findFirst({
      where: { userId: SINGLE_USER_ID },
      orderBy: { createdAt: 'desc' },
    });
    if (batch) {
      const holdings = await prisma.holding.findMany({
        where: { importBatchId: batch.id },
        select: { fundCode: true, fundName: true },
      });
      for (const h of holdings) {
        if (h.fundCode && !fundNames.has(h.fundCode)) {
          fundNames.set(h.fundCode, h.fundName);
        }
      }
    }
  }

  const unreadCount = events.filter(e => !e.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">提醒规则</h1>
          <p className="text-sm text-muted-foreground">
            设置基金或板块的涨跌提醒,AI 也会主动建议规则。
            {unreadCount > 0 ? (
              <span className="ml-2 text-amber-600 font-medium">
                {unreadCount} 条未读事件
              </span>
            ) : null}
          </p>
        </div>
        <AiSuggestButton />
      </div>

      {/* Active rules */}
      <Card>
        <CardHeader>
          <CardTitle>当前规则</CardTitle>
          <CardDescription>
            {rules.length === 0
              ? '还没有规则,点击右上角「AI 建议规则」自动生成。'
              : `${rules.length} 条规则 · ${rules.filter(r => r.enabled).length} 条启用`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertRuleList rules={rules} fundNames={fundNames} />
        </CardContent>
      </Card>

      {/* Event history */}
      {events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>触发历史</CardTitle>
            <CardDescription>最近 50 条</CardDescription>
          </CardHeader>
          <CardContent>
            <AlertEventList events={events} fundNames={fundNames} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
