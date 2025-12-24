## References to Base Our Fixes On
- Telegraf framework examples (webhook + graceful stop) — https://github.com/telegraf/telegraf
- Payments with Telegraf — https://github.com/muety/telegram-payment-bot
- FaceSwap flow reference (multi-step image swap) — https://github.com/Dimildizio/Adjuface
- MagicAPI FaceSwap endpoints — Image JSON and Capix form-encoded video

## What We’ll Implement
- Usage monitoring via API.market Usage API (per-product and all-subscriptions)
- Correct payload types for FaceSwap:
  - Image: JSON (`swap_image`, `target_image`)
  - Video (Capix): x-www-form-urlencoded (`swap_url`, `target_url`)
- Robust webhook launch and graceful shutdown (no “Bot is not running!”)
- Cleaner bot commands and diagnostics for operability

## Changes (Files & Code)
- Add `src/services/usageClient.ts` (or `backend/services/usageClient.js`):
  - `getUsageFor(productSlug)`: GET `https://prod.api.market/api/v1/user/usage/{storeSlug}/{apiProduct}/`
  - `getAllUsage()`: GET `https://prod.api.market/api/v1/user/usage/`
  - Headers: `x-magicapi-key`, `accept: application/json`
- Update FaceSwap calls:
  - Image endpoint: keep JSON body
  - Video endpoint: send `URLSearchParams` with form-encoded body; set `Content-Type: application/x-www-form-urlencoded`
- Bot diagnostics:
  - `/usage` command: returns remaining calls for FaceSwap product
  - `/status` includes quota snapshot
  - `diagnostics/test-usage.js` script to validate API key and endpoints
- Webhook and shutdown:
  - Ensure webhook middleware mounts before `listen`
  - Track `isBotRunning` and wrap `bot.stop()` in try/catch
- Env & config:
  - Require `API_MARKET_KEY` for Usage API
  - Keep `PUBLIC_URL`/`RENDER_EXTERNAL_URL` for webhook

## Deployment & Verification
- Run diagnostics: `test-usage`, `test-webhook`
- Send image/video to bot; confirm swap endpoints respond
- Verify logs show webhook OK and no shutdown exceptions

## Optional Refactor (after stabilization)
- Split `server.js` into `bot.js`, `payments.js`, `faceswap.js`, `usageClient.js` for maintainability

If this plan looks good, I’ll implement the changes, add the diagnostics, and verify end-to-end on Render.