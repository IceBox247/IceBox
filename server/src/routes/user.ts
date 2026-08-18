import { Router } from 'express';
import { prisma, money } from '../db';
import { config } from '../config';
import { publicUser } from '../services/users';

export const userRouter = Router();

/**
 * GET /api/me
 * Returns the authenticated user plus a full overview used by the Home screen:
 * balance, total earned, referral count, tasks done and app-wide config.
 */
userRouter.get('/me', async (req, res) => {
  const user = req.user!;

  const [referralCount, activeReferralCount, tasksDone, staked] = await Promise.all([
    prisma.user.count({ where: { referredById: user.id } }),
    prisma.user.count({ where: { referredById: user.id, totalEarned: { gt: 0 } } }),
    prisma.taskCompletion.count({ where: { userId: user.id } }),
    prisma.stake.aggregate({
      where: { userId: user.id, status: 'active' },
      _sum: { principal: true },
    }),
  ]);

  res.json({
    user: publicUser(user),
    overview: {
      balance: money(user.balance),
      totalEarned: money(user.totalEarned),
      available: money(user.balance),
      totalReferrals: referralCount,
      activeReferrals: activeReferralCount,
      tasksDone,
      totalStaked: money(staked._sum.principal ?? 0),
      usdRate: 1, // USD ≈ 1 USD
    },
    config: {
      referralReward: config.referralReward,
      minWithdrawal: config.minWithdrawal,
      botUsername: config.botUsername,
      stakingEnabled: config.staking.enabled,
    },
    referralLink: `https://t.me/${config.botUsername}?startapp=ref_${user.referralCode}`,
  });
});
