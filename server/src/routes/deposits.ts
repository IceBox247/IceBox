import { Router } from 'express';
import { config, dextopusReady } from '../config';
import {
  getOrCreateDepositAddress,
  reconcileUserDeposits,
  listUserDeposits,
} from '../services/deposits';

export const depositsRouter = Router();

/**
 * GET /api/deposits
 * The user's deposit address (minted on demand), on-ramp config, and recent
 * deposit history. Reconciles with Dextopus first so status is fresh even if a
 * webhook was missed.
 */
depositsRouter.get('/', async (req, res) => {
  const user = req.user!;

  if (!dextopusReady) {
    return res.json({
      enabled: false,
      message: 'Deposits are not configured yet.',
      deposits: [],
    });
  }

  try {
    // Best-effort reconcile so newly-completed deposits are credited on open.
    await reconcileUserDeposits(user);

    const [address, deposits] = await Promise.all([
      getOrCreateDepositAddress(user),
      listUserDeposits(user.id),
    ]);

    res.json({
      enabled: true,
      address: address.address,
      originAsset: address.originAsset,
      originChainId: address.originChainId,
      minDeposit: address.minDeposit,
      rate: address.rate,
      note: 'Send USDT to this address. It is credited as ICE USD (1:1) once it settles.',
      deposits,
    });
  } catch (e) {
    console.error('deposits error', e);
    res.status(502).json({
      enabled: true,
      error: 'deposit_unavailable',
      message: e instanceof Error ? e.message : 'Could not reach the deposit provider.',
    });
  }
});

/**
 * POST /api/deposits/refresh
 * Force a reconcile (used by the "I've sent it" button) and return fresh history.
 */
depositsRouter.post('/refresh', async (req, res) => {
  const user = req.user!;
  if (!dextopusReady) return res.status(503).json({ error: 'deposits_disabled' });
  try {
    await reconcileUserDeposits(user);
    res.json({ ok: true, balance: user.balance, deposits: await listUserDeposits(user.id) });
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', message: e instanceof Error ? e.message : '' });
  }
});

// Expose the min for the client without a round-trip when deposits are off.
export function depositsPublicConfig() {
  return { enabled: dextopusReady, minDeposit: config.dextopus.minDeposit, rate: config.dextopus.rate };
}
