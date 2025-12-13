# Incident Post-Mortem: Telegram Bot Instability
**Date:** 2025-12-13

## 1. Issue Summary
The Telegram FaceSwap bot experienced recurring instability, characterized by:
- **Infinite Loops:** Users stuck in a loop between mode selection and photo upload.
- **Unresponsiveness:** Bot failing to reply to commands.
- **Job Failures:** FaceSwap tasks failing with generic errors.
- **Billing Errors:** Points deducted for failed tasks, and purchase not credited.

## 2. Root Cause Analysis
### A. Infinite Loop (State Loss)
- **Cause:** The bot relied on in-memory state (`DB` object) and local file persistence (`data.json`). In the Serverless deployment environment (Vercel), instances are ephemeral. State was lost between requests (Cold Starts), causing the bot to forget the user's progress.
- **Resolution:** Implemented a **Stateless Flow**. State is now encoded in the Telegram Chat History via `ForceReply` and context markers in messages.

### B. Unresponsiveness (Startup Conflict)
- **Cause:** The bot was configured to use `bot.launch()` (Polling) by default. In Serverless environments, Polling conflicts with the platform's request lifecycle, leading to timeouts and freezes.
- **Resolution:** Implemented intelligent startup logic that detects the environment. It now prefers **Webhooks** if `TELEGRAM_WEBHOOK_URL` is set, and falls back to Polling only for local development.

### C. Job Failures (File Access)
- **Cause:** The backend was downloading files to a local `/uploads` directory and passing these local paths to the external MagicAPI. In Serverless, the filesystem is not publicly accessible, so the API could not read the source images.
- **Resolution:** Updated `runFaceswap` to pass the **Direct Telegram File URL** (`ctx.telegram.getFileLink`) to the API, bypassing local storage requirements.

### D. Billing Errors
- **Cause:** Point deduction occurred *before* job success verification. Refund logic was missing for asynchronous failures.
- **Resolution:** Implemented automatic refund logic in the polling loop. If a job reports "failed" or "error", the points are immediately credited back to the user.

## 3. Implemented Solution & Prevention
- **Robust Startup:** `server.js` now performs a self-check for `BOT_TOKEN` and selects the correct connection mode.
- **Diagnostics:** Added `/debug-bot` endpoint and `check_health.js` script for easy troubleshooting.
- **Admin Tools:** Added `/admin/grant-points` endpoint and `restore_credits_manual.js` for customer support.
- **Error Handling:** Added global error handlers to prevent process crashes from unhandled rejections.

## 4. Recommendations
1.  **Deployment:** Ensure `TELEGRAM_WEBHOOK_URL` is set in Vercel to `https://<your-project>.vercel.app/telegram/webhook`.
2.  **Monitoring:** Use the `/debug-bot` endpoint to verify health.
3.  **Storage:** For long-term persistence of user points, migrate from `data.json` to a real database (Redis/Postgres/MongoDB).
