'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Phase = 'idle' | 'streaming' | 'done' | 'error';

interface Props {
  hasToday: boolean;
}

export default function DailyClient({ hasToday }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPhase('streaming');
    setReport('');
    setError(null);

    try {
      const res = await fetch('/api/daily/stream', { method: 'POST' });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setReport(acc);
      }
      acc += decoder.decode();
      setReport(acc);
      setPhase('done');
      setTimeout(() => {
        router.refresh();
        setReport('');
        setPhase('idle');
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  return (
    <div className="space-y-4">
      <Button
        onClick={generate}
        disabled={phase === 'streaming'}
        variant={hasToday ? 'outline' : 'default'}
      >
        {phase === 'streaming'
          ? '生成中…'
          : hasToday
            ? '重新生成今日日报'
            : '生成今日日报'}
      </Button>

      {error && (
        <p className="text-sm text-red-600">错误：{error}</p>
      )}

      {(phase === 'streaming' || phase === 'done') && report && (
        <Card>
          <CardHeader>
            <CardTitle>日报（流式生成）</CardTitle>
            <CardDescription>
              {phase === 'streaming'
                ? `${report.length} 字 · 还在生成…`
                : `共 ${report.length} 字 · 已保存`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <article className="markdown-body max-w-none text-sm leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
