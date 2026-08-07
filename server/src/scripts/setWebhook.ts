import { Bot } from 'grammy';
import { config, hasBot } from '../config';

/**
 * Register (or clear) the Telegram webhook for the deployed bot.
 *
 *   npm run set-webhook --workspace=server            # set to <PUBLIC_URL>/api/bot
 *   npm run set-webhook --workspace=server -- --delete # remove the webhook
 *
 * Requires BOT_TOKEN and PUBLIC_URL (or WEBAPP_URL) in the environment, plus an
 * optional TELEGRAM_WEBHOOK_SECRET that must match the server's.
 */
async function main() {
  if (!hasBot) throw new Error('BOT_TOKEN is not set');
  const bot = new Bot(config.botToken);
  const del = process.argv.includes('--delete');

  if (del) {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Webhook deleted.');
    return;
  }

  const base = config.publicUrl.replace(/\/$/, '');
  if (!base) throw new Error('PUBLIC_URL (or WEBAPP_URL) is not set');
  const url = `${base}/api/bot`;

  await bot.api.setWebhook(url, {
    secret_token: config.webhookSecret || undefined,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  console.log(`✅ Webhook set to ${url}`);
  const info = await bot.api.getWebhookInfo();
  console.log('   pending updates:', info.pending_update_count);
}

main().catch((e) => {
  console.error('❌', e.message ?? e);
  process.exit(1);
});
