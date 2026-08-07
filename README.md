# ❄️ IceBox — Telegram Mini App Wallet

A Telegram Mini App "airdrop wallet": users earn **USDT** by completing tasks and
inviting friends, then withdraw to their wallet. Inspired by the Bee Wallet
reference, rebuilt with the **IceBox** ice-blue brand.

<p align="center"><em>First Telegram no-fee wallet — earn, refer, withdraw.</em></p>

## ✨ Features

- **Home** — total balance (USDT + USD equiv.), Withdraw & History, and an
  overview of Total Earned, Referrals, Tasks Done and Available balance.
- **Tasks** — join channels, visit sites (with a timed gate), watch ads
  (repeatable), each crediting USDT. Server is the source of truth.
- **Referrals** — per-invite reward, shareable deep link, live stats and a
  **Top 100 leaderboard** with a prize table.
- **Withdraw flow** — minimum-withdrawal gate ("Not Enough Balance → Earn More")
  and multi-network payout requests (TON / TRC20 / BEP20).
- **Menu & History sheets** — refresh balance, withdrawal history, invite friends.
- **Telegram bot** — `/start` deep-links referral codes and launches the Mini App.
- **Secure auth** — every API call validates Telegram `initData` via HMAC-SHA256.

## 🧱 Tech stack

| Layer     | Tech                                                        |
| --------- | ---------------------------------------------------------- |
| Frontend  | React 18, Vite, TypeScript, Tailwind CSS, Telegram WebApp  |
| Backend   | Node.js, Express, Prisma ORM                               |
| Database  | PostgreSQL (Neon-friendly, pooled connection)              |
| Bot       | grammY (long polling locally, webhook on Vercel)           |
| Hosting   | **Vercel** — static web + serverless API in one project    |

Monorepo with npm workspaces: [`web/`](web) (mini app), [`server/`](server)
(API + bot), and [`api/`](api) (the Vercel serverless entry that mounts the
Express app). **Deploys entirely to Vercel** — see [DEPLOY.md](DEPLOY.md).

## 🚀 Quick start

```bash
# 1. Install (root installs both workspaces)
npm install

# 2. Configure environment
cp .env.example .env
#   → set DATABASE_URL + DIRECT_URL (a free Neon Postgres works great)
#   → set BOT_TOKEN (from @BotFather) and BOT_USERNAME
#   → for browser testing without Telegram, set DEV_ALLOW_UNSIGNED=true

# 3. Create the database + seed tasks
npm run db:setup   # prisma generate + db push
npm run seed       # load the default task list

# 4. Run both apps (server :3000, web :5173)
npm run dev
```

Open http://localhost:5173. With `DEV_ALLOW_UNSIGNED=true` a mock "Dev" user is
created so you can click through the UI outside Telegram. Add `?ref=<code>` to
simulate a referral.

## ☁️ Deploy to Vercel

The whole app — static frontend **and** the API + Telegram bot — deploys to a
single Vercel project. Full step-by-step (Neon Postgres, env vars, webhook) is
in **[DEPLOY.md](DEPLOY.md)**. In short:

1. Create a Neon Postgres DB → grab the pooled + direct URLs.
2. Import the repo at <https://vercel.com/new> and add the env vars.
3. Deploy → `npm run db:push && npm run seed` (once) → `npm run set-webhook`.

On Vercel the bot runs via **webhook** (`/api/bot`); locally it uses long
polling. Referral links look like:
`https://t.me/<BOT_USERNAME>/wallet?startapp=ref_<code>`

## 📡 API

All `/api/*` routes require the header `Authorization: tma <initData>`.

| Method | Route                     | Purpose                               |
| ------ | ------------------------- | ------------------------------------- |
| GET    | `/api/health`             | Liveness (no auth)                    |
| GET    | `/api/me`                 | User + overview + config + ref link   |
| GET    | `/api/tasks`              | Tasks with per-user completion state  |
| POST   | `/api/tasks/:id/claim`    | Credit a task reward                  |
| GET    | `/api/referrals`          | Link, stats, referrals, leaderboard   |
| GET    | `/api/withdrawals`        | Payout history                        |
| POST   | `/api/withdrawals`        | Request a withdrawal (min-gated)      |

## 🗄️ Data model

`User` (balance, totalEarned, referral graph) · `Task` / `TaskCompletion` ·
`Withdrawal` · `LedgerEntry` (immutable audit trail of every balance change).
See [`server/prisma/schema.prisma`](server/prisma/schema.prisma).

## ⚙️ Configuration (`.env`)

| Var                  | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `BOT_TOKEN`          | BotFather token (enables bot + initData check)     |
| `BOT_USERNAME`       | Bot username (builds referral links)               |
| `WEBAPP_URL`         | Public URL of the Mini App                         |
| `REFERRAL_REWARD`    | USDT paid per referral (default 2)                 |
| `MIN_WITHDRAWAL`     | Minimum withdrawal in USDT (default 18)            |
| `SIGNUP_BONUS`       | Welcome credit for new users (default 0.30)        |
| `DEV_ALLOW_UNSIGNED` | Bypass initData for browser testing (**dev only**) |

## 🔐 Security notes

- `initData` is validated with the official HMAC-SHA256 algorithm and an
  `auth_date` freshness window before any user is trusted.
- Balances change only inside DB transactions; every change writes a
  `LedgerEntry`. Task/withdrawal caps and minimums are enforced server-side.
- `DEV_ALLOW_UNSIGNED` must be **off** in production.

## 📦 Production build

```bash
npm run build          # builds server (tsc) and web (vite)
npm start              # runs the server; serves web/dist if built
```

## ⚠️ Disclaimer

This is a demonstration project. "Airdrop", reward and prize figures shown in the
UI are illustrative. Operating a real token-reward or payout program may be
subject to financial regulations in your jurisdiction — get appropriate advice
before going live, and wire withdrawals to a real, audited payout system.

## License

MIT
