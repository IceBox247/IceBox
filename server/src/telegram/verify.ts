import { config, hasBot } from '../config';

export type Membership = 'member' | 'not_member' | 'error';

/**
 * Check whether a Telegram user is a member of a channel/group via the Bot API.
 * The bot must be an ADMIN of the chat for this to work on channels.
 *
 * Returns:
 *  - 'member'      the user is in the chat (creator/admin/member/restricted)
 *  - 'not_member'  the user has left or was never in / was removed
 *  - 'error'       the check couldn't run (bot not admin, chat not found, etc.)
 */
export async function checkMembership(
  chatId: string,
  userId: string | number,
): Promise<Membership> {
  if (!hasBot) return 'error';
  try {
    const url =
      `https://api.telegram.org/bot${config.botToken}/getChatMember` +
      `?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(userId))}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { status?: string };
      description?: string;
    };
    if (!data.ok) {
      console.warn('[verify] getChatMember failed for', chatId, '-', data.description);
      return 'error';
    }
    const status = data.result?.status;
    if (status && ['creator', 'administrator', 'member', 'restricted'].includes(status)) {
      return 'member';
    }
    return 'not_member'; // 'left' | 'kicked'
  } catch (err) {
    console.error('[verify] getChatMember error', err);
    return 'error';
  }
}
