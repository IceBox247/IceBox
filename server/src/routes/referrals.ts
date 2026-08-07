import { Router } from 'express';
import { prisma, money } from '../db.js';
import { config } from '../config.js';

export const referralsRouter = Router();

/**
 * GET /api/referrals
 * Returns the user's referral link, stats, their invited users and a global
 * leaderboard of top referrers (Top 100 win prizes).
 */
referralsRouter.get('/', async (req, res) => {
  const user = req.user!;

  const [myReferrals, referralEarnings, leaderboardRaw] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        firstName: true,
        username: true,
        photoUrl: true,
        totalEarned: true,
        createdAt: true,
      },
    }),
    prisma.ledgerEntry.aggregate({
      where: { userId: user.id, reason: 'referral' },
      _sum: { amount: true },
    }),
    // Leaderboard: group referrals by referrer, count them, take the top 100.
    prisma.user.groupBy({
      by: ['referredById'],
      where: { referredById: { not: null } },
      _count: { referredById: true },
      orderBy: { _count: { referredById: 'desc' } },
      take: 100,
    }),
  ]);

  const activeCount = myReferrals.filter((r) => r.totalEarned > 0).length;

  // Hydrate leaderboard rows with referrer profiles.
  const referrerIds = leaderboardRaw
    .map((g) => g.referredById)
    .filter((v): v is number => v != null);
  const referrers = await prisma.user.findMany({
    where: { id: { in: referrerIds } },
    select: { id: true, firstName: true, username: true, photoUrl: true },
  });
  const byId = new Map(referrers.map((r) => [r.id, r]));

  // Prize table for the podium — decreasing rewards for higher ranks.
  const prizeFor = (rank: number): number => {
    if (rank === 1) return 4000;
    if (rank === 2) return 3000;
    if (rank === 3) return 2000;
    if (rank <= 5) return 1500;
    if (rank <= 10) return 1000;
    if (rank <= 50) return 500;
    return 100;
  };

  const leaderboard = leaderboardRaw.map((g, i) => {
    const profile = g.referredById ? byId.get(g.referredById) : undefined;
    return {
      rank: i + 1,
      name: profile?.firstName || profile?.username || 'Anonymous',
      photoUrl: profile?.photoUrl ?? null,
      referrals: g._count.referredById,
      prize: prizeFor(i + 1),
      isMe: g.referredById === user.id,
    };
  });

  res.json({
    referralLink: `https://t.me/${config.botUsername}/wallet?startapp=ref_${user.referralCode}`,
    referralCode: user.referralCode,
    perInvite: config.referralReward,
    stats: {
      totalReferrals: myReferrals.length,
      activeReferrals: activeCount,
      totalEarned: money(referralEarnings._sum.amount ?? 0),
    },
    referrals: myReferrals.map((r) => ({
      id: r.id,
      name: r.firstName || r.username || 'User',
      photoUrl: r.photoUrl,
      active: r.totalEarned > 0,
      joinedAt: r.createdAt,
    })),
    leaderboard,
  });
});
