# Contract tests

Verifies the ICE USD launch sell lock. Not wired into the app build — the
toolchain (solc, ganache) is heavy and only needed when the contract changes.

```bash
cd contracts/test
npm init -y && npm install solc@0.8.26 ganache ethers@6
node compile.js      # writes abi.json + bytecode.txt
node test-lock.js    # 18 assertions, exits non-zero on failure
```

## What is asserted

**The lock is bounded and cannot be abused**

- A lock longer than `MAX_SELL_LOCK` (7 days) is rejected at construction.
- `sellLockUntil` is immutable — no function in the ABI can extend it.
- `unlockSellsEarly()` is one-way; it cannot be called twice, and it does not
  change `sellLockUntil`.
- `setPair` works exactly once; the pair can never be repointed afterwards.

**The lock restricts sells only**

- Selling into the pair reverts while the window is open.
- Buying from the pair, wallet-to-wallet transfers and holding are unaffected.
- The owner is lock-exempt so liquidity can be seeded.

**It expires on its own**

- After the window passes, `sellLockActive()` is false and sells succeed with
  no owner action required.
- A zero-second lock is never restrictive.

## Regenerating the deploy page

`web/public/deploy-token.html` embeds the compiled ABI and bytecode. After
changing `IceUsd.sol`, re-run `compile.js` and replace the `const ABI = ` and
`const BYTECODE = ` lines in that file, or the page will deploy the old
contract.

## Note on revert assertions

Revert checks use `.staticCall(...)` (an `eth_call`) rather than awaiting the
transaction promise. Awaiting the promise alone can resolve before the revert
surfaces at mining time, which produces false passes.
