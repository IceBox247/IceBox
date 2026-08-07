import { Router } from 'express';
import { prisma, money } from '../db.js';

export const tasksRouter = Router();

/**
 * GET /api/tasks
 * Returns all active tasks annotated with the user's completion state.
 */
tasksRouter.get('/', async (req, res) => {
  const user = req.user!;

  const [tasks, completions] = await Promise.all([
    prisma.task.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.taskCompletion.findMany({ where: { userId: user.id } }),
  ]);

  const byTask = new Map(completions.map((c) => [c.taskId, c]));

  res.json({
    tasks: tasks.map((t) => {
      const c = byTask.get(t.id);
      const count = c?.count ?? 0;
      const completed = count >= t.maxCount;
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        subtitle: t.subtitle,
        reward: t.reward,
        actionType: t.actionType,
        actionLabel: t.actionLabel,
        url: t.url,
        icon: t.icon,
        waitSeconds: t.waitSeconds,
        maxCount: t.maxCount,
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.taskCompletion.findUnique({
        where: { userId_taskId: { userId: user.id, taskId: task.id } },
      });

      const currentCount = existing?.count ?? 0;
      if (currentCount >= task.maxCount) {
        return { alreadyDone: true as const };
      }

      const reward = money(task.reward);

      const completion = existing
        ? await tx.taskCompletion.update({
            where: { id: existing.id },
            data: { count: { increment: 1 }, rewarded: { increment: reward } },
          })
        : await tx.taskCompletion.create({
            data: { userId: user.id, taskId: task.id, count: 1, rewarded: reward },
          });

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { balance: { increment: reward }, totalEarned: { increment: reward } },
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
    res.status(500).json({ error: 'claim_failed' });
  }
});
