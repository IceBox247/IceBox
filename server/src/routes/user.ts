import { Router } from 'express';
import { prisma, money } from '../db';
import { config, dextopusReady } from '../config';
import { publicUser } from '../services/users';
import { isAdminTelegramId } from '../services/admin';
import { getIcePriceUsd } from '../services/chain';

export const userRouter = Router();

/**
 * GET /api/me
 * Returns the authenticated user plus a full overview used by the Home screen:
 * balance, total earned, referral count, tasks done and app-wide config.
 */
userRouter.get('/me', async (req, res) => {
  const user = req.user!;

  const [referralCount, activeReferralCount, tasksDone, staked, icePrice] = await Promise.all([
    prisma.user.count({ where: { referredById: user.id } }),
    prisma.user.count({ where: { referredById: user.id, totalEarned: { gt: 0 } } }),
    prisma.taskCompletion.count({ where: { userId: user.id } }),
    prisma.stake.aggregate({
      where: { userId: user.id, status: 'active' },
      _sum: { principal: true },
    }),
    getIcePriceUsd(),
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
      earnedBalance: money(user.earnedBalance),
      // Deposited (bought) portion — the only balance the tiers accept.
      stakeable: money(Math.max(0, user.balance - user.earnedBalance)),
      usdRate: 1, // USD ≈ 1 USD
    },
    config: {
      referralReward: config.referralReward,
      minWithdrawal: config.minWithdrawal,
      minWithdrawalUsdt: config.minWithdrawalUsdt,
      botUsername: config.botUsername,
      stakingEnabled: config.staking.enabled,
      depositEnabled: dextopusReady,
      minDeposit: config.dextopus.minDeposit,
      withdrawEnabled: config.dextopus.withdrawEnabled,
      // Live ICE price in USD — the client shows balances in ICE (value / price).
      icePrice,
      // Countdown to the ICE token going tradeable on-chain.
      tokenLaunchAt: config.tokenLaunch.at,
      tokenLaunchLabel: config.tokenLaunch.label,
      tokenTradeUrl: config.tokenLaunch.tradeUrl,
      isAdmin: isAdminTelegramId(user.telegramId),
      token: {
        address: config.token.address,
        name: config.token.name,
        symbol: config.token.symbol,
        decimals: config.token.decimals,
        chainId: config.token.chainId,
        chainName: config.token.chainName,
        explorerBase: config.explorerBase,
      },
    },
    referralLink: `https://t.me/${config.botUsername}?startapp=ref_${user.referralCode}`,
  });
});
