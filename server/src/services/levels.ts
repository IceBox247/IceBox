import type { Miner, User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import { readIceHolding, refreshIceHolding, isEvmAddress } from './chain';
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
  const level = L().levelForHolding(holding.usd);

  return prisma.$transaction(async (tx) => {
    const miner = await tx.miner.findUniqueOrThrow({ where: { userId } });
    const refs = await miningReferralCount(tx as unknown as Db, userId);
    // Settle pending at the current rate before the level (and thus rate) changes.
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = minerRatePerHour(miner, refs) * hours;
    const updated = await tx.miner.update({
      where: { userId },
      data: {
        pending: money(miner.pending + accrued),
        level,
        holdingUsd: holding.usd,
        holdingTokens: holding.tokens,
        holdingCheckedAt: now,
        lastAccruedAt: now,
      },
    });
    return { miner: updated, holdingUsd: holding.usd, holdingTokens: holding.tokens, level };
  });
}

/** What it takes to reach a target level from the user's current holding. */
export function buyLevelInfo(targetLevel: number, holdingUsd: number, price: number) {
  const c = L();
  const px = price > 0 ? price : c.price;
  const level = Math.max(1, Math.min(c.count, Math.floor(targetLevel)));
  const requiredUsd = c.requiredUsdFor(level);
  const requiredTokens = Math.ceil((requiredUsd / px) * 1e4) / 1e4;
  const missingUsd = Math.max(0, Math.round((requiredUsd - holdingUsd) * 1e4) / 1e4);
  const missingTokens = Math.ceil((missingUsd / px) * 1e4) / 1e4;
  return { level, requiredUsd, requiredTokens, missingUsd, missingTokens };
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
  const next = level < c.count ? buyLevelInfo(level + 1, miner.holdingUsd, px) : null;
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
    // Holding Wallet (on-chain) vs Pool Wallet (earned on-platform, withdrawable).
    holding: { tokens: money(miner.holdingTokens), usd: money(miner.holdingUsd) },
    pool: pending,
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
