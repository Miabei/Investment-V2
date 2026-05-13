'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { aiSuggestRulesAction, createRuleAction } from '../actions';
import type { AlertSuggestion } from '@/lib/ai/deepseek';

export function AiSuggestButton() {
  const [suggestions, setSuggestions] = useState<AlertSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    setSuggestions(null);
    setAccepted(new Set());
    try {
      const result = await aiSuggestRulesAction();
      setSuggestions(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleAccept(idx: number, s: AlertSuggestion) {
    setAccepted(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    createRuleAction({
      source: 'AI_SUGGESTED',
      scope: s.scope,
      targetId: s.targetId,
      condition: s.condition,
    }).catch(() => {
      setAccepted(prev => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    });
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleSuggest} disabled={loading} variant="outline">
        {loading ? 'AI 分析中… (~10s)' : 'AI 建议规则'}
      </Button>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      {suggestions && suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          AI 认为当前没有需要设置提醒的异常波动。
        </p>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">AI 建议的规则</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((s, i) => {
              const isAccepted = accepted.has(i);
              const condLabel =
                s.condition.type === 'drop_pct' ? '跌幅' : '涨幅';
              const scopeLabel = s.scope === 'FUND' ? '基金' : '板块';
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                    isAccepted ? 'opacity-60' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.targetLabel}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">
                        {scopeLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {condLabel} ≥ {s.condition.value}% 时触发
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 italic">
                      {s.reason}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isAccepted ? 'outline' : 'default'}
                    disabled={isAccepted}
                    onClick={() => handleAccept(i, s)}
                    className="flex-shrink-0 text-xs"
                  >
                    {isAccepted ? '已添加' : '启用'}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
