import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env from the repo root (one level above /server) and local .env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config(); // also load server/.env if present (overrides not required)

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? 'myIceBoxBot',
  webAppUrl: process.env.WEBAPP_URL ?? 'http://localhost:5173',
  port: num('PORT', 3000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Bypass initData validation for browser testing. Never true in prod.
  devAllowUnsigned: process.env.DEV_ALLOW_UNSIGNED === 'true',
  referralReward: num('REFERRAL_REWARD', 2),
  minWithdrawal: num('MIN_WITHDRAWAL', 18),
  signupBonus: num('SIGNUP_BONUS', 0.3),
};

export const hasBot = config.botToken.length > 0;
