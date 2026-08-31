import type { User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  classifyFamily,
  createDepositAddress,
  fetchDepositTokens,
  listDeposits,
  normalizeDeposit,
  resolveDecimals,
  type NormalizedDeposit,
  type CatalogChain,
} from './dextopus';
import { alertDeposit } from './notify';

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
  // EVM addresses are hex (case-insensitive) so we normalize them lowercase. But
  // Solana/Tron/Bitcoin addresses are case-SENSITIVE base58 — lowercasing corrupts
  // them into invalid addresses. Only lowercase EVM.
  const addr = classifyFamily(chainId) === 'evm' ? depositAddress.toLowerCase() : depositAddress;

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
  // Dextopus validates the refundTo against the SETTLEMENT chain family (where
  // funds land), not the origin. Since every origin settles to our single
  // treasury on the settlement chain, any origin can mint an address as long as
  // the settlement family has a refund address — which for the default EVM
  // treasury is always the case. Dashboard defaults cover this too; only in
  // env-only mode do we gate on the settlement family's REFUND_* being set.
  const settlementFamily = classifyFamily(config.dextopus.settlementChainId);
  const settlementRefundReady =
    config.dextopus.dashboardRefunds ||
    (settlementFamily === 'solana'
      ? !!config.dextopus.refundSol
      : settlementFamily === 'tron'
        ? !!config.dextopus.refundTron
        : settlementFamily === 'bitcoin'
          ? !!config.dextopus.refundBtc
          : !!config.dextopus.refundEvm);
  const chains = settlementRefundReady
    ? all.filter((c) => c.supportsStaticAddress && c.tokens.length > 0)
    : [];

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

/**
 * ICE USD to credit for a settled deposit (1 USDT = rate ICE USD).
 *
 * Dextopus reports amounts in the token's SMALLEST unit (base units), so a $5
 * settlement of 18-decimal BSC USDT arrives as 5000000000000000000. We divide
 * by the settlement token's decimals to get the human USD figure before
 * applying the peg rate. A raw value already below 1 base unit is treated as
 * already-human and passed through unchanged.
 */
async function creditAmountFor(n: NormalizedDeposit): Promise<number> {
  const useSettlement = n.settlementAmount != null;
  const raw = Number(useSettlement ? n.settlementAmount : n.originAmount) || 0;
  if (raw <= 0) return 0;
  const decimals = useSettlement
    ? await resolveDecimals(config.dextopus.settlementChainId, config.dextopus.settlementAsset)
    : await resolveDecimals(
        n.originChainId ?? config.dextopus.originChainId,
        n.originAsset ?? config.dextopus.originAsset,
      );
  // Guard against a value that is already human (e.g. "5"): only scale down a
  // genuine base-unit integer, which for any real deposit is a large number.
  const scaled = raw >= 10 ** (decimals - 6) ? raw / 10 ** decimals : raw;
  return money(scaled * config.dextopus.rate);
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

  const amount = await creditAmountFor(n);
  const completed = n.status === 'completed';

  const didCredit = await prisma.$transaction(async (tx) => {
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

    if (!completed || dep.credited || amount <= 0) return false;

    // Atomic credit guard: only the first caller to flip `credited` pays out.
    const claim = await tx.deposit.updateMany({
      where: { id: dep.id, credited: false },
      data: { credited: true, creditedAmount: amount },
    });
    if (claim.count !== 1) return false;

    // A deposit is the user's own money moving in — it grows the withdrawable
    // (deposited/USDT) balance but is NOT lifetime "earnings", so totalEarned
    // and earnedBalance are left alone.
    const depositor = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
    });
    await tx.ledgerEntry.create({
      data: {
        userId,
        amount,
        reason: 'deposit',
        meta: JSON.stringify({ dextopusId: externalId, originTxHash: n.originTxHash }),
      },
    });

    // Two-level deposit referral commission. Paid into the referrers' deposited
    // (USDT-withdrawable) bucket, so it can be withdrawn instantly as USDT.
    // Runs only inside this once-per-deposit guarded block, so never double-paid.
    const l1Id = depositor.referredById;
    if (l1Id) {
      const r1 = money((amount * config.depositReferral.level1Pct) / 100);
      if (r1 > 0) {
        const l1 = await tx.user.update({
          where: { id: l1Id },
          data: { balance: { increment: r1 }, totalEarned: { increment: r1 } },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: l1Id,
            amount: r1,
            reason: 'referral_deposit',
            meta: JSON.stringify({ level: 1, fromUserId: userId, dextopusId: externalId }),
          },
        });
        const l2Id = l1.referredById;
        if (l2Id) {
          const r2 = money((amount * config.depositReferral.level2Pct) / 100);
          if (r2 > 0) {
            await tx.user.update({
              where: { id: l2Id },
              data: { balance: { increment: r2 }, totalEarned: { increment: r2 } },
            });
            await tx.ledgerEntry.create({
              data: {
                userId: l2Id,
                amount: r2,
                reason: 'referral_deposit',
                meta: JSON.stringify({ level: 2, fromUserId: userId, dextopusId: externalId }),
              },
            });
          }
        }
      }
    }
    return true;
  });

  // Alert the Deposit Channel once, after the credit commits (best-effort).
  if (didCredit) {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    await alertDeposit({
      amount,
      asset: n.originAsset,
      chain: n.originChainId ? String(n.originChainId) : null,
      // Show the @username only — never a user's real/full name — for privacy.
      name: u?.username ? `@${u.username}` : null,
      txHash: n.originTxHash,
    });
  }
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
 * Reconcile a single user's deposits by id or @username — the operator backstop
 * for when the Dextopus webhook misses a deposit. Credits + alerts any newly
 * completed ones. Returns what happened for the caller to log.
 */
