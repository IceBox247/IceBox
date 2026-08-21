import type { Miner, User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';

const MS_PER_DAY = 86_400_000;

/** Prisma-like client (the base client or a transaction handle). */
export type Db = { user: { count: (args: any) => Promise<number> } };

/**
 * How many of a user's referrals have started mining (bought hashrate or
 * collected mined ICE). Each one lifts the referrer's daily base rate.
 */
export async function miningReferralCount(db: Db, userId: number): Promise<number> {
  return db.user.count({
    where: {
      referredById: userId,
      miner: { is: { OR: [{ hashrate: { gt: 0 } }, { totalMined: { gt: 0 } }] } },
    },
  });
}

/** Extra hashrate a user gets from referrals who mine (0.1 each by default). */
function referralHash(referralMiners: number): number {
  return referralMiners * config.mining.referralBonusPerDay;
}

/** Total effective hashrate = bought power + referral power. */
export function effectiveHashrate(boughtHashrate: number, referralMiners: number): number {
  return boughtHashrate + referralHash(referralMiners);
}

/** ICE mined per DAY = free base + effective hashrate (bought + referrals). */
function icePerDay(boughtHashrate: number, referralMiners: number): number {
  return (
    config.mining.baseIcePerDay +
    effectiveHashrate(boughtHashrate, referralMiners) * config.mining.icePerHashDay
  );
}

/** ICE mined per HOUR. */
function ratePerHour(boughtHashrate: number, referralMiners: number): number {
  return icePerDay(boughtHashrate, referralMiners) / 24;
}

/**
 * ICE mined per HOUR for a miner, honoring the active engine. In the holding-
 * based level model the daily yield comes from the wallet's level (+ referrals);
 * otherwise it's the bought-hashrate model.
 */
export function minerRatePerHour(miner: Miner, referralMiners: number): number {
  if (config.miningLevels.enabled) {
    const daily =
      config.miningLevels.yieldForLevel(miner.level) +
      referralMiners * config.miningLevels.referralYieldPerRef;
    return daily / 24;
  }
  return ratePerHour(miner.hashrate, referralMiners);
}

/** Deposited (USDT-withdrawable) portion of a balance — the only USD that can buy hashrate. */
function depositedOf(u: { balance: number; earnedBalance: number }): number {
  return money(Math.max(0, u.balance - u.earnedBalance));
}

/** Ensure the user has a miner row. */
export async function getOrCreateMiner(userId: number): Promise<Miner> {
  const existing = await prisma.miner.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.miner.create({ data: { userId } });
}

/** Live-accrued pending ICE for a miner as of `now` (does not persist). */
export function livePending(miner: Miner, referralMiners: number, now = new Date()): number {
  const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
  return money(miner.pending + minerRatePerHour(miner, referralMiners) * hours);
}

/** Which level a hashrate falls into, with progress toward the next. */
export function levelFor(hashrate: number) {
  const levels = config.mining.levels;
  let idx = 0;
  for (let i = 0; i < levels.length; i++) {
    if (hashrate >= levels[i].minHash) idx = i;
  }
  const current = levels[idx];
  const next = levels[idx + 1] ?? null;
  const floor = current.minHash;
  const ceil = next?.minHash ?? floor;
  const progress = next ? Math.min(100, Math.round(((hashrate - floor) / (ceil - floor)) * 100)) : 100;
  return {
    level: idx + 1,
    name: current.name,
    nextName: next?.name ?? null,
    nextAtHash: next?.minHash ?? null,
    progress,
  };
}

/** Serialize a miner + config for the client. */
export function serializeMining(user: User, miner: Miner, referralMiners: number, now = new Date()) {
  const pending = livePending(miner, referralMiners, now);
  const effHash = money(effectiveHashrate(miner.hashrate, referralMiners));
  return {
    enabled: config.mining.enabled,
    model: 'packages' as const,
    name: config.mining.name,
    unit: config.mining.unit,
    // Total effective hashrate (bought + referral), with a breakdown.
    hashrate: effHash,
    boughtHashrate: money(miner.hashrate),
    referralHashrate: money(referralHash(referralMiners)),
    pending,
    perHour: money(ratePerHour(miner.hashrate, referralMiners)),
    perDay: money(icePerDay(miner.hashrate, referralMiners)),
    totalMined: money(miner.totalMined),
    totalSpent: money(miner.totalSpent),
    level: levelFor(effHash),
    levels: config.mining.levels,
    // What the user can spend on hashrate, and the pricing.
    spendable: depositedOf(user),
    icePerHashDay: config.mining.icePerHashDay,
    baseIcePerDay: config.mining.baseIcePerDay,
    maxIcePerDay: config.mining.maxIcePerDay,
    minBuy: config.mining.minBuy,
    maxBuy: config.mining.maxBuy,
    // Client uses these to price a custom amount: ice = minDay*(usd/minBuy)^exp.
    minDay: config.mining.minDay,
    yieldExp: config.mining.yieldExp,
    // Referral mining boost.
    referralMiners,
    referralBonusPerDay: config.mining.referralBonusPerDay,
    referralBonus: money(referralMiners * config.mining.referralBonusPerDay),
    // Daily leaderboard reward pools.
    rewards: {
      enabled: config.mining.rewardsEnabled,
      usdtPool: config.mining.usdtPool,
      usdtTop: config.mining.usdtTop,
      // Fixed USDT prize per rank (rank 1 first) — the client shows each place's payout.
      usdtPrizes: config.mining.usdtPrizes,
      icePool: config.mining.icePool,
      iceTop: config.mining.iceTop,
    },
    // Remaining daily-earning capacity before hitting the per-user cap.
    capacityLeftPerDay: money(
      Math.max(0, config.mining.maxIcePerDay - icePerDay(miner.hashrate, referralMiners)),
    ),
    packages: config.mining.packages,
  };
}

/**
 * Buy hashrate with DEPOSITED USD. Settles pending first (so the new rate only
 * applies going forward), then deducts the cost from the deposited bucket and
 * adds hashrate = usd * hashPerUsd.
 */
export async function buyHashrate(userId: number, usd: number) {
  const amount = money(usd);
  if (!Number.isFinite(amount) || amount < config.mining.minBuy) {
    return { error: 'below_minimum' as const, minBuy: config.mining.minBuy };
  }
  if (amount > config.mining.maxBuy) {
    return { error: 'above_maximum' as const, maxBuy: config.mining.maxBuy };
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const deposited = depositedOf(user);
    if (deposited < amount) {
      return { error: 'insufficient_deposited' as const, available: deposited };
    }

    const miner = (await tx.miner.findUnique({ where: { userId } })) ??
      (await tx.miner.create({ data: { userId } }));
    const refs = await miningReferralCount(tx as unknown as Db, userId);

    const addedHash = money(config.mining.yieldForUsd(amount));
    // Enforce the per-user max mining rate (bought hashrate is capped).
    if (miner.hashrate + addedHash > config.mining.maxHashrate + 1e-9) {
      return {
        error: 'max_rate_reached' as const,
        capacityLeftPerDay: money(
          Math.max(0, config.mining.maxIcePerDay - icePerDay(miner.hashrate, refs)),
        ),
      };
    }

    // Settle accrued pending up to now before changing the rate.
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = ratePerHour(miner.hashrate, refs) * hours;

    const updatedMiner = await tx.miner.update({
      where: { userId },
      data: {
        pending: money(miner.pending + accrued),
        hashrate: money(miner.hashrate + addedHash),
        totalSpent: money(miner.totalSpent + amount),
        lastAccruedAt: now,
      },
    });

    // Spend from the deposited bucket (balance down, earnedBalance untouched).
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: amount } },
    });
    await tx.ledgerEntry.create({
      data: {
        userId,
        amount: -amount,
        reason: 'mining_buy',
        meta: JSON.stringify({ hashrate: addedHash }),
      },
    });

    return { ok: true as const, user: updatedUser, miner: updatedMiner };
  });
}

