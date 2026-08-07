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

  console.log('[deploy-db] Database ready ✅');
}

main().catch((e) => {
  console.error('[deploy-db] failed:', e?.message ?? e);
  process.exit(1);
});
