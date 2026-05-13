import { prisma } from '@/lib/db';
import type { ColumnMapping } from '@/lib/ai/deepseek';
import type { ImportBatch } from '@/app/generated/prisma/client';

const SINGLE_USER_ID = process.env.SINGLE_USER_ID ?? 'me';

export interface HoldingInput {
  fundName: string;
  fundCode: string | null;
  amount: number;
  profit: number;
  profitRate: number | null;
  sector: string | null;
}

export interface SaveImportArgs {
  format: 'CSV' | 'XLSX' | 'MANUAL';
  fileUrl?: string | null;
  rawHeaders?: string[] | null;
  columnMapping?: ColumnMapping | null;
  rawText?: string | null; // 粘贴模式下可选保存原文方便复盘
  holdings: HoldingInput[];
}

// MVP 阶段单用户;数据库里若没有就建一行,值固定。
export async function ensureSingleUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: SINGLE_USER_ID },
    update: {},
    create: { id: SINGLE_USER_ID, email: 'me@local' },
  });
}

export async function saveImport(args: SaveImportArgs): Promise<ImportBatch> {
  await ensureSingleUser();

  return prisma.$transaction(async tx => {
    const batch = await tx.importBatch.create({
      data: {
        userId: SINGLE_USER_ID,
        format: args.format,
        fileUrl: args.fileUrl ?? null,
        status: 'CONFIRMED',
        columnMapping: args.columnMapping ?? undefined,
        rawHeaders: args.rawHeaders ?? undefined,
      },
    });

    if (args.holdings.length > 0) {
      await tx.holding.createMany({
        data: args.holdings.map(h => ({
          userId: SINGLE_USER_ID,
          importBatchId: batch.id,
          fundName: h.fundName,
          fundCode: h.fundCode,
          amount: h.amount,
          profit: h.profit,
          profitRate: h.profitRate ?? 0,
          sector: h.sector,
        })),
      });
    }

    return batch;
  });
}
