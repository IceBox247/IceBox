import { config } from '../config';
import { checkMembership } from '../telegram/verify';

/**
 * Return the subset of `channels` the user is NOT a member of. Used to gate
 * mining/withdrawals on Telegram-channel membership. When the bot can't verify a
 * channel (it isn't an admin / transient error) we treat it as a PASS unless
 * GATE_STRICT is on, so a misconfigured channel never bricks the whole app.
 */
export async function missingChannels(telegramId: string, channels: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const ch of channels) {
    if (!ch) continue;
    const m = await checkMembership(ch, telegramId);
    if (m === 'not_member') missing.push(ch);
    else if (m === 'error' && config.gate.strict) missing.push(ch);
  }
  return missing;
}

/** Channels required to collect mined ICE (empty = no gate). */
export function miningGateChannels(): string[] {
  if (!config.gate.enabled || !config.gate.miningChannel) return [];
  return [config.gate.miningChannel];
}

/** Channels required to withdraw (empty = no gate). */
export function withdrawGateChannels(): string[] {
  if (!config.gate.enabled) return [];
  return config.gate.withdrawChannels;
}

/** Build a friendly t.me link from an @username or a full link. */
export function channelLink(ch: string): string {
  const s = ch.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://t.me/${s.replace(/^@/, '')}`;
}
