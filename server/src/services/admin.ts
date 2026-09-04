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

/**
 * Incident tooling: trace every account that has withdrawn to a given payout
 * address, and show where each one's balance actually came from.
 *
 * `lookupUser` only searches names and ids, so when an on-chain payout address
 * is all you have there is no way to reach the account behind it. This closes
 * that gap: pass the address seen in the treasury's transaction history and get
 * back the users, what they withdrew, and the deposits that funded it.
 *
 * Deposits are flagged `suspicious` when the credit dwarfs what was actually
 * sent (>=1000x) — the signature of the 1e6 decimals over-credit, which is the
 * usual way a balance appears without real money behind it.
 */
export async function investigateAddress(address: string) {
  const addr = (address ?? '').trim();
  if (!addr) return { error: 'pass ?address=0x…' };

  const withdrawals = await prisma.withdrawal.findMany({
    where: { address: { equals: addr, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  if (withdrawals.length === 0) {
    return { address: addr, found: false, note: 'No withdrawal in this database used that address.' };
  }

  const userIds = [...new Set(withdrawals.map((w) => w.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });

  const accounts = await Promise.all(
    users.map(async (u) => {
      const mine = withdrawals.filter((w) => w.userId === u.id);
      const paidOut = money(
        mine.filter((w) => w.status === 'paid' || w.status === 'processing')
          .reduce((s, w) => s + w.amount, 0),
      );

      const deposits = await prisma.deposit.findMany({
        where: { userId: u.id, credited: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const depositRows = deposits.map((d) => {
        const sent = d.originAmount ?? d.settlementAmount ?? 0;
        const ratio = sent > 0 ? d.creditedAmount / sent : null;
        return {
          id: d.id,
          chainId: d.originChainId,
          asset: d.originAsset,
          sent,
          credited: money(d.creditedAmount),
          ratio: ratio === null ? null : Math.round(ratio),
          suspicious: ratio !== null && ratio >= 1000,
          txHash: d.originTxHash,
          createdAt: d.createdAt,
        };
      });

      // Where the balance came from, by ledger reason.
      const byReason = await prisma.ledgerEntry.groupBy({
        by: ['reason'],
        where: { userId: u.id },
        _sum: { amount: true },
        _count: true,
      });

      const realMoneyIn = money(
        depositRows.filter((d) => !d.suspicious).reduce((s, d) => s + d.credited, 0),
      );
      const phantomIn = money(
        depositRows.filter((d) => d.suspicious).reduce((s, d) => s + d.credited, 0),
      );

      return {
        userId: u.id,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        telegramId: u.telegramId,
        telegramLink: u.username ? `https://t.me/${u.username}` : null,
        joined: u.createdAt,
        referredById: u.referredById,
        balanceNow: money(u.balance),
        earnedBalance: money(u.earnedBalance),
        withdrawnToThisAddress: paidOut,
        // The headline number: paid out beyond what they ever really funded.
        netLossToUs: money(paidOut - realMoneyIn),
        realDepositsCredited: realMoneyIn,
        overCreditedDeposits: phantomIn,
        withdrawals: mine.map((w) => ({
          id: w.id,
          amount: money(w.amount),
          token: w.token,
          status: w.status,
          txHash: w.txHash,
          createdAt: w.createdAt,
        })),
        deposits: depositRows,
        ledgerByReason: byReason.map((r) => ({
          reason: r.reason,
          total: money(r._sum.amount ?? 0),
          entries: r._count,
        })),
      };
    }),
  );

  return {
    address: addr,
    found: true,
    accounts: accounts.length,
    totalWithdrawnToAddress: money(accounts.reduce((s, a) => s + a.withdrawnToThisAddress, 0)),
    totalNetLoss: money(accounts.reduce((s, a) => s + a.netLossToUs, 0)),
    users: accounts,
  };
}

/**
 * Incident tooling: every account holding balance that was never really funded.
 *
 * Finds deposits credited at >=1000x what the user actually sent (the 1e6
 * decimals over-credit), then reports what each of those accounts has already
 * withdrawn. Answers "how big is this, and is it one person or many?".
 */
export async function exposureReport() {
  const deposits = await prisma.deposit.findMany({ where: { credited: true } });
  const suspicious = deposits.filter((d) => {
    const sent = d.originAmount ?? d.settlementAmount ?? 0;
    return sent > 0 && d.creditedAmount / sent >= 1000;
  });

  const userIds = [...new Set(suspicious.map((d) => d.userId))];
  if (userIds.length === 0) {
    return { affectedAccounts: 0, phantomCredited: 0, withdrawnByThem: 0, users: [] };
  }

  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const rows = await Promise.all(
    users.map(async (u) => {
      const mine = suspicious.filter((d) => d.userId === u.id);
      const phantom = money(mine.reduce((s, d) => s + d.creditedAmount, 0));
      const ws = await prisma.withdrawal.findMany({
        where: { userId: u.id, status: { in: ['paid', 'processing'] } },
      });
      return {
        userId: u.id,
        username: u.username,
        firstName: u.firstName,
        telegramId: u.telegramId,
        telegramLink: u.username ? `https://t.me/${u.username}` : null,
        balanceNow: money(u.balance),
        phantomCredited: phantom,
        withdrawn: money(ws.reduce((s, w) => s + w.amount, 0)),
        payoutAddresses: [...new Set(ws.map((w) => w.address))],
        overCreditedDeposits: mine.length,
      };
    }),
  );
  rows.sort((a, b) => b.withdrawn - a.withdrawn);

  return {
    affectedAccounts: rows.length,
    phantomCredited: money(rows.reduce((s, r) => s + r.phantomCredited, 0)),
    withdrawnByThem: money(rows.reduce((s, r) => s + r.withdrawn, 0)),
    users: rows,
  };
}

/**
 * Everything the 1e6 deposit over-credit touched: the deposits themselves and,
 * crucially, the referrers who were paid a commission out of the inflated
 * amount. A referrer never deposited anything, so their share is pure phantom
 * balance — and it lands in the USDT-withdrawable bucket.
 *
 * Commissions are tied back to a deposit through the `dextopusId` recorded in
 * each `referral_deposit` ledger entry.
 */
export async function affectedReport(limit = 50) {
  const deposits = await prisma.deposit.findMany({
    where: { credited: true },
    orderBy: { createdAt: 'desc' },
  });
  const bad = deposits.filter((d) => {
    const sent = d.originAmount ?? d.settlementAmount ?? 0;
    return sent > 0 && d.creditedAmount / sent >= 1000;
  });
  if (bad.length === 0) {
    return { deposits: 0, overCredited: 0, commissionPaid: 0, rows: [], referrers: [] };
  }

  // Index referral commissions by the deposit that generated them.
  const refEntries = await prisma.ledgerEntry.findMany({ where: { reason: 'referral_deposit' } });
  const byDex = new Map<string, Array<{ userId: number; amount: number; level: number }>>();
  for (const e of refEntries) {
    try {
      const m = JSON.parse(e.meta || '{}') as { dextopusId?: string; level?: number };
      if (!m.dextopusId) continue;
      const arr = byDex.get(String(m.dextopusId)) ?? [];
      arr.push({ userId: e.userId, amount: e.amount, level: Number(m.level ?? 0) });
      byDex.set(String(m.dextopusId), arr);
    } catch {
      /* ignore */
    }
  }

  const userIds = new Set<number>(bad.map((d) => d.userId));
  for (const d of bad) for (const r of byDex.get(String(d.dextopusId)) ?? []) userIds.add(r.userId);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } } });
  const uById = new Map(users.map((u) => [u.id, u]));

  // Per-referrer totals, so the biggest phantom earners surface first.
  const refTotals = new Map<number, { amount: number; fromDeposits: number }>();

  const rows = bad.slice(0, limit).map((d) => {
    const sent = money(d.originAmount ?? d.settlementAmount ?? 0);
    const u = uById.get(d.userId);
    const commissions = (byDex.get(String(d.dextopusId)) ?? []).map((r) => {
      const cur = refTotals.get(r.userId) ?? { amount: 0, fromDeposits: 0 };
      refTotals.set(r.userId, {
        amount: money(cur.amount + r.amount),
        fromDeposits: cur.fromDeposits + 1,
      });
      const ru = uById.get(r.userId);
      return {
        level: r.level,
        amount: money(r.amount),
        userId: r.userId,
        username: ru?.username ?? null,
        firstName: ru?.firstName ?? null,
        telegramId: ru?.telegramId ?? null,
      };
    });
    return {
      depositId: d.id,
      createdAt: d.createdAt,
      chainId: d.originChainId,
      asset: d.originAsset,
      sent,
      credited: money(d.creditedAmount),
      overCredited: money(d.creditedAmount - sent),
      txHash: d.originTxHash,
      depositor: u
        ? {
            userId: u.id,
            username: u.username,
            firstName: u.firstName,
            telegramId: u.telegramId,
            balanceNow: money(u.balance),
            frozen: Boolean(u.frozenAt),
          }
        : null,
      commissions,
    };
  });

  const referrers = [...refTotals.entries()]
    .map(([userId, t]) => {
      const u = uById.get(userId);
      return {
        userId,
        username: u?.username ?? null,
        firstName: u?.firstName ?? null,
        telegramId: u?.telegramId ?? null,
        balanceNow: u ? money(u.balance) : 0,
        frozen: Boolean(u?.frozenAt),
        commissionEarned: t.amount,
        fromDeposits: t.fromDeposits,
      };
    })
    .sort((a, b) => b.commissionEarned - a.commissionEarned);

  return {
    deposits: bad.length,
    overCredited: money(bad.reduce((s, d) => s + (d.creditedAmount - (d.originAmount ?? d.settlementAmount ?? 0)), 0)),
    commissionPaid: money(referrers.reduce((s, r) => s + r.commissionEarned, 0)),
    rows,
    referrers,
  };
}

/** Recent deposits with what actually arrived on chain vs what was credited. */
export async function depositReport(limit = 20) {
  const deposits = await prisma.deposit.findMany({
    where: { credited: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: true },
  });
  return deposits.map((d) => {
    const sent = money(d.originAmount ?? d.settlementAmount ?? 0);
    const credited = money(d.creditedAmount);
    const ratio = sent > 0 ? credited / sent : null;
    return {
      depositId: d.id,
      createdAt: d.createdAt,
      asset: d.originAsset,
      chainId: d.originChainId,
      sent,
      credited,
      ratio: ratio === null ? null : Math.round(ratio),
      suspicious: ratio !== null && ratio >= 1000,
      txHash: d.originTxHash,
      userId: d.userId,
      username: d.user.username,
      firstName: d.user.firstName,
      telegramId: d.user.telegramId,
      balanceNow: money(d.user.balance),
      frozen: Boolean(d.user.frozenAt),
    };
  });
}
