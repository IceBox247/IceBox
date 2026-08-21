import type { Miner, User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import { readIceHolding, refreshIceHolding, isEvmAddress, getIcePriceUsd } from './chain';
import {
  getOrCreateMiner,
  miningReferralCount,
  minerRatePerHour,
  livePending,
  type Db,
} from './mining';

const L = () => config.miningLevels;

/** Cosmetic hash speed (TH/s) shown for a level — geometric across the curve. */
export function speedForLevel(level: number): number {
  const c = L();
  if (level < 1) return 0;
  const ratio = Math.pow(c.maxSpeed / c.minSpeed, 1 / (c.count - 1));
  return Math.round(c.minSpeed * Math.pow(ratio, Math.min(c.count, level) - 1) * 100) / 100;
}

/**
 * Re-read the connected wallet's on-chain holding and update the miner's level.
 * Settles accrued pending at the OLD rate first so a level change only affects
 * earnings going forward. A wallet only counts once it's signature-verified.
 */
export async function syncMinerLevel(
  userId: number,
  opts: { fresh?: boolean } = {},
): Promise<{ miner: Miner; holdingUsd: number; holdingTokens: number; level: number }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await getOrCreateMiner(userId);

  const verified = !!user.walletVerifiedAt && isEvmAddress(user.walletAddress);
  const holding =
    verified && user.walletAddress
      ? await (opts.fresh ? refreshIceHolding : readIceHolding)(user.walletAddress)
      : { tokens: 0, usd: 0 };
  const price = await getIcePriceUsd();

  return prisma.$transaction(async (tx) => {
    const miner = await tx.miner.findUniqueOrThrow({ where: { userId } });
    const refs = await miningReferralCount(tx as unknown as Db, userId);
    // Settle pending at the current rate before the level (and thus rate) changes.
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = minerRatePerHour(miner, refs) * hours;
    const pending = money(miner.pending + accrued);
    // Level is driven by ASSETS = on-chain holding + pool wallet (earned + pending) —
    // exactly what the buy sheet qualifies on. (Migration compensation already
    // lives in the pool, so no separate holding credit is added here.)
    const poolTokens = money(user.earnedBalance + pending);
    const assetsUsd = money(holding.usd + poolTokens * price);
    const level = L().levelForHolding(assetsUsd);
    const peakLevel = Math.max(miner.peakLevel, level);
    const changed = level !== miner.level;
    const updated = await tx.miner.update({
      where: { userId },
      data: {
        pending,
        level,
        peakLevel,
        holdingUsd: holding.usd, // Holding Wallet = on-chain value only
        holdingTokens: holding.tokens,
        holdingCheckedAt: now,
        lastAccruedAt: now,
      },
    });
    // Record a Level-Journey point when the level moves (or on the first sync).
    if (changed || miner.peakLevel === 0) {
      await tx.minerLevelPoint.create({ data: { userId, level, assetsUsd } });
    }
    return { miner: updated, holdingUsd: holding.usd, holdingTokens: holding.tokens, level };
  });
}

/**
 * One-time migration: compensate users who spent REAL USD on the old bought-
 * hashrate model. Each such user (miner.totalSpent > 0) gets, for the exact USD
 * they spent: (a) an ICE token balance worth that USD at the live price, and
 * (b) a holding credit so their spend still gives them a mining level.
 * Idempotent per user via a 'hashrate_migration' ledger marker.
 */
export async function migrateHashrateSpenders() {
  const price = await getIcePriceUsd();
  const px = price > 0 ? price : L().price;
  const miners = await prisma.miner.findMany({ where: { totalSpent: { gt: 0 } } });
  let migrated = 0;
  let skipped = 0;
  let totalSpentUsd = 0;
  let refundedIce = 0;
  for (const m of miners) {
    const already = await prisma.ledgerEntry.findFirst({
      where: { userId: m.userId, reason: 'hashrate_migration' },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    const spent = money(m.totalSpent);
    const refundIce = money(spent / px);
    const level = L().levelForHolding(spent);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: m.userId },
        data: {
          balance: { increment: refundIce },
          earnedBalance: { increment: refundIce },
          totalEarned: { increment: refundIce },
        },
      });
      await tx.miner.update({
        where: { userId: m.userId },
        data: { bonusHoldingUsd: spent, holdingUsd: spent, level },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: m.userId,
          amount: refundIce,
          reason: 'hashrate_migration',
          meta: JSON.stringify({ spentUsd: spent, refundIce, price: px, level }),
        },
      });
    });
    migrated++;
    totalSpentUsd = money(totalSpentUsd + spent);
    refundedIce = money(refundedIce + refundIce);
  }
  return { migrated, skipped, totalSpentUsd, refundedIce, price: px };
}

/**
 * A user's "Level Journey" for the Miner Store stats card: their current level,
 * the peak they've ever hit, a time series of recorded points (level + assets),
 * and how their assets moved over the last 24h (the trading-style P&L number).
 */
