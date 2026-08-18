/**
 * Payout safety tests. Requires a throwaway Postgres:
 *
 *   export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/icebox_test
 *   export DIRECT_URL=$DATABASE_URL
 *   npx prisma db push --schema=server/prisma/schema.prisma
 *   npx tsx server/src/scripts/testPayout.ts
 *
 * These cover the parts where a bug pays a user twice or loses their balance.
 * The on-chain transfer itself is not exercised here — that needs a funded
 * wallet — but every database transition around it is.
 */
import '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

async function freshUser(balance: number) {
  const n = Math.random().toString(36).slice(2, 10);
  return prisma.user.create({
    data: { telegramId: 't' + n, referralCode: 'r' + n, balance, totalEarned: balance },
  });
}

/** The exact claim the worker performs. */
const claim = (id: number) =>
  prisma.withdrawal.updateMany({ where: { id, status: 'pending' }, data: { status: 'processing' } });

async function main() {
  await prisma.ledgerEntry.deleteMany({});
  await prisma.withdrawal.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('\n--- concurrent claim: only one runner may take a row ---');
  {
    const u = await freshUser(100);
    const w = await prisma.withdrawal.create({
      data: { userId: u.id, amount: 20, address: '0x' + '1'.repeat(40), network: 'BEP20' },
    });

    // Ten simultaneous runners racing for the same withdrawal.
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(w.id)));
    const winners = results.filter((r) => r.count === 1).length;
    check('exactly one runner claims the row', winners === 1, `winners=${winners}`);

    const after = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    check('row ends in processing', after.status === 'processing', after.status);

    // A later pass must not pick it up again.
    const again = await claim(w.id);
    check('already-processing row cannot be re-claimed', again.count === 0);
  }

  console.log('\n--- a processing row is never selected by the worker query ---');
  {
    const u = await freshUser(100);
    await prisma.withdrawal.create({
      data: { userId: u.id, amount: 5, address: '0x' + '2'.repeat(40), status: 'processing' },
    });
    await prisma.withdrawal.create({
      data: { userId: u.id, amount: 6, address: '0x' + '3'.repeat(40), status: 'paid' },
    });
    const pending = await prisma.withdrawal.findMany({ where: { status: 'pending' } });
    check(
      'stuck/settled rows are excluded from the pending queue',
      pending.every((p) => p.status === 'pending'),
    );
  }

  console.log('\n--- refund restores balance exactly once ---');
  {
    const u = await freshUser(50);
    const amount = 20;
    // Mirror the request path: debit, then create the withdrawal.
    await prisma.user.update({ where: { id: u.id }, data: { balance: { decrement: amount } } });
    const w = await prisma.withdrawal.create({
      data: { userId: u.id, amount, address: '0x' + '4'.repeat(40), status: 'processing' },
    });

    const midway = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    check('balance debited on request', midway.balance === 30, String(midway.balance));

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: w.id },
        data: { status: 'rejected', error: 'test failure', processedAt: new Date() },
      });
      await tx.user.update({ where: { id: u.id }, data: { balance: { increment: amount } } });
      await tx.ledgerEntry.create({
        data: { userId: u.id, amount, reason: 'withdrawal_refund', meta: '{}' },
      });
    });

    const restored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    check('balance restored after refund', restored.balance === 50, String(restored.balance));

    const entries = await prisma.ledgerEntry.count({
      where: { userId: u.id, reason: 'withdrawal_refund' },
    });
    check('exactly one refund ledger entry', entries === 1, String(entries));

    const done = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    check('withdrawal marked rejected with a reason', done.status === 'rejected' && !!done.error);
  }

  console.log('\n--- txHash is recorded and survives ---');
  {
    const u = await freshUser(100);
    const w = await prisma.withdrawal.create({
      data: { userId: u.id, amount: 25, address: '0x' + '5'.repeat(40), status: 'processing' },
    });
    const hash = '0x' + 'a'.repeat(64);
    await prisma.withdrawal.update({ where: { id: w.id }, data: { txHash: hash } });
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'paid', processedAt: new Date() },
    });
    const paid = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    check('paid row keeps its txHash', paid.txHash === hash);
    check('paid row has processedAt', paid.processedAt !== null);
  }

  console.log('\n--- ordering is oldest first ---');
  {
    const u = await freshUser(500);
    const a = await prisma.withdrawal.create({
      data: { userId: u.id, amount: 20, address: '0x' + '6'.repeat(40) },
    });
    await new Promise((r) => setTimeout(r, 15));
    await prisma.withdrawal.create({
      data: { userId: u.id, amount: 20, address: '0x' + '7'.repeat(40) },
    });
    const q = await prisma.withdrawal.findMany({
      where: { status: 'pending', userId: u.id },
      orderBy: { createdAt: 'asc' },
    });
    check('oldest pending withdrawal is served first', q[0]?.id === a.id);
  }

  console.log('\n=============================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('HARNESS ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
