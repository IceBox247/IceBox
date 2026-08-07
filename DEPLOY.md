# 🚀 Deploying IceBox to Vercel (all-in-one)

IceBox runs entirely on Vercel: the **web app** as static output and the
**API + Telegram bot** as a single serverless function (`api/[...path].ts`).
The database is **PostgreSQL** (Neon works great and has a free tier).

```
Browser / Telegram ──▶ Vercel
                        ├─ /            → static web app (web/dist)
                        ├─ /api/*       → serverless Express (api/[...path].ts)
                        └─ /api/bot     → Telegram webhook (same function)
                                   │
                                   ▼
                             Neon PostgreSQL
```

---

## 1. Create a Postgres database (Neon)

1. Sign up at <https://neon.tech> → **New Project**.
2. Copy two connection strings from the dashboard:
   - **Pooled** (host contains `-pooler`) → this is `DATABASE_URL`
   - **Direct** (no `-pooler`) → this is `DIRECT_URL`
   Both should end with `?sslmode=require`.

> Any Postgres works (Supabase, Railway, RDS…). Neon's pooled URL is the
> serverless-friendly default.

## 2. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → get the **token**.
2. `/newapp` (or **Bot Settings → Configure Mini App**) and, after the first
   deploy, set the Mini App URL to your Vercel domain (step 5).
3. Note the bot **username** (without `@`).

## 3. Push the code to GitHub

The repo is already a git project. Push your branch to GitHub so Vercel can
import it.

## 4. Import the project into Vercel

1. <https://vercel.com/new> → **Import** your GitHub repo.
2. Framework preset: **Other** (the included `vercel.json` handles the build).
   - Build command / output dir are already set (`web/dist`).
3. Add **Environment Variables** (Production + Preview):

   | Key                       | Value                                             |
   | ------------------------- | ------------------------------------------------- |
   | `DATABASE_URL`            | Neon **pooled** connection string                 |
   | `DIRECT_URL`              | Neon **direct** connection string                 |
   | `BOT_TOKEN`               | BotFather token                                   |
   | `BOT_USERNAME`            | your bot username (no `@`)                         |
   | `WEBAPP_URL`              | `https://<your-project>.vercel.app`               |
   | `PUBLIC_URL`              | `https://<your-project>.vercel.app`               |
   | `TELEGRAM_WEBHOOK_SECRET` | random string — `openssl rand -hex 16`            |
   | `REFERRAL_REWARD`         | `2` (optional)                                     |
   | `MIN_WITHDRAWAL`          | `18` (optional)                                    |
   | `SIGNUP_BONUS`            | `0.30` (optional)                                  |

   `BOT_MODE` is auto-set to `webhook` on Vercel — no need to add it.
   Leave `CORS_ORIGIN` and `VITE_API_BASE` empty (web + api share the domain).

4. **Deploy.** `postinstall` runs `prisma generate` automatically; the function
   is bundled with the Postgres client.

## 5. Point the bot & Mini App at the domain

After the first successful deploy you have `https://<project>.vercel.app`.

1. In BotFather, set the **Mini App URL** to that domain.
2. If you used a placeholder earlier, update `WEBAPP_URL` / `PUBLIC_URL` env vars
   to the real domain and redeploy.

## 6. Initialise the database schema

Run once from your machine (uses the **direct** URL):

```bash
# from the repo root, with the two Neon URLs exported
export DATABASE_URL="postgresql://...-pooler...?sslmode=require"
export DIRECT_URL="postgresql://...direct...?sslmode=require"

npm run db:push     # create tables
npm run seed        # load the default task list
```

> Prefer migrations? Use `npx prisma migrate deploy` instead of `db:push`.

## 7. Register the Telegram webhook

```bash
export BOT_TOKEN="123456:ABC..."
export PUBLIC_URL="https://<project>.vercel.app"
export TELEGRAM_WEBHOOK_SECRET="the-same-secret-you-set-in-vercel"

npm run set-webhook            # → sets webhook to $PUBLIC_URL/api/bot
# npm run set-webhook -- --delete   # to remove it
```

Telegram will now POST updates to `/api/bot`, authenticated by the secret token.

## 8. Verify

- Visit `https://<project>.vercel.app/api/health` → `{"ok":true,"mode":"webhook"}`.
- Open the bot in Telegram → `/start` → tap **Open IceBox Wallet**.
- The Mini App loads, shows your balance, tasks and referrals.

---

## Local development

Local dev uses long polling and a Postgres database (a free Neon dev branch is
easiest):

```bash
cp .env.example .env      # fill DATABASE_URL, DIRECT_URL, BOT_TOKEN, BOT_USERNAME
#   for UI-only work without Telegram, set DEV_ALLOW_UNSIGNED=true
npm install
npm run db:setup && npm run seed
npm run dev               # web :5173 (proxies /api → server :3000)
```

`BOT_MODE` defaults to `polling` locally, so the bot long-polls and no webhook
is needed.

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `/api/*` returns 500 with a Prisma error | `DATABASE_URL`/`DIRECT_URL` env vars missing or wrong; must be the Neon strings. Re-run `npm run db:push`. |
| Prisma engine "not found" on Vercel | Ensure the deploy ran `postinstall` (it's in root `package.json`). The schema already targets `rhel-openssl-*`. Redeploy. |
| Bot doesn't respond | Re-run `npm run set-webhook`; check `getWebhookInfo` output and that `TELEGRAM_WEBHOOK_SECRET` matches the Vercel env var. |
| 401 on every API call | The app is opened outside Telegram (no signed `initData`). Open it via the bot's Mini App button. |
| Too many DB connections | Use the **pooled** Neon URL for `DATABASE_URL` (serverless opens many short-lived connections). |
