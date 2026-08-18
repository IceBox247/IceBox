import type { User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  createDepositAddress,
  listDeposits,
  normalizeDeposit,
  type NormalizedDeposit,
} from './dextopus';

/**
 * Return the user's stable Dextopus deposit address, minting it once and
 * caching the mapping (address -> user) so incoming webhooks can be credited to
 * the right account.
 */
export async function getOrCreateDepositAddress(user: User): Promise<{
  address: string;
  originAsset: string;
  originChainId: number;
  minDeposit: number;
  rate: number;
}> {
  const meta = {
    originAsset: config.dextopus.originAsset,
    originChainId: config.dextopus.originChainId,
    minDeposit: config.dextopus.minDeposit,
    rate: config.dextopus.rate,
  };

  const existing = await prisma.depositAddress.findUnique({ where: { userId: user.id } });
  if (existing) return { address: existing.address, ...meta };

  const { depositAddress, dextopusId } = await createDepositAddress(String(user.id));
  const addr = depositAddress.toLowerCase();

  // upsert guards the astronomically rare race of two mint calls at once.
  const row = await prisma.depositAddress.upsert({
    where: { userId: user.id },
    create: { userId: user.id, address: addr, dextopusId: dextopusId ?? undefined },
    update: {},
  });
  return { address: row.address, ...meta };
}

/** ICE USD to credit for a settled deposit (1 USDT = rate ICE USD). */
function creditAmountFor(n: NormalizedDeposit): number {
  const settled = n.settlementAmount ?? n.originAmount ?? 0;
  return money(settled * config.dextopus.rate);
}

/**
 * Idempotently record one deposit and, if it is completed, credit the user's
 * withdrawable balance exactly once. Dedupe key is the Dextopus id (falling
 * back to the origin tx hash); without either we can't safely credit, so we
 * skip. Safe to call from both the webhook and status polling.
 */
export async function recordAndCredit(userId: number, n: NormalizedDeposit): Promise<void> {
  const externalId = n.dextopusId || n.originTxHash;
  if (!externalId) return; // can't dedupe -> don't credit

  const amount = creditAmountFor(n);
  const completed = n.status === 'completed';

  await prisma.$transaction(async (tx) => {
    const dep = await tx.deposit.upsert({
      where: { dextopusId: externalId },
      create: {
        userId,
        dextopusId: externalId,
        depositAddress: n.depositAddress ?? '',
        status: n.status || 'pending',
        originAsset: n.originAsset,
        originChainId: n.originChainId,
        originAmount: n.originAmount,
        originTxHash: n.originTxHash,
        settlementAmount: n.settlementAmount,
        settlementTxHash: n.settlementTxHash,
      },
      update: {
        status: n.status || undefined,
        originAmount: n.originAmount ?? undefined,
        settlementAmount: n.settlementAmount ?? undefined,
        settlementTxHash: n.settlementTxHash ?? undefined,
      },
    });

    if (!completed || dep.credited || amount <= 0) return;

    // Atomic credit guard: only the first caller to flip `credited` pays out.
    const claim = await tx.deposit.updateMany({
      where: { id: dep.id, credited: false },
      data: { credited: true, creditedAmount: amount },
    });
    if (claim.count !== 1) return;

    // A deposit is the user's own money moving in — it grows the withdrawable
    // balance but is NOT lifetime "earnings", so totalEarned is left alone.
    await tx.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
    await tx.ledgerEntry.create({
      data: {
        userId,
        amount,
        reason: 'deposit',
        meta: JSON.stringify({ dextopusId: externalId, originTxHash: n.originTxHash }),
      },
    });
  });
}

/** Poll Dextopus for this user's deposits and credit any newly completed ones. */
export async function reconcileUserDeposits(user: User): Promise<void> {
  let deposits: NormalizedDeposit[] = [];
  try {
    deposits = await listDeposits(String(user.id));
  } catch {
    return; // best-effort; the webhook is the primary path
  }
  for (const d of deposits) {
    await recordAndCredit(user.id, d);
  }
}

/**
 * Handle a raw Dextopus deposit webhook event: map the deposit address back to
 * a user and credit. Returns a short status for logging.
 */
export async function handleDepositWebhook(event: any): Promise<{ ok: boolean; note: string }> {
  const data = event?.data || event?.deposit || event;
  const n = normalizeDeposit(data);
  if (!n.depositAddress) return { ok: true, note: 'no_deposit_address' };

  const mapping = await prisma.depositAddress.findUnique({
    where: { address: String(n.depositAddress).toLowerCase() },
  });
  // Fall back to a userId carried in metadata, if the mapping is missing.
  const metaUserId = Number(data?.metadata?.userId ?? data?.userId);
  const userId = mapping?.userId ?? (Number.isInteger(metaUserId) ? metaUserId : null);
  if (!userId) return { ok: true, note: 'unmapped_address' };

  await recordAndCredit(userId, n);
  return { ok: true, note: `credited_check:${n.status}` };
}

/** Recent deposit history for the UI. */
export async function listUserDeposits(userId: number, take = 20) {
  const rows = await prisma.deposit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    credited: d.credited,
    amount: money(d.creditedAmount || d.settlementAmount || d.originAmount || 0),
    originAsset: d.originAsset,
    originTxHash: d.originTxHash,
    createdAt: d.createdAt,
  }));
}
