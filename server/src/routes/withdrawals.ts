import { Router } from 'express';
import { prisma, money } from '../db';
import { config, dextopusWithdrawReady, payoutReady } from '../config';
import { processWithdrawalInstant, pollDextopusWithdrawals } from '../services/dextopusPayout';
import { processIceWithdrawalInstant } from '../services/payout';

export const withdrawalsRouter = Router();

/** A BEP-20 payout address: 0x followed by 40 hex characters. */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** GET /api/withdrawals — the user's payout history, newest first. */
withdrawalsRouter.get('/', async (req, res) => {
  const user = req.user!;

  // Confirm any in-flight Dextopus (USDT) withdrawals right away, so a user who
  // just withdrew sees it flip from "processing" to "paid" without cron.
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
      token: w.token,
      status: w.status,
      txHash: w.txHash,
      createdAt: w.createdAt,
    })),
  });
});

/**
 * POST /api/withdrawals
 * Body: { amount, address, network, token }
 *
 * Two rails, chosen by `token`:
 *  - "ice"  → pays the ICE token on-chain (instant), drawn from the EARNED
 *             bucket (task/referral earnings).
 *  - "usdt" → pays real USDT via Dextopus (instant), drawn from the DEPOSITED /
 *             staked bucket. Only funds that were deposited or passed through
 *             staking are USDT-withdrawable.
 */
withdrawalsRouter.post('/', async (req, res) => {
  const user = req.user!;
  const amount = money(Number(req.body?.amount));
  const address = String(req.body?.address ?? '').trim();
  const network = String(req.body?.network ?? 'BEP20').trim() || 'BEP20';
  const token = String(req.body?.token ?? 'usdt').trim().toLowerCase() === 'ice' ? 'ice' : 'usdt';

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount' });
  }
  const minForRail = token === 'usdt' ? config.minWithdrawalUsdt : config.minWithdrawal;
  if (amount < minForRail) {
    return res.status(400).json({
      error: 'below_minimum',
      minWithdrawal: minForRail,
      message: `Minimum ${token.toUpperCase()} withdrawal is ${minForRail.toFixed(2)} USD.`,
    });
  }
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
      const deposited = money(Math.max(0, fresh.balance - fresh.earnedBalance));

      if (token === 'ice') {
        // ICE token rail draws from the earned bucket.
        if (fresh.earnedBalance < amount) {
          return { insufficient: 'earned' as const, available: money(fresh.earnedBalance) };
        }
      } else {
        // USDT rail draws from the deposited/staked bucket.
        if (deposited < amount) {
          return { insufficient: 'deposited' as const, available: deposited };
        }
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { decrement: amount },
          // ICE withdrawal also draws down the earned bucket; USDT leaves it.
          ...(token === 'ice' ? { earnedBalance: { decrement: amount } } : {}),
        },
      });

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: user.id,
          amount,
          address,
          network,
          token,
          status: 'pending',
          // Dextopus off-ramp destination (USDT rail only); harmless on the ICE rail.
          destChainId: config.dextopus.withdrawDestChainId,
          destAsset: config.dextopus.withdrawDestAsset,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: -amount,
          reason: 'withdrawal',
          meta: JSON.stringify({ withdrawalId: withdrawal.id, address, network, token }),
        },
      });

      return {
        insufficient: false as const,
        withdrawal,
        balance: money(updated.balance),
        earnedBalance: money(updated.earnedBalance),
      };
    });

    if ('insufficient' in result && result.insufficient) {
      return res.status(400).json({
        error: 'insufficient_balance',
        bucket: result.insufficient,
        available: result.available,
        message:
          result.insufficient === 'earned'
            ? 'Not enough earned ICE USD for an ICE-token withdrawal.'
            : 'Not enough USDT-withdrawable balance. Only deposited or staked ICE USD can be withdrawn as USDT.',
      });
    }

    // Instant payout via the matching rail.
    let status = result.withdrawal.status;
    let txHash: string | null = null;
    let balance = result.balance;
    const ready = token === 'ice' ? payoutReady : dextopusWithdrawReady;
    if (ready) {
      try {
        const instant =
          token === 'ice'
            ? await processIceWithdrawalInstant(result.withdrawal.id)
            : await processWithdrawalInstant(result.withdrawal.id);
        status = instant.status;
        txHash = instant.txHash ?? null;
        if (instant.status === 'rejected') {
          const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
          balance = money(fresh.balance);
          return res.status(502).json({
            error: 'payout_failed',
            balance,
            reason: instant.reason,
            message:
              instant.reason === 'insufficient_float'
                ? 'Treasury is out of USDT — top it up. Your balance was refunded.'
                : `Withdrawal could not be sent: ${String(instant.reason ?? 'unknown error').slice(0, 160)}. Your balance was refunded.`,
          });
        }
      } catch (e) {
        console.error('instant withdrawal error', e);
      }
    }

    res.json({
      ok: true,
      balance,
      earnedBalance: result.earnedBalance,
      instant: ready,
      withdrawal: {
        id: result.withdrawal.id,
        amount: money(result.withdrawal.amount),
        address: result.withdrawal.address,
        network: result.withdrawal.network,
        token,
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
