import dotenv from 'dotenv';
import path from 'node:path';

// Load .env from the repo root and the local cwd. On Vercel there is no .env
// file (env vars come from the dashboard) — dotenv simply no-ops then.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

// Accept the database connection under any of the common names so the app
// works whether you set DATABASE_URL/DIRECT_URL by hand OR use Vercel's
// built-in Postgres/Neon storage (which injects POSTGRES_*/DATABASE_URL_*).
{
  const rawDatabaseUrl = process.env.DATABASE_URL;

  // On a pooled (PgBouncer/Neon pooler) connection, Prisma must disable
  // prepared statements or transactions/writes fail intermittently. Ensure
  // pgbouncer=true is present on the pooled runtime URL.
  const ensurePgBouncer = (url?: string): string | undefined => {
    if (!url) return url;
    const isPooled = /-pooler\.|pgbouncer/.test(url);
    if (isPooled && !/[?&]pgbouncer=true/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
    }
    return url;
  };

  const pooled = ensurePgBouncer(
    process.env.POSTGRES_PRISMA_URL || rawDatabaseUrl || process.env.POSTGRES_URL,
  );
  // Direct (non-pooled) connection for migrations; never the pgbouncer URL.
  const direct =
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    rawDatabaseUrl ||
    pooled;

  if (pooled) process.env.DATABASE_URL = pooled;
  if (direct) process.env.DIRECT_URL = direct;
}

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

  payout: {
    // Master switch. Payouts stay off until this is explicitly "true", so a
    // half-configured deployment can never start sending tokens.
    enabled: process.env.PAYOUT_ENABLED === 'true',
    // ICE USD token contract on BSC.
    tokenAddress: process.env.TOKEN_ADDRESS ?? '',
    // Hot wallet that holds the float and signs transfers. Keep it topped up
    // with only a few days of payouts — anyone with dashboard access can read
    // this value.
    privateKey: process.env.PAYOUT_PRIVATE_KEY ?? '',
    rpcUrl: process.env.BSC_RPC_URL ?? 'https://bsc-dataseed.binance.org',
    // How many tokens one unit of app balance is worth.
    tokensPerUnit: num('TOKENS_PER_UNIT', 1),
    // Ceiling on a single automated payout; anything larger is left pending
    // for manual review rather than sent unattended.
    maxPerWithdrawal: num('MAX_AUTO_PAYOUT', 500),
    // Rows handled per cron run, to stay inside the function time limit.
    batchSize: num('PAYOUT_BATCH_SIZE', 5),
    // Shared secret Vercel Cron presents to /api/cron/payouts.
    cronSecret: process.env.CRON_SECRET ?? '',
  },
};

/** Payouts only run when every required piece is present. */
export const payoutReady =
  config.payout.enabled &&
  /^0x[a-fA-F0-9]{40}$/.test(config.payout.tokenAddress) &&
  config.payout.privateKey.length > 0;

export const hasBot = config.botToken.length > 0;
