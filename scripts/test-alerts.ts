// 快速测试提醒功能:创建测试规则 → 评估 → 显示结果
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { evaluateAllRules } from '@/lib/alerts/engine';

async function main() {
  const uid = 'me';

  // 清理旧的测试规则
  const existing = await prisma.alertRule.findMany({ where: { userId: uid } });
  if (existing.length > 0) {
    console.log(`清理 ${existing.length} 条旧规则…`);
    for (const r of existing) {
      await prisma.alertEvent.deleteMany({ where: { ruleId: r.id } });
      await prisma.alertRule.delete({ where: { id: r.id } });
    }
  }

  // 查看当前行情
  const losingFunds = await prisma.marketQuote.findMany({
    orderBy: { changePct: 'asc' },
    take: 3,
  });

  console.log('当前跌幅最大基金:');
  for (const q of losingFunds) {
    const h = await prisma.holding.findFirst({
      where: { fundCode: q.fundCode },
      select: { fundName: true },
    });
    console.log(`  ${q.fundCode} ${h?.fundName ?? '?'}  ${Number(q.changePct).toFixed(2)}%`);
  }

  // 创建测试规则
  const fundCode = losingFunds[0]!.fundCode;
  const rules = await Promise.all([
    // 会触发:跌幅超过 2%
    prisma.alertRule.create({
      data: {
        userId: uid, source: 'USER', scope: 'FUND', targetId: fundCode,
        condition: { type: 'drop_pct', value: 2, baseline: 'today' },
        enabled: true,
      },
    }),
    // 会触发:医药生物板块跌幅超过 2%
    prisma.alertRule.create({
      data: {
        userId: uid, source: 'USER', scope: 'SECTOR', targetId: '医药生物',
        condition: { type: 'drop_pct', value: 2, baseline: 'today' },
        enabled: true,
      },
    }),
    // 不会触发:阈值太高
    prisma.alertRule.create({
      data: {
        userId: uid, source: 'USER', scope: 'FUND', targetId: fundCode,
        condition: { type: 'drop_pct', value: 8, baseline: 'today' },
        enabled: true,
      },
    }),
  ]);

  console.log(`\n创建 ${rules.length} 条规则`);
  console.log(`  1. FUND ${fundCode} drop>=2% (应触发)`);
  console.log(`  2. SECTOR 医药生物 drop>=2% (应触发)`);
  console.log(`  3. FUND ${fundCode} drop>=8% (不应触发)\n`);

  // 评估
  console.log('=== 评估结果 ===');
  const { checked, triggered, events } = await evaluateAllRules();

  console.log(`检查: ${checked} 条  触发: ${triggered} 条\n`);

  for (const event of events) {
    const rule = await prisma.alertRule.findUnique({ where: { id: event.ruleId } });
    const cond = rule?.condition as Record<string, unknown> | null;
    const p = event.payload as Record<string, unknown> | null;

    console.log(`⚡ ${rule?.scope === 'FUND' ? '基金' : '板块'}「${rule?.targetId}」`);
    console.log(`   条件: ${cond?.type === 'drop_pct' ? '跌幅' : '涨幅'} ≥ ${cond?.value}%`);
    console.log(`   实际: ${p?.changePct ?? p?.avgChangePct}%`);
    console.log(`   时间: ${new Date(event.triggeredAt).toLocaleString('zh-CN')}`);
    console.log();
  }

  // 显示未读计数
  const unread = await prisma.alertEvent.count({
    where: { rule: { userId: uid }, read: false },
  });
  console.log(`未读事件: ${unread} 条`);
  console.log('\n打开 http://localhost:3000/alerts 查看');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
