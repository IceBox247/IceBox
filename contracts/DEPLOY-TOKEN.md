# Deploying the ICE USD token (BEP-20 on BNB Smart Chain)

The contract is [`IceUsd.sol`](IceUsd.sol) — a standard OpenZeppelin ERC-20
(name **ICE USD**, symbol **USD**, 18 decimals). Deploy it yourself in a few
minutes with Remix. You need a BSC wallet (MetaMask) with a little **BNB for
gas** (~$1 is plenty).

> ⚠️ Reality check: a token only has real value if you back it with real
> liquidity you're willing to honor. This contract makes **no** price claim.
> Handing it to users as if it were cashable dollars, without real backing, is
> misleading them. Distribute it honestly (real liquidity, or clearly as reward
> points).

## Option A — Remix (easiest, no local setup)

1. Open <https://remix.ethereum.org>.
2. Create a new file `IceUsd.sol` and paste the contents of this repo's
   `contracts/IceUsd.sol`.
3. **Solidity Compiler** tab → compiler version **0.8.20** (or higher) →
   **Compile IceUsd.sol**.
4. Add **BNB Smart Chain** to MetaMask if needed:
   - Network name: BNB Smart Chain
   - RPC: `https://bsc-dataseed.binance.org`
   - Chain ID: `56`
   - Symbol: `BNB`
   - Explorer: `https://bscscan.com`
5. Fund that MetaMask account with a small amount of **BNB**.
6. **Deploy & Run Transactions** tab:
   - Environment: **Injected Provider – MetaMask** (confirm it shows Chain 56).
   - Contract: **IceUsd**.
   - Next to **Deploy**, enter the initial supply in **whole tokens**
     (e.g. `1000000000` for 1 billion).
   - Click **Deploy** → confirm in MetaMask.
7. Copy the deployed **contract address** from Remix.

## Option B — Hardhat (scriptable)

```bash
npm i -D hardhat @openzeppelin/contracts
npx hardhat init            # choose a TypeScript/JS project
# put IceUsd.sol in contracts/, add a deploy script, set BSC network + PRIVATE_KEY
npx hardhat run scripts/deploy.ts --network bsc
```
Keep the deployer `PRIVATE_KEY` in a local `.env` only — never commit it.

## After deploying

1. **Verify the source on BscScan** (Contract → Verify & Publish → Solidity,
   compiler 0.8.20, MIT) so holders can read the code.
2. Add the token to MetaMask/Trust Wallet by its contract address to see your
   balance.
3. **Wire it into IceBox:** put the new address in `web/src/brand.ts`
   (`TOKEN.contract`) and, when you build the on-chain payout, in the server's
   payout config. The withdrawal flow already targets **BSC (BEP-20)**.
4. **If you want real value:** create a PancakeSwap pool pairing ICE USD with
   real USDT/BNB and seed it with real funds. That — and only that — is what
   gives the token a price users can actually realize.

## What this does NOT do

- It doesn't peg to $1 or make the token a stablecoin.
- It doesn't make wallets show a fake dollar value.
- It doesn't stop holders from selling.

Those are deliberate. A reward token that users can trust is one that's honest
about what it is.
