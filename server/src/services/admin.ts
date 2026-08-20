import { prisma, money } from '../db';
import { config } from '../config';

/** Is this Telegram id an operator/admin? (ADMIN_TELEGRAM_IDS env, comma list) */
export function isAdminTelegramId(telegramId: string | number | null | undefined): boolean {
  if (telegramId == null) return false;
  return config.adminIds.includes(String(telegramId));
}

/** Platform-wide statistics for the operator dashboard. */
export async function adminStats() {
  const [
    totalUsers,
    usersToday,
    deposits,
    withdrawalsPaid,
    withdrawalsPending,
    activeStakes,
    miningSpent,
    minedAgg,
    activeMiners,
    balances,
    refCommission,
    tasksDone,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.deposit.aggregate({
      where: { credited: true },
      _sum: { creditedAmount: true },
      _count: true,
    }),
    prisma.withdrawal.groupBy({
      by: ['token'],
      where: { status: 'paid' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.withdrawal.aggregate({
      where: { status: { in: ['pending', 'processing'] } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.stake.aggregate({
      where: { status: 'active' },
      _sum: { principal: true },
      _count: true,
    }),
    prisma.miner.aggregate({ _sum: { totalSpent: true, hashrate: true } }),
    prisma.miner.aggregate({ _sum: { totalMined: true } }),
    prisma.miner.count({ where: { OR: [{ hashrate: { gt: 0 } }, { totalMined: { gt: 0 } }] } }),
    prisma.user.aggregate({ _sum: { balance: true, earnedBalance: true, totalEarned: true } }),
    prisma.ledgerEntry.aggregate({
      where: { reason: 'referral_deposit' },
      _sum: { amount: true },
    }),
    prisma.taskCompletion.count(),
  ]);

  const paidByToken: Record<string, { amount: number; count: number }> = {};
  for (const g of withdrawalsPaid) {
    paidByToken[g.token] = { amount: money(g._sum.amount ?? 0), count: g._count };
  }

  const totalBalance = money(balances._sum.balance ?? 0);
  const totalEarned = money(balances._sum.earnedBalance ?? 0);

  return {
    users: { total: totalUsers, newToday: usersToday },
    deposits: {
      totalUsd: money(deposits._sum.creditedAmount ?? 0),
      count: deposits._count,
    },
    withdrawals: {
      paidUsdt: paidByToken['usdt']?.amount ?? 0,
      paidUsdtCount: paidByToken['usdt']?.count ?? 0,
      paidIce: paidByToken['ice']?.amount ?? 0,
      paidIceCount: paidByToken['ice']?.count ?? 0,
      pendingCount: withdrawalsPending._count,
      pendingUsd: money(withdrawalsPending._sum.amount ?? 0),
    },
    staking: {
      activeStaked: money(activeStakes._sum.principal ?? 0),
      activeCount: activeStakes._count,
    },
    mining: {
      spentUsd: money(miningSpent._sum.totalSpent ?? 0),
      minedIce: money(minedAgg._sum.totalMined ?? 0),
      totalHashrate: money(miningSpent._sum.hashrate ?? 0),
      activeMiners,
    },
    balances: {
      totalBalance,
      earnedBalance: totalEarned,
      depositedBucket: money(Math.max(0, totalBalance - totalEarned)),
      lifetimeEarned: money(balances._sum.totalEarned ?? 0),
    },
    referrals: {
      depositCommissionPaid: money(refCommission._sum.amount ?? 0),
    },
    tasks: { completions: tasksDone },
    generatedAt: new Date().toISOString(),
  };
}
