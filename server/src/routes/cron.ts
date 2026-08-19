import { Router } from 'express';
import { config, hasBot } from '../config';
import { runPayouts, payoutStatus } from '../services/payout';
import { runDextopusPayouts, pollDextopusWithdrawals } from '../services/dextopusPayout';

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

/**
 * GET /api/cron/payouts — the single safety-net job (Hobby allows few crons).
 * Deposits and withdrawals are processed instantly at request time; this run is
 * only a backstop that (a) sends any withdrawals the instant path left pending
 * (e.g. treasury was briefly out of gas), (b) confirms in-flight Dextopus
 * deliveries, and (c) drains the legacy direct-token payout queue.
 */
cronRouter.get('/payouts', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const legacy = await runPayouts();
    const dextopus = await runDextopusPayouts();
    const poll = await pollDextopusWithdrawals();
    res.json({ ok: true, legacy, dextopus, poll });
  } catch (e) {
    console.error('[cron] payout run failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/dextopus-payouts — off-ramp: fund Dextopus quotes for pending
 * withdrawals, then confirm delivery of ones already in flight.
 */
cronRouter.get('/dextopus-payouts', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const run = await runDextopusPayouts();
    const poll = await pollDextopusWithdrawals();
    res.json({ ok: true, run, poll });
  } catch (e) {
    console.error('[cron] dextopus payout run failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/test-alert — post a sample alert to the deposit AND payout
 * channels and return Telegram's raw answer for each, so channel/bot-admin
 * misconfig is diagnosable from a phone without waiting for a real deposit.
 * Call: /api/cron/test-alert?secret=YOUR_CRON_SECRET
 */
cronRouter.get('/test-alert', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });

  const button = { inline_keyboard: [[{ text: config.alerts.buttonText, url: config.alerts.buttonUrl }]] };
  const photo = config.alerts.image;

  async function post(label: string, channel: string) {
    if (!hasBot) return { label, ok: false, reason: 'BOT_TOKEN not set' };
    if (!channel) return { label, ok: false, reason: `${label.toUpperCase()}_CHANNEL is empty` };
    const method = photo ? 'sendPhoto' : 'sendMessage';
    const caption = `✅ IceBox test — ${label} channel is wired up correctly.`;
    const body = photo
      ? { chat_id: channel, photo, caption, reply_markup: button }
      : { chat_id: channel, text: caption, reply_markup: button };
    try {
      const r = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j: any = await r.json().catch(() => ({}));
      return { label, channel, status: r.status, ok: !!j?.ok, description: j?.description ?? null };
    } catch (e) {
      return { label, channel, ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  const results = await Promise.all([
    post('deposit', config.channels.deposit),
    post('payout', config.channels.payout),
  ]);
  res.json({ ok: true, hasImage: !!photo, image: photo || null, results });
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
