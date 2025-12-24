# Comprehensive Technical Analysis & Resolution Plan

## Root Cause Analysis
1.  **Strict API Input Validation**: The `Invalid swap_image` error (Error 400) confirms MagicAPI strictly enforces URL extensions (e.g., `.jpg`, `.png`). If Telegram's signed URLs lack these or expire, the API rejects them immediately.
2.  **Sequential Processing Bottleneck**: The current `QueueService` processes jobs one-by-one (`for...of` loop with `await`). If one job hangs or the queue builds up, all subsequent users experience severe delays, perceived as "performance issues".
3.  **Startup Misconfiguration**: The application was previously launching the legacy backend (`backend/server.js`) instead of the optimized one (`new_backend/index.js`), causing silent auth failures. This has been rectified.

## Architecture & Integration Review
-   **System**: Node.js Event Loop + Better-SQLite3 (Synchronous I/O) + Telegraf.
-   **Integration**: MagicAPI (External, REST).
-   **Performance Limiter**: Single-threaded polling mechanism blocks on every HTTP request to MagicAPI status endpoint.

## Actionable Recommendations (Implementation Plan)

### 1. Optimize Queue Throughput (Concurrency)
-   **Change**: Refactor `QueueService.poll` to use `Promise.all` with a concurrency limit (e.g., 5 parallel checks).
-   **Impact**: drastically reduces wait times when multiple jobs are pending.

### 2. Enforce Input Validity
-   **Change**: In `bot.js`, append a dummy query parameter or check extension on Telegram URLs to ensure they satisfy MagicAPI's regex checks if needed, or simply validate before sending.
-   **Impact**: Prevents 400 Bad Request errors and provides immediate feedback to users if their file is invalid.

### 3. Resilience & Feedback
-   **Change**: Add specific error handling for 400/401/429 status codes in `QueueService`.
-   **Change**: Emit 'processing_update' events to keep users informed during long waits.

I will now proceed to implement the concurrency improvements and validation fixes.