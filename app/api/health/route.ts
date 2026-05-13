import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

type CheckResult =
  | { ok: true; latencyMs: number; detail?: string }
  | { ok: false; error: string };

async function checkDb(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      return { ok: false, error: `unexpected reply: ${pong}` };
    }
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const [db, redisResult] = await Promise.all([checkDb(), checkRedis()]);
  const allOk = db.ok && redisResult.ok;
  return NextResponse.json(
    {
      ok: allOk,
      timestamp: new Date().toISOString(),
      services: { db, redis: redisResult },
    },
    { status: allOk ? 200 : 503 },
  );
}
