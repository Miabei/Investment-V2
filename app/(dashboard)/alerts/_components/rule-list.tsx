'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { AlertRule } from '@/app/generated/prisma/client';
import { toggleRuleAction, deleteRuleAction } from '../actions';

interface Props {
  rules: AlertRule[];
  fundNames: Map<string, string>;
}

function resolveLabel(rule: AlertRule, fundNames: Map<string, string>): string {
  if (rule.scope === 'FUND') {
    return fundNames.get(rule.targetId) ?? rule.targetId;
  }
  return rule.targetId;
}

function parseCondition(rule: AlertRule): string {
  const cond = rule.condition as Record<string, unknown> | null;
  if (!cond) return '未知';
  const type = cond.type === 'drop_pct' ? '跌幅' : '涨幅';
  return `${type} ≥ ${cond.value}%`;
}

export function AlertRuleList({ rules, fundNames }: Props) {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无规则</p>;
  }

  return (
    <div className="space-y-2">
      {rules.map(rule => (
        <RuleRow key={rule.id} rule={rule} label={resolveLabel(rule, fundNames)} />
      ))}
    </div>
  );
}

function RuleRow({ rule, label }: { rule: AlertRule; label: string }) {
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();

  const condText = parseCondition(rule);
  const scopeLabel = rule.scope === 'FUND' ? '基金' : '板块';
  const sourceLabel = rule.source === 'AI_SUGGESTED' ? 'AI' : '手动';

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <button
        onClick={() => startToggle(() => toggleRuleAction(rule.id, !rule.enabled))}
        className={`h-5 w-5 rounded border-2 flex-shrink-0 transition-colors ${
          rule.enabled
            ? 'border-emerald-500 bg-emerald-500'
            : 'border-muted-foreground/30'
        }`}
        title={rule.enabled ? '已启用,点击停用' : '已停用,点击启用'}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{label}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {scopeLabel}
          </span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {sourceLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {condText}时触发
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => startDelete(() => deleteRuleAction(rule.id))}
        className="flex-shrink-0 text-xs"
      >
        删除
      </Button>
    </div>
  );
}
