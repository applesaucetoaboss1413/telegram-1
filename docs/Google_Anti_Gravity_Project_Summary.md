# Google Anti Gravity — Project Summary and Handover

## Table of Contents
- 1. Project Background
- 2. Project Objectives
- 3. Technical Implementation
- 4. Operational Procedures
- 5. Knowledge Transfer
- 6. Next Steps
- 7. Credentials and API Keys
- 8. Production Readiness & 24/7 Stability

## 1. Project Background
- Current Status of Spam Prevention Efforts
  - Promo messaging control added with strict gating and safe defaults to prevent channel spam. See `backend/server.js:281` (`startPromoLoop`) with interval clamping and an explicit kill switch (`PROMO_ENABLED`) at `backend/server.js:282`.
  - Channel identifiers normalized to support `@username` and `t.me/<channel>` formats. See `backend/server.js:266` (`normalizePromoChatId`).
  - Render health endpoint is online for monitoring service liveness: `backend/server.js:964` (`GET /healthz`).
- Key Challenges and Threats Addressed
  - Unbounded promo intervals causing rapid-fire posts when misconfigured.
  - Incorrect channel identifiers causing send failures or fallback loops.
  - Webhook vs polling misconfiguration leading to message backlog or non-responsiveness.
  - External dependency instability (payment provider and face swap API) affecting user flow reliability.
- Technical Approach Used to Stop the Spam
  - Environment-gated promo loop with interval lower-bound (`>= 15 minutes`) and safe default (`1 hour`) to avoid burst posting. See `backend/server.js:296`.
  - Centralized normalization of channel identifiers to reduce format errors. See `backend/server.js:266`.
  - Explicit kill switch via `PROMO_ENABLED=0` for immediate cessation of automated posts. See `backend/server.js:282`.
- Result Channels (Automated Posting)
  - Successful Image swaps are posted to `@faceswapchat` (configurable via `CHANNEL_ID`).
  - Successful Video swaps are posted to `@faceswapvidz` (configurable via `CHANNEL_VIDEO`).
  - Implementation: `backend/server.js:347` (`sendToResultChannel`).

## 2. Project Objectives
- Primary Goals and Success Metrics
  - Zero unintended spam: no more than one promo per configured interval to a designated channel.
  - Automatic posting of results: images to `@faceswapchat`, videos to `@faceswapvidz`.
  - 24/7 bot responsiveness under Webhook mode on Render; fallback Polling mode available locally.
  - Stable face swap operations (image/video) with clear user guidance.
  - Reliable payments and crediting via Stripe.
- Expected Outcomes and Deliverables
  - Hardened configuration model preventing spam from misconfiguration.
  - Automated result sharing in designated Telegram channels.
  - Documented operational runbooks, monitoring and incident workflows.
  - Integration references and environment templates for Render and Stripe.
- Long-Term Vision for the Solution
  - Extensible policy engine for content scheduling and rate limits.
  - Auditable operations with structured logs and periodic health reporting.
  - Modular architecture to plug in additional anti-abuse signals in the future.

## 3. Technical Implementation
- Architecture Overview
  ```
  [Telegram Users]
        |
        v
  [Telegram Bot API] <---> [Telegraf Bot]  (Webhook/Polling)
        |
        |                        v
        |                 [Express Server]
        |
        |           +------------+------------+----------------+
        |           |                         |                |
        v           v                         v                v
  [Promo Control]  [FaceSwap API]      [Stripe Payments]  [Result Channels]
        |           (MagicAPI/Capix)    (checkout/webhook) (@faceswapchat/vidz)
        |                 |                   |                |
        +------------> [Outputs] <------------+----------------+
  ```
