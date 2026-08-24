# IceBox — Progress Log

A running record of every change: what, why, and the commit. Newest first.
Two branches ship every change: dev `claude/stake-to-earn-tiers-e9bh70`,
prod `claude/telegram-mini-app-fkt2aj` (Vercel production).

## Key facts (do not forget)
- **ICE liquidity is LIVE** and ICE trades on-chain. Price is read live from the LP pool.
- Mining rate = f(level). Level = f(on-chain HOLDING only) + migration bonus.
  The POOL wallet (earned/mined ICE) never counts toward level (runaway-loop fix).
- Level 0 (FROST) now earns a **base rate** (~0.7 ICE/day at base price; tapers as
  price rises). A user whose ICE sits in the Pool (not held in their own wallet)
  still mines the base. Env `MINE_LEVEL_BASE_YIELD` tunes it (default = level-1 base).
- USDT rewards/prizes are REAL money — never get the ICE ×multipliers.
- Verify the live mining rate at **`/api/rates`** (public, no Telegram auth).

## Log

### 339faea — Public /api/rates probe
Open `/api/rates` in any browser to see the live per-level ICE/day the running
build computes, bypassing the Telegram Mini App webview cache. Proves Level 0 > 0.

### 9313ea8 — Total USDT won on top mining ranks
Leaderboard top ranks now show expected daily USDT (headline) **and** total USDT
actually won so far (sub-line). Sums `mining_reward` type `usdt` ledger per user.

### 78636cf — Level 0 (FROST) base mining rate
Root cause of "0.000000 ICE/day for everyone": `baseYieldForLevel(0)` returned 0,
and with holdings in the Pool (not the wallet) everyone sat at Level 0. Now Level 0
earns a base floor. Fix is in both the displayed rate and the real accrual.

### f46b871 — Seamless Buy Level + expected USDT on leaderboard
`purchaseLevel()` spends deposited USDT → ICE holding credit at live price → raises
level. Green "⚡ Buy Level" button in the buy sheet. Leaderboard shows expected USDT.

### ed84149 — $100/day USDT ladder + daily winners post
USDT prizes 50/20/15/10/5 = $100/day. Daily top winners announced in the rewards chat.

### 08d94dc — Tasks: don't block claim when membership unverifiable
Task verify soft-fails when the bot can't read a partner channel (not admin), instead
of looping "Verifying…". `TASK_STRICT_VERIFY=true` to hard-block.

## Operator TODO (run once, on the live deploy)
- Set env: `BSCSCAN_API_KEY`, `REWARDS_CHANNEL` (rotate the BscScan key — was pasted in plaintext).
- Cron (all take `?secret=icebox12354`): `/api/cron/dedupe-wallets`, `/api/cron/resync-levels`,
  `/api/cron/reconcile-deposits`, `/api/cron/adjust-balance?...&amount=-8&bucket=deposited` (over-sent $8).
- Confirm the daily `/api/cron/payouts` runs so USDT "claimed" totals accrue.