export async function reconcileDepositsFor(
  key: { userId?: number; username?: string },
): Promise<{ ok: boolean; note: string; userId?: number }> {
  const user = key.userId
    ? await prisma.user.findUnique({ where: { id: key.userId } })
    : key.username
      ? await prisma.user.findFirst({
          where: { username: { equals: key.username.replace(/^@/, ''), mode: 'insensitive' } },
        })
      : null;
  if (!user) return { ok: false, note: 'user_not_found' };
  await reconcileUserDeposits(user);
  return { ok: true, note: 'reconciled', userId: user.id };
}

/**
 * Bounded batch backstop: reconcile the most recently active users who have a
 * Dextopus deposit address, so a webhook outage self-heals without waiting for
 * each user to open the app. Capped to stay well under the serverless timeout
 * (one Dextopus call per user). The webhook remains the primary, instant path.
 */
export async function reconcileRecentDeposits(limit = 25): Promise<{ scanned: number }> {
  const addrs = await prisma.depositAddress.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(100, limit)),
    include: { user: true },
  });
  // Dedupe users (a user can have several deposit addresses).
  const seen = new Set<number>();
  let scanned = 0;
  for (const a of addrs) {
    if (seen.has(a.userId)) continue;
    seen.add(a.userId);
    await reconcileUserDeposits(a.user).catch(() => {});
    scanned++;
  }
  return { scanned };
}

/**
 * Handle a raw Dextopus deposit webhook event: map the deposit address back to
 * a user and credit. Returns a short status for logging.
 */
export async function handleDepositWebhook(event: any): Promise<{ ok: boolean; note: string }> {
  const data = event?.data || event?.deposit || event;
  const n = normalizeDeposit(data);
  if (!n.depositAddress) return { ok: true, note: 'no_deposit_address' };

  // Match case-sensitively first (Solana/Tron/Bitcoin base58 is case-sensitive),
  // then fall back to the lowercased form for EVM addresses stored normalized.
  const rawAddr = String(n.depositAddress);
  const mapping =
    (await prisma.depositAddress.findUnique({ where: { address: rawAddr } })) ??
    (await prisma.depositAddress.findUnique({ where: { address: rawAddr.toLowerCase() } }));
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
  // `creditedAmount` is already the human value; the raw origin/settlement
  // amounts from Dextopus are in base units, so scale those down for display
  // (a big integer is base units; a small one is already human).
  const scaleRaw = (n: number) => (n >= 1_000_000 ? n / 1e18 : n);
  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    credited: d.credited,
    amount: d.credited
      ? money(d.creditedAmount)
      : money(scaleRaw(d.settlementAmount || d.originAmount || 0)),
    originAsset: d.originAsset,
    originTxHash: d.originTxHash,
    createdAt: d.createdAt,
  }));
}

/**
 * One-time correction for deposits over-credited by the base-unit decimals bug:
 * Solana/Tron stablecoins are 6-dp, but the crediter defaulted to 18-dp on a
 * catalog miss, skipping the divide — so a $0.1 USDC deposit credited 100,000.
 * For each affected deposit we rescale creditedAmount by 1e6 and claw the
 * over-credit back from the depositor's balance, plus the over-paid two-level
 * referral commissions (attributed via the shared dextopusId). Idempotent via a
 * per-deposit 'deposit_scale_fix' ledger marker. Pass apply=false for a dry run.
 */
