# Google Anti Gravity Project Summary: Telegram FaceSwap & AI Bot

## 1. Project Overview
This project is a high-performance Telegram bot ecosystem designed for AI-driven face swapping and video content creation. It integrates Telegram's messaging capabilities with robust backend processing to deliver a seamless user experience for digital content transformation.

## 2. Core Features
- **AI FaceSwap:** State-of-the-art face swapping for both images and short videos.
- **Monetization System:** Integrated Stripe checkout for point purchases with tiered bonuses.
- **Viral Growth Engine:** Built-in referral system, daily check-ins, and promoter rewards (20% credit).
- **Community Integration:** Linked Telegram channel and discussion groups with automated leaderboards and announcements.

## 3. Technical Architecture
The system is currently undergoing an architectural evolution from a monolithic design to a modular, production-ready stack.

### 3.1 Current Stack (Legacy)
- **Runtime:** Node.js
- **Frameworks:** Express, Telegraf (Bot Framework), Multer
- **Persistence:** JSON-based local storage (`telegram_bot_data.json`).
- **Media Processing:** MagicAPI (FaceSwap), Fluent-FFmpeg.

### 3.2 Target Stack (New Backend Prototype)
- **Database:** SQLite (for ACID-compliant persistence).
- **Architecture:** Modular services (Queue, DB, FaceSwap, Payment).
- **Stability:** Dedicated job queue to handle long-running processing tasks and prevent data loss on server restarts.

## 4. Key Performance Gaps & Roadmap
The project is focused on transitioning to `new_backend` to address several critical needs:
- **Persistence Safety:** Replacing JSON file writes with SQLite to prevent data corruption.
- **Job Reliability:** Implementing a persistent queue for media processing.
- **Scalability:** Moving away from monolithic `server.js` toward a maintainable service-oriented architecture.
- **Resource Management:** Optimized file cleanup and handling of Telegram's large file limit restrictions.

## 5. Deployment Status
- **Development:** Active prototyping in `new_backend`.
- **Legacy Bot:** Operational via `backend/server.js`.
- **Infrastructure:** Target deployment requires VPS/Persistent storage for SQLite support.
