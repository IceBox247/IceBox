import { Router } from 'express';
import { prisma, money } from '../db';
import { config, dextopusWithdrawReady, payoutReady } from '../config';
import { processWithdrawalInstant, pollDextopusWithdrawals } from '../services/dextopusPayout';
import { processIceWithdrawalInstant } from '../services/payout';
import { missingChannels, withdrawGateChannels, channelLink } from '../services/gate';

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
  if (amount > config.withdraw.maxPerTx) {
    return res.status(400).json({
      error: 'above_maximum',
      maxPerWithdrawal: config.withdraw.maxPerTx,
      message: `Maximum per withdrawal is ${config.withdraw.maxPerTx.toFixed(2)} USD.`,
    });
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

  // ── Anti-bot / anti-abuse gates ──────────────────────────────────────────
  const W = config.withdraw;
  const acct = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  // Operator freeze — checked first so a frozen account is stopped before any
  // other gate, balance read or payout path runs.
  if (acct.frozenAt) {
    return res.status(403).json({
      error: 'account_frozen',
      message: 'Withdrawals are suspended on this account. Contact support.',
    });
  }

  // Must be a member of ALL required Telegram channels to withdraw.
  const gateChs = withdrawGateChannels();
  if (gateChs.length) {
    const missing = await missingChannels(acct.telegramId, gateChs);
    if (missing.length) {
      return res.status(403).json({
        error: 'join_required',
        channels: missing.map(channelLink),
        message: 'Join all our Telegram channels to withdraw.',
      });
    }
  }

  // New accounts must age before withdrawing (0 disables).
  if (W.minAccountAgeHours > 0) {
    const ageHours = (Date.now() - acct.createdAt.getTime()) / 3_600_000;
    if (ageHours < W.minAccountAgeHours) {
      return res.status(403).json({
        error: 'account_too_new',
        message: `New accounts can withdraw ${W.minAccountAgeHours}h after signup. Please try again later.`,
      });
    }
  }

  // Optionally require a signature-verified wallet (hard for bots at scale).
  if (W.requireWallet && !acct.walletVerifiedAt) {
    return res.status(403).json({
      error: 'wallet_required',
      message: 'Connect and verify your wallet before withdrawing.',
    });
  }

  // One payout address per account: once set, every withdrawal goes there.
  if (W.lockAddress && acct.withdrawAddress && acct.withdrawAddress.toLowerCase() !== address.toLowerCase()) {
    return res.status(403).json({
      error: 'address_locked',
      lockedAddress: acct.withdrawAddress,
      message: `Withdrawals are locked to your first address (${acct.withdrawAddress}). Contact support to change it.`,
    });
  }

  // A payout address can belong to only one account (anti multi-account).
  if (W.uniqueAddress) {
    const taken = await prisma.user.findFirst({
      where: { withdrawAddress: { equals: address, mode: 'insensitive' }, NOT: { id: user.id } },
      select: { id: true },
    });
    if (taken) {
      return res.status(409).json({
        error: 'address_taken',
        message: 'This payout address is already linked to another account.',
      });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialise this account's withdrawals. Without the lock, requests fired
      // in parallel each read the same daily total and each pass the cap.
      await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', user.id);

      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const deposited = money(Math.max(0, fresh.balance - fresh.earnedBalance));

      // Rolling 24h ceiling on everything this account has taken out.
      const dayStart = new Date(Date.now() - 24 * 3_600_000);
      const takenAgg = await tx.withdrawal.aggregate({
        where: { userId: user.id, status: { not: 'rejected' }, createdAt: { gte: dayStart } },
        _sum: { amount: true },
      });
      const takenToday = money(takenAgg._sum.amount ?? 0);
      if (money(takenToday + amount) > W.maxPerDay) {
        return {
          dailyCap: true as const,
          takenToday,
          cap: W.maxPerDay,
          remaining: money(Math.max(0, W.maxPerDay - takenToday)),
        };
      }

      // One free withdrawal per rolling window; each extra one in the window costs
      // a fee (charged on top of the amount, kept by the treasury). Rate-limits bots.
      const windowStart = new Date(Date.now() - W.freeWindowHours * 3_600_000);
      const recent = await tx.withdrawal.count({
        where: { userId: user.id, status: { not: 'rejected' }, createdAt: { gte: windowStart } },
      });
      const fee = recent >= 1 ? money(W.extraFee) : 0;
      const need = money(amount + fee); // must cover payout + fee

      if (token === 'ice') {
        // ICE token rail draws from the earned bucket.
        if (fresh.earnedBalance < need) {
          return { insufficient: 'earned' as const, available: money(fresh.earnedBalance), fee };
        }
      } else {
        // USDT rail draws from the deposited/staked bucket.
        if (deposited < need) {
          return { insufficient: 'deposited' as const, available: deposited, fee };
        }
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          balance: { decrement: need },
          // ICE withdrawal also draws down the earned bucket; USDT leaves it.
          ...(token === 'ice' ? { earnedBalance: { decrement: need } } : {}),
          // Bind the account's single payout address on first withdrawal.
          ...(fresh.withdrawAddress ? {} : { withdrawAddress: address }),
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

      if (fee > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: user.id,
            amount: -fee,
            reason: 'withdrawal_fee',
            meta: JSON.stringify({ withdrawalId: withdrawal.id, windowHours: W.freeWindowHours }),
          },
        });
      }

      return {
        insufficient: false as const,
        withdrawal,
        fee,
        balance: money(updated.balance),
        earnedBalance: money(updated.earnedBalance),
      };
    });

    if ('dailyCap' in result && result.dailyCap) {
      return res.status(429).json({
        error: 'daily_limit_reached',
        cap: result.cap,
        takenToday: result.takenToday,
        remaining: result.remaining,
        message:
          result.remaining > 0
            ? `Daily withdrawal limit is ${result.cap.toFixed(2)} USD. You have ${result.remaining.toFixed(2)} left today.`
            : `Daily withdrawal limit of ${result.cap.toFixed(2)} USD reached. Try again tomorrow.`,
      });
    }

    if ('insufficient' in result && result.insufficient) {
      const feeNote = result.fee > 0 ? ` (includes a $${result.fee.toFixed(2)} extra-withdrawal fee)` : '';
      return res.status(400).json({
        error: 'insufficient_balance',
        bucket: result.insufficient,
        available: result.available,
        fee: result.fee,
        message:
          result.insufficient === 'earned'
            ? `Not enough earned ICE USD for this withdrawal${feeNote}.`
            : `Not enough USDT-withdrawable balance${feeNote}. Only deposited or staked ICE USD can be withdrawn as USDT.`,
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
      fee: result.fee,
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
