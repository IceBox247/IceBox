import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { webhookCallback } from 'grammy';

import { config, hasBot } from './config';
import { authenticate } from './middleware/auth';
import { userRouter } from './routes/user';
import { tasksRouter } from './routes/tasks';
import { referralsRouter } from './routes/referrals';
import { withdrawalsRouter } from './routes/withdrawals';
import { stakingRouter } from './routes/staking';
import { checkinRouter } from './routes/checkin';
import { depositsRouter } from './routes/deposits';
import { miningRouter } from './routes/mining';
import { adminRouter } from './routes/admin';
import { dextopusWebhookHandler } from './routes/webhooks';
import { tokensRouter } from './routes/tokens';
import { walletLinkRouter } from './routes/walletLink';
import { cronRouter } from './routes/cron';
import { createBot } from './telegram/bot';

/**
 * Build the fully-configured Express app.
 *
 * The same app is used two ways:
 *  - Locally: `index.ts` calls `listen()` and (optionally) runs the bot via
 *    long polling.
 *  - On Vercel: `api/index.ts` exports the app as a serverless function, and
 *    the bot is driven by Telegram webhooks hitting `/api/bot`.
 */
export function createApp(): Express {
  const app = express();

  // Dextopus deposit webhook — mounted BEFORE the JSON parser with a raw body
  // parser so HMAC-SHA256 can run over the exact bytes Dextopus signed.
  app.all('/api/webhooks/dextopus', express.raw({ type: '*/*' }), dextopusWebhookHandler);

  app.use(express.json({ limit: '1mb' })); // room for small logo data URLs
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        // Same-origin deployments (web + api on one Vercel domain) send no
        // cross-origin requests; allow all when no explicit allowlist is set.
        return cb(null, config.corsOrigins.length === 0);
      },
      credentials: true,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: hasBot, mode: config.botMode, time: new Date().toISOString() });
  });

  // Telegram webhook — mounted BEFORE auth (Telegram doesn't send initData).
  if (hasBot && config.botMode === 'webhook') {
    const bot = createBot();
    if (bot) {
      app.use(
        '/api/bot',
        webhookCallback(bot, 'express', {
          secretToken: config.webhookSecret || undefined,
        }),
      );
    }
  }

  // Public token registry (used by the wallet-browser creator pages — no Telegram).
  app.use('/api/tokens', tokensRouter);

  // Public wallet-linking (the /connect.html page runs in the wallet's browser,
  // outside Telegram, so these can't sit behind Mini App auth).
  app.use('/api/wallet', walletLinkRouter);

  // Vercel Cron / operator endpoints — before auth, since neither caller has
  // Mini App initData. Guarded by CRON_SECRET instead.
  app.use('/api/cron', cronRouter);

  // Everything below requires a valid Telegram Mini App user.
  app.use('/api', authenticate);
  app.use('/api', userRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/referrals', referralsRouter);
  app.use('/api/withdrawals', withdrawalsRouter);
  app.use('/api/staking', stakingRouter);
  app.use('/api/checkin', checkinRouter);
  app.use('/api/deposits', depositsRouter);
  app.use('/api/mining', miningRouter);
  app.use('/api/admin', adminRouter);

  // Serve the built web app when co-located (local prod). On Vercel the static
  // frontend is served by the platform, so this directory won't exist there.
  const webDist = path.resolve(process.cwd(), 'web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
