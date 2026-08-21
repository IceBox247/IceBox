import { prisma } from '../db';

/**
 * Derive a public @username chat id from a t.me link so channel-join tasks can
 * be membership-verified via the Bot API. Returns null for private invite links
 * (t.me/+hash, t.me/joinchat/…) which have no public username — those need an
 * explicit numeric chatId set on the task instead.
 */
function chatIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})\/?$/.exec(url.trim());
  if (!m) return null; // t.me/+abc or t.me/joinchat/abc → not a public username
  const name = m[1];
  if (name.toLowerCase() === 'joinchat') return null;
  return '@' + name;
}

/**
 * Seed the default task list (mirrors the reference app's Tasks screen).
 * Idempotent: upserts by the stable `key`.
 */
const TASKS = [
  {
    key: 'join_channel',
    title: 'Join IceBox Channel',
    subtitle: 'Join our official channel',
    reward: 1.0,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/iceboxAi',
    chatId: '@iceboxAi',
    icon: 'telegram',
    sortOrder: 1,
  },
  {
    key: 'join_payment',
    title: 'Join IceBox Payout',
    subtitle: 'Join our payout channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/IceBoxPayout',
    chatId: '@IceBoxPayout',
    icon: 'telegram',
    sortOrder: 2,
  },
  {
    key: 'join_deposit',
    title: 'Join IceBox Deposit',
    subtitle: 'Join our deposit channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/IceBoxDeposit',
    chatId: '@IceBoxDeposit',
    icon: 'telegram',
    sortOrder: 3,
  },
  {
    key: 'join_seedly',
    title: 'Join Seedly Farm',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/seedlyfarm',
    icon: 'telegram',
    sortOrder: 4,
  },
  {
    key: 'join_onlineupdate',
    title: 'Join Online Update 247',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/onlineupdate_247',
    icon: 'telegram',
    sortOrder: 4,
  },
  {
    // Placeholder partner with no real channel — deactivated so users can't be
    // paid for a "join" we can't verify. Re-enable with a real t.me link + the
    // bot added as admin of that channel.
    key: 'join_sharkverse',
    title: 'Join SharkVerse',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/telegram',
    icon: 'telegram',
    sortOrder: 5,
    active: false,
  },
  {
    key: 'visit_website',
    title: 'Visit Website and Wait 15 Sec',
    subtitle: 'Visit our website',
    reward: 0.3,
    actionType: 'visit',
    actionLabel: 'Visit',
    url: 'https://telegram.org',
    icon: 'globe',
    waitSeconds: 15,
    sortOrder: 4,
  },
  {
    // Placeholder partner with no real channel — deactivated (see SharkVerse).
    key: 'join_devlab',
    title: 'Join Dev Crypto Lab',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/telegram',
    icon: 'telegram',
    sortOrder: 5,
    active: false,
  },
  {
    key: 'join_whatsapp',
    title: 'Join Whatsapp Channel',
    subtitle: 'Visit our channel',
    reward: 0.5,
    actionType: 'visit',
    actionLabel: 'Visit',
    url: 'https://whatsapp.com',
    icon: 'globe',
    sortOrder: 6,
  },
  {
    key: 'register_app',
    title: 'Register and Download App',
    subtitle: 'Visit our website',
    reward: 0.5,
    actionType: 'visit',
    actionLabel: 'Visit',
    url: 'https://telegram.org',
    icon: 'globe',
    sortOrder: 7,
  },
  {
    key: 'watch_ad',
    title: 'Watch & Click on Ad',
    subtitle: 'Watch 1 ad to earn rewards',
    reward: 0.5,
    actionType: 'watch',
    actionLabel: 'Watch',
    url: 'https://telegram.org',
    icon: 'play',
    waitSeconds: 5,
    maxCount: 5,
    sortOrder: 8,
  },
] as const;

export async function seedTasks() {
  for (const t of TASKS) {
    // Every Telegram "join" task must be membership-verifiable: use an explicit
    // chatId if given, otherwise derive @username from its t.me link. Non-join
    // tasks (visit/watch) stay unverified by nature.
    const explicit = 'chatId' in t ? (t.chatId as string | null) : null;
    const chatId = explicit ?? (t.actionType === 'join' ? chatIdFromUrl(t.url) : null);
    const active = 'active' in t ? (t.active as boolean) : true;
    const fields = {
      title: t.title,
      subtitle: t.subtitle,
      reward: t.reward,
      actionType: t.actionType,
      actionLabel: t.actionLabel,
      url: t.url,
      chatId,
      icon: t.icon,
      waitSeconds: 'waitSeconds' in t ? t.waitSeconds : 0,
      maxCount: 'maxCount' in t ? t.maxCount : 1,
      sortOrder: t.sortOrder,
      active,
    };
    await prisma.task.upsert({
      where: { key: t.key },
      update: fields,
      create: { key: t.key, ...fields },
    });
  }
  console.log(`[seed] ${TASKS.length} tasks upserted.`);
}

// Allow running directly: `tsx src/services/seed.ts`
if (require.main === module) {
  seedTasks()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
