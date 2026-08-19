import { config, hasBot } from '../config';

/**
 * Best-effort Telegram channel alerts (deposit + payout proof channels).
 * Posts via the Bot API sendMessage endpoint. Never throws into the caller —
 * an alert failing must not roll back a credited deposit or a sent payout.
 */

async function sendChannel(channel: string, text: string): Promise<void> {
  if (!hasBot || !channel) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
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
  await sendChannel(config.channels.deposit, text);
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
  await sendChannel(config.channels.payout, text);
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
  await sendChannel(config.channels.payout, text);
}
