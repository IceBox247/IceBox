import { prisma } from '../db';

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
    key: 'join_sharkverse',
    title: 'Join SharkVerse',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/telegram',
    icon: 'telegram',
    sortOrder: 5,
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
    key: 'join_devlab',
    title: 'Join Dev Crypto Lab',
    subtitle: 'Join our partner channel',
    reward: 0.5,
    actionType: 'join',
    actionLabel: 'Join',
    url: 'https://t.me/telegram',
    icon: 'telegram',
    sortOrder: 5,
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
    await prisma.task.upsert({
      where: { key: t.key },
      update: {
        title: t.title,
        subtitle: t.subtitle,
        reward: t.reward,
        actionType: t.actionType,
        actionLabel: t.actionLabel,
        url: t.url,
        chatId: 'chatId' in t ? t.chatId : null,
        icon: t.icon,
        waitSeconds: 'waitSeconds' in t ? t.waitSeconds : 0,
        maxCount: 'maxCount' in t ? t.maxCount : 1,
        sortOrder: t.sortOrder,
        active: true,
      },
      create: {
        key: t.key,
        title: t.title,
        subtitle: t.subtitle,
        reward: t.reward,
        actionType: t.actionType,
        actionLabel: t.actionLabel,
        url: t.url,
        chatId: 'chatId' in t ? t.chatId : null,
        icon: t.icon,
        waitSeconds: 'waitSeconds' in t ? t.waitSeconds : 0,
        maxCount: 'maxCount' in t ? t.maxCount : 1,
        sortOrder: t.sortOrder,
        active: true,
      },
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
