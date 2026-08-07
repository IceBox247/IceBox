import { config, hasBot } from './config';
import { prisma } from './db';
import { createApp } from './app';
import { createBot } from './telegram/bot';
import { seedTasks } from './services/seed';

/**
 * Local / long-running server entry point.
 * Seeds tasks, starts Express, and runs the bot via long polling.
 * (On Vercel the app is served from `api/index.ts` and the bot uses webhooks —
 * this file is not used there.)
 */
async function main() {
  await seedTasks();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    if (config.devAllowUnsigned) {
      console.warn('[server] DEV_ALLOW_UNSIGNED is on — do NOT use in production.');
    }
  });

  if (hasBot && config.botMode === 'polling') {
    const bot = createBot();
    if (bot) {
      // Ensure no webhook is set when we long-poll.
      await bot.api.deleteWebhook().catch(() => undefined);
      bot.start({ onStart: (me) => console.log(`[bot] @${me.username} polling`) });
    }
  }
}

main().catch(async (err) => {
  console.error('fatal', err);
  await prisma.$disconnect();
  process.exit(1);
});
