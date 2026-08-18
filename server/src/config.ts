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

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v != null && v.trim() !== '' ? v : fallback;
}

/**
 * A stake-to-earn section. Users pick the section whose amount range covers the
 * amount they want to stake. Every spec — the amount range, headline APY, the
 * daily reward rate that actually accrues, and the lock duration — is read from
 * the environment so the operator can tune them from the Vercel dashboard
 * without a code change. Values here are only fallbacks.
 */
export interface StakeTier {
  key: string;
  name: string;
  blurb: string;
  minStake: number; // inclusive lower bound of the range, in whole USD
  maxStake: number; // inclusive upper bound
  apy: number; // headline APY %, shown in the UI
  dailyRate: number; // % per day — drives reward accrual
  durationDays: number; // lock/earn window in days
  accent: string; // UI accent token (Tailwind color family)
}

/** Build one section from `STAKE_<prefix>_*` env vars, falling back to defaults. */
function stakeTier(
  prefix: string,
  defaults: Omit<StakeTier, 'accent'> & { accent: string },
): StakeTier {
  return {
    key: defaults.key,
    accent: defaults.accent,
    name: str(`STAKE_${prefix}_NAME`, defaults.name),
    blurb: str(`STAKE_${prefix}_BLURB`, defaults.blurb),
    minStake: num(`STAKE_${prefix}_MIN`, defaults.minStake),
    maxStake: num(`STAKE_${prefix}_MAX`, defaults.maxStake),
    apy: num(`STAKE_${prefix}_APY`, defaults.apy),
    dailyRate: num(`STAKE_${prefix}_DAILY`, defaults.dailyRate),
    durationDays: num(`STAKE_${prefix}_DURATION`, defaults.durationDays),
  };
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

  staking: {
    // Master switch. Staking is on by default; set STAKING_ENABLED=false to hide
    // the feature and refuse new stakes (existing positions can still be
    // claimed/unstaked).
    enabled: process.env.STAKING_ENABLED !== 'false',
    // Four amount-range sections. Tune every number from the Vercel env —
    // STAKE_S1_APY, STAKE_S1_DAILY, STAKE_S1_DURATION, STAKE_S1_MIN, STAKE_S1_MAX,
    // and likewise S2/S3/S4. `dailyRate` (% per day) is what actually accrues;
    // `apy` is the headline figure shown in the UI.
    tiers: [
      stakeTier('S1', {
        key: 's1',
        name: 'Starter',
        blurb: 'Get started — stake any amount up to $500.',
        minStake: 1,
        maxStake: 500,
        apy: 18,
        dailyRate: 0.05,
        durationDays: 30,
        accent: 'sky',
      }),
      stakeTier('S2', {
        key: 's2',
        name: 'Silver',
        blurb: 'Step up your position from $501 to $2,000.',
        minStake: 501,
        maxStake: 2000,
        apy: 30,
        dailyRate: 0.08,
        durationDays: 45,
        accent: 'ice',
      }),
      stakeTier('S3', {
        key: 's3',
        name: 'Gold',
        blurb: 'Serious stakers — $2,001 to $5,000.',
        minStake: 2001,
        maxStake: 5000,
        apy: 45,
        dailyRate: 0.12,
        durationDays: 60,
        accent: 'amber',
      }),
      stakeTier('S4', {
        key: 's4',
        name: 'Diamond',
        blurb: 'Top tier — $5,001 to $10,000 for our best yield.',
        minStake: 5001,
        maxStake: 10000,
        apy: 60,
        dailyRate: 0.16,
        durationDays: 90,
        accent: 'violet',
      }),
    ] as StakeTier[],
  },

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
