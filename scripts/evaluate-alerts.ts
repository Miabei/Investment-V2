// 评估所有启用的提醒规则,对比当前行情触发事件
// 用法: npx tsx scripts/evaluate-alerts.ts
// 适合放在 cron / scheduled task 中每日运行

import 'dotenv/config';
import { evaluateAllRules, parseCondition } from '@/lib/alerts/engine';
import { prisma } from '@/lib/db';

async function main() {
  console.log('评估提醒规则…\n');

  const { checked, triggered, events } = await evaluateAllRules();

  console.log(`检查了 ${checked} 条规则`);
  console.log(`触发了 ${triggered} 条\n`);

  if (events.length > 0) {
    // 打印事件详情
    const rules = await prisma.alertRule.findMany({
      where: { id: { in: events.map(e => e.ruleId) } },
    });
    const ruleMap = new Map(rules.map(r => [r.id, r]));

    for (const event of events) {
      const rule = ruleMap.get(event.ruleId);
      const cond = rule ? parseCondition(rule) : null;
      const payload = event.payload as Record<string, unknown> | null;
      const scope = rule?.scope === 'FUND' ? '基金' : '板块';
      const target = rule?.targetId ?? '?';
      const value = payload?.changePct ?? payload?.avgChangePct ?? '?';

      console.log(`  ${scope}「${target}」`);
      console.log(`    条件: ${cond ? `${cond.type === 'drop_pct' ? '跌幅' : '涨幅'} ≥ ${cond.value}%` : '?'}`);
      console.log(`    实际: ${typeof value === 'number' ? value.toFixed(2) + '%' : value}`);
      console.log(`    时间: ${new Date(event.triggeredAt).toLocaleString('zh-CN')}`);
      console.log();
    }
  }

  if (checked === 0) {
    console.log('当前没有启用的规则。在 /alerts 页面添加规则。');
  }

  console.log('✓ 评估完成');
}

main()
  .catch(err => {
    console.error('\n失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
