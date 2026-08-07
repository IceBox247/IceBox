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

  const [referralCount, activeReferralCount, tasksDone] = await Promise.all([
    prisma.user.count({ where: { referredById: user.id } }),
    prisma.user.count({ where: { referredById: user.id, totalEarned: { gt: 0 } } }),
    prisma.taskCompletion.count({ where: { userId: user.id } }),
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
      usdRate: 1, // USD ≈ 1 USD
    },
    config: {
      referralReward: config.referralReward,
      minWithdrawal: config.minWithdrawal,
      botUsername: config.botUsername,
    },
    referralLink: `https://t.me/${config.botUsername}/wallet?startapp=ref_${user.referralCode}`,
  });
});
