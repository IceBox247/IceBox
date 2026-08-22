import { prisma, money } from '../db';

/** A single activity item shown in the in-app notification feed. */
export interface Notification {
  id: number;
  kind: string; // ledger reason, e.g. 'mining' | 'referral' | 'deposit'
  icon: string; // emoji shown in the row
  title: string;
  detail: string;
  amount: number; // signed ICE/USDT amount
  token: 'ice' | 'usdt';
  at: string; // ISO timestamp
}

/** Ledger reasons that represent a real, user-facing money movement. Everything
 * else in the ledger (error markers, internal buys) is hidden from the feed. */
const SHOWN = new Set([
  'signup_bonus',
  'task',
  'referral',
  'referral_deposit',
  'deposit',
  'mining',
  'mining_reward',
  'stake',
  'stake_reward',
  'unstake',
  'checkin',
  'withdrawal',
  'withdrawal_refund',
  'hashrate_migration',
]);

/** Reasons paid/credited in real USDT (deposited rail) rather than ICE tokens. */
const USDT_REASONS = new Set(['deposit', 'referral_deposit']);

function describe(reason: string, amount: number, meta: any): { icon: string; title: string; detail: string } {
  switch (reason) {
    case 'signup_bonus':
      return { icon: '🎁', title: 'Welcome bonus', detail: 'Sign-up reward credited' };
    case 'task':
      return { icon: '✅', title: 'Task reward', detail: 'You completed a task' };
    case 'referral':
      return { icon: '👥', title: 'Referral reward', detail: 'A friend joined with your link' };
    case 'referral_deposit':
      return { icon: '💸', title: 'Referral commission', detail: 'Earned from an invite’s deposit' };
    case 'deposit':
      return { icon: '⬇️', title: 'Deposit credited', detail: 'Funds added to your balance' };
    case 'mining':
      return { icon: '⛏️', title: 'Mining claimed', detail: 'ICE swept from your rig' };
    case 'mining_reward': {
      const rank = meta?.rank ? ` · rank #${meta.rank}` : '';
      return { icon: '🏆', title: 'Leaderboard reward', detail: `Daily mining prize${rank}` };
    }
    case 'stake':
      return { icon: '🔒', title: 'Staked', detail: 'Moved into a stake position' };
    case 'stake_reward':
      return { icon: '📈', title: 'Stake reward', detail: 'Daily staking yield claimed' };
    case 'unstake':
      return { icon: '🔓', title: 'Unstaked', detail: 'Principal + rewards released' };
    case 'checkin':
      return { icon: '🔥', title: 'Daily check-in', detail: 'Streak bonus claimed' };
    case 'withdrawal':
      return { icon: '⬆️', title: 'Withdrawal', detail: 'Payout requested' };
    case 'withdrawal_refund':
      return { icon: '↩️', title: 'Withdrawal refunded', detail: 'Returned to your balance' };
    case 'hashrate_migration':
      return { icon: '❄️', title: 'Hashrate migrated', detail: 'Compensation for earlier spend' };
    default:
      return { icon: '•', title: reason, detail: '' };
  }
}

/**
 * Build the user's notification feed from their ledger, newest first, plus how
 * many are newer than `sinceId` (for the unread dot). The client passes the id
 * of the last notification it has seen (stored locally per device).
 */
export async function userNotifications(
  userId: number,
  sinceId = 0,
  take = 40,
): Promise<{ notifications: Notification[]; unread: number; latestId: number }> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { userId, reason: { in: [...SHOWN] } },
    orderBy: { id: 'desc' },
    take,
  });

  const notifications: Notification[] = rows.map((r) => {
    let meta: any = null;
    try {
      meta = r.meta ? JSON.parse(r.meta) : null;
    } catch {
      /* ignore non-JSON meta */
    }
    const d = describe(r.reason, r.amount, meta);
    return {
      id: r.id,
      kind: r.reason,
      icon: d.icon,
      title: d.title,
      detail: d.detail,
      amount: money(r.amount),
      token: USDT_REASONS.has(r.reason) ? 'usdt' : 'ice',
      at: r.createdAt.toISOString(),
    };
  });

  const latestId = notifications[0]?.id ?? 0;
  const unread = notifications.filter((n) => n.id > sinceId).length;
  return { notifications, unread, latestId };
}
