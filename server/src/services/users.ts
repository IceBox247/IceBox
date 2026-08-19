import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma, money } from '../db';
import { config } from '../config';
import type { TelegramUser } from '../telegram/initData';

/** Generate a short, URL-safe referral code. */
function generateReferralCode(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

/**
 * Resolve a referral start param into the referrer's user id, if any.
 * The start param may be a raw referral code or "ref_<code>".
 */
async function resolveReferrer(
  startParam: string | undefined,
  selfTelegramId: string,
): Promise<User | null> {
  if (!startParam) return null;
  const code = startParam.startsWith('ref_') ? startParam.slice(4) : startParam;
  if (!code) return null;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
  if (!referrer) return null;
  if (referrer.telegramId === selfTelegramId) return null; // no self-referral
  return referrer;
}

/**
 * Find or create a user from validated Telegram identity.
 * On first creation: grant signup bonus and (if referred) pay the referrer.
 */
export async function findOrCreateUser(
  tgUser: TelegramUser,
  startParam?: string,
): Promise<User> {
  const telegramId = String(tgUser.id);

  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    // Keep profile fields fresh.
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username: tgUser.username ?? existing.username,
        firstName: tgUser.first_name ?? existing.firstName,
        lastName: tgUser.last_name ?? existing.lastName,
        photoUrl: tgUser.photo_url ?? existing.photoUrl,
      },
    });
  }

  const referrer = await resolveReferrer(startParam, telegramId);

  // Ensure a unique referral code (retry on the astronomically rare clash).
  let referralCode = generateReferralCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.user.findUnique({ where: { referralCode } });
    if (!clash) break;
    referralCode = generateReferralCode();
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        telegramId,
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
        photoUrl: tgUser.photo_url,
        referralCode,
        referredById: referrer?.id ?? null,
        balance: money(config.signupBonus),
        // Signup bonus is earned (not deposited), so it can't go into the tiers.
        earnedBalance: money(config.signupBonus),
        totalEarned: money(config.signupBonus),
      },
    });

    if (config.signupBonus > 0) {
      await tx.ledgerEntry.create({
        data: { userId: user.id, amount: money(config.signupBonus), reason: 'signup_bonus' },
      });
    }

    // Reward the referrer once, at signup.
    if (referrer) {
      const reward = money(config.referralReward);
      await tx.user.update({
        where: { id: referrer.id },
        data: {
          balance: { increment: reward },
          earnedBalance: { increment: reward }, // referral reward is earned
          totalEarned: { increment: reward },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: referrer.id,
          amount: reward,
          reason: 'referral',
          meta: JSON.stringify({ referredUserId: user.id }),
        },
      });
    }

    return user;
  });
}

/** Public shape returned to the client. */
export function publicUser(user: User) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    balance: money(user.balance),
    earnedBalance: money(user.earnedBalance),
    // The deposited portion — the only balance the tier stakes accept.
    stakeable: money(Math.max(0, user.balance - user.earnedBalance)),
    totalEarned: money(user.totalEarned),
    referralCode: user.referralCode,
  };
}
