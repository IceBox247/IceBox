import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';
import { getEarnIceMultiplier } from '../services/chain';

export const checkinRouter = Router();

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** UTC day index — same value all day, +1 the next UTC day. */
const dayIndex = (d: Date | number) => Math.floor((typeof d === 'number' ? d : d.getTime()) / MS_PER_DAY);

/**
 * Reward for a given 1-based streak day.
 *  • USDT rail (staker above the threshold): FLAT `base` every day — real
 *    dollars, no growth, no ICE multiplier.
 *  • ICE rail: `base × mult`, plus `iceGrowthPerDay` of the day-1 amount for
 *    each extra streak day (e.g. +10%/day). Capped at `days` so it never grows
 *    without bound.
 */
function rewardForDay(day: number, asUsdt: boolean, mult: number): number {
  const c = config.checkin;
  if (asUsdt) return money(c.base); // flat USDT
  const d = Math.min(Math.max(day, 1), c.days);
  const grown = c.base * (1 + c.iceGrowthPerDay * (d - 1));
  return money(grown * mult); // ICE: +growth/day, price-scaled multiplier
}

/**
 * Compute the current check-in state, using the rail (USDT vs ICE) and the ICE
 * multiplier so the DISPLAYED ladder matches exactly what gets credited.
 */
function checkinState(
  lastCheckIn: Date | null,
  streak: number,
  now: Date,
  asUsdt: boolean,
  mult: number,
) {
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
    reward: rewardForDay(nextStreak, asUsdt, mult),
    rewards: Array.from({ length: config.checkin.days }, (_, i) => rewardForDay(i + 1, asUsdt, mult)),
    // Start of the next UTC day, when the next claim opens.
    nextClaimAt: new Date((today + 1) * MS_PER_DAY).toISOString(),
  };
}

/** Whether the user's active staked principal qualifies for the flat-USDT rail. */
async function isUsdtRail(db: { stake: { aggregate: Function } }, userId: number) {
  const staked = await db.stake.aggregate({
    where: { userId, status: 'active' },
    _sum: { principal: true },
  });
  return (staked._sum.principal ?? 0) > config.checkin.usdtMinStake;
}

/** GET /api/checkin — current streak, whether claimable today, reward schedule. */
checkinRouter.get('/', async (req, res) => {
  const user = req.user!;
  const [asUsdt, mult] = await Promise.all([isUsdtRail(prisma, user.id), getEarnIceMultiplier()]);
  res.json({ ...checkinState(user.lastCheckIn, user.checkInStreak, new Date(), asUsdt, mult), asUsdt });
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

      // Reward rail: stakers above the threshold get a FLAT USDT amount (real $,
      // deposited bucket); everyone else gets ICE (earned bucket) that grows
      // 10%/day off the day-1 amount, at the price-scaled multiplier.
      const asUsdt = await isUsdtRail(tx, user.id);
      const reward = rewardForDay(streak, asUsdt, mult);

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
        ...checkinState(now, result.streak, now, result.asUsdt, mult),
        asUsdt: result.asUsdt,
      },
    });
  } catch (err) {
    console.error('checkin error', err);
    res.status(500).json({ error: 'checkin_failed' });
  }
});