export async function correctSolanaTronOverCredits(apply: boolean) {
  const NON_EVM_ORIGINS = [792703809, 728126428]; // Solana, Tron
  const SCALE = 1_000_000; // 1e6: 6-dp base units credited as whole dollars
  // A row is only considered over-credited when the credit dwarfs what was
  // actually sent. Healthy rows sit at ~1x (fees aside); bugged rows at ~1e6x,
  // so anything above 1000x is unambiguous and leaves a huge safety margin.
  const RATIO_MIN = 1000;

  const deposits = await prisma.deposit.findMany({
    where: { credited: true, originChainId: { in: NON_EVM_ORIGINS } },
  });
  // Idempotency: skip deposits already corrected.
  const markers = await prisma.ledgerEntry.findMany({
    where: { reason: 'deposit_scale_fix' },
    select: { meta: true },
  });
  const fixed = new Set<number>();
  for (const m of markers) {
    try {
      const id = Number((JSON.parse(m.meta || '{}') as { depositId?: number }).depositId);
      if (Number.isInteger(id)) fixed.add(id);
    } catch {
      /* ignore */
    }
  }
  // Index referral_deposit entries by the deposit's dextopusId for attribution.
  const refEntries = await prisma.ledgerEntry.findMany({ where: { reason: 'referral_deposit' } });
  const refByDex = new Map<string, { id: number; userId: number; amount: number }[]>();
  for (const e of refEntries) {
    try {
      const dx = (JSON.parse(e.meta || '{}') as { dextopusId?: string }).dextopusId;
      if (dx) {
        const arr = refByDex.get(String(dx)) ?? [];
        arr.push({ id: e.id, userId: e.userId, amount: e.amount });
        refByDex.set(String(dx), arr);
      }
    } catch {
      /* ignore */
    }
  }

  let count = 0;
  let depDelta = 0;
  let refDelta = 0;
  let skipped = 0;
  let unknown = 0;
  for (const d of deposits) {
    if (fixed.has(d.id)) continue;

    // Only touch rows actually hit by the 1e6 bug. A correctly credited deposit
    // has creditedAmount ~= what the user sent; an over-credited one is ~1e6x
    // larger. Without this test the rescale below would also divide healthy
    // deposits — a real $0.10 credit would round to $0.00 — so the function
    // could not safely run on every deploy.
    const sent = d.originAmount ?? d.settlementAmount ?? 0;
    if (!(sent > 0)) {
      // No reference amount to compare against; leave it for manual review
      // rather than guess.
      unknown++;
      continue;
    }
    if (d.creditedAmount / sent < RATIO_MIN) {
      skipped++;
      continue;
    }

    const corrected = money(d.creditedAmount / SCALE);
    const delta = money(d.creditedAmount - corrected);
    if (delta <= 0) continue;
    const refs = d.dextopusId ? refByDex.get(String(d.dextopusId)) ?? [] : [];
    count++;
    depDelta = money(depDelta + delta);
    for (const r of refs) refDelta = money(refDelta + (r.amount - money(r.amount / SCALE)));

    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.deposit.update({ where: { id: d.id }, data: { creditedAmount: corrected } });
        await tx.user.update({ where: { id: d.userId }, data: { balance: { decrement: delta } } });
        for (const r of refs) {
          const rc = money(r.amount / SCALE);
          const rd = money(r.amount - rc);
          if (rd > 0) {
            await tx.user.update({
              where: { id: r.userId },
              data: { balance: { decrement: rd }, totalEarned: { decrement: rd } },
            });
            await tx.ledgerEntry.update({ where: { id: r.id }, data: { amount: rc } });
          }
        }
        await tx.ledgerEntry.create({
          data: {
            userId: d.userId,
            amount: -delta,
            reason: 'deposit_scale_fix',
            meta: JSON.stringify({ depositId: d.id, from: d.creditedAmount, to: corrected }),
          },
        });
      });
    }
  }
  console.log(
    `[overcredit] ${apply ? 'APPLIED' : 'DRY-RUN'}: ${count} deposit(s); ` +
      `depositor claw-back $${depDelta.toFixed(2)}, referral claw-back $${refDelta.toFixed(2)}; ` +
      `${skipped} healthy deposit(s) left alone, ${unknown} without a reference amount.`,
  );
  return {
    count,
    depDelta: money(depDelta),
    refDelta: money(refDelta),
    skipped,
    unknown,
    applied: apply,
  };
}
