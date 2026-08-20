import type { Miner, User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';

const MS_PER_DAY = 86_400_000;

/** ICE mined per hashrate unit per hour. */
function ratePerHashHour(): number {
  return config.mining.icePerHashDay / 24;
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
export function livePending(miner: Miner, now = new Date()): number {
  const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
  return money(miner.pending + miner.hashrate * ratePerHashHour() * hours);
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
export function serializeMining(user: User, miner: Miner, now = new Date()) {
  const pending = livePending(miner, now);
  const perHour = money(miner.hashrate * ratePerHashHour());
  return {
    enabled: config.mining.enabled,
    name: config.mining.name,
    unit: config.mining.unit,
    hashrate: miner.hashrate,
    pending,
    perHour,
    perDay: money(miner.hashrate * config.mining.icePerHashDay),
    totalMined: money(miner.totalMined),
    totalSpent: money(miner.totalSpent),
    level: levelFor(miner.hashrate),
    // What the user can spend on hashrate, and the price.
    spendable: depositedOf(user),
    hashPerUsd: config.mining.hashPerUsd,
    icePerHashDay: config.mining.icePerHashDay,
    minBuy: config.mining.minBuy,
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

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const deposited = depositedOf(user);
    if (deposited < amount) {
      return { error: 'insufficient_deposited' as const, available: deposited };
    }

    const miner = (await tx.miner.findUnique({ where: { userId } })) ??
      (await tx.miner.create({ data: { userId } }));

    // Settle accrued pending up to now before changing the rate.
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = miner.hashrate * ratePerHashHour() * hours;
    const addedHash = money(amount * config.mining.hashPerUsd);

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

    const now = new Date();
    const hours = Math.max(0, (now.getTime() - miner.lastAccruedAt.getTime()) / 3_600_000);
    const accrued = miner.hashrate * ratePerHashHour() * hours;
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

export { MS_PER_DAY };
