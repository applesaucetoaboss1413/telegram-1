# Telegram Face-Swap Bot - PRD

## Problem Statement
Bot buttons were dead ends. Channel deep links (t.me/bot?start=create, t.me/bot?start=buy_micro) opened DM but nothing happened because:
1. "Create Video" flow required uploaded templates (which no user had) → dead end
2. "Buy Credits" flow used MXN currency with USD cent amounts → Stripe rejected all sessions below $10 MXN minimum → silent failure
3. Render build failing because main branch had no package.json (overwritten by previous session)

## Architecture
- Node.js + Telegraf v4 + SQLite (better-sqlite3) + Stripe + a2e.ai API
- Hosted on Render.com (webhook mode)
- Mini app: Express static HTML at /miniapp
- Code in /app/new_backend/

## What's Been Fixed (Feb 16, 2026)

### 1. "Create Video" Flow Fixed
- `create` deep link: removed template requirement, goes directly to video→photo→faceswap flow
- `create_5s`, `create_10s`, `create_20s`: all changed from `create_video` mode (template-dependent) to `demo` mode (direct faceswap)
- `demo_new` action: same fix, no templates needed
- All create flows now check credits upfront and redirect to buy/free if insufficient
- Flow: User clicks Create → prompted for video → prompted for face photo → sent to a2e.ai → result returned

### 2. "Buy Credits" Flow Fixed
- Changed ALL Stripe checkout sessions from `currency: 'mxn'` to `currency: 'usd'`
- Stripe auto-converts to user's local currency at checkout
- No more minimum amount errors

### 3. Render Build Fixed
- Root `package.json` with: `build: cd new_backend && npm install`, `start: cd new_backend && node index.js`
- Root `render.yaml` with correct build/start commands
- Bot code now on main branch when user saves to GitHub

### 4. Security Hardening
- Input validation, rate limiting, deep link whitelist
- Global error handler (bot.catch + process handlers)
- Removed hardcoded admin IDs

## Test Results
- 53/53 flow simulation tests passing
- Testing agent: 100% backend success rate
- All syntax checks passing

## Deployment
1. User clicks "Save to GitHub" → pushes to main
2. Render: Build Command: `cd new_backend && npm install`
3. Render: Start Command: `cd new_backend && node index.js`
4. Set ADMIN_IDS env var
