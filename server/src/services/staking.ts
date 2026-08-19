import type { Stake } from '@prisma/client';
import { money } from '../db';
import { config, type StakeTier } from '../config';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** All configured sections (from the Vercel env, with code defaults). */
export function stakeTiers(): StakeTier[] {
  return config.staking.tiers;
}

/** Look up a section by its key, e.g. "s2". */
export function findTier(key: string): StakeTier | undefined {
  return config.staking.tiers.find((t) => t.key === key);
}

/** The section whose amount range covers `amount`, if any. */
export function tierForAmount(amount: number): StakeTier | undefined {
  return config.staking.tiers.find((t) => amount >= t.minStake && amount <= t.maxStake);
}

/** The special locked stake for task/referral-earned ICE USD. */
export function earnedTier() {
  return config.staking.earned;
}

/**
 * Reward accrued on a stake since its last claim, as of `now`.
 *
 * The daily rate drives it: principal × dailyRate% × elapsedDays. Accrual only
 * runs inside the lock window, so time past `maturesAt` earns nothing — the
 * position paid its full term and is waiting to be unstaked. Only `active`
 * stakes accrue. Rounded to 2 decimals to match the rest of the money math.
 */
export function pendingReward(stake: Stake, now: Date = new Date()): number {
  if (stake.status !== 'active') return 0;
  // Cap the accrual clock at maturity: rewards stop once the term is served.
  const until = Math.min(now.getTime(), stake.maturesAt.getTime());
  const elapsedDays = Math.max(0, (until - stake.lastClaimAt.getTime()) / MS_PER_DAY);
  const reward = stake.principal * (stake.dailyRate / 100) * elapsedDays;
  return money(reward);
}

/** Public shape of a stake returned to the client, with live pending reward. */
export function serializeStake(stake: Stake, now: Date = new Date()) {
  const matured = now.getTime() >= stake.maturesAt.getTime();
  return {
    id: stake.id,
    tier: stake.tier,
    kind: stake.kind,
    principal: money(stake.principal),
    apy: stake.apy,
    dailyRate: stake.dailyRate,
    lockDays: stake.lockDays,
    status: stake.status,
    claimed: money(stake.claimed),
    pending: pendingReward(stake, now),
    // Earned-vault rewards are locked — they only release with the principal at
    // maturity, so they are never separately claimable.
    claimable: stake.kind !== 'earned',
    startedAt: stake.startedAt,
    maturesAt: stake.maturesAt,
    unstakedAt: stake.unstakedAt,
    matured,
  };
}

/** Public, safe shape of the earned-vault config for the client. */
export function serializeEarnedTier() {
  const e = config.staking.earned;
  return {
    enabled: e.enabled,
    key: e.key,
    name: e.name,
    blurb: e.blurb,
    minStake: e.minStake,
    apy: e.apy,
    dailyRate: e.dailyRate,
    durationDays: e.durationDays,
    accent: e.accent,
  };
}

/** Public, safe shape of a section for the client. */
export function serializeTier(t: StakeTier) {
  return {
    key: t.key,
    name: t.name,
    blurb: t.blurb,
    minStake: t.minStake,
    maxStake: t.maxStake,
    apy: t.apy,
    dailyRate: t.dailyRate,
    durationDays: t.durationDays,
    accent: t.accent,
  };
}
