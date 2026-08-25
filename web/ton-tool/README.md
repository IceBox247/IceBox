# IceBox TON tool — Gram (Jetton) creator

Builds the browser bundle used by `web/public/create-ton-token.html` to let anyone
deploy a TON Jetton ("Gram") from the IceBox mini-app.

## What it does
- Connects the user's TON wallet via **TON Connect** (`tonconnect-manifest.json`).
- Deploys a **standard Jetton** (audited code from `@ton-community/assets-sdk`) with
  **on-chain metadata** (name, symbol, decimals, description, image URL) — no IPFS or
  API keys needed.
- Mints the full supply to the creator in the same transaction; creator becomes admin.
- Works on **TON testnet** (default) and **mainnet**, selectable in the UI.

## Build
```bash
cd web/ton-tool
npm install
npm run build      # -> ../public/ice-ton.js  (exposes window.IceTon)
```
The output is a single self-contained IIFE, inlined-style like the BEP-20 tool pages,
loaded via `<script src="/ice-ton.js">`. Rebuild and commit `web/public/ice-ton.js`
whenever `src/main.js` changes.

## Also included
- **Add liquidity** on STON.fi (`add-ton-liquidity.html`, `window.IceTon.addLiquidity`):
  resolves a v2.2 constant-product router from the STON.fi API (no hardcoded
  addresses) and sends the jetton side + TON side in one wallet-approved transaction.
  Mainnet only — STON.fi does not run on testnet.

- **My Tokens** (`my-ton-tokens.html`, `window.IceTon.listMyTokens`): lists the connected
  wallet's IceBox-created Grams across mainnet (607) and testnet (608).
- **Renounce admin / lock supply** (`window.IceTon.renounceAdmin`): hands the jetton admin
  to the zero address so supply is fixed forever. Offered after create and per-token in
  My Tokens. Irreversible.

## Roadmap (not yet built)
- Tax / sell-lock jettons require a **custom** jetton contract (the standard one has no
  transfer tax) — a separate contract-engineering effort, tested on testnet first.

## Safety
The on-chain deploy path handles real funds and **must be validated on testnet before
mainnet use**.
