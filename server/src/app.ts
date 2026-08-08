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
import { tokensRouter } from './routes/tokens';
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
  app.use(express.json());
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

  // Everything below requires a valid Telegram Mini App user.
  app.use('/api', authenticate);
  app.use('/api', userRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/referrals', referralsRouter);
  app.use('/api/withdrawals', withdrawalsRouter);

  // Serve the built web app when co-located (local prod). On Vercel the static
  // frontend is served by the platform, so this directory won't exist there.
  const webDist = path.resolve(process.cwd(), 'web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
