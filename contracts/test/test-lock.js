const fs = require('fs');
const ganache = require('ganache');
const { ethers } = require('ethers');

const ABI = JSON.parse(fs.readFileSync('abi.json', 'utf8'));
const BYTECODE = fs.readFileSync('bytecode.txt', 'utf8').trim();

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}
async function reverts(fn, name) {
  try { await (typeof fn === 'function' ? fn() : fn); check(name + ' (should revert)', false, 'did NOT revert'); }
  catch (e) { check(name, true); }
}

(async () => {
  const gan = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4 } });
  const provider = new ethers.BrowserProvider(gan);
  const owner = await provider.getSigner(0);
  const alice = await provider.getSigner(1);   // airdrop recipient
  const pairEOA = await provider.getSigner(2); // stands in for the LP pair
  const bob = await provider.getSigner(3);

  const pairAddr = await pairEOA.getAddress();
  const aliceAddr = await alice.getAddress();
  const bobAddr = await bob.getAddress();

  const F = new ethers.ContractFactory(ABI, BYTECODE, owner);

  console.log('\n--- constructor bound (MAX_SELL_LOCK = 7 days) ---');
  await reverts(() => F.deploy(1000000n, 8n * 86400n).then(c=>c.waitForDeployment()), '8-day lock rejected');
  const okDeploy = await F.deploy(1000000n, 7n * 86400n);
  await okDeploy.waitForDeployment();
  check('7-day lock accepted', true);

  const t = okDeploy;
  console.log('\n--- lock is dormant until the pair is set ---');
  await (await t.transfer(aliceAddr, ethers.parseUnits('1000', 18))).wait();
  // Alice can "sell" to the pair address while pair is unset
  await (await t.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell allowed before setPair (lock dormant)', true);

  console.log('\n--- with pair set, sells blocked, everything else open ---');
  await (await t.setPair(pairAddr)).wait();
  check('sellLockActive() true', await t.sellLockActive());

  await reverts(
    () => t.connect(alice).transfer.staticCall(pairAddr, ethers.parseUnits('1', 18)),
    'holder sell into pair blocked'
  );

  // wallet -> wallet still works
  await (await t.connect(alice).transfer(bobAddr, ethers.parseUnits('5', 18))).wait();
  check('wallet-to-wallet transfer still allowed', (await t.balanceOf(bobAddr)) === ethers.parseUnits('5', 18));

  // buying (pair -> holder) still works
  await (await t.connect(pairEOA).transfer(aliceAddr, ethers.parseUnits('1', 18))).wait();
  check('buy from pair still allowed', true);

  // owner is exempt so liquidity can be seeded
  await (await t.transfer(pairAddr, ethers.parseUnits('10', 18))).wait();
  check('owner exempt (can seed liquidity)', true);

  console.log('\n--- pair cannot be repointed ---');
  await reverts(() => t.setPair.staticCall(bobAddr), 'setPair second time rejected');

  console.log('\n--- lock cannot be extended, only shortened ---');
  const names = ABI.filter(x => x.type === 'function').map(x => x.name);
  check('no extend/relock function in ABI', !names.some(n => /extend|relock|setSellLock|prolong/i.test(n)), names.join(','));
  const until1 = await t.sellLockUntil();
  await (await t.unlockSellsEarly()).wait();
  check('unlockSellsEarly clears the lock', (await t.sellLockActive()) === false);
  check('sellLockUntil unchanged (immutable)', (await t.sellLockUntil()) === until1);
  await reverts(() => t.unlockSellsEarly.staticCall(), 'cannot unlock twice');

  // after early unlock, selling works
  await (await t.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell works after early unlock', true);

  console.log('\n--- time-based expiry (fresh token, 1h lock) ---');
  const t2 = await F.deploy(1000000n, 3600n);
  await t2.waitForDeployment();
  await (await t2.setPair(pairAddr)).wait();
  await (await t2.transfer(aliceAddr, ethers.parseUnits('100', 18))).wait();
  await reverts(() => t2.connect(alice).transfer.staticCall(pairAddr, 1n), 'sell blocked inside window');
  await gan.request({ method: 'evm_increaseTime', params: [3601] });
  await gan.request({ method: 'evm_mine', params: [] });
  check('sellLockActive() false after expiry', (await t2.sellLockActive()) === false);
  await (await t2.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('sell works after expiry, no owner action', true);

  console.log('\n--- zero lock = never restricted ---');
  const t3 = await F.deploy(1000n, 0n);
  await t3.waitForDeployment();
  await (await t3.setPair(pairAddr)).wait();
  await (await t3.transfer(aliceAddr, ethers.parseUnits('10', 18))).wait();
  await (await t3.connect(alice).transfer(pairAddr, ethers.parseUnits('1', 18))).wait();
  check('no lock => sells open immediately', (await t3.sellLockActive()) === false);

  console.log('\n=============================');
  console.log('passed: ' + pass + '   failed: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
