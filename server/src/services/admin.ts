import { prisma, money } from '../db';
import { config } from '../config';
import { miningReferralCount } from './mining';

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

  // Daily mining-leaderboard rewards actually paid out (from the ledger).
  const [rwUsdt, rwIce, rwLast] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { reason: 'mining_reward', meta: { contains: '"type":"usdt"' } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.ledgerEntry.aggregate({
      where: { reason: 'mining_reward', meta: { contains: '"type":"ice"' } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.ledgerEntry.findFirst({
      where: { reason: 'mining_reward' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
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
    miningRewards: {
      usdtPaid: money(rwUsdt._sum.amount ?? 0),
      usdtCount: rwUsdt._count,
      icePaid: money(rwIce._sum.amount ?? 0),
      iceCount: rwIce._count,
      lastPaidAt: rwLast?.createdAt ? rwLast.createdAt.toISOString() : null,
    },
    tasks: { completions: tasksDone },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Inspect one or more users by id / telegramId / username / first name — the
 * full financial + mining breakdown, so the operator can see exactly where a
 * user's balance and hashrate came from.
 */
export async function lookupUser(query: string) {
  const q = (query ?? '').trim();
  if (!q) return { count: 0, users: [] };
  const idNum = Number(q);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        Number.isInteger(idNum) ? { id: idNum } : {},
        { telegramId: q },
        { username: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 15,
    include: { miner: true },
  });

  const rows = await Promise.all(
    users.map(async (u) => {
      const [deposits, refCommission, miningReward, referrals, miningRefs] = await Promise.all([
        prisma.deposit.aggregate({
          where: { userId: u.id, credited: true },
          _sum: { creditedAmount: true },
          _count: true,
        }),
        prisma.ledgerEntry.aggregate({
          where: { userId: u.id, reason: 'referral_deposit' },
          _sum: { amount: true },
        }),
        prisma.ledgerEntry.aggregate({
          where: { userId: u.id, reason: 'mining_reward' },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.user.count({ where: { referredById: u.id } }),
        miningReferralCount(prisma, u.id),
      ]);
      const deposited = money(Math.max(0, u.balance - u.earnedBalance));
      return {
        id: u.id,
        name: u.firstName || u.username || `#${u.id}`,
        username: u.username,
        telegramId: u.telegramId,
        balance: money(u.balance),
        earnedBalance: money(u.earnedBalance),
        deposited,
        totalEarned: money(u.totalEarned),
        creditedDeposits: money(deposits._sum.creditedAmount ?? 0),
        depositCount: deposits._count,
        referralCommissionEarned: money(refCommission._sum.amount ?? 0),
        miningRewardReceived: money(miningReward._sum.amount ?? 0),
        miningRewardEntries: miningReward._count,
        referrals,
        miningReferrals: miningRefs,
        miner: u.miner
          ? {
              hashrate: money(u.miner.hashrate),
              spentOnHashrate: money(u.miner.totalSpent),
              totalMined: money(u.miner.totalMined),
            }
          : null,
      };
    }),
  );
  return { count: rows.length, users: rows };
}
