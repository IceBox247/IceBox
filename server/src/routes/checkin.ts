import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';

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

/** Compute the current check-in state for a user. */
function checkinState(lastCheckIn: Date | null, streak: number, now = new Date()) {
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
    reward: rewardForStreak(nextStreak),
    rewards: config.checkin.rewards,
    // Start of the next UTC day, when the next claim opens.
    nextClaimAt: new Date((today + 1) * MS_PER_DAY).toISOString(),
  };
}

/** GET /api/checkin — current streak, whether claimable today, reward schedule. */
checkinRouter.get('/', async (req, res) => {
  const user = req.user!;
  res.json(checkinState(user.lastCheckIn, user.checkInStreak));
});

/** POST /api/checkin/claim — claim today's bonus (once per UTC day). */
checkinRouter.post('/claim', async (req, res) => {
  const user = req.user!;
  if (!config.checkin.enabled) return res.status(403).json({ error: 'checkin_disabled' });

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const today = dayIndex(now);
      const last = fresh.lastCheckIn ? dayIndex(fresh.lastCheckIn) : null;
      if (last === today) return { already: true as const };

      const streak = last === today - 1 ? fresh.checkInStreak + 1 : 1;
      const reward = rewardForStreak(streak);

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          lastCheckIn: now,
          checkInStreak: streak,
          // Check-in is earned (ICE-token bucket), like tasks.
          balance: { increment: reward },
          earnedBalance: { increment: reward },
          totalEarned: { increment: reward },
        },
      });
      if (reward > 0) {
        await tx.ledgerEntry.create({
          data: { userId: user.id, amount: reward, reason: 'checkin', meta: JSON.stringify({ streak }) },
        });
      }
      return {
        already: false as const,
        reward,
        streak,
        balance: money(updated.balance),
        earnedBalance: money(updated.earnedBalance),
      };
    });

    if (result.already) return res.status(409).json({ error: 'already_claimed' });
    res.json({
      ok: true,
      claimedReward: result.reward,
      streak: result.streak,
      balance: result.balance,
      earnedBalance: result.earnedBalance,
      state: checkinState(now, result.streak, now),
    });
  } catch (err) {
    console.error('checkin error', err);
    res.status(500).json({ error: 'checkin_failed' });
  }
});