- Critical Components and Their Functions
  - Telegraf Bot
    - Commands: `faceswap` (`backend/server.js:647`), `imageswap` (`backend/server.js:657`), payment/points UI actions (`backend/server.js:575`–`backend/server.js:618`).
    - Webhook configuration: `WEBHOOK_PATH='/telegram/webhook'` at `backend/server.js:969`; webhook setup at `backend/server.js:992`; middleware mount at `backend/server.js:988`.
  - Promo Loop
    - Initialization call: `startPromoLoop()` at `backend/server.js:1013`.
    - Interval clamping: `backend/server.js:296` (minimum 15 minutes, default 1 hour).
    - Kill switch: `PROMO_ENABLED` gating at `backend/server.js:282`.
    - Channel normalization: `backend/server.js:266`.
  - Result Channels Handler
    - Successful swaps are dispatched to public channels via `sendToResultChannel` (`backend/server.js:347`).
    - Configured via `CHANNEL_ID` and `CHANNEL_VIDEO`.
  - FaceSwap HTTP Endpoint
    - `POST /faceswap` media handling and MagicAPI integration at `backend/server.js:755`.
    - MagicAPI call wrapper with retry: `backend/server.js:310`; usage in HTTP flow: `backend/server.js:816`.
  - Payments (Stripe)
    - In-bot checkout creation: `stripe.checkout.sessions.create` at `backend/server.js:587`.
    - API endpoints for checkout and confirmation:
      - `POST /create-point-session` at `backend/server.js:861` (creates Session via Stripe).
      - `POST /confirm-point-session` at `backend/server.js:901` (verifies payment and credits points).
    - Webhook listener: `POST /stripe/webhook` at `backend/server.js:941` and event construction at `backend/server.js:944`.
  - Health and Boot
    - Health check endpoint: `GET /healthz` at `backend/server.js:964`.
    - Server listen (Render-PORT aware): `backend/server.js:1039`, `PORT` sourced from env at `backend/server.js:27`.
- Integration Points with Existing Systems
  - Telegram
    - Webhook path: `https://<PUBLIC_URL>/telegram/webhook` (POST only). A GET request returns “Cannot GET /telegram/webhook” by design.
    - BOT token: `BOT_TOKEN` required.
    - Result Channels: `@faceswapchat` (images), `@faceswapvidz` (videos).

## 8. Production Readiness & 24/7 Stability
To ensure the bot is production-ready and running 24/7, the following optimizations have been implemented:
- **Non-blocking Background Processing**: The bot now acknowledges Telegram webhooks immediately and processes heavy face swap tasks in the background. This prevents Telegram from timing out and retrying requests, which was previously causing infinite loops and unresponsiveness.
- **Global Error Handling**: Added `bot.catch` to prevent the entire server from crashing when a single user encounters an error or sends malformed data.
- **Self-Ping (Keep-Alive)**: A built-in ping mechanism runs every 10 minutes to try and keep the Render instance awake. 
- **Recommendation for 24/7 Uptime**: For absolute 100% reliability and to eliminate "cold starts," it is highly recommended to upgrade the Render service from the "Free" plan to a "Starter" or "Individual" plan. This prevents the service from sleeping after 15 minutes of inactivity.
  - Render
    - Port binding via `PORT` env; Render default is `10000`. Ensure binding to `0.0.0.0`. See service logs and `backend/server.js:1039`.
    - Health check: point to `/healthz` for proactive monitoring.
    - API usage: `rnd_VYV2msJPYQiL4xNA0HlxfFgcMDZq` (for management automation).
  - MagicAPI/Capix
    - Uses V2 endpoints in `/faceswap` flow; requires `MAGICAPI_KEY` or `API_MARKET_KEY`.
  - Stripe
    - Secret keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
    - Checkout session metadata used for user crediting in webhook and confirmation.

## 4. Operational Procedures
- Maintenance Requirements
  - Rotate secrets quarterly: `BOT_TOKEN`, `MAGICAPI_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RENDER_API_KEY`.
  - Validate promo configuration after any environment change: `PROMO_ENABLED`, `PROMO_INTERVAL_MS`, `PROMO_CHANNEL_ID`.
  - Validate result channel configuration: `CHANNEL_ID`, `CHANNEL_VIDEO`.
  - Keep dependencies up to date per `backend/package.json`.
