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

/**
 * Audit one referrer's invitees to judge whether their referral count is real.
 * Lists every account that signed up under them with activity + fraud signals:
 * how many are active/deposited/have a photo, how many show zero activity, and
 * the biggest signup burst (many accounts created in the same hour points to a
 * bot farm). `query` matches id / telegramId / referralCode / username / name.
 */
export async function auditReferrer(query: string) {
  const q = (query ?? '').trim();
  if (!q) return { found: false as const };
  const idNum = Number(q);
  const referrer = await prisma.user.findFirst({
    where: {
      OR: [
        Number.isInteger(idNum) ? { id: idNum } : {},
        { telegramId: q },
        { referralCode: q },
        { username: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { id: 'asc' },
  });
  if (!referrer) return { found: false as const };

  const refs = await prisma.user.findMany({
    where: { referredById: referrer.id },
    orderBy: { createdAt: 'asc' },
    include: { miner: true },
  });
  const depAgg = refs.length
    ? await prisma.deposit.groupBy({
        by: ['userId'],
        where: { userId: { in: refs.map((r) => r.id) }, credited: true },
        _sum: { creditedAmount: true },
        _count: true,
      })
    : [];
  const depByUser = new Map<number, { sum: number; count: number }>();
  for (const d of depAgg) depByUser.set(d.userId, { sum: money(d._sum.creditedAmount ?? 0), count: d._count });

  let active = 0;
  let withDeposit = 0;
  let withPhoto = 0;
  let zeroActivity = 0;
  const hourBuckets = new Map<string, number>();
  const invited = refs.map((u) => {
    const dep = depByUser.get(u.id);
    const isActive = u.totalEarned > 0;
    const hasDep = !!dep && dep.sum > 0;
    const mined = u.miner ? money(u.miner.totalMined) : 0;
    const anyActivity = isActive || hasDep || mined > 0;
    if (isActive) active++;
    if (hasDep) withDeposit++;
    if (u.photoUrl) withPhoto++;
    if (!anyActivity) zeroActivity++;
    const hourKey = u.createdAt.toISOString().slice(0, 13); // yyyy-mm-ddTHH
    hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + 1);
    return {
      id: u.id,
      name: u.firstName || u.username || `#${u.id}`,
      telegramId: u.telegramId,
      joined: u.createdAt.toISOString(),
      active: isActive,
      deposited: hasDep,
      depositUsd: dep?.sum ?? 0,
      minedIce: mined,
      hasPhoto: !!u.photoUrl,
      totalEarned: money(u.totalEarned),
    };
  });

  let peakHour = '';
  let peakCount = 0;
  for (const [h, c] of hourBuckets) if (c > peakCount) { peakCount = c; peakHour = h; }
  const total = refs.length;

  return {
    found: true as const,
    referrer: {
      id: referrer.id,
      name: referrer.firstName || referrer.username || `#${referrer.id}`,
      telegramId: referrer.telegramId,
      referralCode: referrer.referralCode,
    },
    total,
    active,
    withDeposit,
    withPhoto,
    zeroActivity,
    signup: { peakHour, peakInOneHour: peakCount, distinctHours: hourBuckets.size },
    // Higher = more suspicious. Lots of zero-activity/no-photo accounts created in
    // one burst is the classic fake-referral pattern.
    signals: total
      ? {
          zeroActivityPct: Math.round((zeroActivity / total) * 100),
          noPhotoPct: Math.round(((total - withPhoto) / total) * 100),
          burstConcentrationPct: Math.round((peakCount / total) * 100),
        }
      : null,
    invited,
    generatedAt: new Date().toISOString(),
  };
}
