import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  findTier,
  earnedTier,
  pendingReward,
  serializeStake,
  serializeTier,
  serializeEarnedTier,
  MS_PER_DAY,
} from '../services/staking';

export const stakingRouter = Router();

/** Deposited (stakeable-in-tiers) portion of a user's balance. */
function depositedOf(user: { balance: number; earnedBalance: number }): number {
  return money(Math.max(0, user.balance - user.earnedBalance));
}

/**
 * GET /api/staking
 * Sections + the earned vault, the user's positions (with live pending
 * rewards), balance buckets, and a roll-up summary.
 */
stakingRouter.get('/', async (req, res) => {
  const user = req.user!;
  const now = new Date();

  const stakes = await prisma.stake.findMany({
    where: { userId: user.id },
    orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
  });

  const serialized = stakes.map((s) => serializeStake(s, now));
  const active = serialized.filter((s) => s.status === 'active');

  const summary = {
    totalStaked: money(active.reduce((sum, s) => sum + s.principal, 0)),
    totalPending: money(active.reduce((sum, s) => sum + s.pending, 0)),
    totalClaimed: money(serialized.reduce((sum, s) => sum + s.claimed, 0)),
    activeCount: active.length,
  };

  res.json({
    enabled: config.staking.enabled,
    balance: money(user.balance),
    earnedBalance: money(user.earnedBalance),
    stakeable: depositedOf(user), // deposited portion — the tiers accept only this
    tiers: config.staking.tiers.map(serializeTier),
    earnedTier: serializeEarnedTier(),
    stakes: serialized,
    summary,
  });
});

/**
 * POST /api/staking/stake
 * Body: { tier, amount }
 * `tier` is a section key (s1..s4) to stake DEPOSITED ICE USD in the tiers, or
 * "earned" to lock TASK/REFERRAL-earned ICE USD in the earned vault.
 */
stakingRouter.post('/stake', async (req, res) => {
  const user = req.user!;

  if (!config.staking.enabled) {
    return res.status(403).json({ error: 'staking_disabled', message: 'Staking is currently off.' });
  }

  const tierKey = String(req.body?.tier ?? '').trim();
  const amount = money(Number(req.body?.amount));
  const isEarned = tierKey === 'earned';

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Enter a valid amount.' });
  }

  // Resolve the spec + range/bucket rules for the chosen stake kind.
  let spec: { apy: number; dailyRate: number; durationDays: number };
  if (isEarned) {
    const e = earnedTier();
    if (!e.enabled) {
      return res.status(403).json({ error: 'earned_disabled', message: 'The earned vault is off.' });
    }
    if (amount < e.minStake) {
      return res.status(400).json({
        error: 'below_minimum',
        message: `The earned vault takes a minimum of ${e.minStake} ICE USD.`,
      });
    }
    spec = { apy: e.apy, dailyRate: e.dailyRate, durationDays: e.durationDays };
  } else {
    const tier = findTier(tierKey);
    if (!tier) return res.status(400).json({ error: 'invalid_tier', message: 'Unknown staking section.' });
    if (amount < tier.minStake || amount > tier.maxStake) {
      return res.status(400).json({
        error: 'out_of_range',
        message: `${tier.name} accepts ${tier.minStake.toLocaleString()}–${tier.maxStake.toLocaleString()} USD.`,
        minStake: tier.minStake,
        maxStake: tier.maxStake,
      });
    }
    spec = { apy: tier.apy, dailyRate: tier.dailyRate, durationDays: tier.durationDays };
  }

  const now = new Date();
  const maturesAt = new Date(now.getTime() + spec.durationDays * MS_PER_DAY);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });

      if (isEarned) {
        // Earned vault draws from the earned bucket only.
        if (fresh.earnedBalance < amount) {
          return { insufficient: 'earned' as const, available: money(fresh.earnedBalance) };
        }
      } else {
        // Tiers draw from the deposited bucket only.
        const deposited = depositedOf(fresh);
        if (deposited < amount) {
          return { insufficient: 'deposited' as const, available: deposited };
        }
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { decrement: amount },
          // Earned stake also draws down the earned bucket; a tier stake leaves
          // earnedBalance untouched (it consumed deposited capital).
          ...(isEarned ? { earnedBalance: { decrement: amount } } : {}),
        },
      });

      const stake = await tx.stake.create({
        data: {
          userId: user.id,
          tier: isEarned ? 'earned' : tierKey,
          kind: isEarned ? 'earned' : 'tier',
          principal: amount,
          apy: spec.apy,
          dailyRate: spec.dailyRate,
          lockDays: spec.durationDays,
          status: 'active',
          startedAt: now,
          lastClaimAt: now,
          maturesAt,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: -amount,
          reason: 'stake',
          meta: JSON.stringify({ stakeId: stake.id, tier: stake.tier, kind: stake.kind }),
        },
      });

      return {
        ok: true as const,
        stake,
        balance: money(updated.balance),
        earnedBalance: money(updated.earnedBalance),
        stakeable: depositedOf(updated),
      };
    });

    if ('insufficient' in result) {
      return res.status(400).json({
        error: 'insufficient_balance',
        bucket: result.insufficient,
        available: result.available,
        message:
          result.insufficient === 'earned'
            ? 'Not enough earned ICE USD to lock that amount.'
            : 'Not enough deposited ICE USD. Only bought/deposited ICE USD can be staked in the tiers.',
      });
    }

    res.json({
      ok: true,
      balance: result.balance,
      earnedBalance: result.earnedBalance,
      stakeable: result.stakeable,
      stake: serializeStake(result.stake, now),
    });
  } catch (err) {
    console.error('stake error', err);
    res.status(500).json({ error: 'stake_failed' });
  }
});

