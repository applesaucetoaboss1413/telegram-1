# Telegram Face-Swap Bot - PRD & Progress

## Original Problem Statement
User reported their Telegram bot (@ImMoreThanJustSomeBot) had:
1. Hack attempts causing crashes (composer.js:519 error)
2. Stripe MXN minimum amount error: "$10.00 mxn" on micro pack
3. No input validation on any user-facing inputs
4. Other persistent problems (hardcoded admin IDs, missing config, no rate limiting)

## Architecture
- **Runtime**: Node.js (v22) with Telegraf v4
- **Database**: SQLite (better-sqlite3) - faceswap.db
- **Payments**: Stripe (MXN currency, Mexican account)
- **Hosting**: Render.com (webhook mode)
- **Services**: Face swap via a2e.ai API, Cloudinary for media
- **Mini App**: Express-served static HTML at /miniapp

## Core Requirements
- Telegram bot with face-swap video creation
- Credit system (buy packs, daily free credits, welcome bonus)
- Stripe checkout with MXN currency support
- Admin commands (stats, broadcast, flashsale)
- Promo scheduler for channel engagement

## What's Been Implemented (Feb 16, 2026)

### Fixes Applied:

#### 1. CRITICAL: Stripe MXN Currency Conversion (bot.js)
- `createStripeCheckoutSession()` now properly converts USD cents to MXN centavos
- Uses exchange rate API with 3% spread (same as server.js mini app checkout)
- Enforces Stripe MXN minimum of 1000 centavos ($10.00 MXN)
- All buy_pack actions and deep links now use proper conversion
- **Before**: 99 cents USD passed as 99 centavos MXN = $0.99 MXN (BELOW $10 MIN)
- **After**: 99 cents USD -> ~1835 centavos MXN = ~$18.35 MXN (VALID)

#### 2. Input Validation & Sanitization (bot.js)
- Deep link payload whitelist (VALID_DEEP_LINKS set)
- `sanitizeInput()` strips null bytes, control characters, limits length
- `isValidTelegramId()` validates user IDs are positive integers < 1e15
- All user inputs validated before processing

#### 3. Rate Limiting (bot.js + server.js)
- Per-user, per-action rate limiting:
  - Commands: 15/min
  - Payments: 5/min
  - Deep links: 10/min
  - Uploads: 5/5min
- HTTP endpoint rate limiting (IP-based)
- Periodic cleanup of stale rate limit entries

#### 4. Global Error Handler (bot.js + index.js)
- `bot.catch()` handler prevents Telegraf crashes
- `process.on('unhandledRejection')` catches async errors
- `process.on('uncaughtException')` logs and exits cleanly
- Users get friendly error messages instead of crashes

#### 5. Admin Security Hardening (bot.js + database.js)
- Removed hardcoded admin IDs (1087968824, 8063916626) from fallback values
- Admin commands now require ADMIN_IDS env var to be set
- Silent rejection of unauthorized admin commands (no "Admin only" message)
- Admin grant endpoint validates userId, amount, and rate limits

#### 6. Config Fix (a2eConfig.js)
- Added `demoPrices` config (5s: 60, 10s: 90, 15s: 125, 20s: 150 credits)
- Added `approx5sDemos` computed property to all packs
- Fixed references in promoScheduler.js and sendBuyPointsMenu()

#### 7. HTTP Endpoint Security (server.js)
- All mini app endpoints validate userId with `isValidUserId()`
- Error responses don't leak internal error messages
- Admin grant endpoint has proper rate limiting and input validation
- Checkout endpoint validates packType against whitelist

### Files Modified:
- `new_backend/index.js` - Cleaned up env validation, added crash handlers
- `new_backend/src/bot.js` - Major security hardening + Stripe fix
- `new_backend/src/database.js` - Removed hardcoded admin IDs
- `new_backend/src/server.js` - Input validation + rate limiting
- `new_backend/src/services/a2eConfig.js` - Added missing config properties

## Prioritized Backlog

### P0 (Critical)
- [x] Fix Stripe MXN minimum amount error
- [x] Add input validation
- [x] Add crash protection
- [x] Remove hardcoded credentials

### P1 (Important)
- [ ] Add webhook signature verification on Telegram webhook endpoint
- [ ] Add CORS restrictions on Express endpoints
- [ ] Add request body size limits on all POST endpoints
- [ ] Add Helmet.js for HTTP security headers

### P2 (Nice to Have)
- [ ] Add IP-based blocking for repeated abuse
- [ ] Add user ban/block list for spam users
- [ ] Add audit logging for admin actions
- [ ] Implement CAPTCHA for free credit claims
- [ ] Add rate limit headers (X-RateLimit-*) to HTTP responses

## Next Tasks
1. Deploy to Render and verify Stripe checkout works with MXN
2. Monitor logs for any remaining crash patterns
3. Add Helmet.js and CORS restrictions
4. Consider moving rate limit state to Redis for multi-instance support