export async function minerJourney(userId: number, price: number) {
  const [user, miner, points] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getOrCreateMiner(userId),
    prisma.minerLevelPoint.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
  ]);
  const px = price > 0 ? price : L().price;
  const refs = await miningReferralCount(prisma, userId);
  const pending = livePending(miner, refs);
  const assetsUsd = money(miner.holdingUsd + (user.earnedBalance + pending) * px);

  // Always end the series on the live "now" point so the chart tracks live.
  const series = points.map((p) => ({
    at: p.createdAt.toISOString(),
    level: p.level,
    assetsUsd: money(p.assetsUsd),
  }));
  series.push({ at: new Date().toISOString(), level: miner.level, assetsUsd });

  // Today's P&L = change in assets vs. the earliest point in the last 24h.
  const dayAgo = Date.now() - 86_400_000;
  const base =
    [...points].reverse().find((p) => p.createdAt.getTime() <= dayAgo)?.assetsUsd ??
    points[0]?.assetsUsd ??
    assetsUsd;
  const todayChangeUsd = money(assetsUsd - base);
  const todayChangePct = base > 0 ? Math.round((todayChangeUsd / base) * 10000) / 100 : 0;

  return {
    current: miner.level,
    peak: Math.max(miner.peakLevel, miner.level),
    assetsUsd,
    price: px,
    todayChangeUsd,
    todayChangePct,
    points: series,
  };
}

/** What it takes to reach a target level, qualified on the user's ASSETS
 * (wallet holding + pool wallet), matching the ATF-style buy sheet. */
export function buyLevelInfo(targetLevel: number, assetsUsd: number, price: number) {
  const c = L();
  const px = price > 0 ? price : c.price;
  const level = Math.max(1, Math.min(c.count, Math.floor(targetLevel)));
  const requiredUsd = c.requiredUsdFor(level);
  const requiredTokens = Math.ceil((requiredUsd / px) * 1e4) / 1e4;
  const yourUsd = Math.round(assetsUsd * 1e4) / 1e4;
  const yourTokens = Math.round((assetsUsd / px) * 1e4) / 1e4;
  const missingUsd = Math.max(0, Math.round((requiredUsd - assetsUsd) * 1e4) / 1e4);
  const missingTokens = Math.ceil((missingUsd / px) * 1e4) / 1e4;
  return { level, requiredUsd, requiredTokens, yourUsd, yourTokens, missingUsd, missingTokens };
}

/** Serialize the holding-based mining state for the client. */
export function serializeLevelMining(
  user: User,
  miner: Miner,
  refs: number,
  price: number,
  now = new Date(),
) {
  const c = L();
  const px = price > 0 ? price : c.price;
  const pending = livePending(miner, refs, now);
  const level = miner.level;
  const dailyBase = c.yieldForLevel(level);
  const referralBonus = money(refs * c.referralYieldPerRef);
  const perDay = money(dailyBase + referralBonus);
  // Assets = on-chain holding + pool wallet (earned + live pending).
  const assetsUsd = money(miner.holdingUsd + (user.earnedBalance + pending) * px);
  const next = level < c.count ? buyLevelInfo(level + 1, assetsUsd, px) : null;
  return {
    enabled: true,
    model: 'levels' as const,
    name: config.mining.name,
    unit: 'Lvl',
    wallet: {
      address: user.walletAddress ?? null,
      verified: !!user.walletVerifiedAt && isEvmAddress(user.walletAddress),
    },
    // Live ICE price in USD (read from the pool), so the client tracks on-chain.
    price: px,
    // Holding Wallet (on-chain) vs Pool Wallet (total ICE held on the platform).
    holding: { tokens: money(miner.holdingTokens), usd: money(miner.holdingUsd) },
    // `pool` = uncollected pending (the "ready to claim" number). `earnedBalance`
    // = the user's full withdrawable platform ICE balance already collected.
    pool: pending,
    earnedBalance: money(user.earnedBalance),
    level,
    speed: speedForLevel(level),
    speedUnit: c.speedUnit,
    perDay,
    perHour: money(perDay / 24),
    dailyBase,
    totalMined: money(miner.totalMined),
    // Curve params so the client can render all `count` level cards itself.
    curve: {
      count: c.count,
      minUsd: c.minUsd,
      maxUsd: c.maxUsd,
      minYield: c.minYield,
      maxYield: c.maxYield,
      minSpeed: c.minSpeed,
      maxSpeed: c.maxSpeed,
      price: px,
    },
    referral: { miners: refs, perRef: c.referralYieldPerRef, bonus: referralBonus },
    nextLevel: next,
    swapUrlBase: c.swapUrlBase,
    rewards: {
      enabled: config.mining.rewardsEnabled,
      usdtPool: config.mining.usdtPool,
      usdtTop: config.mining.usdtTop,
      usdtPrizes: config.mining.usdtPrizes,
      icePool: config.mining.icePool,
      iceTop: config.mining.iceTop,
    },
  };
}
