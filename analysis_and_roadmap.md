# FaceSwap Telegram Bot - Research & Technical Analysis

## 1. Research Phase: Reference Architectures

### 1.1 Active Projects
We identified several key players in the Telegram FaceSwap space:

| Project | Stack | Key Features | Pros | Cons |
|---------|-------|--------------|------|------|
| **Adjuface** | Python, ONNX, InsightFace | Local processing, Custom targets, Menu system | Privacy, Free (self-hosted) | High GPU reqs, Setup complexity |
| **FaceMagic** | Proprietary API | Multi-face, Video/GIF support, High quality | Great UX, Fast | Paid, Closed source |
| **MyFaceSwap** | Python/Node | Simple 1-to-1 swap | Easy to use | Limited features |

### 1.2 Comparison Matrix

| Feature | Reference Standard (Adjuface/FaceMagic) | Current Implementation | Gap |
|---------|-----------------------------------------|------------------------|-----|
| **Architecture** | Microservices / Worker Queues | Monolithic `server.js` | High risk of blocking/crash |
| **Processing** | Async Job Queues (Celery/Bull) | In-memory polling (`setTimeout`) | Data loss on restart |
| **State** | Persistent DB (Postgres/Redis) | In-memory object + JSON file | Race conditions, Scalability limits |
| **UX** | Menu-driven, Persistent User Gallery | Command/Reply flow | Clunky for frequent users |
| **Payment** | Integrated Credits/Sub | Stripe Link (Basic) | Functional but basic |

## 2. Technical Analysis: Current System Audit

### 2.1 System Architecture
- **Type:** Monolithic Node.js Application
- **Entry Point:** `imported/Telegram/backend/server.js`
- **Frameworks:** Express (API), Telegraf (Bot), Multer (Uploads)
- **External Dependencies:** MagicAPI (FaceSwap), Stripe (Payments), Telegram API

### 2.2 Critical Issues Identified

#### A. State Management & Persistence
- **Current:** Uses a global `DB` object synced to `telegram_bot_data.json` via `fs.writeFileSync`.
- **Risk:** High.
    -   **Race Conditions:** Concurrent writes can corrupt the JSON file.
    -   **Data Loss:** If the server crashes during a write or before `saveDB()` is called, data (credits, pending jobs) is lost.
    -   **Scalability:** The JSON file will grow indefinitely, slowing down read/write operations.

#### B. Job Processing (Polling)
- **Current:** `pollMagicResult` function uses recursive `setTimeout`.
- **Risk:** Medium.
    -   **Memory Leaks:** If thousands of jobs are pending, thousands of timers are created.
    -   **Restart Vulnerability:** If the server restarts, all running `setTimeout` loops are killed. The `recovery` logic exists (lines 452-465) but relies on `DB.pending_swaps`.

#### C. File Handling
- **Current:** Downloads files to `os.tmpdir()` or `backend/uploads`.
- **Risk:**
    -   **Disk Space:** No automatic cleanup cron job (only `cleanupFiles` called in specific paths). `tmpdir` might fill up.
    -   **Public Access:** MagicAPI needs public URLs. The code uses `ctx.telegram.getFileLink`. This is a *good* approach as it avoids hosting files ourselves, BUT it depends on MagicAPI being able to fetch from Telegram's API servers.

#### D. Code Structure
- **Current:** Single file (`server.js`) containing:
    -   Express Server
    -   Telegram Bot Logic
    -   Stripe Webhooks
    -   MagicAPI Integration
    -   File Utilities
    -   In-memory DB logic
- **Impact:** Hard to maintain, test, and debug.

### 2.3 Implementation Roadmap (Proposed)

We will rebuild the system with a modular architecture:

1.  **Project Structure:**
    -   `src/bot/`: Telegraf handlers (Commands, Actions, Events).
    -   `src/api/`: Express routes (Stripe, Admin).
    -   `src/services/`: Core logic (Queue, FaceSwap, User, Payment).
    -   `src/db/`: Database adapter (SQLite/JSON-wrapper with improved safety).
    -   `src/utils/`: Helpers (File download, Logger).

2.  **Key Improvements:**
    -   **Robust Polling:** Use a proper Job Queue (e.g., `bull` or a persistent SQL-backed queue) to survive restarts.
    -   **Modular Code:** Separation of concerns.
    -   **Enhanced Logging:** Structured logs for debugging.
    -   **Error Handling:** Global error handler and graceful degradation.

3.  **Validation:**
    -   Unit tests for Services.
    -   Integration tests for API.
