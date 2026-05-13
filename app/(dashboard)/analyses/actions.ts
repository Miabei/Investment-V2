'use server';

import {
  optimizeAnalysisPrompt,
  type PromptOptimization,
} from '@/lib/ai/deepseek';
import { buildHoldingsSnapshot } from '@/lib/analyses/snapshot';

const POLISH_TIMEOUT_MS = 30_000;

export async function optimizePromptAction(
  rawPrompt: string,
): Promise<PromptOptimization> {
  const snapshot = await buildHoldingsSnapshot();
  const ctx = snapshot
    ? {
        totalAmount: snapshot.totalAmount,
        bucketCount: snapshot.byBucket.length,
        topBuckets: snapshot.byBucket.slice(0, 3).map(b => b.bucket),
      }
    : { totalAmount: 0, bucketCount: 0, topBuckets: [] };

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('AI 优化超时,请稍后重试或直接生成报告')),
      POLISH_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      optimizeAnalysisPrompt(rawPrompt, ctx),
      timeoutPromise,
    ]);
    return result as PromptOptimization;
  } finally {
    clearTimeout(timeoutId!);
  }
}
