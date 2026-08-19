import { config, hasBot } from '../config';

/**
 * Best-effort Telegram channel alerts (deposit + payout proof channels).
 * Posts via the Bot API sendMessage endpoint. Never throws into the caller —
 * an alert failing must not roll back a credited deposit or a sent payout.
 */

/** Inline keyboard with the "Open IceBox" button under every alert. */
function replyMarkup() {
  return {
    inline_keyboard: [[{ text: config.alerts.buttonText, url: config.alerts.buttonUrl }]],
  };
}

/**
 * Post an alert to a channel: a photo with the caption when an image is
 * configured (falls back to a text message), always with the Open IceBox
 * button below it. Best-effort — never throws.
 */
async function sendChannel(channel: string, text: string, image?: string): Promise<void> {
  if (!hasBot || !channel) return;
  const photo = image || config.alerts.image;
  const reply_markup = replyMarkup();
  const method = photo ? 'sendPhoto' : 'sendMessage';
  const body = photo
    ? { chat_id: channel, photo, caption: text, parse_mode: 'HTML', reply_markup }
    : { chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup };
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Telegram answers 400/403 with { ok:false, description } instead of throwing,
    // so surface the real reason (e.g. "chat not found", "bot is not a member",
    // "not enough rights to send photos") to the logs — invaluable for debugging.
    if (!res.ok) {
      const info: any = await res.json().catch(() => ({}));
      console.error(
        `[notify] ${method} to "${channel}" failed: ${res.status} ${info?.description ?? ''}`.trim(),
      );
    }
  } catch (e) {
    console.error('[notify] channel post failed', e);
  }
}

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function txLink(hash?: string | null): string {
  if (!hash) return '';
  return `\n🔗 <a href="${config.explorerBase}/tx/${hash}">View transaction</a>`;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 🟢 New deposit → Deposit Channel. */
export async function alertDeposit(params: {
  amount: number;
  asset?: string | null;
  chain?: string | null;
  name?: string | null;
  txHash?: string | null;
}): Promise<void> {
  const asset = params.asset || 'USDT';
  const who = params.name ? `\n👤 ${params.name}` : '';
  const text =
    `🟢 <b>New Deposit</b>\n\n` +
    `💰 Amount: <b>${money(params.amount)} ICE USD</b>\n` +
    `🪙 Asset: ${asset}${params.chain ? ` (${params.chain})` : ''}` +
    who +
    txLink(params.txHash) +
    `\n\n#deposit #IceBox`;
  await sendChannel(config.channels.deposit, text, config.alerts.depositImage);
}

/** ❄️ ICE token withdrawal → Payout Channel. */
export async function alertIceWithdrawal(params: {
  amount: number;
  address: string;
  txHash?: string | null;
}): Promise<void> {
  const text =
    `❄️ <b>ICE Token Withdrawal</b>\n\n` +
    `💎 Amount: <b>${money(params.amount)} ICE</b>\n` +
    `📤 To: <code>${shortAddr(params.address)}</code>` +
    txLink(params.txHash) +
    `\n\n#IceWithdrawal #IceBox`;
  await sendChannel(config.channels.payout, text, config.alerts.payoutImage);
}

/** 💵 USDT withdrawal → Payout Channel. */
export async function alertUsdtWithdrawal(params: {
  amount: number;
  address: string;
  txHash?: string | null;
}): Promise<void> {
  const text =
    `💵 <b>USDT Withdrawal</b>\n\n` +
    `💰 Amount: <b>${money(params.amount)} USDT</b>\n` +
    `📤 To: <code>${shortAddr(params.address)}</code>` +
    txLink(params.txHash) +
    `\n\n#UsdtWithdrawal #IceBox`;
  await sendChannel(config.channels.payout, text, config.alerts.payoutImage);
}
