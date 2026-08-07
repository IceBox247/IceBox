import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { config, hasBot } from './config.js';
import { prisma } from './db.js';
import { authenticate } from './middleware/auth.js';
import { userRouter } from './routes/user.js';
import { tasksRouter } from './routes/tasks.js';
import { referralsRouter } from './routes/referrals.js';
import { withdrawalsRouter } from './routes/withdrawals.js';
import { createBot } from './telegram/bot.js';
import { seedTasks } from './services/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await seedTasks();

  const app = express();
  app.use(express.json());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin/no-origin (mobile webviews) and configured origins.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, config.corsOrigins.length === 0);
      },
      credentials: true,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: hasBot, time: new Date().toISOString() });
  });

  // All /api routes below require a valid Telegram user.
  app.use('/api', authenticate);
  app.use('/api', userRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/referrals', referralsRouter);
  app.use('/api/withdrawals', withdrawalsRouter);

  // Serve the built web app in production if it exists.
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    console.log('[server] serving web app from', webDist);
  }

  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    if (config.devAllowUnsigned) {
      console.warn('[server] DEV_ALLOW_UNSIGNED is on — do NOT use in production.');
    }
  });

  // Start the Telegram bot (long polling). For production, prefer webhooks.
  const bot = createBot();
  if (bot) {
    bot.start({ onStart: (me) => console.log(`[bot] @${me.username} started`) });
  }
}

main().catch(async (err) => {
  console.error('fatal', err);
  await prisma.$disconnect();
  process.exit(1);
});
