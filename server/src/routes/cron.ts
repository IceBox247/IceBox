import { Router } from 'express';
import { config } from '../config';
import { runPayouts, payoutStatus } from '../services/payout';

export const cronRouter = Router();

/**
 * Vercel Cron and manual operator checks. Mounted before the Telegram auth
 * middleware — neither caller has Mini App initData — so every route here
 * authenticates with CRON_SECRET instead.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; a `?secret=` query
 * parameter is accepted too so the endpoint can be triggered from a phone.
 */
function authorized(req: { headers: Record<string, unknown>; query: Record<string, unknown> }) {
  const expected = config.payout.cronSecret;
  if (!expected) return false; // no secret configured => endpoint stays shut
  const header = String(req.headers['authorization'] ?? '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = String(req.query['secret'] ?? '');
  return bearer === expected || query === expected;
}

/** GET /api/cron/payouts — send queued withdrawals. */
cronRouter.get('/payouts', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const result = await runPayouts();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron] payout run failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/** GET /api/cron/status — queue counts and hot-wallet balances. */
cronRouter.get('/status', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json({ ok: true, ...(await payoutStatus()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
