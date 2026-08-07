import { Bot, InlineKeyboard } from 'grammy';
import { config, hasBot } from '../config';

/**
 * Telegram bot: greets users, deep-links referral codes, and opens the Mini App.
 * `/start ref_<code>` carries the referrer through to the web app via startapp.
 */
export function createBot(): Bot | null {
  if (!hasBot) {
    console.warn('[bot] BOT_TOKEN not set — Telegram bot disabled.');
    return null;
  }

  const bot = new Bot(config.botToken);

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim();
    const startapp = payload ? `?startapp=${encodeURIComponent(payload)}` : '';
    const url = `${config.webAppUrl}${startapp}`;

    const keyboard = new InlineKeyboard()
      .webApp('❄️ Open IceBox Wallet', url)
      .row()
      .url('📣 Join Channel', 'https://t.me/telegram');

    await ctx.reply(
      [
        '❄️ *Welcome to IceBox Wallet*',
        '',
        'The first Telegram *no-fee* USDT wallet.',
        '',
        '• Complete tasks to earn USDT',
        `• Invite friends — earn *${config.referralReward} USDT* per referral`,
        '• Instant withdrawals to your wallet',
        '',
        'Tap below to open the app 👇',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  bot.command('invite', async (ctx) => {
    await ctx.reply(
      `Share your link and earn ${config.referralReward} USDT per friend who joins!`,
    );
  });

  bot.catch((err) => {
    console.error('[bot] error', err.error);
  });

  return bot;
}
