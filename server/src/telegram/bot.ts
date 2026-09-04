import { Bot, InlineKeyboard, type Context } from 'grammy';
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
  bot.on('message', async (ctx, next) => {
    const text = ctx.message?.text ?? '';
    const caption = ctx.message?.caption ?? '';
    const isPost = text.startsWith('/post') || caption.startsWith('/post');
    // Not a /post: hand the update on. Returning without calling next() would
    // halt the middleware chain and swallow every command registered below.
    if (!isPost) return next();

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

  /**
   * Operator tools. `/withdrawals [n]` lists the most recent payouts with the
   * account behind each one and a ban button, so an abusive account can be
   * identified and stopped from Telegram during an incident — without needing
   * the database or the cron endpoints.
   *
   * Access: an id in ADMIN_TELEGRAM_IDS, or an admin/creator of MAIN_CHANNEL.
   */
  async function isOperator(ctx: Context): Promise<boolean> {
    const { isAdminTelegramId } = await import('../services/admin');
    if (isAdminTelegramId(ctx.from?.id)) return true;
    const channel = config.channels.main;
    if (!channel || !ctx.from) return false;
    try {
      const m = await ctx.api.getChatMember(channel, ctx.from.id);
      return m.status === 'administrator' || m.status === 'creator';
    } catch {
      return false;
    }
  }

  /**
   * Send a long report as however many messages it takes. Telegram caps one
   * message at 4096 characters, so a single reply silently truncated the tail —
   * which hid exactly the accounts an operator needs to see.
   */
  async function sendPaged(ctx: Context, lines: string[], header: string) {
    const LIMIT = 3500; // headroom under Telegram's 4096
    const MAX_PAGES = 25; // stop runaway floods
    let buf = '';
    let page = 0;
    const flush = async () => {
      if (!buf.trim()) return;
      page++;
      await ctx.reply(buf, { parse_mode: 'HTML' });
      buf = '';
      // Stay well inside Telegram's per-chat rate limit.
      await new Promise((r) => setTimeout(r, 350));
    };
    buf = header + '\n\n';
    for (const line of lines) {
      if (page >= MAX_PAGES) break;
      if (buf.length + line.length + 1 > LIMIT) await flush();
      buf += line + '\n';
    }
    await flush();
    if (page >= MAX_PAGES) {
      await ctx.reply('… output truncated at ' + MAX_PAGES + ' messages. Narrow the query.');
    }
  }

  /** "Ada (@ada) · id 42 · tg 12345" — whatever identity we actually have. */
  function describe(u: {
    id: number;
    username: string | null;
    firstName: string | null;
    telegramId: string;
  }): string {
    const name = [u.firstName].filter(Boolean).join(' ') || 'no name';
    const handle = u.username ? `@${u.username}` : 'no username';
    return `${name} (${handle}) · id ${u.id} · tg ${u.telegramId}`;
  }

  bot.command('withdrawals', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { prisma, money } = await import('../db');
    const n = Math.min(20, Math.max(1, Number(ctx.match?.trim()) || 10));

    const rows = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      take: n,
      include: { user: true },
    });
    if (rows.length === 0) {
      await ctx.reply('No withdrawals yet.');
      return;
    }

    const lines: string[] = [`<b>Last ${rows.length} withdrawals</b>`, ''];
    const seen = new Map<number, string>();
    for (const w of rows) {
      const u = w.user;
      if (!seen.has(u.id)) seen.set(u.id, u.username ? `@${u.username}` : `id ${u.id}`);
      const when = new Date(w.createdAt).toISOString().replace('T', ' ').slice(5, 16);
      lines.push(
        `<b>${money(w.amount).toFixed(2)} ${w.token.toUpperCase()}</b> · ${w.status}` +
          `${u.frozenAt ? ' · <b>FROZEN</b>' : ''}\n` +
          `${describe(u)}\n` +
          `bal ${money(u.balance).toFixed(2)} · ${when} UTC\n` +
          `<code>${w.address}</code>`,
        '',
      );
    }

    // One ban row per distinct account in the list.
    const keyboard = new InlineKeyboard();
    for (const [userId, label] of seen) {
      keyboard.text(`🚫 Ban ${label}`, `ban:${userId}`).row();
      keyboard.text(`💣 Ban + zero ${label}`, `banzero:${userId}`).row();
    }

    await ctx.reply(lines.join('\n').slice(0, 4096), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  /** Ban (freeze withdrawals), optionally zeroing the balance too. */
  bot.callbackQuery(/^ban(zero)?:(\d+)$/, async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.answerCallbackQuery({ text: 'Operators only.', show_alert: true });
      return;
    }
    const zero = Boolean(ctx.match?.[1]);
    const userId = Number(ctx.match?.[2]);
    const { prisma, money } = await import('../db');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await ctx.answerCallbackQuery({ text: 'User not found.', show_alert: true });
      return;
    }

    const reason = `banned from Telegram by ${ctx.from?.id ?? 'operator'}`;
    const zeroed = zero ? money(user.balance) : 0;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          frozenAt: new Date(),
          frozenReason: reason,
          ...(zero ? { balance: 0, earnedBalance: 0 } : {}),
        },
      });
      if (zero && zeroed > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId,
            amount: -zeroed,
            reason: 'operator_freeze_zero',
            meta: JSON.stringify({ admin: true, via: 'telegram' }),
          },
        });
      }
    });

    await ctx.answerCallbackQuery({
      text: zero ? `Banned. Balance ${zeroed.toFixed(2)} cleared.` : 'Banned — withdrawals blocked.',
      show_alert: true,
    });
    await ctx.reply(
      `🚫 <b>Banned</b> ${describe(user)}` +
        (zero ? `\nBalance cleared: <b>${zeroed.toFixed(2)}</b>` : '') +
        `\n\nWithdrawals are now blocked for this account. Undo with <code>/unban ${userId}</code>.`,
      { parse_mode: 'HTML' },
    );
  });

  /**
   * /usdt [n] — accounts holding USDT-withdrawable balance, biggest first.
   *
   * That bucket is `balance - earnedBalance`, and it is what the USDT rail pays
   * out as real money. Each row also shows what the account actually deposited,
   * so funds that arrived without a deposit behind them stand out.
   */
  bot.command('usdt', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { prisma, money } = await import('../db');
    const n = Math.min(2000, Math.max(1, Number(ctx.match?.trim()) || 500));

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number;
        username: string | null;
        firstName: string | null;
        telegramId: string;
        balance: number;
        earnedBalance: number;
        frozenAt: Date | null;
        createdAt: Date;
      }>
    >(
      'SELECT id, username, "firstName", "telegramId", balance, "earnedBalance", "frozenAt", "createdAt" ' +
        'FROM "User" WHERE (balance - "earnedBalance") > 0.005 ' +
        'ORDER BY (balance - "earnedBalance") DESC LIMIT ' + n,
    );
    if (rows.length === 0) {
      await ctx.reply('No account is holding USDT-withdrawable balance.');
      return;
    }

    // What each of them actually deposited, so phantom funds are obvious.
    const deposited = new Map<number, number>();
    const sums = await prisma.deposit.groupBy({
      by: ['userId'],
      where: { userId: { in: rows.map((r) => r.id) }, credited: true },
      _sum: { creditedAmount: true },
    });
    for (const d of sums) deposited.set(d.userId, money(d._sum.creditedAmount ?? 0));

    const out: string[] = [];
    let phantomTotal = 0;
    for (const r of rows) {
      const usdt = money(r.balance - r.earnedBalance);
      const real = deposited.get(r.id) ?? 0;
      const phantom = money(Math.max(0, usdt - real));
      phantomTotal = money(phantomTotal + phantom);
      const flag = real === 0 ? ' ⚠️ <b>never deposited</b>' : phantom > 0.01 ? ' ⚠️' : '';
      out.push(
        '<b>' + usdt.toFixed(2) + ' USDT</b>' + (r.frozenAt ? ' · <b>FROZEN</b>' : '') + flag,
        describe(r) + ' · joined ' + new Date(r.createdAt).toISOString().slice(0, 10),
        'really sent ' + real.toFixed(2) + ' on chain' +
          (phantom > 0.01 ? ' · phantom <b>' + phantom.toFixed(2) + '</b>' : '') +
          ' · /ban ' + r.id,
        '',
      );
    }
    await sendPaged(
      ctx,
      out,
      '<b>USDT-withdrawable balances</b> (' + rows.length + ' accounts, phantom ' +
        phantomTotal.toFixed(2) + ')',
    );
  });

  /** /ice [n] — biggest earned (ICE-withdrawable) balances. */
  bot.command('ice', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { prisma, money } = await import('../db');
    const n = Math.min(30, Math.max(1, Number(ctx.match?.trim()) || 15));

    const rows = await prisma.user.findMany({
      where: { earnedBalance: { gt: 0.005 } },
      orderBy: { earnedBalance: 'desc' },
      take: n,
    });
    if (rows.length === 0) {
      await ctx.reply('No account is holding earned ICE.');
      return;
    }

    const out = ['<b>Largest ICE (earned) balances</b>', ''];
    for (const r of rows) {
      out.push(
        '<b>' + money(r.earnedBalance).toFixed(2) + ' ICE</b>' +
          (r.frozenAt ? ' · <b>FROZEN</b>' : ''),
        describe(r) + ' · joined ' + new Date(r.createdAt).toISOString().slice(0, 10),
        'total balance ' + money(r.balance).toFixed(2) + ' · /ban ' + r.id,
        '',
      );
    }
    await ctx.reply(out.join('\n').slice(0, 4096), { parse_mode: 'HTML' });
  });

  /**
   * /deposits [n] — every credited deposit: what actually arrived on chain
   * against what was credited to the account, with a ban shortcut per row.
   * A healthy row sits at ~1x; the 1e6 over-credit shows as a huge ratio.
   */
  bot.command('deposits', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { depositReport } = await import('../services/admin');
    const n = Math.min(30, Math.max(1, Number(ctx.match?.trim()) || 15));
    const rows = await depositReport(n);
    if (rows.length === 0) {
      await ctx.reply('No credited deposits yet.');
      return;
    }

    const out = ['<b>Deposits — on-chain vs credited</b>', ''];
    for (const d of rows) {
      out.push(
        (d.suspicious ? '⚠️ ' : '') +
          'sent <b>' + d.sent.toFixed(2) + '</b> → credited <b>' + d.credited.toFixed(2) + '</b>' +
          (d.ratio !== null && d.ratio > 1 ? ' (' + d.ratio + 'x)' : '') +
          (d.frozen ? ' · <b>FROZEN</b>' : ''),
        (d.username ? '@' + d.username : d.firstName || 'no name') +
          ' · id ' + d.userId + ' · tg ' + d.telegramId,
        'bal ' + d.balanceNow.toFixed(2) + ' · ' +
          new Date(d.createdAt).toISOString().slice(0, 16).replace('T', ' ') +
          ' · /ban ' + d.userId,
        '',
      );
    }
    await ctx.reply(out.join('\n').slice(0, 4096), { parse_mode: 'HTML' });
  });

  /**
   * /affected — every account touched by the 1e6 deposit over-credit: the
   * inflated deposits AND the referrers paid a commission out of them.
   */
  bot.command('affected', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { affectedReport } = await import('../services/admin');
    const r = await affectedReport(25);
    if (r.deposits === 0) {
      await ctx.reply('✅ No over-credited deposits found.');
      return;
    }

    const out = [
      '<b>Accounts affected by the deposit over-credit</b>',
      '',
      'Bad deposits: <b>' + r.deposits + '</b>',
      'Over-credited: <b>' + r.overCredited.toFixed(2) + '</b>',
      'Commission paid out of it: <b>' + r.commissionPaid.toFixed(2) + '</b>',
      '',
      '<b>— Deposits —</b>',
      '',
    ];
    for (const d of r.rows) {
      const who = d.depositor;
      out.push(
        'sent <b>' + d.sent.toFixed(2) + '</b> → credited <b>' + d.credited.toFixed(2) + '</b>' +
          (who?.frozen ? ' · <b>FROZEN</b>' : ''),
        who
          ? (who.username ? '@' + who.username : who.firstName || 'no name') +
            ' · id ' + who.userId + ' · bal ' + who.balanceNow.toFixed(2) + ' · /ban ' + who.userId
          : 'unknown account',
      );
      for (const c of d.commissions) {
        out.push(
          '   ↳ L' + c.level + ' commission <b>' + c.amount.toFixed(2) + '</b> → ' +
            (c.username ? '@' + c.username : c.firstName || 'id ' + c.userId) +
            ' · /ban ' + c.userId,
        );
      }
      out.push('');
    }
    if (r.referrers.length) {
      out.push('<b>— Referrers who earned from it —</b>', '');
      for (const f of r.referrers) {
        out.push(
          '<b>' + f.commissionEarned.toFixed(2) + '</b> from ' + f.fromDeposits + ' deposit(s)' +
            (f.frozen ? ' · <b>FROZEN</b>' : ''),
          (f.username ? '@' + f.username : f.firstName || 'no name') +
            ' · id ' + f.userId + ' · bal ' + f.balanceNow.toFixed(2) + ' · /ban ' + f.userId,
          '',
        );
      }
    }
    await ctx.reply(out.join('\n').slice(0, 4096), { parse_mode: 'HTML' });
  });

  /**
   * /purge — clear every phantom balance in one action, rather than banning
   * accounts one id at a time.
   *
   * Shows what would be removed and waits for a confirmation tap; nothing
   * changes until the button is pressed. Each account keeps whatever it really
   * deposited on chain, so genuine depositors are not penalised, and accounts
   * that never deposited at all are frozen as well.
   */
  bot.command('purge', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { phantomScan } = await import('../services/admin');
    const scan = await phantomScan();
    if (scan.accounts === 0) {
      await ctx.reply('✅ No phantom balance found — every withdrawable balance is backed by a real deposit.');
      return;
    }

    const preview = scan.targets
      .slice(0, 20)
      .map(
        (t) =>
          '<b>' + t.phantom.toFixed(2) + '</b> · ' +
          (t.username ? '@' + t.username : t.firstName || 'id ' + t.userId) +
          ' (id ' + t.userId + ')' +
          (t.neverDeposited ? ' · never deposited' : ' · really sent ' + t.realDeposited.toFixed(2)),
      );
    if (scan.targets.length > preview.length) {
      preview.push('… and ' + (scan.targets.length - preview.length) + ' more');
    }

    await ctx.reply(
      [
        '<b>Phantom balance sweep — preview</b>',
        '',
        'Accounts affected: <b>' + scan.accounts + '</b>',
        'Never deposited at all: <b>' + scan.neverDeposited + '</b>',
        'Total to remove: <b>' + scan.totalPhantom.toFixed(2) + '</b>',
        scan.unknown.length
          ? 'Skipped (no on-chain amount recorded): <b>' + scan.unknown.length + '</b>'
          : '',
        '',
        ...preview,
        '',
        'Each account keeps what it really deposited. Nothing has changed yet.',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 4096),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('💣 Clear all ' + scan.accounts + ' now', 'purge:go')
          .row()
          .text('Cancel', 'purge:cancel'),
      },
    );
  });

  bot.callbackQuery('purge:cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Cancelled — nothing changed.' });
  });

  bot.callbackQuery('purge:go', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.answerCallbackQuery({ text: 'Operators only.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Clearing…' });
    const { phantomPurge } = await import('../services/admin');
    const r = await phantomPurge();
    await ctx.reply(
      [
        '✅ <b>Phantom balance cleared</b>',
        '',
        'Accounts adjusted: <b>' + r.cleared + '</b>',
        'Frozen (never deposited): <b>' + r.frozen + '</b>',
        'Removed: <b>' + r.removed.toFixed(2) + '</b>',
        r.unknown ? 'Skipped, no on-chain amount: <b>' + r.unknown + '</b>' : '',
        r.remaining ? '⏳ <b>' + r.remaining + '</b> more remain — run /purgeall to finish.' : '',
        '',
        'Recorded in the ledger as <code>phantom_purge</code>.',
        'Run /traced to see phantom money that was already spent or withdrawn.',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  /**
   * /purgeall — clear ALL phantom balance in one command, no button.
   *
   * Runs the batched purge repeatedly until nothing remains, so a large cleanup
   * finishes in a single command even though each batch is kept short enough to
   * survive the serverless time limit. Idempotent and safe to re-run.
   */
  bot.command('purgeall', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { phantomPurge } = await import('../services/admin');
    await ctx.reply('⏳ Clearing all phantom balances…');
    const r = await phantomPurge();
    await ctx.reply(
      [
        '✅ <b>Phantom purge complete</b>',
        '',
        'Accounts adjusted: <b>' + r.cleared + '</b>',
        'Frozen (never deposited): <b>' + r.frozen + '</b>',
        'Total removed: <b>' + r.removed.toFixed(2) + '</b>',
        r.unknown ? 'Skipped, no on-chain amount: <b>' + r.unknown + '</b>' : '',
        '',
        'Recorded in the ledger as <code>phantom_purge</code>.',
        'Run /usdt to confirm what is left, /traced for money already spent.',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  /**
   * /traced — follow the phantom money, including what was already spent.
   *
   * A balance sweep alone misses accounts that converted phantom credit into
   * ICE, a mining level or a stake: those all drain the same bucket, so the
   * account ends up with a small balance and looks innocent.
   */
  bot.command('traced', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const { phantomTrace } = await import('../services/admin');
    const t = await phantomTrace();
    if (t.accounts === 0) {
      await ctx.reply('✅ No account was ever credited phantom money.');
      return;
    }

    const lines: string[] = [];
    for (const r of t.rows) {
      const parts: string[] = [];
      if (r.withdrawable > 0.01) parts.push('still holds ' + r.withdrawable.toFixed(2));
      if (r.spentOnIce > 0.01) parts.push('⛏ ICE/levels ' + r.spentOnIce.toFixed(2));
      if (r.staked > 0.01) parts.push('🔒 staked ' + r.staked.toFixed(2));
      if (r.withdrawn > 0.01) parts.push('🚨 withdrawn ' + r.withdrawn.toFixed(2));
      lines.push(
        '<b>' + r.phantomIn.toFixed(2) + ' phantom</b>' +
          (r.fromCommission > 0.01 ? ' (' + r.fromCommission.toFixed(2) + ' commission)' : '') +
          (r.frozen ? ' · <b>FROZEN</b>' : ''),
        (r.username ? '@' + r.username : r.firstName || 'no name') +
          ' · id ' + r.userId + ' · tg ' + r.telegramId,
        parts.length ? parts.join(' · ') : 'untouched',
        '/ban ' + r.userId,
        '',
      );
    }

    await sendPaged(
      ctx,
      lines,
      [
        '<b>Where the phantom money went</b>',
        'Accounts: <b>' + t.accounts + '</b> · credited <b>' + t.totalIn.toFixed(2) + '</b>',
        'Still on balances: <b>' + t.totalLeft.toFixed(2) + '</b>',
        'Already withdrawn (gone): <b>' + t.totalWithdrawn.toFixed(2) + '</b>',
      ].join('\n'),
    );
  });

  /** /ban <userId> [zero] — ban from a list, without needing a button. */
  bot.command('ban', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const parts = (ctx.match?.trim() ?? '').split(/\s+/);
    const userId = Number(parts[0]);
    const zero = parts[1]?.toLowerCase() === 'zero';
    if (!Number.isInteger(userId) || userId <= 0) {
      await ctx.reply('Usage: /ban <userId> [zero]');
      return;
    }
    const { prisma, money } = await import('../db');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await ctx.reply('User not found.');
      return;
    }
    const zeroed = zero ? money(user.balance) : 0;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          frozenAt: new Date(),
          frozenReason: 'banned from Telegram by ' + (ctx.from?.id ?? 'operator'),
          ...(zero ? { balance: 0, earnedBalance: 0 } : {}),
        },
      });
      if (zero && zeroed > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId,
            amount: -zeroed,
            reason: 'operator_freeze_zero',
            meta: JSON.stringify({ admin: true, via: 'telegram' }),
          },
        });
      }
    });
    await ctx.reply(
      '🚫 <b>Banned</b> ' + describe(user) +
        (zero ? '\nBalance cleared: <b>' + zeroed.toFixed(2) + '</b>' : '') +
        '\n\nUndo with <code>/unban ' + userId + '</code>.',
      { parse_mode: 'HTML' },
    );
  });

  bot.command('unban', async (ctx) => {
    if (!(await isOperator(ctx))) {
      await ctx.reply('Operators only.');
      return;
    }
    const userId = Number(ctx.match?.trim());
    if (!Number.isInteger(userId) || userId <= 0) {
      await ctx.reply('Usage: /unban <userId>');
      return;
    }
    const { prisma } = await import('../db');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await ctx.reply('User not found.');
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { frozenAt: null, frozenReason: null },
    });
    await ctx.reply(`✅ Unbanned ${describe(user)}. Balance is unchanged.`);
  });

  bot.catch((err) => {
    console.error('[bot] error', err.error);
  });

  return bot;
}