/**
 * Collect accrued ICE into the EARNED (ICE-token-withdrawable) bucket. Settles
 * pending to now, moves it to the balance, resets the accrual anchor.
 */
export async function collectMined(userId: number) {
  return prisma.$transaction(async (tx) => {
    const miner = (await tx.miner.findUnique({ where: { userId } })) ??
      (await tx.miner.create({ data: { userId } }));

    const refs = await miningReferralCount(tx as unknown as Db, userId);
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = minerRatePerHour(miner, refs) * hours;
    const total = money(miner.pending + accrued);

    if (total <= 0) {
      await tx.miner.update({ where: { userId }, data: { lastAccruedAt: now } });
      return { ok: false as const, reason: 'nothing_to_collect' as const };
    }

    await tx.miner.update({
      where: { userId },
      data: { pending: 0, totalMined: money(miner.totalMined + total), lastAccruedAt: now },
    });
    // Mined ICE is earned USD (ICE-token withdrawable, stakeable in the vault).
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: total },
        earnedBalance: { increment: total },
        totalEarned: { increment: total },
      },
    });
    await tx.ledgerEntry.create({
      data: { userId, amount: total, reason: 'mining' },
    });

    return { ok: true as const, collected: total, user: updatedUser };
  });
}

/**
 * Top miners by effective hashrate (bought power + referral power). Includes
 * lifetime mined for display, and flags the requesting user's own row.
 */
