# AI Coding Assistant Instructions

## Architecture Overview
This is a Telegram bot service with integrated faceswap functionality using Express.js backend and Telegraf bot framework. Core components:
- **Bot Interface**: Handles user commands (/start, /faceswap) and media uploads via Telegram API
- **Payment System**: Stripe integration for point purchases with multi-currency support
- **Faceswap Processing**: MagicAPI integration with async polling for video/image swaps
- **Data Persistence**: In-memory database with JSON file backup (`backend/data.json`)
- **File Management**: Temporary storage in `os.tmpdir()` for serverless compatibility

## Key Patterns & Conventions

### Point System & User Management
- Users start with 10 points, faceswaps cost 9 points each
- Use `getOrCreateUser(id, fields)` for user operations
- Audit all point changes with `addAudit(userId, delta, reason, meta)`
- Store user data in global `DB.users` object

### Faceswap Flow
- Deduct points before API call, refund on failure
- Use stateless bot flow with `reply_to_message` for multi-step interactions
- Persist pending jobs in `DB.pending_swaps` with recovery on restart
- Poll MagicAPI status every 3 seconds, timeout after 5 minutes

### File Handling
- Download Telegram files to temp directory using `downloadTo(url, dest)`
- Clean up files immediately after API submission with `cleanupFiles(paths)`
- Serve outputs via Express static routes (`/outputs/`)

### Error Handling
- Global uncaught exception/rejection handlers
- Bot errors reply with generic message, log details
- API failures trigger point refunds and user notifications

## Development Workflows

### Running the Service
```bash
npm start  # Runs backend/server.js
```

### Testing
```bash
cd backend
npm test  # Jest tests with supertest
```

### Key Files
- `backend/server.js`: Main server with bot logic, API endpoints, and faceswap processing
- `backend/data.json`: Persistent user data and job states
- `backend/pricing.json`: Point packages and pricing tiers
- `backend/__tests__/`: API endpoint tests

### Environment Variables
- `BOT_TOKEN`: Telegram bot token
- `MAGICAPI_KEY`: For faceswap API calls
- `STRIPE_SECRET_KEY`: Payment processing
- `PUBLIC_ORIGIN`: Base URL for webhooks and file serving

### API Endpoints (for testing)
- `POST /faceswap`: Direct faceswap with multipart files
- `GET /faceswap/status/:requestId`: Poll job status
- `POST /create-point-session`: Create Stripe checkout
- `GET /healthz`: Service health check

## Code Style Notes
- Async/await for API calls and file operations
- Inline error handling with try/catch blocks
- Use `path.join()` for cross-platform file paths
- Log debug info with process.pid for multi-instance tracking</content>
<parameter name="filePath">c:\Users\HP\Documents\trae_projects\telegram\.github\copilot-instructions.md