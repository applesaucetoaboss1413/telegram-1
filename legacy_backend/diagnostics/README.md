# Diagnostic Tools

This directory contains scripts to verify your Faceswap Bot configuration.

## Prerequisites

Ensure you have your environment variables set. You can set them in a `.env` file in the `backend/` directory or pass them inline.

## 1. Test MagicAPI Key
Verifies your `MAGICAPI_KEY` is valid and can reach the Faceswap endpoint.

```bash
# Windows (PowerShell)
$env:MAGICAPI_KEY="your_key_here"; node diagnostics/test-magicapi.js

# Linux/Mac
MAGICAPI_KEY=your_key_here node diagnostics/test-magicapi.js
```

## 2. Test Telegram Webhook
Checks your bot's current webhook status and compares it with your Render URL.

```bash
# Windows (PowerShell)
$env:BOT_TOKEN="your_token"; $env:RENDER_EXTERNAL_URL="https://your-app.onrender.com"; node diagnostics/test-webhook.js
```

## 3. Test File Download
Verifies the bot can generate download links and fetch files from Telegram.

```bash
# Windows (PowerShell)
$env:BOT_TOKEN="your_token"; node diagnostics/test-file-download.js
```
