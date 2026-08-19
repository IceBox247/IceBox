import { ethers } from 'ethers';
import { prisma, money } from '../db';
import { config, dextopusWithdrawReady } from '../config';
import { createWithdrawalQuote, getRequestStatus } from './dextopus';
import { alertUsdtWithdrawal } from './notify';

/**
 * Dextopus off-ramp payouts: ICE USD -> USDT delivered to the user's external
 * wallet (any Dextopus-supported chain/token).
 *
 * Flow per withdrawal:
 *   1. Atomically claim the row (`pending` -> `processing`) so no two runners
 *      touch it — same guard the direct-token payout uses.
 *   2. Create a Dextopus quote (recipient = the user's wallet). Dextopus returns
 *      an address the treasury must fund.
 *   3. Send USDT from the treasury hot wallet to that address, recording the tx
 *      hash BEFORE waiting so a crash leaves something to reconcile, never a
 *      double-send.
 *   4. Leave the row `processing`; `pollDextopusWithdrawals` flips it to `paid`
 *      once Dextopus confirms final delivery to the user.
 *
 * Mirrors services/payout.ts's safety model; a `processing` row is never
 * auto-retried.
 */

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export interface DextopusPayoutResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: string[];
  details: Array<{ id: number; status: string; txHash?: string; requestId?: string; error?: string }>;
}

/** Refund a failed withdrawal to the user's balance and record why. */
async function refund(id: number, userId: number, amount: number, reason: string) {
  await prisma.$transaction(async (tx) => {
    await tx.withdrawal.update({
      where: { id },
      data: { status: 'rejected', error: reason.slice(0, 500), processedAt: new Date() },
    });
    await tx.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
    await tx.ledgerEntry.create({
      data: {
        userId,
        amount,
        reason: 'withdrawal_refund',
        meta: JSON.stringify({ withdrawalId: id, reason: reason.slice(0, 200) }),
      },
    });
  });
}

export async function runDextopusPayouts(): Promise<DextopusPayoutResult> {
  const out: DextopusPayoutResult = { claimed: 0, sent: 0, failed: 0, skipped: [], details: [] };
  if (!dextopusWithdrawReady) {
    out.skipped.push('dextopus_withdraw_not_configured');
    return out;
  }

  const provider = new ethers.JsonRpcProvider(config.dextopus.withdrawRpcUrl);
  const wallet = new ethers.Wallet(config.dextopus.treasuryPrivateKey, provider);
  const usdt = new ethers.Contract(config.dextopus.usdtAddress, ERC20_ABI, wallet);
  const decimals = Number(await usdt.decimals());

  const gasBalance = await provider.getBalance(wallet.address);
  if (gasBalance === 0n) {
    out.skipped.push('treasury_has_no_gas');
    return out;
  }

  const candidates = await prisma.withdrawal.findMany({
    where: { status: 'pending', token: 'usdt' },
    orderBy: { createdAt: 'asc' },
    take: config.payout.batchSize,
  });

  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  for (const w of candidates) {
    if (w.amount > config.payout.maxPerWithdrawal) {
      out.skipped.push(`#${w.id}_over_auto_limit`);
      continue;
    }

    // (1) Atomic claim.
    const claim = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claim.count !== 1) {
      out.skipped.push(`#${w.id}_claimed_elsewhere`);
      continue;
    }
    out.claimed++;

    const amountUnits = ethers.parseUnits(w.amount.toFixed(decimals), decimals);

    // Enough USDT float to cover this payout?
    const bal: bigint = await usdt.balanceOf(wallet.address);
    if (bal < amountUnits) {
      await refund(w.id, w.userId, w.amount, 'treasury is out of USDT — please top it up');
      out.failed++;
      out.details.push({ id: w.id, status: 'rejected', error: 'insufficient_float' });
      continue;
    }

    try {
      // (2) Create the Dextopus quote for the user's chosen destination.
      const quote = await createWithdrawalQuote({
        originChainId: config.dextopus.withdrawOriginChainId,
        originAsset: config.dextopus.withdrawOriginAsset,
        destinationChainId: w.destChainId ?? config.dextopus.withdrawDestChainId,
        destinationAsset: w.destAsset ?? config.dextopus.withdrawDestAsset,
        amount: amountUnits.toString(),
        recipient: w.address,
        refundTo: config.dextopus.refundAddress,
      });

      await prisma.withdrawal.update({
        where: { id: w.id },
        data: { dextopusRequestId: quote.depositRequestId, dextopusDepositAddress: quote.depositAddress },
      });

      // (3) Fund the quote address from the treasury, recording the hash first.
      const tx = await usdt.transfer(quote.depositAddress, amountUnits, { nonce });
      nonce++;
      await prisma.withdrawal.update({ where: { id: w.id }, data: { txHash: tx.hash } });

      const receipt = await tx.wait(1);
      if (receipt && receipt.status === 1) {
        // Delivery is now Dextopus's job — poll confirms it. Stay `processing`.
        out.sent++;
        out.details.push({
          id: w.id,
          status: 'processing',
          txHash: tx.hash,
          requestId: quote.depositRequestId ?? undefined,
        });
      } else {
        await refund(w.id, w.userId, w.amount, `funding tx reverted: ${tx.hash}`);
        out.failed++;
        out.details.push({ id: w.id, status: 'rejected', txHash: tx.hash, error: 'reverted' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const current = await prisma.withdrawal.findUnique({ where: { id: w.id } });
      // A recorded hash means funds may be in flight — never refund blindly.
      if (current?.txHash) {
        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { error: `unconfirmed: ${msg}`.slice(0, 500) },
        });
        out.details.push({ id: w.id, status: 'processing', txHash: current.txHash, error: msg });
      } else {
        await refund(w.id, w.userId, w.amount, msg);
        out.failed++;
        out.details.push({ id: w.id, status: 'rejected', error: msg });
      }
    }
  }

  return out;
}

