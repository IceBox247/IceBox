import type { User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  createDepositAddress,
  fetchDepositTokens,
  listDeposits,
  normalizeDeposit,
  type NormalizedDeposit,
  type CatalogChain,
} from './dextopus';

/**
 * Return (minting once) the user's stable deposit address for a given origin
 * chain + asset, and cache the address -> user mapping so an incoming webhook
 * credits the right account. Defaults to the configured origin (USDT on BSC).
 */
export async function getOrCreateDepositAddress(
  user: User,
  origin?: { chainId: number; asset: string },
): Promise<{
  address: string;
  originAsset: string;
  originChainId: number;
  minDeposit: number;
  rate: number;
}> {
  const chainId = origin?.chainId ?? config.dextopus.originChainId;
  const asset = origin?.asset ?? config.dextopus.originAsset;
  const meta = { originAsset: asset, originChainId: chainId, minDeposit: config.dextopus.minDeposit, rate: config.dextopus.rate };

  const existing = await prisma.depositAddress.findUnique({
    where: { userId_chainId_asset: { userId: user.id, chainId, asset } },
  });
  if (existing) return { address: existing.address, ...meta };

  const { depositAddress, dextopusId } = await createDepositAddress(String(user.id), { chainId, asset });
  const addr = depositAddress.toLowerCase();

  // upsert guards the astronomically rare race of two mint calls at once.
  const row = await prisma.depositAddress.upsert({
    where: { userId_chainId_asset: { userId: user.id, chainId, asset } },
    create: { userId: user.id, chainId, asset, address: addr, dextopusId: dextopusId ?? undefined },
    update: {},
  });
  return { address: row.address, ...meta };
}

// Majors shown at the forefront of the picker, in this order. Matched by symbol.
const FEATURED_SYMBOLS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'POL', 'MATIC', 'AVAX', 'DAI'];
// Chain popularity, to pick the best instance of a featured symbol first.
const POPULAR_CHAINS = [56, 1, 8453, 42161, 10, 137, 43114, 792703809, 8253038, 728126428];

export interface FeaturedToken {
  chainId: number;
  chainName: string;
  family: string;
  symbol: string;
  name: string;
  asset: string; // what we pass as originAsset (contract address, or symbol)
  decimals: number;
  logoURI: string;
}

/**
 * The deposit catalog for the picker: a curated "featured majors" list up
 * front, plus every static-address-capable chain/token so the user can pick
 * literally any supported crypto.
 */
export async function depositCatalog(): Promise<{
  featured: FeaturedToken[];
  chains: CatalogChain[];
}> {
  const all = await fetchDepositTokens();
  // Only chains that can hand out a permanent deposit address are usable here.
  const chains = all.filter((c) => c.supportsStaticAddress && c.tokens.length > 0);

  const featured: FeaturedToken[] = [];
  const seen = new Set<string>();
  for (const symbol of FEATURED_SYMBOLS) {
    const candidates: FeaturedToken[] = [];
    for (const c of chains) {
      for (const t of c.tokens) {
        if (String(t.symbol || '').toUpperCase() !== symbol) continue;
        candidates.push({
          chainId: c.chainId,
          chainName: c.name,
          family: c.family,
          symbol: t.symbol,
          name: t.name,
          asset: t.address || t.symbol,
          decimals: t.decimals,
          logoURI: t.logoURI,
        });
      }
    }
    candidates.sort((a, b) => {
      const ai = POPULAR_CHAINS.indexOf(a.chainId);
      const bi = POPULAR_CHAINS.indexOf(b.chainId);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    // Take up to 2 instances of each major (e.g. USDT on BSC + Tron).
    for (const cand of candidates.slice(0, 2)) {
      const key = `${cand.chainId}:${cand.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      featured.push(cand);
    }
  }

  return { featured, chains };
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