- Monitoring and Alerting Protocols
  - Uptime and liveness: poll `GET /healthz` (`backend/server.js:964`).
  - Log monitoring: watch for `[CHANNEL] Failed to send` errors in Render logs to identify channel posting issues.
  - Job failure tracking: monitor `DB.api_results` for high failure rates.
- Incident Response Workflow
  - Webhook failure: if bot stops responding, check `setWebhook` output in logs. Use `test-webhook.js` diagnostic.
  - Spam burst: set `PROMO_ENABLED=0` in Render environment and redeploy.
  - Payment failure: verify `STRIPE_WEBHOOK_SECRET` matches Render config and Stripe dashboard.

## 5. Knowledge Transfer
- Complete System Documentation
  - This summary document serves as the primary handover guide.
  - Detailed inline code comments explain queueing, retry logic, and media normalization.
- Troubleshooting Guide
  - "Bot doesn't respond": check `PUBLIC_URL` and `BOT_TOKEN`. Ensure no trailing slashes on URLs.
  - "Faceswap fails": verify `MAGICAPI_KEY` has active V2 subscription and credits.
  - "Promo spamming": ensure `PROMO_INTERVAL_MS` is set (minimum 900,000ms/15m).
  - "Results not in channel": ensure the bot is an Administrator in `@faceswapchat` and `@faceswapvidz` with "Post Messages" permission.
- Contact Points for Technical Support
  - Core Developer: [Add contact details here]
  - API Providers: MagicAPI Support (MagicAPI Dashboard), Stripe Support.

## 6. Next Steps
- Immediate Action Items
  - [ ] Set `CHANNEL_ID=@faceswapchat` and `CHANNEL_VIDEO=@faceswapvidz` in Render environment.
  - [ ] Add bot as Administrator to `@faceswapchat` and `@faceswapvidz`.
  - [ ] Finalize Stripe webhook endpoint registration in Stripe Dashboard.
- Timeline for Full Handover
  - Current Phase: Implementation of automated result channels complete.
  - Next Phase: Final verification of payment flows and production load testing.
- Key Milestones and Review Points
  - Milestone 1: Spam-free promo cycle verified (1 hour interval).
  - Milestone 2: Automated result posting verified for both image and video.
  - Milestone 3: First production Stripe payment successful and credited.

## 7. Credentials and API Keys
- **Telegram Bot Token**: `BOT_TOKEN`
- **Render API Key**: `rnd_VYV2msJPYQiL4xNA0HlxfFgcMDZq` (Used for Render management)
- **MagicAPI Key**: `MAGICAPI_KEY` / `API_MARKET_KEY`
- **Stripe Secret**: `STRIPE_SECRET_KEY`
- **Stripe Webhook Secret**: `STRIPE_WEBHOOK_SECRET`
- **Public URL**: `PUBLIC_URL` (e.g., `https://telegram-d0ui.onrender.com`)
- **Result Channels**:
  - Image: `@faceswapchat` (`CHANNEL_ID`)
  - Video: `@faceswapvidz` (`CHANNEL_VIDEO`)

---

### Configuration Summary (Environment Variables)
- `BOT_TOKEN` (Telegram)
- `PUBLIC_URL` (Render public web service URL)
- `RENDER_EXTERNAL_URL` (Render-provided)
- `MAGICAPI_KEY` or `API_MARKET_KEY` (FaceSwap API)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe)
- `PROMO_ENABLED` (`0/false/off` to disable promo loop; default enabled)
- `PROMO_CHANNEL_ID` (`@username` or `t.me/<username>`)
- `PROMO_INTERVAL_MS` (minimum `900000`; default `3600000`)
- `PORT` (Render sets to `10000`; server binds via `backend/server.js:1039`)

