'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

import { optimizePromptAction } from '../actions';

type Phase = 'idle' | 'optimizing' | 'optimized' | 'streaming' | 'done';

export default function NewAnalysisPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const [rawPrompt, setRawPrompt] = useState<string>('');
  const [optimized, setOptimized] = useState<string>('');
  const [explanation, setExplanation] = useState<string>('');

  const [streamedReport, setStreamedReport] = useState<string>('');

  const [optimizeElapsed, setOptimizeElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'optimizing') {
      setOptimizeElapsed(0);
      return;
    }
    const start = Date.now();
    const iv = setInterval(
      () => setOptimizeElapsed(Math.round((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(iv);
  }, [phase]);

  async function runOptimize() {
    if (!rawPrompt.trim()) return;
    setPhase('optimizing');
    setError(null);
    try {
      const r = await optimizePromptAction(rawPrompt);
      setOptimized(r.optimized);
      setExplanation(r.explanation);
      setPhase('optimized');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }

  async function runGenerate() {
    const promptToUse = optimized.trim() || rawPrompt.trim();
    if (!promptToUse) return;
    setPhase('streaming');
    setError(null);
    setStreamedReport('');

    try {
      const res = await fetch('/api/analyses/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawPrompt, optimizedPrompt: promptToUse }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      const id = res.headers.get('X-Analysis-Id');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamedReport(acc);
      }
      acc += decoder.decode(); // flush
      setStreamedReport(acc);
      setPhase('done');
      if (id) {
        setTimeout(() => {
          router.push(`/analyses/${id}`);
          router.refresh();
        }, 1200);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(optimized.trim() ? 'optimized' : 'idle');
    }
  }

  const placeholder = `例:
- 我组合是不是太集中医药了?有什么再平衡建议?
- 港股科技和 A 股科技哪边权重应该加?
- 当前累计亏损主要来自哪些桶?
- 给我做一次全面的风险体检`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">新建分析</h1>
          <p className="text-sm text-muted-foreground">
            写下你想问的问题 → AI 帮你优化成清晰指令 → 生成报告(基于当前最新持仓快照)
          </p>
        </div>
        <Link
          href="/analyses"
          className={buttonVariants({ variant: 'outline' })}
        >
          返回列表
        </Link>
      </div>

      {/* 1. 输入原始问题 */}
      <Card>
        <CardHeader>
          <CardTitle>1. 你想问什么?</CardTitle>
          <CardDescription>用自然语言写,模糊也没关系。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={rawPrompt}
            onChange={e => setRawPrompt(e.target.value)}
            placeholder={placeholder}
            className="min-h-32 text-sm"
            disabled={phase === 'optimizing' || phase === 'streaming'}
          />
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={runOptimize}
                disabled={
                  !rawPrompt.trim() ||
                  phase === 'optimizing' ||
                  phase === 'streaming'
                }
              >
                {phase === 'optimizing' ? 'AI 优化中…' : 'AI 优化提示词'}
              </Button>
              <Button
                onClick={runGenerate}
                disabled={
                  !rawPrompt.trim() ||
                  phase === 'streaming' ||
                  phase === 'done'
                }
              >
                {phase === 'streaming'
                  ? '生成中…'
                  : phase === 'done'
                    ? '完成,跳转中…'
                    : optimized.trim()
                      ? '生成分析报告 (基于优化指令)'
                      : '直接生成分析报告'}
              </Button>
            </div>
            {phase === 'optimizing' ? (
              <p className="text-xs text-muted-foreground">
                已等待 {optimizeElapsed}s…
              </p>
            ) : null}
          </div>
          {error && phase === 'idle' ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. 展示+编辑优化版 */}
      {optimized ? (
        <Card>
          <CardHeader>
            <CardTitle>2. 优化后的指令(可继续编辑)</CardTitle>
            {explanation ? (
              <CardDescription>AI 优化理由:{explanation}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={optimized}
              onChange={e => setOptimized(e.target.value)}
              className="min-h-40 text-sm"
              disabled={phase === 'streaming'}
            />
            <p className="text-xs text-muted-foreground">
              编辑后点击上方「生成分析报告」按钮使用编辑后的指令。
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* 3. 流式输出 */}
      {(phase === 'streaming' || phase === 'done') && streamedReport ? (
        <Card>
          <CardHeader>
            <CardTitle>3. 报告(流式生成)</CardTitle>
            <CardDescription>
              {phase === 'streaming'
                ? `${streamedReport.length} 字 · 还在生成…`
                : `共 ${streamedReport.length} 字`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <article className="markdown-body max-w-none text-sm leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamedReport}
              </ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      ) : null}

      {error && phase !== 'idle' ? (
        <p className="text-sm text-red-600">错误:{error}</p>
      ) : null}
    </div>
  );
}
