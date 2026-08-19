import { ethers } from 'ethers';
import { prisma, money } from '../db';
import { config, payoutReady } from '../config';
import { alertIceWithdrawal } from './notify';

/**
 * Automated ICE USD payouts.
 *
 * Safety model — the whole point of this file is never paying twice:
 *
 *  1. A row is claimed with a conditional update (`pending` -> `processing`).
 *     Postgres serialises that, so only one invocation can win a given row;
 *     concurrent cron runs and retries simply find nothing to claim.
 *  2. Once a row is `processing` it is NEVER auto-retried. If this function
 *     crashes between broadcasting and recording the hash, the row is left
 *     `processing` with no txHash for a human to reconcile. Retrying it
 *     automatically is what would double-send.
 *  3. Nonces are taken as "pending" and transfers are sent one at a time, so a
 *     batch cannot produce two transactions with the same nonce.
 *
 * A payout is a wallet-to-wallet transfer, so the launch sell lock and the
 * decaying sell tax do not apply — recipients receive the full amount.
 */

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export interface PayoutResult {
  claimed: number;
  paid: number;
  failed: number;
  skipped: string[];
  details: Array<{ id: number; status: string; txHash?: string; error?: string }>;
}

/** Refund a failed payout and record why, in one transaction. */
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

export async function runPayouts(): Promise<PayoutResult> {
  const out: PayoutResult = { claimed: 0, paid: 0, failed: 0, skipped: [], details: [] };

  if (!payoutReady) {
    out.skipped.push('payouts_not_configured');
    return out;
  }

  const provider = new ethers.JsonRpcProvider(config.payout.rpcUrl);
  const wallet = new ethers.Wallet(config.payout.privateKey, provider);
  const token = new ethers.Contract(config.payout.tokenAddress, ERC20_ABI, wallet);

  const decimals: number = Number(await token.decimals());
  const toUnits = (appAmount: number) =>
    ethers.parseUnits((appAmount * config.payout.tokensPerUnit).toFixed(decimals), decimals);

  // Gas check up front — without BNB every transfer reverts and we would burn
  // through the queue marking everything failed.
  const gasBalance = await provider.getBalance(wallet.address);
  if (gasBalance === 0n) {
    out.skipped.push('hot_wallet_has_no_bnb_for_gas');
    return out;
  }

  // Only ICE-token withdrawals are paid here; USDT withdrawals go via Dextopus.
  const candidates = await prisma.withdrawal.findMany({
    where: { status: 'pending', token: 'ice' },
    orderBy: { createdAt: 'asc' },
    take: config.payout.batchSize,
  });

  let nonce = await provider.getTransactionCount(wallet.address, 'pending');

  for (const w of candidates) {
    // Oversized payouts are left pending for a human rather than sent blind.
    if (w.amount > config.payout.maxPerWithdrawal) {
      out.skipped.push(`#${w.id}_over_auto_limit`);
      continue;
    }

    // (1) Atomic claim. updateMany with a status guard means a second runner
    // that reaches this row sees count 0 and moves on.
    const claim = await prisma.withdrawal.updateMany({
      where: { id: w.id, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claim.count !== 1) {
      out.skipped.push(`#${w.id}_claimed_elsewhere`);
      continue;
    }
    out.claimed++;

    const amountUnits = toUnits(w.amount);

    // Confirm the float can cover this transfer before broadcasting.
    const tokenBalance: bigint = await token.balanceOf(wallet.address);
    if (tokenBalance < amountUnits) {
      await refund(w.id, w.userId, w.amount, 'payout wallet is out of ICE USD — please top it up');
      out.failed++;
      out.details.push({ id: w.id, status: 'rejected', error: 'insufficient_float' });
      continue;
    }

    try {
      // (3) Explicit sequential nonce so a batch cannot collide with itself.
      const tx = await token.transfer(w.address, amountUnits, { nonce });
      nonce++;

      // Record the hash immediately — before waiting for confirmation — so a
      // timeout still leaves us the transaction to reconcile against.
      await prisma.withdrawal.update({
        where: { id: w.id },
        data: { txHash: tx.hash },
      });

      const receipt = await tx.wait(1);
      if (receipt && receipt.status === 1) {
        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { status: 'paid', processedAt: new Date() },
        });
        await alertIceWithdrawal({ amount: w.amount, address: w.address, txHash: tx.hash });
        out.paid++;
        out.details.push({ id: w.id, status: 'paid', txHash: tx.hash });
      } else {
        // Mined but reverted: the tokens did not move, so refunding is correct.
        await refund(w.id, w.userId, w.amount, `transaction reverted: ${tx.hash}`);
        out.failed++;
        out.details.push({ id: w.id, status: 'rejected', txHash: tx.hash, error: 'reverted' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const current = await prisma.withdrawal.findUnique({ where: { id: w.id } });

      // If a hash was already recorded the transaction may well be in flight.
      // Leave it `processing` for manual reconciliation instead of refunding a
      // payout that might still confirm.
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
 * Process ONE ICE-token withdrawal immediately at request time, so ICE
 * withdrawals are instant. Claims the row, sends the ICE token from the payout
 * wallet to the user, waits one confirmation, and marks it paid (+ alert).
 * Reuses the same never-pay-twice guards as the batch worker.
 */
export async function processIceWithdrawalInstant(withdrawalId: number): Promise<{
  ok: boolean;
  status: string;
  txHash?: string;
  reason?: string;
}> {
  if (!payoutReady) return { ok: false, status: 'pending', reason: 'not_configured' };

  const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w) return { ok: false, status: 'missing', reason: 'not_found' };
  if (w.status !== 'pending') return { ok: false, status: w.status, reason: 'not_pending' };
  if (w.amount > config.payout.maxPerWithdrawal) {
    return { ok: false, status: 'pending', reason: 'over_auto_limit' };
  }

  const claim = await prisma.withdrawal.updateMany({
    where: { id: w.id, status: 'pending' },
    data: { status: 'processing' },
  });
  if (claim.count !== 1) return { ok: false, status: 'processing', reason: 'claimed_elsewhere' };

  const provider = new ethers.JsonRpcProvider(config.payout.rpcUrl);
  const wallet = new ethers.Wallet(config.payout.privateKey, provider);
  const token = new ethers.Contract(config.payout.tokenAddress, ERC20_ABI, wallet);

  try {
    const decimals = Number(await token.decimals());
    const amountUnits = ethers.parseUnits(
      (w.amount * config.payout.tokensPerUnit).toFixed(decimals),
      decimals,
    );
    const [bal, gas] = await Promise.all([
      token.balanceOf(wallet.address) as Promise<bigint>,
      provider.getBalance(wallet.address),
    ]);
    if (gas === 0n) {
      await prisma.withdrawal.update({ where: { id: w.id }, data: { status: 'pending' } });
      return { ok: false, status: 'pending', reason: 'wallet_no_gas' };
    }
    if (bal < amountUnits) {
      await refund(w.id, w.userId, w.amount, 'payout wallet is out of ICE USD — please top it up');
      return { ok: false, status: 'rejected', reason: 'insufficient_float' };
    }

    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const tx = await token.transfer(w.address, amountUnits, { nonce });
    await prisma.withdrawal.update({ where: { id: w.id }, data: { txHash: tx.hash } });

    const receipt = await tx.wait(1);
    if (receipt && receipt.status === 1) {
      await prisma.withdrawal.update({
        where: { id: w.id },
        data: { status: 'paid', processedAt: new Date() },
      });
      await alertIceWithdrawal({ amount: w.amount, address: w.address, txHash: tx.hash });
      return { ok: true, status: 'paid', txHash: tx.hash };
    }
    // Broadcast but not yet confirmed — leave processing for the cron to finish.
    return { ok: true, status: 'processing', txHash: tx.hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const current = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    if (current?.txHash) {
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

/** Operational snapshot for the cron response and manual checks. */
export async function payoutStatus() {
  const [pending, processing, paid, rejected] = await Promise.all([
    prisma.withdrawal.count({ where: { status: 'pending' } }),
    prisma.withdrawal.count({ where: { status: 'processing' } }),
    prisma.withdrawal.count({ where: { status: 'paid' } }),
    prisma.withdrawal.count({ where: { status: 'rejected' } }),
  ]);

  const base = {
    configured: payoutReady,
    tokensPerUnit: config.payout.tokensPerUnit,
    queue: { pending, processing, paid, rejected },
  };
  if (!payoutReady) return base;

  try {
    const provider = new ethers.JsonRpcProvider(config.payout.rpcUrl);
    const wallet = new ethers.Wallet(config.payout.privateKey, provider);
    const token = new ethers.Contract(config.payout.tokenAddress, ERC20_ABI, provider);
    const [bnb, tokens, decimals] = await Promise.all([
      provider.getBalance(wallet.address),
      token.balanceOf(wallet.address),
      token.decimals(),
    ]);
    return {
      ...base,
      wallet: {
        address: wallet.address,
        bnb: ethers.formatEther(bnb),
        iceUsd: ethers.formatUnits(tokens, Number(decimals)),
      },
    };
  } catch (e) {
    return { ...base, walletError: e instanceof Error ? e.message : String(e) };
  }
}

export { money };
