## Summary of Findings
- Two backends exist and conflict:
  - Root app starts `backend/server.js` (`package.json:6`).
  - Working bot is in `new_backend/index.js` (`new_backend/index.js:1–39`).
- `backend/server.js` expects `.env` inside `backend/` and supports webhook/polling (`backend/server.js:1095–1104`, `backend/server.js:1032–1068`).
- `new_backend` has `.env` with `BOT_TOKEN` but runs only in polling mode (`new_backend/src/bot.js:11`, `new_backend/index.js:25–31`).
- If you run `npm start` from repo root, the bot likely fails because `backend/.env` is missing and `BOT_TOKEN` is not set (`backend/server.js:1099–1101`).

## Proposed Changes
1. Unify startup to use `new_backend` by default
- Update the root start script to `node new_backend/index.js`.
- Document clearly how to run locally and in production.

2. Add webhook support to `new_backend`
- Mount `app.use('/telegram/webhook', bot.webhookCallback('/telegram/webhook'))` in `new_backend/src/server.js`.
- In `new_backend/index.js`, if `PUBLIC_URL` or `TELEGRAM_WEBHOOK_URL` is set:
  - Call `bot.telegram.setWebhook(<PUBLIC_URL>/telegram/webhook)` and do not call `bot.launch()`.
  - Otherwise, delete webhook and start polling.

3. Standardize environment management
- Keep a single `.env` in `new_backend/` and load it for both bot and server.
- Remove reliance on `backend/.env` to avoid confusion.

4. Hardening and diagnostics
- Ensure Node ≥ 18 or add `node-fetch` import for health check (`new_backend/src/health.js:21`).
- Add clear startup logs for webhook vs polling selection.

## Verification Plan
- Local: Run `node new_backend/index.js` and verify:
  - Bot prints “Telegram Bot Started” (polling) (`new_backend/index.js:27–31`).
  - `/health` returns healthy (`new_backend/src/server.js:88–106`).
- Webhook: Set `PUBLIC_URL` to a reachable domain, verify `setWebhook` succeeds and messages arrive via webhook (`backend/server.js:1046–1051` as reference behavior).
- Deploy: Confirm server stays alive and bot responds to `/start`, photo/video flows, and Stripe webhook receives events (`new_backend/src/server.js:26–80`).

## Notes on MagicAPI Usage Overrides
- The override mechanisms you pasted are for API store creators to adjust billing; this bot is an API consumer. We won’t add override headers unless you control the MagicAPI store and provide an admin key. If needed, we can add a background task to call `/overrideCustomUsage` with your admin key after jobs complete.