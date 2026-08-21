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
      .url('📣 Join Channel', 'https://t.me/iceboxAi')
      .row()
      .url('💸 Payouts', 'https://t.me/IceBoxPayout')
      .url('📥 Deposits', 'https://t.me/IceBoxDeposit');

    await ctx.reply(
      [
        '❄️ *Welcome to IceBox Wallet*',
        '',
        'The first Telegram *no-fee* USD wallet.',
        '',
        '• Complete tasks to earn USD',
        `• Invite friends — earn *${config.referralReward} USD* per referral`,
        '• Instant withdrawals to your wallet',
        '',
        'Tap below to open the app 👇',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  });

  bot.command('invite', async (ctx) => {
    await ctx.reply(
      `Share your link and earn ${config.referralReward} USD per friend who joins!`,
    );
  });

  /**
   * /post — repost an admin's message to the MAIN channel with the "Open IceBox"
   * button attached (Telegram only allows inline buttons on bot-sent messages).
   * Usage: send the bot `/post <your text>`, or a photo whose caption starts
   * with `/post <text>`. Only admins of the main channel may use it.
   */
  bot.on('message', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const caption = ctx.message?.caption ?? '';
    const isPost = text.startsWith('/post') || caption.startsWith('/post');
    if (!isPost) return; // ignore everything that isn't a /post

    const channel = config.channels.main;
    if (!channel) {
      await ctx.reply('No MAIN_CHANNEL is configured.');
      return;
    }
    // Only channel admins/creator may broadcast.
    try {
      const member = await ctx.api.getChatMember(channel, ctx.from!.id);
      if (member.status !== 'administrator' && member.status !== 'creator') {
        await ctx.reply('Only an admin of the channel can use /post.');
        return;
      }
    } catch {
      await ctx.reply(
        `I can't check admins of ${channel}. Add me as an admin of that channel (with "Post Messages") and try again.`,
      );
      return;
    }

    const body = (text || caption).replace(/^\/post@?\w*\s*/i, '').trim();
    const keyboard = new InlineKeyboard().url(config.alerts.buttonText, config.alerts.buttonUrl);

    try {
      const photos = ctx.message?.photo;
      const CAPTION_MAX = 1024; // Telegram photo-caption limit
      const TEXT_MAX = 4096; // Telegram message limit
      const fileId = photos && photos.length > 0 ? photos[photos.length - 1].file_id : null;

      if (fileId && body.length <= CAPTION_MAX) {
        // Fits as a captioned photo with the button.
        await ctx.api.sendPhoto(channel, fileId, {
          caption: body || undefined,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else if (fileId) {
        // Caption too long: post the image first, then the full text (with the
        // button) as a separate message so nothing gets cut off.
        await ctx.api.sendPhoto(channel, fileId, {});
        await ctx.api.sendMessage(channel, body.slice(0, TEXT_MAX), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard,
        });
      } else {
        if (!body) {
          await ctx.reply('Add the text after /post, e.g. `/post Big news!`', {
            parse_mode: 'Markdown',
          });
          return;
        }
        await ctx.api.sendMessage(channel, body.slice(0, TEXT_MAX), {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard,
        });
      }
      await ctx.reply('✅ Posted to the channel with the Open IceBox button.');
    } catch (e) {
      await ctx.reply(
        `Couldn't post: ${e instanceof Error ? e.message : String(e)}. Make sure I'm an admin of ${channel} with post rights.`,
      );
    }
  });

  bot.catch((err) => {
    console.error('[bot] error', err.error);
  });

  return bot;
}
