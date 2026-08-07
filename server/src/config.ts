import dotenv from 'dotenv';
import path from 'node:path';

// Load .env from the repo root and the local cwd. On Vercel there is no .env
// file (env vars come from the dashboard) — dotenv simply no-ops then.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? 'myIceBoxBot',
  webAppUrl: process.env.WEBAPP_URL ?? 'http://localhost:5173',
  // Public base URL of the deployment (e.g. https://icebox.vercel.app).
  publicUrl: process.env.PUBLIC_URL ?? process.env.WEBAPP_URL ?? '',
  // Shared secret Telegram sends back in the X-Telegram-Bot-Api-Secret-Token
  // header on each webhook call; guards the /api/bot endpoint.
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  // "webhook" on serverless (Vercel), "polling" for a long-running local server.
  botMode: (process.env.BOT_MODE ?? (process.env.VERCEL ? 'webhook' : 'polling')) as
    | 'webhook'
    | 'polling',
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
