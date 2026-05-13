'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { AlertEvent, AlertRule } from '@/app/generated/prisma/client';
import { markEventReadAction, markAllReadAction } from '../actions';

interface EventWithRule extends AlertEvent {
  rule?: Pick<AlertRule, 'scope' | 'targetId'>;
}

interface Props {
  events: EventWithRule[];
  fundNames: Map<string, string>;
}

function resolveLabel(
  event: EventWithRule,
  fundNames: Map<string, string>,
): string {
  if (event.rule?.scope === 'FUND') {
    return fundNames.get(event.rule.targetId) ?? event.rule.targetId;
  }
  return event.rule?.targetId ?? '未知';
}

function parsePayload(event: AlertEvent): string {
  const p = event.payload as Record<string, unknown> | null;
  if (!p) return '';
  if (p.avgChangePct !== undefined) {
    return `板块均跌 ${Number(p.avgChangePct).toFixed(2)}%`;
  }
  if (p.changePct !== undefined) {
    return `${Number(p.changePct).toFixed(2)}%`;
  }
  return '';
}

export function AlertEventList({ events, fundNames }: Props) {
  const [, startMark] = useTransition();
  const [, startMarkAll] = useTransition();
  const hasUnread = events.some(e => !e.read);

  return (
    <div>
      {hasUnread ? (
        <div className="mb-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startMarkAll(() => markAllReadAction())}
          >
            全部标为已读
          </Button>
        </div>
      ) : null}
      <div className="space-y-1">
        {events.map(event => {
          const label = resolveLabel(event, fundNames);
          const summary = parsePayload(event);
          return (
            <div
              key={event.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${
                !event.read ? 'bg-amber-50 dark:bg-amber-950/20' : ''
              }`}
            >
              {!event.read ? (
                <span className="h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
              ) : (
                <span className="w-2 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{label}</span>
                {summary ? (
                  <span className="ml-2 text-xs text-muted-foreground">{summary}</span>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {new Date(event.triggeredAt).toLocaleString('zh-CN')}
              </span>
              {!event.read ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => startMark(() => markEventReadAction(event.id))}
                >
                  已读
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