export async function miningLeaderboard(meId: number, take = 100) {
  const [miners, refGroups, rewardIceGroups] = await Promise.all([
    prisma.miner.findMany({
      where: { OR: [{ hashrate: { gt: 0 } }, { totalMined: { gt: 0 } }, { level: { gt: 0 } }] },
      take: 300,
      orderBy: { hashrate: 'desc' },
      include: { user: { select: { id: true, firstName: true, username: true, photoUrl: true } } },
    }),
    // Mining-referral counts per referrer, to fold referral power into the rank.
    prisma.user.groupBy({
      by: ['referredById'],
      where: {
        referredById: { not: null },
        miner: { is: { OR: [{ hashrate: { gt: 0 } }, { totalMined: { gt: 0 } }] } },
      },
      _count: { referredById: true },
    }),
    // Daily ICE-reward payouts per user (leaderboard prizes), to add to what
    // each miner has actually claimed from mining overall.
    prisma.ledgerEntry.groupBy({
      by: ['userId'],
      where: { reason: 'mining_reward', meta: { contains: '"type":"ice"' } },
      _sum: { amount: true },
    }),
  ]);

  const refCount = new Map<number, number>();
  for (const g of refGroups) {
    if (g.referredById != null) refCount.set(g.referredById, g._count.referredById);
  }
  const rewardIce = new Map<number, number>();
  for (const g of rewardIceGroups) rewardIce.set(g.userId, g._sum.amount ?? 0);

  const levelModel = config.miningLevels.enabled;
  const rows = miners
    .map((m) => {
      const refs = refCount.get(m.userId) ?? 0;
      const hashrate = money(effectiveHashrate(m.hashrate, refs));
      const mined = money(m.totalMined);
      const rewards = money(rewardIce.get(m.userId) ?? 0);
      return {
        userId: m.userId,
        name: m.user.firstName || m.user.username || 'Miner',
        photoUrl: m.user.photoUrl,
        hashrate,
        level: m.level,
        holdingUsd: money(m.holdingUsd),
        totalMined: mined,
        rewardIce: rewards,
        // Total ICE USD this miner has claimed: collected mining + daily ICE rewards.
        totalClaimed: money(mined + rewards),
      };
    })
    // Rank by level (holding) in the level model, by effective hashrate otherwise.
    .sort((a, b) =>
      levelModel
        ? b.level - a.level || b.holdingUsd - a.holdingUsd || b.totalMined - a.totalMined
        : b.hashrate - a.hashrate || b.totalMined - a.totalMined,
    )
    .slice(0, take)
    .map((r, i) => ({ rank: i + 1, ...r, isMe: r.userId === meId }));

  return { unit: levelModel ? 'Lvl' : config.mining.unit, leaderboard: rows };
}

/**
 * Distribute the daily mining-leaderboard rewards, once per UTC day:
 *  - Top `usdtTop` miners share the USDT pool (into the withdrawable bucket).
 *  - Top `iceTop` miners share the ICE pool (into the earned bucket).
 * Both are split by rank weight (higher rank → bigger share). Idempotent: a
 * marker ledger row per day prevents a second run.
 */
export async function distributeMiningRewards(): Promise<{
  ran: boolean;
  day: string;
  usdtPaid: number;
  icePaid: number;
  winners: number;
}> {
  const cfg = config.mining;
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const skip = { ran: false, day, usdtPaid: 0, icePaid: 0, winners: 0 };
  if (!cfg.rewardsEnabled) return skip;

  // Idempotency: bail if today's rewards already went out.
  const already = await prisma.ledgerEntry.findFirst({
    where: { reason: 'mining_reward', meta: { contains: `"day":"${day}"` } },
    select: { id: true },
  });
  if (already) return skip;

  const { leaderboard } = await miningLeaderboard(0, cfg.iceTop);
  if (leaderboard.length === 0) return skip;

  // USDT: fixed prize per rank (rank 1 = usdtPrizes[0], …); ranks past the ladder
  // win nothing. ICE: rank-weighted split (rank 1 heaviest). With fewer miners
  // than the ladder length, the lower prizes simply go unpaid.
  const iceDenom = (cfg.iceTop * (cfg.iceTop + 1)) / 2;

  let usdtPaid = 0;
  let icePaid = 0;
  let winners = 0;

  for (const row of leaderboard) {
    const rank = row.rank;
    const usdt = money(cfg.usdtPrizes[rank - 1] ?? 0);
    const ice =
      rank <= cfg.iceTop ? money((cfg.icePool * (cfg.iceTop - rank + 1)) / iceDenom) : 0;
    if (usdt <= 0 && ice <= 0) continue;
    winners++;
    usdtPaid = money(usdtPaid + usdt);
    icePaid = money(icePaid + ice);

    await prisma.$transaction(async (tx) => {
      // USDT reward → deposited bucket (withdrawable). ICE reward → earned bucket.
      await tx.user.update({
        where: { id: row.userId },
        data: {
          balance: { increment: money(usdt + ice) },
          earnedBalance: { increment: ice },
          totalEarned: { increment: ice },
        },
      });
      if (usdt > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: row.userId,
            amount: usdt,
            reason: 'mining_reward',
            meta: JSON.stringify({ day, type: 'usdt', rank }),
          },
        });
      }
      if (ice > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: row.userId,
            amount: ice,
            reason: 'mining_reward',
            meta: JSON.stringify({ day, type: 'ice', rank }),
          },
        });
      }
    });
  }

  return { ran: true, day, usdtPaid, icePaid, winners };
}

export { MS_PER_DAY };
