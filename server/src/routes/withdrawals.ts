import { Router } from 'express';
import { prisma, money } from '../db.js';
import { config } from '../config.js';

export const withdrawalsRouter = Router();

/** GET /api/withdrawals — the user's payout history, newest first. */
withdrawalsRouter.get('/', async (req, res) => {
  const user = req.user!;
  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: money(w.amount),
      address: w.address,
      network: w.network,
      status: w.status,
      createdAt: w.createdAt,
    })),
  });
});

/**
 * POST /api/withdrawals
 * Body: { amount, address, network }
 * Enforces the minimum-withdrawal gate and sufficient balance, then debits the
 * balance and records a pending withdrawal. Actual payout is handled off-app.
 */
withdrawalsRouter.post('/', async (req, res) => {
  const user = req.user!;
  const amount = money(Number(req.body?.amount));
  const address = String(req.body?.address ?? '').trim();
  const network = String(req.body?.network ?? 'TON').trim() || 'TON';

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount' });
  }
  if (amount < config.minWithdrawal) {
    return res.status(400).json({
      error: 'below_minimum',
      minWithdrawal: config.minWithdrawal,
      message: `Minimum withdrawal is ${config.minWithdrawal.toFixed(2)} USDT.`,
    });
  }
  if (!address || address.length < 8) {
    return res.status(400).json({ error: 'invalid_address' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (fresh.balance < amount) {
        return { insufficient: true as const, balance: money(fresh.balance) };
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: amount } },
      });

      const withdrawal = await tx.withdrawal.create({
        data: { userId: user.id, amount, address, network, status: 'pending' },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: -amount,
          reason: 'withdrawal',
          meta: JSON.stringify({ withdrawalId: withdrawal.id, address, network }),
        },
      });

      return {
        insufficient: false as const,
        withdrawal,
        balance: money(updated.balance),
      };
    });

    if (result.insufficient) {
      return res.status(400).json({
        error: 'insufficient_balance',
        balance: result.balance,
        message: 'Not enough balance.',
      });
    }

    res.json({
      ok: true,
      balance: result.balance,
      withdrawal: {
        id: result.withdrawal.id,
        amount: money(result.withdrawal.amount),
        address: result.withdrawal.address,
        network: result.withdrawal.network,
        status: result.withdrawal.status,
        createdAt: result.withdrawal.createdAt,
      },
    });
  } catch (err) {
    console.error('withdrawal error', err);
    res.status(500).json({ error: 'withdrawal_failed' });
  }
});
