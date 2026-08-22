import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';
import { getEarnIceMultiplier } from '../services/chain';

export const checkinRouter = Router();

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** UTC day index — same value all day, +1 the next UTC day. */
const dayIndex = (d: Date | number) => Math.floor((typeof d === 'number' ? d : d.getTime()) / MS_PER_DAY);

/** Reward for a given 1-based streak day (clamped to the last configured day). */
function rewardForStreak(streak: number): number {
  const r = config.checkin.rewards;
  if (r.length === 0) return 0;
  return money(r[Math.min(Math.max(streak, 1), r.length) - 1]);
}

/**
 * Compute the current check-in state for a user. `scale` adjusts the DISPLAYED
 * rewards to match what's actually credited: non-stakers get ICE at the
 * price-scaled free-money multiplier (scale = mult), stakers get the raw USDT
 * value (scale = 1). Keeps the ladder honest with the payout.
 */
function checkinState(lastCheckIn: Date | null, streak: number, now = new Date(), scale = 1) {
  const today = dayIndex(now);
  const last = lastCheckIn ? dayIndex(lastCheckIn) : null;
  const claimedToday = last === today;
  // Next streak we'd land on if they claim now.
  const nextStreak = last === today - 1 ? streak + 1 : 1;
  return {
    enabled: config.checkin.enabled,
    canClaim: config.checkin.enabled && !claimedToday,
    claimedToday,
    streak,
    nextStreak,
    reward: money(rewardForStreak(nextStreak) * scale),
    rewards: config.checkin.rewards.map((r) => money(r * scale)),
    // Start of the next UTC day, when the next claim opens.
    nextClaimAt: new Date((today + 1) * MS_PER_DAY).toISOString(),
  };
}

/** GET /api/checkin — current streak, whether claimable today, reward schedule. */
checkinRouter.get('/', async (req, res) => {
  const user = req.user!;
  const [activeStakes, mult] = await Promise.all([
    prisma.stake.count({ where: { userId: user.id, status: 'active' } }),
    getEarnIceMultiplier(),
  ]);
  const asUsdt = activeStakes > 0;
  res.json({ ...checkinState(user.lastCheckIn, user.checkInStreak, new Date(), asUsdt ? 1 : mult), asUsdt });
});

/** POST /api/checkin/claim — claim today's bonus (once per UTC day). */
checkinRouter.post('/claim', async (req, res) => {
  const user = req.user!;
  if (!config.checkin.enabled) return res.status(403).json({ error: 'checkin_disabled' });

  const now = new Date();
  // Price-scaled ICE multiplier, fetched before the transaction (network I/O).
  const mult = await getEarnIceMultiplier();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const today = dayIndex(now);
      const last = fresh.lastCheckIn ? dayIndex(fresh.lastCheckIn) : null;
      if (last === today) return { already: true as const };

      const streak = last === today - 1 ? fresh.checkInStreak + 1 : 1;
      const baseReward = rewardForStreak(streak);

      // Reward rail depends on whether the user has staked funds: stakers get
      // it as USDT-withdrawable (deposited bucket, real $ value); everyone else
      // gets ICE (earned bucket) at the price-scaled free-money multiplier.
      const activeStakes = await tx.stake.count({ where: { userId: user.id, status: 'active' } });
      const asUsdt = activeStakes > 0;
      const reward = asUsdt ? baseReward : money(baseReward * mult);

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          lastCheckIn: now,
          checkInStreak: streak,
          balance: { increment: reward },
          // Only credit the earned bucket when NOT a staker (keeps it ICE-only).
          ...(asUsdt ? {} : { earnedBalance: { increment: reward } }),
          totalEarned: { increment: reward },
        },
      });
      if (reward > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: user.id,
            amount: reward,
            reason: 'checkin',
            meta: JSON.stringify({ streak, rail: asUsdt ? 'usdt' : 'ice' }),
          },
        });
      }
      return {
        already: false as const,
        reward,
        streak,
        asUsdt,
        balance: money(updated.balance),
        earnedBalance: money(updated.earnedBalance),
      };
    });

    if (result.already) return res.status(409).json({ error: 'already_claimed' });
    res.json({
      ok: true,
      claimedReward: result.reward,
      streak: result.streak,
      asUsdt: result.asUsdt,
      balance: result.balance,
      earnedBalance: result.earnedBalance,
      state: {
        ...checkinState(now, result.streak, now, result.asUsdt ? 1 : mult),
        asUsdt: result.asUsdt,
      },
    });
  } catch (err) {
    console.error('checkin error', err);
    res.status(500).json({ error: 'checkin_failed' });
  }
});
