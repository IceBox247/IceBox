import { Router } from 'express';
import { prisma, money } from '../db';
import { config, dextopusWithdrawReady } from '../config';
import { processWithdrawalInstant, pollDextopusWithdrawals } from '../services/dextopusPayout';

export const withdrawalsRouter = Router();

/** A BEP-20 payout address: 0x followed by 40 hex characters. */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** GET /api/withdrawals — the user's payout history, newest first. */
withdrawalsRouter.get('/', async (req, res) => {
  const user = req.user!;

  // Confirm any in-flight Dextopus withdrawals right away, so a user who just
  // withdrew sees it flip from "processing" to "paid" without waiting for cron.
  if (dextopusWithdrawReady) {
    try {
      await pollDextopusWithdrawals();
    } catch {
      /* best-effort */
    }
  }

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
  const network = String(req.body?.network ?? 'BEP20').trim() || 'BEP20';

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount' });
  }
  if (amount < config.minWithdrawal) {
    return res.status(400).json({
      error: 'below_minimum',
      minWithdrawal: config.minWithdrawal,
      message: `Minimum withdrawal is ${config.minWithdrawal.toFixed(2)} USD.`,
    });
  }
  // A BEP-20 payout address must be a well-formed EVM address. A loose length
  // check would accept typos, and tokens sent to a bad address are unrecoverable.
  if (!EVM_ADDRESS.test(address)) {
    return res.status(400).json({
      error: 'invalid_address',
      message: 'Enter a valid BSC (BEP-20) address — 0x followed by 40 characters.',
    });
  }
  if (/^0x0{40}$/i.test(address)) {
    return res.status(400).json({
      error: 'invalid_address',
      message: 'That is the zero address — funds sent there are burned.',
    });
  }
  if (network !== 'BEP20') {
    return res.status(400).json({
      error: 'unsupported_network',
      message: 'Only BSC (BEP-20) withdrawals are supported.',
    });
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
        data: {
          userId: user.id,
          amount,
          address,
          network,
          status: 'pending',
          // Destination for the Dextopus off-ramp (ICE USD -> USDT). Defaults to
          // USDT on BSC; the cron worker funds the Dextopus quote from here.
          destChainId: config.dextopus.withdrawDestChainId,
          destAsset: config.dextopus.withdrawDestAsset,
        },
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

    // Instant payout: process this withdrawal now instead of queuing for cron.
    // If the treasury can't cover it the helper refunds the balance and marks
    // the row rejected; surface that to the user rather than a silent pending.
    let status = result.withdrawal.status;
    let txHash: string | null = null;
    let balance = result.balance;
    if (dextopusWithdrawReady) {
      try {
        const instant = await processWithdrawalInstant(result.withdrawal.id);
        status = instant.status;
        txHash = instant.txHash ?? null;
        if (instant.status === 'rejected') {
          const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
          balance = money(fresh.balance);
          return res.status(502).json({
            error: 'payout_failed',
            balance,
            message:
              instant.reason === 'insufficient_float'
                ? 'Payouts are temporarily paused. Your balance was not deducted.'
                : 'Withdrawal could not be sent right now. Your balance was refunded.',
          });
        }
      } catch (e) {
        // Leave the row for the cron/poll to reconcile; don't fail the request.
        console.error('instant withdrawal error', e);
      }
    }

    res.json({
      ok: true,
      balance,
      instant: dextopusWithdrawReady,
      withdrawal: {
        id: result.withdrawal.id,
        amount: money(result.withdrawal.amount),
        address: result.withdrawal.address,
        network: result.withdrawal.network,
        status,
        txHash,
        createdAt: result.withdrawal.createdAt,
      },
    });
  } catch (err) {
    console.error('withdrawal error', err);
    res.status(500).json({ error: 'withdrawal_failed' });
  }
});