/**
 * Process ONE withdrawal immediately, at request time, so withdrawals are
 * instant instead of waiting for the cron. Claims the row, creates a Dextopus
 * quote, and BROADCASTS the treasury's USDT transfer — returning as soon as the
 * tx is submitted (no confirmation wait, to stay inside the function budget).
 * Delivery is finalised by `pollDextopusWithdrawals` (run on view + daily cron).
 *
 * Reuses the same safety guards as the batch worker. Returns a compact result
 * the withdrawal route can hand straight back to the client.
 */
export async function processWithdrawalInstant(withdrawalId: number): Promise<{
  ok: boolean;
  status: string;
  txHash?: string;
  requestId?: string;
  reason?: string;
}> {
  if (!dextopusWithdrawReady) return { ok: false, status: 'pending', reason: 'not_configured' };

  const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w) return { ok: false, status: 'missing', reason: 'not_found' };
  if (w.status !== 'pending') return { ok: false, status: w.status, reason: 'not_pending' };
  if (w.amount > config.payout.maxPerWithdrawal) {
    return { ok: false, status: 'pending', reason: 'over_auto_limit' };
  }

  // Atomic claim so the cron and this call can never both send the same row.
  const claim = await prisma.withdrawal.updateMany({
    where: { id: w.id, status: 'pending' },
    data: { status: 'processing' },
  });
  if (claim.count !== 1) return { ok: false, status: 'processing', reason: 'claimed_elsewhere' };

  const provider = new ethers.JsonRpcProvider(config.dextopus.withdrawRpcUrl);
  const wallet = new ethers.Wallet(config.dextopus.treasuryPrivateKey, provider);
  const usdt = new ethers.Contract(config.dextopus.usdtAddress, ERC20_ABI, wallet);

  try {
    const decimals = Number(await usdt.decimals());
    const amountUnits = ethers.parseUnits(w.amount.toFixed(decimals), decimals);

    const [bal, gas] = await Promise.all([
      usdt.balanceOf(wallet.address) as Promise<bigint>,
      provider.getBalance(wallet.address),
    ]);
    // No gas or no float: release the claim back to `pending` (nothing was sent)
    // so a later run can pay it once the treasury is topped up.
    if (gas === 0n) {
      await prisma.withdrawal.update({ where: { id: w.id }, data: { status: 'pending' } });
      return { ok: false, status: 'pending', reason: 'treasury_no_gas' };
    }
    if (bal < amountUnits) {
      await refund(w.id, w.userId, w.amount, 'treasury is out of USDT — please top it up');
      return { ok: false, status: 'rejected', reason: 'insufficient_float' };
    }

    const quote = await createWithdrawalQuote({
      originChainId: config.dextopus.withdrawOriginChainId,
      originAsset: config.dextopus.withdrawOriginAsset,
      destinationChainId: w.destChainId ?? config.dextopus.withdrawDestChainId,
      destinationAsset: w.destAsset ?? config.dextopus.withdrawDestAsset,
      amount: amountUnits.toString(),
      recipient: w.address,
      refundTo: config.dextopus.refundAddress,
    });
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { dextopusRequestId: quote.depositRequestId, dextopusDepositAddress: quote.depositAddress },
    });

    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    // transfer() resolves once the tx is broadcast — fast enough to return now.
    const tx = await usdt.transfer(quote.depositAddress, amountUnits, { nonce });
    await prisma.withdrawal.update({ where: { id: w.id }, data: { txHash: tx.hash } });

    return {
      ok: true,
      status: 'processing',
      txHash: tx.hash,
      requestId: quote.depositRequestId ?? undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const current = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    if (current?.txHash) {
      // Funds may be in flight — never refund. Leave for the poll to confirm.
      await prisma.withdrawal.update({
        where: { id: w.id },
        data: { error: `unconfirmed: ${msg}`.slice(0, 500) },
      });
      return { ok: true, status: 'processing', txHash: current.txHash };
    }
    await refund(w.id, w.userId, w.amount, msg);
    return { ok: false, status: 'rejected', reason: msg };
  }
}

/**
 * Confirm delivery for `processing` withdrawals that carry a Dextopus request
 * id, marking them `paid` once Dextopus reports completion. Failures are left
 * `processing` with an error note for a human, rather than auto-refunded (the
 * treasury already sent funds; Dextopus refunds to `refundTo`).
 */
export async function pollDextopusWithdrawals(): Promise<{ checked: number; paid: number }> {
  let paid = 0;
  if (!dextopusWithdrawReady) return { checked: 0, paid: 0 };

  const rows = await prisma.withdrawal.findMany({
    where: { status: 'processing', dextopusRequestId: { not: null } },
    take: 20,
  });

  for (const w of rows) {
    try {
      const s = await getRequestStatus({
        depositRequestId: w.dextopusRequestId ?? undefined,
        depositAddress: w.dextopusDepositAddress ?? undefined,
      });
      if (!s) continue;
      const done = ['completed', 'success', 'delivered', 'filled'].includes(s.executionStatus) ||
        ['completed', 'success', 'delivered', 'filled'].includes(s.status);
      if (done) {
        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { status: 'paid', processedAt: new Date() },
        });
        await alertUsdtWithdrawal({
          amount: w.amount,
          address: w.address,
          txHash: s.destinationTxHashes[0] ?? w.txHash,
        });
        paid++;
      } else if (['failed', 'refunded', 'expired'].includes(s.status)) {
        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { error: `dextopus ${s.status}`.slice(0, 500) },
        });
      }
    } catch {
      // best-effort; try again next poll
    }
  }

  return { checked: rows.length, paid };
}

export { money };
