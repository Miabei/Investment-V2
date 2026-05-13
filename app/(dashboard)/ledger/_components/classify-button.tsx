'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { classifyMissingSectorsAction } from '../actions';

export function ClassifyButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (count === 0) return null;

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await classifyMissingSectorsAction();
        const parts = [
          `处理了 ${r.uniqueFunds} 只基金`,
          r.fromEastmoney > 0 ? `${r.fromEastmoney} 只用天天基金权威数据` : null,
          r.fromLlm > 0 ? `${r.fromLlm} 只 AI 看名字推断` : null,
          `全部归入饼图分类`,
          `更新了 ${r.rowsUpdated} 条持仓记录`,
        ].filter(Boolean);
        setResult(parts.join(' · '));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={pending}
        size="sm"
      >
        {pending ? `AI 分类中…` : `AI 自动补全领域 (${count} 条空)`}
      </Button>
      {result ? (
        <span className="text-xs text-muted-foreground">{result}</span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
