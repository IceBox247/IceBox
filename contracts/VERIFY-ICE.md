# Verify the ICE token on BscScan (clears the “suspicious token” flag)

Your ICE token was created with the IceBox **Standard** option, which deploys the
`CustomToken` contract from [`TokenFactory.sol`](./TokenFactory.sol). Verifying
publishes the source on BscScan and gives it the green ✅ **“Contract Source Code
Verified”** badge — the single biggest signal that flips wallet security scanners
(MetaMask/Blockaid, Trust) away from “suspicious”.

No wallet or gas is needed to verify — it’s a free, public submission on the
BscScan website.

## Exact settings (must match)

| Field | Value |
|---|---|
| **Contract address** | `0x4BDBDfF5e883b7fBE3b5Bc33ec33E4FC17774eD4` |
| **Compiler type** | Solidity (Single file) |
| **Compiler version** | `v0.8.26+commit.8a97fa7a` |
| **Open source license** | MIT |
| **Optimization** | **Yes** |
| **Runs** | `200` |
| **Contract name (to pick)** | `CustomToken` |
| **EVM version** | `default` — if it doesn’t match, retry with `shanghai`, then `paris` |

## Steps

1. Go to **https://bscscan.com/verifyContract?a=0x4BDBDfF5e883b7fBE3b5Bc33ec33E4FC17774eD4**
   (or: open the token on BscScan → **Contract** tab → **Verify & Publish**).
2. **Compiler Type:** *Solidity (Single file)*.
3. **Compiler Version:** `v0.8.26+commit.8a97fa7a`.
4. **License:** *MIT*.
5. Click **Continue**.
6. **Optimization:** *Yes*, **Runs:** `200`.
7. **Source code:** paste the **entire contents** of
   [`contracts/TokenFactory.sol`](./TokenFactory.sol) (it’s self-contained — no
   imports). BscScan will find all three contracts in it; that’s fine.
8. **Contract Name:** choose **`CustomToken`** (not TokenFactory / TaxToken).
9. **Constructor Arguments (ABI-encoded):** usually **auto-detected** — leave it
   blank first. If BscScan complains, see “Constructor args” below.
10. Complete the captcha → **Verify and Publish**.

If it reports **“Unable to match”**, don’t change the source — just re-run and try
**EVM version = shanghai**, then **paris**. One of default/shanghai/paris will
match (the contract uses the `PUSH0` opcode, so it was compiled for Shanghai or
later). A “partial/similar match” still shows as **Verified** and clears the flag.

## Constructor args (only if step 9 asks)

`CustomToken(string name, string symbol, uint8 decimals, uint256 supplyWhole, address owner)`

- `name` = `ICE BOX`
- `symbol` = `ICE`
- `decimals` = `18`
- `supplyWhole` = the total supply you entered at creation (whole tokens)
- `owner` = the wallet that created the token

To get the exact ABI-encoded string: on BscScan open the token’s **contract
creation transaction**, or paste those 5 values into
**https://abi.hashex.org/** (types: string, string, uint8, uint256, address) and
copy the encoded output into the field.

## After verification

1. The ✅ **Verified** badge appears on the Contract tab within a minute.
2. Then update the token’s public info on BscScan (logo, website, socials) via
   **“Update Token Info”** on the token page (needs a small verification).
3. File the wallet-scanner appeals so the “suspicious” label lifts everywhere:
   - **MetaMask / Blockaid:** report the false positive at
     https://report.blockaid.io
   - **Trust Wallet:** submit the token to the Trust Wallet Assets repo (logo +
     info.json).
   - List on **CoinGecko** and **CoinMarketCap**.

Verified source + real liquidity + a growing holder count is what moves a token
from “suspicious” to clean across all wallets.
