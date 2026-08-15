const fs = require('fs');
const path = require('path');
const ganache = require('ganache');
const { ethers } = require('ethers');

const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, 'abi.json'), 'utf8'));
const BYTECODE = fs.readFileSync(path.join(__dirname, 'bytecode.txt'), 'utf8').trim();

const DAY = 86400;
const NO_TAX = [false, ethers.ZeroAddress];

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}
// Revert checks go through staticCall (eth_call). Awaiting the tx promise alone
// can resolve before the revert surfaces at mining time -> false passes.
async function reverts(fn, name) {
  try { await fn(); check(name + ' (should revert)', false, 'did NOT revert'); }
  catch (e) { check(name, true); }
}

(async () => {
  const gan = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 5 } });
  const provider = new ethers.BrowserProvider(gan);
  const owner = await provider.getSigner(0);
  const alice = await provider.getSigner(1);   // airdrop recipient
  const pairEOA = await provider.getSigner(2); // stands in for the LP pair
  const bob = await provider.getSigner(3);
  const taxEOA = await provider.getSigner(4);

  const pairAddr = await pairEOA.getAddress();
  const aliceAddr = await alice.getAddress();
  const bobAddr = await bob.getAddress();
  const taxWallet = await taxEOA.getAddress();

  const F = new ethers.ContractFactory(ABI, BYTECODE, owner);
  const advance = async (secs) => {
    await gan.request({ method: 'evm_increaseTime', params: [secs] });
    await gan.request({ method: 'evm_mine', params: [] });
  };

  // ===================== LAUNCH SELL LOCK =====================
  console.log('\n--- constructor bound (MAX_SELL_LOCK = 7 days) ---');
  await reverts(
    () => F.deploy(1000000n, BigInt(8 * DAY), ...NO_TAX).then((c) => c.waitForDeployment()),
    '8-day lock rejected'
  );
  const t = await F.deploy(1000000n, BigInt(7 * DAY), ...NO_TAX);
  await t.waitForDeployment();
  check('7-day lock accepted', true);

  console.log('\n--- lock is dormant until the pair is set ---');
  await (await t.transfer(aliceAddr, ethers.parseUnits('1000', 18))).wait();
  await (await t.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell allowed before setPair (lock dormant)', true);

  console.log('\n--- with pair set, sells blocked, everything else open ---');
  await (await t.setPair(pairAddr)).wait();
  check('sellLockActive() true', await t.sellLockActive());
  await reverts(
    () => t.connect(alice).transfer.staticCall(pairAddr, ethers.parseUnits('1', 18)),
    'holder sell into pair blocked'
  );
  await (await t.connect(alice).transfer(bobAddr, ethers.parseUnits('5', 18))).wait();
  check('wallet-to-wallet still allowed', (await t.balanceOf(bobAddr)) === ethers.parseUnits('5', 18));
  await (await t.connect(pairEOA).transfer(aliceAddr, ethers.parseUnits('1', 18))).wait();
  check('buy from pair still allowed', true);
  await (await t.transfer(pairAddr, ethers.parseUnits('10', 18))).wait();
  check('owner exempt (can seed liquidity)', true);

  console.log('\n--- pair cannot be repointed ---');
  await reverts(() => t.setPair.staticCall(bobAddr), 'setPair second time rejected');

  console.log('\n--- lock can only be shortened, never extended ---');
  const names = ABI.filter((x) => x.type === 'function').map((x) => x.name);
  check('no extend/relock function in ABI',
    !names.some((n) => /extend|relock|setSellLock|prolong/i.test(n)), names.join(','));
  const until1 = await t.sellLockUntil();
  await (await t.unlockSellsEarly()).wait();
  check('unlockSellsEarly clears the lock', (await t.sellLockActive()) === false);
  check('sellLockUntil unchanged (immutable)', (await t.sellLockUntil()) === until1);
  await reverts(() => t.unlockSellsEarly.staticCall(), 'cannot unlock twice');
  await (await t.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell works after early unlock', true);

  console.log('\n--- time-based expiry (fresh token, 1h lock) ---');
  const t2 = await F.deploy(1000000n, 3600n, ...NO_TAX);
  await t2.waitForDeployment();
  await (await t2.setPair(pairAddr)).wait();
  await (await t2.transfer(aliceAddr, ethers.parseUnits('100', 18))).wait();
  await reverts(() => t2.connect(alice).transfer.staticCall(pairAddr, 1n), 'sell blocked inside window');
  await advance(3601);
  check('sellLockActive() false after expiry', (await t2.sellLockActive()) === false);
  await (await t2.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell works after expiry, no owner action', true);

  console.log('\n--- zero lock = never restricted ---');
  const t3 = await F.deploy(1000n, 0n, ...NO_TAX);
  await t3.waitForDeployment();
  await (await t3.setPair(pairAddr)).wait();
  await (await t3.transfer(aliceAddr, ethers.parseUnits('10', 18))).wait();
  await (await t3.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('no lock => sells open immediately', (await t3.sellLockActive()) === false);

  // ===================== DECAYING SELL TAX =====================
  console.log('\n--- decaying sell tax: declared schedule ---');
  const tt = await F.deploy(10000000n, 0n, true, taxWallet);
  await tt.waitForDeployment();
  await (await tt.setPair(pairAddr)).wait();

  const expected = [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 500];
  const sched = (await tt.sellTaxSchedule()).map(Number);
  check('sellTaxSchedule() = 90..10 then 5%',
    JSON.stringify(sched) === JSON.stringify(expected), sched.join(','));
  check('day 1 rate is 90%', Number(await tt.currentSellTaxBps()) === 9000);

  console.log('\n--- tax actually charged, walked day by day ---');
  await (await tt.transfer(aliceAddr, ethers.parseUnits('100000', 18))).wait();
  const SELL = ethers.parseUnits('100', 18);
  let curveOk = true; const detail = [];
  for (let d = 0; d < 11; d++) {
    const want = d >= 9 ? 500 : 9000 - d * 1000;
    const rate = Number(await tt.currentSellTaxBps());
    const before = await tt.balanceOf(taxWallet);
    const bobBefore = await tt.balanceOf(pairAddr);
    await (await tt.connect(alice).transfer(pairAddr, SELL)).wait();
    const took = (await tt.balanceOf(taxWallet)) - before;
    const delivered = (await tt.balanceOf(pairAddr)) - bobBefore;
    const wantTook = (SELL * BigInt(want)) / 10000n;
    if (rate !== want || took !== wantTook || delivered !== SELL - wantTook) {
      curveOk = false;
      detail.push(`day${d + 1} rate=${rate} want=${want} took=${took} wantTook=${wantTook}`);
    }
    await advance(DAY);
  }
  check('charged tax matches schedule, days 1-11', curveOk, detail.join(' | '));
  check('settles at 5% permanently', Number(await tt.currentSellTaxBps()) === 500);
  await advance(60 * DAY);
  check('still 5% two months later', Number(await tt.currentSellTaxBps()) === 500);

  console.log('\n--- tax cannot be raised or tampered with ---');
  check('no tax-rate setter in ABI',
    !names.some((n) => /^setTax$|setSellTax|setFee|updateTax|setRate/i.test(n)), names.join(','));
  check('MAX_SELL_TAX_BPS is 9000', Number(await tt.MAX_SELL_TAX_BPS()) === 9000);
  check('FINAL_SELL_TAX_BPS is 500', Number(await tt.FINAL_SELL_TAX_BPS()) === 500);

  console.log('\n--- tax applies to sells only ---');
  let b0 = await tt.balanceOf(taxWallet);
  await (await tt.connect(pairEOA).transfer(bobAddr, ethers.parseUnits('10', 18))).wait();
  check('buys are never taxed', (await tt.balanceOf(taxWallet)) === b0);
  b0 = await tt.balanceOf(taxWallet);
  await (await tt.connect(alice).transfer(bobAddr, ethers.parseUnits('10', 18))).wait();
  check('wallet-to-wallet never taxed', (await tt.balanceOf(taxWallet)) === b0);
  b0 = await tt.balanceOf(taxWallet);
  await (await tt.transfer(pairAddr, ethers.parseUnits('10', 18))).wait();
  check('owner exempt from tax (liquidity seeding)', (await tt.balanceOf(taxWallet)) === b0);

  console.log('\n--- tax disabled => no tax ever ---');
  const t4 = await F.deploy(1000n, 0n, ...NO_TAX);
  await t4.waitForDeployment();
  await (await t4.setPair(pairAddr)).wait();
  check('currentSellTaxBps() is 0 when disabled', Number(await t4.currentSellTaxBps()) === 0);

  console.log('\n=============================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
