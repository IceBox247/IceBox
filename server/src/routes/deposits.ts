import { Router } from 'express';
import { config, dextopusReady } from '../config';
import {
  getOrCreateDepositAddress,
  reconcileUserDeposits,
  listUserDeposits,
  depositCatalog,
} from '../services/deposits';

export const depositsRouter = Router();

/**
 * GET /api/deposits
 * On-ramp config + recent deposit history. Reconciles with Dextopus first so
 * status is fresh even if a webhook was missed. Does NOT mint an address —
 * the client picks a coin, then calls /address for that origin.
 */
depositsRouter.get('/', async (req, res) => {
  const user = req.user!;

  if (!dextopusReady) {
    return res.json({ enabled: false, message: 'Deposits are not configured yet.', deposits: [] });
  }

  try {
    await reconcileUserDeposits(user);
    res.json({
      enabled: true,
      minDeposit: config.dextopus.minDeposit,
      rate: config.dextopus.rate,
      note: 'Pick a coin, send it to your address — it’s credited as ICE USD (1:1) once it settles.',
      deposits: await listUserDeposits(user.id),
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
 * GET /api/deposits/tokens
 * The coin picker: featured majors up front, plus every supported chain/token.
 */
depositsRouter.get('/tokens', async (_req, res) => {
  if (!dextopusReady) return res.json({ enabled: false, featured: [], chains: [] });
  try {
    const catalog = await depositCatalog();
    res.json({ enabled: true, ...catalog });
  } catch (e) {
    console.error('deposit catalog error', e);
    res.status(502).json({ error: 'catalog_unavailable', message: e instanceof Error ? e.message : '' });
  }
});

/**
 * POST /api/deposits/address
 * Body: { chainId, asset }
 * Return (minting once) the user's deposit address for the chosen origin coin.
 */
depositsRouter.post('/address', async (req, res) => {
  const user = req.user!;
  if (!dextopusReady) return res.status(503).json({ error: 'deposits_disabled' });

  const chainId = Number(req.body?.chainId);
  const asset = String(req.body?.asset ?? '').trim();
  if (!Number.isFinite(chainId) || !asset) {
    return res.status(400).json({ error: 'invalid_origin', message: 'Pick a coin to deposit.' });
  }

  try {
    const info = await getOrCreateDepositAddress(user, { chainId, asset });
    res.json({ ...info, note: 'Send only this coin to this address.' });
  } catch (e) {
    console.error('deposit address error', e);
    res.status(502).json({
      error: 'address_unavailable',
      message: e instanceof Error ? e.message : 'Could not create a deposit address.',
    });
  }
});

/**
 * POST /api/deposits/refresh
 * Force a reconcile (the "I've sent it" button / auto-poll) and return history.
 */
depositsRouter.post('/refresh', async (req, res) => {
  const user = req.user!;
  if (!dextopusReady) return res.status(503).json({ error: 'deposits_disabled' });
  try {
    await reconcileUserDeposits(user);
    res.json({ ok: true, deposits: await listUserDeposits(user.id) });
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', message: e instanceof Error ? e.message : '' });
  }
});
