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
    // Daily mining-leaderboard rewards (idempotent per UTC day).
    const { distributeMiningRewards } = await import('../services/mining');
    const miningRewards = await distributeMiningRewards().catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    // One-time compensation for old bought-hashrate spenders (idempotent per user).
    const { migrateHashrateSpenders } = await import('../services/levels');
    const hashrateMigration = await migrateHashrateSpenders().catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    // Backstop: credit + alert any deposits the webhook missed (bounded batch).
    const { reconcileRecentDeposits } = await import('../services/deposits');
    const deposits = await reconcileRecentDeposits().catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    res.json({ ok: true, legacy, dextopus, poll, miningRewards, hashrateMigration, deposits });
  } catch (e) {
    console.error('[cron] payout run failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/reconcile-deposits — operator backstop for missed deposits.
 *  • ?userId=123 or ?username=@name → reconcile just that user (fast; use this
 *    to rescue a specific stuck deposit).
 *  • no target → bounded batch of recently-active depositors.
 * Credits + posts the deposit alert for anything the webhook missed.
 */
cronRouter.get('/reconcile-deposits', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { reconcileDepositsFor, reconcileRecentDeposits } = await import('../services/deposits');
    const userId = Number(req.query.userId);
    const username = req.query.username ? String(req.query.username) : undefined;
    if ((Number.isInteger(userId) && userId > 0) || username) {
      const result = await reconcileDepositsFor({
        userId: Number.isInteger(userId) && userId > 0 ? userId : undefined,
        username,
      });
      return res.json(result);
    }
    const limit = Number(req.query.limit) || 25;
    res.json({ ok: true, ...(await reconcileRecentDeposits(limit)) });
  } catch (e) {
    console.error('[cron] reconcile-deposits failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/resync-levels — repair the mining runaway: recompute every
 * miner's level from on-chain holding only and clear inflated uncollected
 * pending. Run once after the holding-only-level fix deploys.
 */
cronRouter.get('/resync-levels', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { resyncAllLevels } = await import('../services/levels');
    res.json({ ok: true, ...(await resyncAllLevels()) });
  } catch (e) {
    console.error('[cron] resync-levels failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/dedupe-wallets — enforce one-wallet-per-account on existing
 * data: unbind wallets shared across multiple accounts (earliest keeps it).
 */
cronRouter.get('/dedupe-wallets', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { dedupeWallets } = await import('../services/levels');
    res.json({ ok: true, ...(await dedupeWallets()) });
  } catch (e) {
    console.error('[cron] dedupe-wallets failed', e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/cron/adjust-balance — operator balance correction (self-serve).
 * Params: secret, (username=@name OR userId=123), amount (e.g. -8 to deduct,
 * 8 to add), optional bucket=deposited|earned (default deposited), reason.
 * Writes a ledger entry and refuses to push the balance negative.
 *
 * Example — claw back an over-sent $8 deposit:
 *   /api/cron/adjust-balance?secret=…&username=Uchedolla&amount=-8&reason=over-deposit
 */
cronRouter.get('/adjust-balance', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { prisma, money } = await import('../db');
  const username = String(req.query.username ?? '').replace(/^@/, '').trim();
  const userId = Number(req.query.userId);
  const amount = Number(req.query.amount);
  const bucket = String(req.query.bucket ?? 'deposited'); // deposited | earned
  const reason = (String(req.query.reason ?? 'admin_adjustment') || 'admin_adjustment').slice(0, 64);
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Pass a non-zero amount (e.g. -8).' });
  }
  const user = Number.isInteger(userId) && userId > 0
    ? await prisma.user.findUnique({ where: { id: userId } })
    : username
      ? await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })
      : null;
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const delta = money(amount);
  if (money(user.balance + delta) < 0) {
    return res.status(400).json({ error: 'would_go_negative', balance: money(user.balance) });
  }
  const data: Record<string, unknown> = { balance: { increment: delta } };
  // 'earned' also moves the earned (ICE) bucket; 'deposited' touches balance only.
  if (bucket === 'earned') data.earnedBalance = { increment: delta };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data });
    await tx.ledgerEntry.create({
      data: { userId: user.id, amount: delta, reason, meta: JSON.stringify({ admin: true, bucket }) },
    });
    return u;
  });
  res.json({
    ok: true,
    userId: user.id,
    username: user.username,
    delta,
    bucket,
    balance: money(updated.balance),
    earnedBalance: money(updated.earnedBalance),
  });
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

/**
 * GET /api/cron/config?secret=CRON_SECRET — echoes the staking specs the SERVER
 * actually resolved from the environment, so "my APY isn't changing" can be told
 * apart from a frontend cache vs. env-not-applied. If the numbers here match your
 * Vercel env, the API is correct and the app just needs a hard reload; if they
 * show the old defaults, the env isn't reaching this deployment.
 */
cronRouter.get('/config', (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    ok: true,
    stakingEnabled: config.staking.enabled,
    tiers: config.staking.tiers.map((t) => ({
      key: t.key,
      name: t.name,
      apy: t.apy,
      dailyRate: t.dailyRate,
      durationDays: t.durationDays,
      min: t.minStake,
      max: t.maxStake,
    })),
    earnedVault: {
      apy: config.staking.earned.apy,
      dailyRate: config.staking.earned.dailyRate,
      durationDays: config.staking.earned.durationDays,
    },
  });
});