/**
 * POST /api/staking/:id/claim
 * Sweeps accrued rewards on a TIER position into the balance. Earned-vault
 * positions are locked — their rewards only release at maturity via unstake.
 */
stakingRouter.post('/:id/claim', async (req, res) => {
  const user = req.user!;
  const stakeId = Number(req.params.id);
  if (!Number.isInteger(stakeId)) return res.status(400).json({ error: 'bad_stake_id' });

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const stake = await tx.stake.findFirst({ where: { id: stakeId, userId: user.id } });
      if (!stake) return { notFound: true as const };
      if (stake.status !== 'active') return { inactive: true as const };
      if (stake.kind === 'earned') return { locked: true as const };

      const reward = pendingReward(stake, now);
      if (reward <= 0) return { nothing: true as const };

      const updatedStake = await tx.stake.update({
        where: { id: stake.id },
        data: { lastClaimAt: now, claimed: { increment: reward } },
      });

      // Staked funds are USDT-withdrawable: the reward lands in the deposited
      // bucket (balance up, earnedBalance untouched), so it can be withdrawn as
      // real USDT via Dextopus.
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { increment: reward },
          totalEarned: { increment: reward },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: reward,
          reason: 'stake_reward',
          meta: JSON.stringify({ stakeId: stake.id, tier: stake.tier }),
        },
      });

      return {
        ok: true as const,
        reward,
        balance: money(updatedUser.balance),
        earnedBalance: money(updatedUser.earnedBalance),
        totalEarned: money(updatedUser.totalEarned),
        stake: serializeStake(updatedStake, now),
      };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'stake_not_found' });
    if ('inactive' in result) return res.status(409).json({ error: 'stake_inactive' });
    if ('locked' in result) {
      return res.status(400).json({
        error: 'rewards_locked',
        message: 'Earned-vault rewards unlock with your principal at maturity.',
      });
    }
    if ('nothing' in result) {
      return res.status(400).json({ error: 'nothing_to_claim', message: 'No rewards to claim yet.' });
    }
    res.json(result);
  } catch (err) {
    console.error('claim stake error', err);
    res.status(500).json({ error: 'claim_failed' });
  }
});

/**
 * POST /api/staking/:id/unstake
 * After maturity, returns the principal (plus any final/locked reward) to the
 * balance. Tier principal restores the deposited bucket; earned-vault principal
 * and its now-released rewards return to the earned bucket. Refused while locked.
 */
stakingRouter.post('/:id/unstake', async (req, res) => {
  const user = req.user!;
  const stakeId = Number(req.params.id);
  if (!Number.isInteger(stakeId)) return res.status(400).json({ error: 'bad_stake_id' });

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const stake = await tx.stake.findFirst({ where: { id: stakeId, userId: user.id } });
      if (!stake) return { notFound: true as const };
      if (stake.status !== 'active') return { inactive: true as const };
      if (now.getTime() < stake.maturesAt.getTime()) {
        return { locked: true as const, maturesAt: stake.maturesAt };
      }

      const isEarned = stake.kind === 'earned';
      const reward = pendingReward(stake, now);
      const principal = money(stake.principal);
      const payout = money(principal + reward);

      const updatedStake = await tx.stake.update({
        where: { id: stake.id },
        data: { status: 'unstaked', unstakedAt: now, lastClaimAt: now, claimed: { increment: reward } },
      });

      // Everything that passes through staking comes out USDT-withdrawable:
      // principal + released reward land in the deposited bucket (balance up,
      // earnedBalance untouched) whether it was a tier or the earned vault.
      // This is the incentive to stake earned ICE USD — it converts it to real
      // USDT-withdrawable funds.
      void isEarned;
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { increment: payout },
          totalEarned: { increment: reward },
        },
      });

      if (reward > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: user.id,
            amount: reward,
            reason: 'stake_reward',
            meta: JSON.stringify({ stakeId: stake.id, tier: stake.tier, final: true }),
          },
        });
      }
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: principal,
          reason: 'unstake',
          meta: JSON.stringify({ stakeId: stake.id, tier: stake.tier, kind: stake.kind }),
        },
      });

      return {
        ok: true as const,
        principal,
        reward,
        payout,
        balance: money(updatedUser.balance),
        earnedBalance: money(updatedUser.earnedBalance),
        stakeable: depositedOf(updatedUser),
        totalEarned: money(updatedUser.totalEarned),
        stake: serializeStake(updatedStake, now),
      };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'stake_not_found' });
    if ('inactive' in result) return res.status(409).json({ error: 'stake_inactive' });
    if ('locked' in result) {
      return res.status(400).json({
        error: 'still_locked',
        maturesAt: result.maturesAt,
        message: 'This position is still locked. It unlocks at maturity.',
      });
    }
    res.json(result);
  } catch (err) {
    console.error('unstake error', err);
    res.status(500).json({ error: 'unstake_failed' });
  }
});
