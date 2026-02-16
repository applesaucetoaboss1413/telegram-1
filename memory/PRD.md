# Telegram Face-Swap Bot - PRD

## Problem Statement
Bot buttons were leading to dead ends. "Create Video" required templates that users didn't have. "Buy Credits" was creating Stripe sessions in MXN with USD cent amounts (below Stripe minimum). Render build was failing because main branch was overwritten by a previous session.

## Architecture
- Node.js + Telegraf v4 + SQLite (better-sqlite3) + Stripe + a2e.ai API
- Hosted on Render.com (webhook mode)
- Mini app: Express static HTML

## What's Been Fixed (Feb 16, 2026)

### 1. Render Build Fix
- Root `package.json` added with correct scripts: `build: cd new_backend && npm install`, `start: cd new_backend && node index.js`
- Root `render.yaml` added with correct build/start commands
- Bot code moved to main branch structure

### 2. "Create Video" Button Fixed
- Removed template requirement from `demo_new` action
- Flow now: click Create -> pick duration -> send video -> send face photo -> a2e.ai processes -> result returned
- Added credit check before starting (redirects to buy/free credits if insufficient)

### 3. "Buy Credits" Button Fixed
- Changed all Stripe sessions from `currency: 'mxn'` to `currency: 'usd'`
- Stripe auto-converts to user's local currency
- No more minimum amount errors

### 4. Security Hardening
- Input validation: sanitizeInput(), isValidTelegramId()
- Rate limiting per user per action
- Deep link whitelist
- Global error handler (bot.catch + process handlers)
- Removed hardcoded admin IDs

## Files Modified
- `package.json` (root) - new, for Render deployment
- `render.yaml` (root) - new, deployment config
- `new_backend/index.js` - crash handlers, env validation cleanup
- `new_backend/src/bot.js` - button flow fixes, security, USD currency
- `new_backend/src/database.js` - removed hardcoded admin IDs
- `new_backend/src/server.js` - input validation, rate limiting
- `new_backend/src/services/a2eConfig.js` - added demoPrices, approx5sDemos

## Deployment Steps
1. Save to GitHub (pushes to main)
2. On Render: set Build Command to `cd new_backend && npm install`
3. On Render: set Start Command to `cd new_backend && node index.js`
4. Set ADMIN_IDS env var on Render