/**
 * GET /api/cron/admin?secret=CRON_SECRET — the operator stats dashboard as JSON,
 * accessible from a browser without needing an admin Telegram id set up.
 */
cronRouter.get('/admin', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { adminStats } = await import('../services/admin');
  res.json({ ok: true, ...(await adminStats()) });
});

/**
 * GET /api/cron/user?secret=CRON_SECRET&query=<name|username|id> — inspect a
 * user's full balance + mining breakdown to see where funds/hashrate came from.
 */
cronRouter.get('/user', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { lookupUser } = await import('../services/admin');
  res.json({ ok: true, ...(await lookupUser(String(req.query.query ?? ''))) });
});

/**
 * GET /api/cron/referrer?secret=CRON_SECRET&query=<name|code|id> — audit a
 * referrer's invitees (activity + fraud signals) to verify their count is real.
 */
cronRouter.get('/referrer', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { auditReferrer } = await import('../services/admin');
  res.json({ ok: true, ...(await auditReferrer(String(req.query.query ?? ''))) });
});

/**
 * GET /api/cron/investigate?secret=CRON_SECRET&address=0x… — incident tooling.
 * Given a payout address seen in the treasury's transaction history, return the
 * account(s) behind it, what they withdrew, and the deposits that funded it
 * (flagging any credited at >=1000x what was actually sent).
 */
cronRouter.get('/investigate', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { investigateAddress } = await import('../services/admin');
  res.json({ ok: true, ...(await investigateAddress(String(req.query.address ?? ''))) });
});

/**
 * GET /api/cron/exposure?secret=CRON_SECRET — every account credited far more
 * than it deposited, and what each has already withdrawn. Use it to size an
 * incident and see whether it is one account or many.
 */
cronRouter.get('/exposure', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  const { exposureReport } = await import('../services/admin');
  res.json({ ok: true, ...(await exposureReport()) });
});

/**
 * GET /api/cron/task-verify?secret=CRON_SECRET — for each active channel-join
 * task, report whether the bot can verify membership (i.e. it is an admin of
 * that chat). Use it after adding @IceBoxbot_bot as admin to confirm each
 * channel is wired up, so real joiners can claim and non-joiners are blocked.
 */
cronRouter.get('/task-verify', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  if (!hasBot) return res.json({ ok: false, reason: 'BOT_TOKEN not set' });

  const botId = config.botToken.split(':')[0];
  const { prisma } = await import('../db');
  const tasks = await prisma.task.findMany({
    where: { active: true, actionType: 'join' },
    select: { key: true, title: true, chatId: true, url: true },
    orderBy: { sortOrder: 'asc' },
  });

  const checks = await Promise.all(
    tasks.map(async (t) => {
      if (!t.chatId) {
        return { task: t.key, chatId: null, ready: false, note: 'no chatId — cannot verify (private invite link?)' };
      }
      try {
        const r = await fetch(
          `https://api.telegram.org/bot${config.botToken}/getChatMember` +
            `?chat_id=${encodeURIComponent(t.chatId)}&user_id=${encodeURIComponent(botId)}`,
        );
        const j: any = await r.json().catch(() => ({}));
        if (!j?.ok) {
          return { task: t.key, chatId: t.chatId, ready: false, note: j?.description ?? 'getChatMember failed' };
        }
        const status = j?.result?.status;
        const ready = status === 'administrator' || status === 'creator';
        return {
          task: t.key,
          chatId: t.chatId,
          ready,
          botStatus: status,
          note: ready ? 'bot is admin — verification works' : `bot is "${status}", must be admin`,
        };
      } catch (e) {
        return { task: t.key, chatId: t.chatId, ready: false, note: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  res.json({ ok: true, allReady: checks.every((c) => c.ready), checks });
});

/**
 * GET /api/cron/migrate-hashrate?secret=CRON_SECRET — one-time: compensate users
 * who spent real USD on the old bought-hashrate model with ICE tokens (at the
 * live price) + a holding credit for their level. Idempotent — safe to re-run.
 */
cronRouter.get('/migrate-hashrate', async (req, res) => {
  if (!authorized(req as never)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { migrateHashrateSpenders } = await import('../services/levels');
    res.json({ ok: true, ...(await migrateHashrateSpenders()) });
  } catch (e) {
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
