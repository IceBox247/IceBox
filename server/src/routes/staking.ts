import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';
import {
  findTier,
  tierForAmount,
  pendingReward,
  serializeStake,
  serializeTier,
  MS_PER_DAY,
} from '../services/staking';

export const stakingRouter = Router();

/**
 * GET /api/staking
 * The configured sections, the user's stakes (with live pending rewards) and a
 * roll-up summary used by the Stake screen.
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
    tiers: config.staking.tiers.map(serializeTier),
    stakes: serialized,
    summary,
  });
});

/**
 * POST /api/staking/stake
 * Body: { tier, amount }
 * Moves `amount` from the withdrawable balance into a new locked position. The
 * amount must fall inside the chosen section's range, and the section's specs
 * are snapshot onto the row so later env changes never re-price it.
 */
stakingRouter.post('/stake', async (req, res) => {
  const user = req.user!;

  if (!config.staking.enabled) {
    return res.status(403).json({ error: 'staking_disabled', message: 'Staking is currently off.' });
  }

  const tierKey = String(req.body?.tier ?? '').trim();
  const amount = money(Number(req.body?.amount));
  const tier = findTier(tierKey);

  if (!tier) return res.status(400).json({ error: 'invalid_tier', message: 'Unknown staking section.' });
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Enter a valid amount.' });
  }
  if (amount < tier.minStake || amount > tier.maxStake) {
    return res.status(400).json({
      error: 'out_of_range',
      message: `${tier.name} accepts ${tier.minStake.toLocaleString()}–${tier.maxStake.toLocaleString()} USD.`,
      minStake: tier.minStake,
      maxStake: tier.maxStake,
    });
  }

  const now = new Date();
  const maturesAt = new Date(now.getTime() + tier.durationDays * MS_PER_DAY);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (fresh.balance < amount) {
        return { insufficient: true as const, balance: money(fresh.balance) };
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: amount } },
      });

      const stake = await tx.stake.create({
        data: {
          userId: user.id,
          tier: tier.key,
          principal: amount,
          apy: tier.apy,
          dailyRate: tier.dailyRate,
          lockDays: tier.durationDays,
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
          meta: JSON.stringify({ stakeId: stake.id, tier: tier.key }),
        },
      });

      return { insufficient: false as const, stake, balance: money(updated.balance) };
    });

    if (result.insufficient) {
      return res.status(400).json({
        error: 'insufficient_balance',
        balance: result.balance,
        message: 'Not enough balance to stake that amount.',
      });
    }

    res.json({ ok: true, balance: result.balance, stake: serializeStake(result.stake, now) });
  } catch (err) {
    console.error('stake error', err);
    res.status(500).json({ error: 'stake_failed' });
  }
});

/**
 * POST /api/staking/:id/claim
 * Sweeps the accrued reward on one active position into the withdrawable
 * balance and resets its accrual anchor. Works before or after maturity.
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

      const reward = pendingReward(stake, now);
      if (reward <= 0) return { nothing: true as const };

      const updatedStake = await tx.stake.update({
        where: { id: stake.id },
        data: { lastClaimAt: now, claimed: { increment: reward } },
      });

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { balance: { increment: reward }, totalEarned: { increment: reward } },
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
        totalEarned: money(updatedUser.totalEarned),
        stake: serializeStake(updatedStake, now),
      };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'stake_not_found' });
    if ('inactive' in result) return res.status(409).json({ error: 'stake_inactive' });
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
 * After maturity, returns the principal to the withdrawable balance and sweeps
 * any last accrued reward with it. Refused while the position is still locked.
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

      const reward = pendingReward(stake, now);
      const principal = money(stake.principal);
      const payout = money(principal + reward);

      const updatedStake = await tx.stake.update({
        where: { id: stake.id },
        data: {
          status: 'unstaked',
          unstakedAt: now,
          lastClaimAt: now,
          claimed: { increment: reward },
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          // Principal returns to balance; it was already counted in totalEarned
          // when first earned, so only the reward adds to lifetime earnings.
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
          meta: JSON.stringify({ stakeId: stake.id, tier: stake.tier }),
        },
      });

      return {
        ok: true as const,
        principal,
        reward,
        payout,
        balance: money(updatedUser.balance),
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
