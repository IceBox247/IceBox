import { Router } from 'express';
import { prisma, money } from '../db';
import { checkMembership } from '../telegram/verify';
import { getEarnIceMultiplier } from '../services/chain';

export const tasksRouter = Router();

/**
 * GET /api/tasks
 * Returns all active tasks annotated with the user's completion state.
 */
tasksRouter.get('/', async (req, res) => {
  const user = req.user!;

  const [tasks, completions, mult] = await Promise.all([
    prisma.task.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.taskCompletion.findMany({ where: { userId: user.id } }),
    getEarnIceMultiplier(),
  ]);

  const byTask = new Map(completions.map((c) => [c.taskId, c]));
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  res.json({
    tasks: tasks.map((t) => {
      const c = byTask.get(t.id);
      // Daily tasks (ads) reset each UTC day: yesterday's completions don't count.
      const stale = t.daily && c ? c.completedAt < startOfDay : false;
      const count = stale ? 0 : c?.count ?? 0;
      const completed = count >= t.maxCount;
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        subtitle: t.subtitle,
        // Show the actual ICE the user will receive (price-scaled multiplier).
        reward: money(t.reward * mult),
        actionType: t.actionType,
        actionLabel: t.actionLabel,
        url: t.url,
        provider: t.provider,
        icon: t.icon,
        waitSeconds: t.waitSeconds,
        maxCount: t.maxCount,
        daily: t.daily,
        count,
        completed,
      };
    }),
  });
});

/**
 * POST /api/tasks/:id/claim
 * Credits the task reward. For repeatable tasks (maxCount > 1) each call adds one
 * completion until the cap is reached. Server is the source of truth; the client's
 * "wait N seconds" / "watch ad" gates are UX, re-checked here for the cap only.
 */
tasksRouter.post('/:id/claim', async (req, res) => {
  const user = req.user!;
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId)) return res.status(400).json({ error: 'bad_task_id' });

  const task = await prisma.task.findFirst({ where: { id: taskId, active: true } });
  if (!task) return res.status(404).json({ error: 'task_not_found' });

  // For channel-join tasks, confirm the user actually joined via the bot.
  // Only a CONFIRMED non-member is blocked. When the bot can't check at all
  // (it's not an admin of a partner channel, chat not found, transient error)
  // we let the claim through — a task nobody can ever verify would otherwise be
  // impossible to complete. Set TASK_STRICT_VERIFY=true to hard-block instead.
  if (task.chatId) {
    const membership = await checkMembership(task.chatId, user.telegramId);
    if (membership === 'not_member') {
      return res.status(403).json({
        error: 'not_joined',
        message: 'Join the channel first, then tap Claim.',
      });
    }
    if (membership === 'error' && process.env.TASK_STRICT_VERIFY === 'true') {
      return res.status(503).json({
        error: 'verify_unavailable',
        message: 'Could not verify membership yet. Please try again shortly.',
      });
    }
  }

  // Price-scaled ICE multiplier, fetched before the transaction (network I/O).
  const mult = await getEarnIceMultiplier();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.taskCompletion.findUnique({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
      });

      // Daily tasks (ads) reset each UTC day, so a completion from a prior day
      // starts today's count fresh at 0 instead of blocking on the lifetime cap.
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const isReset = task.daily && !!existing && existing.completedAt < startOfDay;
      const currentCount = isReset ? 0 : existing?.count ?? 0;
      if (currentCount >= task.maxCount) {
        return { alreadyDone: true as const };
      }

      // Free money is credited as ICE tokens at the price-scaled multiplier (not $ value).
      const reward = money(task.reward * mult);

      const completion = existing
        ? await tx.taskCompletion.update({
            where: { id: existing.id },
            data: {
              count: isReset ? 1 : { increment: 1 },
              rewarded: isReset ? reward : { increment: reward },
              completedAt: now,
            },
          })
        : await tx.taskCompletion.create({
            data: { userId: user.id, taskId: task.id, count: 1, rewarded: reward },
          });

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { increment: reward },
          earnedBalance: { increment: reward }, // task reward is earned ICE, not deposited
          totalEarned: { increment: reward },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: reward,
          reason: 'task',
          meta: JSON.stringify({ taskId: task.id, key: task.key }),
        },
      });

      return {
        alreadyDone: false as const,
        reward,
        count: completion.count,
        completed: completion.count >= task.maxCount,
        balance: money(updatedUser.balance),
        totalEarned: money(updatedUser.totalEarned),
      };
    });

    if (result.alreadyDone) {
      return res.status(409).json({ error: 'already_completed' });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('claim error', err);
    res.status(500).json({
      error: 'claim_failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
