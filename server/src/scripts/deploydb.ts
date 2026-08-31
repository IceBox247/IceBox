// Runs during the Vercel build (and can be run locally).
// If a database connection is configured, it pushes the Prisma schema (creates
// tables) and seeds the default tasks. If no DB is configured yet, it skips
// cleanly so the first deploy still succeeds.
import '../config'; // loads dotenv + normalizes DATABASE_URL / DIRECT_URL
import { execSync } from 'node:child_process';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn('[deploy-db] No database URL found — skipping schema push & seed.');
    console.warn('[deploy-db] Add Vercel Postgres (or DATABASE_URL/DIRECT_URL) then redeploy.');
    return;
  }

  console.log('[deploy-db] Pushing Prisma schema to the database…');
  execSync('prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: process.env,
  });

  console.log('[deploy-db] Seeding default tasks…');
  const { seedTasks } = await import('../services/seed');
  await seedTasks();

  // One-time backfill: balances that predate the earned/deposited split came
  // entirely from tasks/referrals/signup, so mark them earned. Guarded to
  // pre-feature rows only (earnedBalance still 0, positive balance, and no
  // credited deposit), so it's a no-op on every later deploy.
  console.log('[deploy-db] Backfilling earned balances…');
  const { prisma } = await import('../db');
  const backfilled = await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "earnedBalance" = "balance"
       WHERE "earnedBalance" = 0 AND "balance" > 0
       AND NOT EXISTS (
         SELECT 1 FROM "Deposit" d WHERE d."userId" = "User"."id" AND d."credited" = true
       )`,
  );
  console.log(`[deploy-db] earned-balance backfill touched ${backfilled} row(s).`);

  // One-time correction for deposits credited BEFORE the decimals fix: the old
  // code credited the raw settlement amount (base units of 18-decimal BSC USDT)
  // without dividing by decimals, so a $5 deposit credited 5e18. Every polluted
  // credit is therefore off by exactly 1e18. Reverse the over-credit on the
  // depositor's balance, the deposit row, and any referral commissions paid from
  // it. Idempotent: after correction the amounts fall below the 1e6 base-unit
  // threshold, so re-runs on later deploys select nothing.
  console.log('[deploy-db] Correcting pre-fix deposit decimals…');
  const BASE = 1000000; // any real USD amount is far below this; base units are far above
  await prisma.$transaction([
    // 1. Undo the over-credit on each depositor's balance (before we rescale the rows).
    prisma.$executeRawUnsafe(
      `UPDATE "User" u SET "balance" = u."balance" - agg.delta
         FROM (
           SELECT d."userId" AS uid,
                  SUM(d."creditedAmount" - d."creditedAmount" / 1e18) AS delta
           FROM "Deposit" d
           WHERE d."credited" = true AND d."creditedAmount" >= ${BASE}
           GROUP BY d."userId"
         ) agg
         WHERE u."id" = agg.uid`,
    ),
    // 2. Rescale the deposit rows themselves.
    prisma.$executeRawUnsafe(
      `UPDATE "Deposit" SET "creditedAmount" = "creditedAmount" / 1e18
         WHERE "credited" = true AND "creditedAmount" >= ${BASE}`,
    ),
    // 3. Reverse referral commissions paid as a % of the huge amount.
    prisma.$executeRawUnsafe(
      `UPDATE "User" u
         SET "balance" = u."balance" - agg.delta,
             "totalEarned" = GREATEST(0, u."totalEarned" - agg.delta)
         FROM (
           SELECT l."userId" AS uid, SUM(l."amount" - l."amount" / 1e18) AS delta
           FROM "LedgerEntry" l
           WHERE l."reason" = 'referral_deposit' AND l."amount" >= ${BASE}
           GROUP BY l."userId"
         ) agg
         WHERE u."id" = agg.uid`,
    ),
    // 4. Rescale the ledger history (deposit + referral) for accurate records.
    prisma.$executeRawUnsafe(
      `UPDATE "LedgerEntry" SET "amount" = "amount" / 1e18
         WHERE "reason" IN ('deposit', 'referral_deposit') AND "amount" >= ${BASE}`,
    ),
  ]);
  console.log('[deploy-db] Deposit-decimals correction applied.');

  // One-time fix: earlier code lowercased every minted deposit address. That's
  // fine for EVM (hex) but CORRUPTS Solana/Tron base58 addresses into invalid
  // ones. The lowercased form is unrecoverable, so delete the corrupted rows —
  // they re-mint with correct casing on the user's next deposit view. Idempotent:
  // valid base58 addresses contain uppercase, so `address = LOWER(address)` only
  // ever matches the corrupted rows (Solana=792703809, Tron=728126428; Bitcoin
  // excluded since bech32 is legitimately all-lowercase).
  console.log('[deploy-db] Removing corrupted (lowercased) Solana/Tron deposit addresses…');
  const badAddrs = await prisma.$executeRawUnsafe(
    `DELETE FROM "DepositAddress"
       WHERE "chainId" IN (792703809, 728126428)
       AND "address" = LOWER("address")`,
  );
  console.log(`[deploy-db] Removed ${badAddrs} corrupted deposit address(es) for re-mint.`);

  // Auto-correct any deposit over-credited 1e6× by the Solana/Tron 6-dp decimals
  // bug. Idempotent (per-deposit 'deposit_scale_fix' marker), so it fixes every
  // wrong deposit on this deploy and is a no-op for already-corrected ones.
  console.log('[deploy-db] Correcting Solana/Tron over-credited deposits…');
  const { correctSolanaTronOverCredits } = await import('../services/deposits');
  await correctSolanaTronOverCredits(true);

  // One-time, opt-in cleanup: reverse level purchases that were funded from mined
  // POOL ICE during the window Buy Level briefly allowed it. Gated behind an env
  // flag so it only runs when you deliberately set RUN_POOL_LEVEL_REVERSAL=true;
  // idempotent (per-user ledger marker), so it's safe to leave the flag on.
  if (process.env.RUN_POOL_LEVEL_REVERSAL === 'true') {
    console.log('[deploy-db] Reversing pool-funded level purchases…');
    const { reversePoolLevelPurchases } = await import('../services/levels');
    const res = await reversePoolLevelPurchases();
    console.log(`[deploy-db] Reversal done: ${res.corrected} user(s), $${res.reversedUsd} removed.`);
  }

  console.log('[deploy-db] Database ready ✅');
}

main().catch((e) => {
  console.error('[deploy-db] failed:', e?.message ?? e);
  process.exit(1);
});
