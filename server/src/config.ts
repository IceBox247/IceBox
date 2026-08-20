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
 * Coerce a configured value into a valid https link Telegram will accept as an
 * inline-button URL. Accepts a full http(s) URL as-is, prefixes a bare "t.me/…",
 * and turns a bare bot username (with or without @) into a deep link that opens
 * the Mini App. `fallbackUser` is used when the value is empty.
 */
function telegramUrl(raw: string | undefined, fallbackUser: string): string {
  const v = (raw ?? '').trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^t\.me\//i.test(v)) return `https://${v}`;
  const uname = (v || fallbackUser).replace(/^@/, '');
  return `https://t.me/${uname}?startapp`;
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
  // Max age (seconds) of a Telegram initData payload before it's rejected as
  // stale. Telegram reopens Mini Apps from a cached webview whose auth_date can
  // be days old, so a strict window locks legitimate users out with "open from
  // inside Telegram". The HMAC signature already proves authenticity; 0 disables
  // the age check entirely (default). Set INITDATA_MAX_AGE_SECONDS to re-enable.
  initDataMaxAge: num('INITDATA_MAX_AGE_SECONDS', 0),
  referralReward: num('REFERRAL_REWARD', 2),
  minWithdrawal: num('MIN_WITHDRAWAL', 18), // ICE-token rail minimum
  minWithdrawalUsdt: num('MIN_WITHDRAWAL_USDT', 0.5), // USDT rail minimum
  signupBonus: num('SIGNUP_BONUS', 0.3),

  // Two-level referral commission paid on every DEPOSIT, as a % of the deposit.
  // These land in the referrers' deposited (USDT-withdrawable) bucket, so they
  // can be withdrawn instantly as USDT. Level 1 = direct referrer, level 2 =
  // the referrer's referrer.
  depositReferral: {
    level1Pct: num('REF_DEPOSIT_L1_PCT', 7),
    level2Pct: num('REF_DEPOSIT_L2_PCT', 3),
  },

  // Daily check-in bonus. `rewards` is the per-streak-day reward schedule; once
  // the streak passes the list length it stays at the last value. Credited to
  // the earned bucket (like tasks). Tune with CHECKIN_REWARDS (comma list).
  checkin: {
    enabled: process.env.CHECKIN_ENABLED !== 'false',
    rewards: (process.env.CHECKIN_REWARDS ?? '0.05,0.10,0.15,0.20,0.25,0.30,0.50')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0),
  },

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
        blurb: 'Step up your position up to $2,000.',
        minStake: 1,
        maxStake: 2000,
        apy: 30,
        dailyRate: 0.08,
        durationDays: 45,
        accent: 'ice',
      }),
      stakeTier('S3', {
        key: 's3',
        name: 'Gold',
        blurb: 'Serious stakers — up to $5,000.',
        minStake: 1,
        maxStake: 5000,
        apy: 45,
        dailyRate: 0.12,
        durationDays: 60,
        accent: 'amber',
      }),
      stakeTier('S4', {
        key: 's4',
        name: 'Diamond',
        blurb: 'Top tier — up to $10,000 for our best yield.',
        minStake: 1,
        maxStake: 10000,
        apy: 60,
        dailyRate: 0.16,
        durationDays: 90,
        accent: 'violet',
      }),
    ] as StakeTier[],

    // The special locked stake for task/referral-earned ICE USD. Rewards accrue
    // but stay locked — principal + all rewards release only at maturity. Tune
    // via STAKE_EARNED_APY / _DAILY / _DURATION / _MIN.
    earned: {
      enabled: process.env.STAKE_EARNED_ENABLED !== 'false',
      key: 'earned',
      name: str('STAKE_EARNED_NAME', 'Earned Vault'),
      blurb: str(
        'STAKE_EARNED_BLURB',
        'Lock ICE USD earned from tasks & referrals. Rewards release with your principal at the end of the term.',
      ),
      minStake: num('STAKE_EARNED_MIN', 1),
      apy: num('STAKE_EARNED_APY', 40),
      dailyRate: num('STAKE_EARNED_DAILY', 0.11),
      durationDays: num('STAKE_EARNED_DURATION', 100),
      accent: 'ice',
    },
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

  // Dextopus on-ramp: users deposit USDT and it settles to the treasury, which
  // credits their ICE USD balance 1:1. Docs: https://dextopus.gitbook.io.
  dextopus: {
    // Master switch — deposits stay off until an API key + treasury are set.
    enabled: process.env.DEXTOPUS_ENABLED === 'true',
    apiBase: str('DEXTOPUS_API_BASE', 'https://swap-api.dextopus.com'),
    // Swap-API key from the Dextopus dashboard (sent as the x-api-key header).
    apiKey: process.env.DEXTOPUS_API_KEY ?? '',
    // Shared secret Dextopus signs deposit webhooks with (HMAC-SHA256).
    webhookSecret: process.env.DEXTOPUS_WEBHOOK_SECRET ?? '',
    // Treasury wallet that deposits settle into. This is the settlementAddress
    // handed to Dextopus; ICE USD credited to the user equals what lands here.
    treasuryAddress: process.env.TREASURY_ADDRESS ?? '',
    // What the user is expected to send. Defaults to USDT on BSC (BEP-20).
    originChainId: num('DEXTOPUS_ORIGIN_CHAIN_ID', 56),
    originAsset: str('DEXTOPUS_ORIGIN_ASSET', 'USDT'),
    // Where funds settle — the treasury's chain/asset. Also USDT on BSC.
    settlementChainId: num('DEXTOPUS_SETTLEMENT_CHAIN_ID', 56),
    settlementAsset: str('DEXTOPUS_SETTLEMENT_ASSET', 'USDT'),
    // Smallest deposit the UI encourages, in USD.
    minDeposit: num('DEXTOPUS_MIN_DEPOSIT', 2),
    // 1 USDT = this many ICE USD. Keep at 1 for a 1:1 peg.
    rate: num('DEXTOPUS_RATE', 1),

    // Refund addresses per ORIGIN chain family — Dextopus requires a `refundTo`
    // when minting a deposit address (funds return here if a swap fails). EVM
    // defaults to the treasury; set the others only if you accept those chains.
    refundEvm: str('REFUND_EVM', process.env.TREASURY_ADDRESS ?? ''),
    refundSol: process.env.REFUND_SOL ?? '',
    refundTron: process.env.REFUND_TRON ?? '',
    refundBtc: process.env.REFUND_BTC ?? '',
    // When true (default), trust the Default Refund Addresses set in the
    // Dextopus dashboard and offer coins on every supported chain. Set to false
    // to restrict the picker to only families with a REFUND_* env address.
    dashboardRefunds: process.env.DEXTOPUS_DASHBOARD_REFUNDS !== 'false',

    // ── Withdrawal (off-ramp) ──
    // Turn on ICE USD -> USDT withdrawals routed through Dextopus. Requires the
    // TREASURY signer below to hold USDT + gas to send.
    withdrawEnabled: process.env.DEXTOPUS_WITHDRAW_ENABLED === 'true',
    // Private key of the TREASURY hot wallet that holds USDT + gas and signs USDT
    // payouts. This is a SEPARATE wallet from PAYOUT_PRIVATE_KEY (which signs the
    // ICE-token payouts). Set TREASURY_PRIVATE_KEY to the wallet that actually
    // holds your USDT float — do NOT reuse the ICE-token key here.
    treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY ?? '',
    // RPC the treasury signer broadcasts through (defaults to the BSC RPC).
    withdrawRpcUrl: str('TREASURY_RPC_URL', process.env.BSC_RPC_URL ?? 'https://bsc-dataseed.binance.org'),
    // What the treasury sends from when paying out (defaults to USDT on BSC).
    withdrawOriginChainId: num('DEXTOPUS_WITHDRAW_ORIGIN_CHAIN_ID', 56),
    withdrawOriginAsset: str('DEXTOPUS_WITHDRAW_ORIGIN_ASSET', 'USDT'),
    // USDT (BEP-20) contract the treasury transfers on the origin chain.
    usdtAddress: str('USDT_ADDRESS', '0x55d398326f99059fF775485246999027B3197955'),
    // Default destination the user receives on (they can override per request).
    withdrawDestChainId: num('DEXTOPUS_WITHDRAW_DEST_CHAIN_ID', 56),
    withdrawDestAsset: str('DEXTOPUS_WITHDRAW_DEST_ASSET', 'USDT'),
    // Address failed/expired withdrawals are refunded to (must be ours).
    refundAddress: str('DEXTOPUS_REFUND_ADDRESS', process.env.TREASURY_ADDRESS ?? ''),
    // Optional partner fee taken on every withdrawal, in basis points.
    partnerAddress: process.env.DEXTOPUS_PARTNER_ADDRESS ?? '',
    partnerFeeBps: num('DEXTOPUS_PARTNER_FEE_BPS', 0),
  },

  // Telegram channels the bot posts activity alerts to (chat id like -100… or
  // an @channelusername the bot is an admin of). Left blank = no alert sent.
  channels: {
    deposit: process.env.DEPOSIT_CHANNEL ?? '',
    payout: process.env.PAYOUT_CHANNEL ?? '',
  },
  // Rich-alert styling: an image attached to each alert + an "Open IceBox"
  // button below it. Image must be a public URL Telegram can fetch (host it,
  // e.g. https://www.iceboxminiapp.online/paid-alert.jpg). The button opens the
  // Mini App — use a t.me link, not the raw domain.
  alerts: {
    // Defaults to a branded image served from your own domain (web/public/
    // alert.png) so alerts have a picture with zero setup. Override with your
    // own "USD PAID" banner via ALERT_IMAGE_URL.
    image:
      process.env.ALERT_IMAGE_URL ??
      ((process.env.PUBLIC_URL || process.env.WEBAPP_URL)
        ? `${(process.env.PUBLIC_URL || process.env.WEBAPP_URL)!.replace(/\/$/, '')}/alert.png`
        : ''),
    // Deposit alerts get their own "USD DEPOSIT" banner; payout alerts keep the
    // "USD PAID" one. Both default to images committed in web/public, served
    // from your own domain, so there's a distinct picture with zero setup.
    depositImage:
      process.env.ALERT_DEPOSIT_IMAGE_URL ??
      ((process.env.PUBLIC_URL || process.env.WEBAPP_URL)
        ? `${(process.env.PUBLIC_URL || process.env.WEBAPP_URL)!.replace(/\/$/, '')}/deposit.png`
        : ''),
    payoutImage:
      process.env.ALERT_PAYOUT_IMAGE_URL ??
      ((process.env.PUBLIC_URL || process.env.WEBAPP_URL)
        ? `${(process.env.PUBLIC_URL || process.env.WEBAPP_URL)!.replace(/\/$/, '')}/alert.png`
        : ''),
    buttonText: str('ALERT_BUTTON_TEXT', '❄️ Open IceBox'),
    // Normalise whatever is configured into a valid https link. Telegram rejects
    // the whole alert if the inline-button URL is not a proper HTTP URL, so a
    // bare bot username ("IceBoxbot_bot") or a "t.me/…" value is coerced into
    // "https://t.me/<username>?startapp".
    buttonUrl: telegramUrl(process.env.ALERT_BUTTON_URL, process.env.BOT_USERNAME ?? 'myIceBoxBot'),
  },
  // Block explorer for tx links in alerts (BscScan by default).
  explorerBase: str('EXPLORER_BASE', 'https://bscscan.com'),

  // Countdown to the ICE token going tradeable on-chain. `at` is a fixed ISO
  // timestamp the app counts down to — set TOKEN_LAUNCH_AT in the Vercel env to
  // your real launch moment. `tradeUrl` (optional) becomes a "Trade" button once
  // the countdown hits zero.
  tokenLaunch: {
    at: str('TOKEN_LAUNCH_AT', '2026-09-20T12:00:00Z'),
    label: str('TOKEN_LAUNCH_LABEL', 'ICE Token goes live on-chain'),
    tradeUrl: process.env.TOKEN_TRADE_URL ?? '',
  },

  // "Glacier" mining: users buy hashrate (mining power) with DEPOSITED USD and
  // it mines ICE USD continuously. Rewards land in the earned (ICE) bucket.
  // Every rate is env-tunable so you can balance the economy from Vercel.
  mining: {
    enabled: process.env.MINING_ENABLED !== 'false',
    name: str('MINE_NAME', 'Glacier'),
    unit: str('MINE_UNIT', 'GH/s'),
    // Hashrate gained per 1 USD spent (deposited USD → mining power).
    hashPerUsd: num('MINE_HASH_PER_USD', 1),
    // ICE USD mined per 1 unit of hashrate per day (drives earnings/hour = /24).
    icePerHashDay: num('MINE_ICE_PER_HASH_DAY', 0.05),
    // Smallest hashrate purchase, in USD.
    minBuy: num('MINE_MIN_BUY', 1),
    // Optional preset buy packages (USD), shown as quick-buy chips.
    packages: (process.env.MINE_PACKAGES ?? '5,20,50,100,500')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    // Level names by ascending hashrate threshold. Level 1 starts at 0.
    levels: [
      { name: 'Frost', minHash: 0 },
      { name: 'Glacier', minHash: 50 },
      { name: 'Iceberg', minHash: 250 },
      { name: 'Avalanche', minHash: 1000 },
      { name: 'Polar Vortex', minHash: 5000 },
    ],
  },
};

/** Payouts only run when every required piece is present. */
export const payoutReady =
  config.payout.enabled &&
  /^0x[a-fA-F0-9]{40}$/.test(config.payout.tokenAddress) &&
  config.payout.privateKey.length > 0;

/** Dextopus deposits only run when the key + treasury are both present. */
export const dextopusReady =
  config.dextopus.enabled &&
  config.dextopus.apiKey.length > 0 &&
  config.dextopus.treasuryAddress.length > 0;

/**
 * Dextopus withdrawals also need the treasury signer (it sends USDT on-chain to
 * the quote address) and a refund address. Kept off by default so a treasury
 * that isn't funded can never start sending.
 */
export const dextopusWithdrawReady =
  config.dextopus.withdrawEnabled &&
  config.dextopus.apiKey.length > 0 &&
  config.dextopus.treasuryPrivateKey.length > 0 &&
  /^0x[a-fA-F0-9]{40}$/.test(config.dextopus.usdtAddress) &&
  config.dextopus.refundAddress.length > 0;

export const hasBot = config.botToken.length > 0;
