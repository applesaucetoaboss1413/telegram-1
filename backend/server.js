require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fetch = require('node-fetch');
const { default: PQueue } = require('p-queue');

const queue = new PQueue(process.env.NODE_ENV === 'test' ? { concurrency: 1 } : { concurrency: 1, timeout: 300000 });

if (process.env.NODE_ENV !== 'test') {
  console.log('Server script started (V6 - JSON/URL Fix)');
  console.log('Deploy tick', Date.now());
}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const https = require('https');
const cloudinary = require('cloudinary').v2;
const { Telegraf, Markup } = require('telegraf');
const { getAllUsage, getUsageFor } = require('./services/usageClient');

const PORT = process.env.PORT || 3000;
console.log('DEBUG PUBLIC_URL at startup:', process.env.PUBLIC_URL);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim();
console.log('DEBUG NORMALIZED PUBLIC_URL:', PUBLIC_URL);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
console.log('DEBUG: Cloudinary configured with cloud_name:', process.env.CLOUDINARY_CLOUD_NAME);

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
let stripe = global.__stripe || null;
if (!stripe) {
  if (stripeSecretKey) {
    stripe = require('stripe')(stripeSecretKey);
  } else {
    try { console.warn('Missing STRIPE_SECRET_KEY. Stripe payments disabled.'); } catch (_) {}
  }
}

function cleanupFiles(paths) {
  if (!Array.isArray(paths)) return;
  paths.forEach(p => {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch(e) { console.error('Cleanup error', e); }
  });
}

const SUPPORTED_CURRENCIES = ['usd','eur','gbp','cad','aud','jpy','cny','inr','brl','mxn'];
const CURRENCY_DECIMALS = { usd: 2, eur: 2, gbp: 2, cad: 2, aud: 2, jpy: 0, cny: 2, inr: 2, brl: 2, rub: 2, mxn: 2 };

const SAFE_RATES = { 
  EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.52, JPY: 148.0, 
  CNY: 7.2, INR: 83.0, BRL: 5.0, RUB: 92.0, MXN: 17.0
};

function formatCurrency(amount, currency = 'usd') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch (e) {
    return `${currency.toUpperCase()} ${Number(amount).toFixed(2)}`;
  }
}

function formatUSD(amount) {
  return formatCurrency(amount, 'usd');
}

async function fetchUsdRate(to) {
  return await new Promise((resolve) => {
    try {
      const symbol = String(to || '').toUpperCase();
      if (symbol === 'USD') return resolve(1);
      
      const req = https.request({ 
        hostname: 'api.exchangerate-api.com', 
        path: `/v4/latest/USD`, 
        method: 'GET',
        timeout: 4000 
      }, res => {
        let buf=''; 
        res.on('data', c => buf+=c); 
        res.on('end', () => {
          try { 
            const j = JSON.parse(buf); 
            const rate = j && j.rates && j.rates[symbol]; 
            if (typeof rate === 'number') resolve(rate);
            else resolve(SAFE_RATES[symbol] || 1);
          }
          catch (_) { resolve(SAFE_RATES[symbol] || 1); }
        });
      });
      req.on('error', () => resolve(SAFE_RATES[symbol] || 1));
      req.on('timeout', () => { req.destroy(); resolve(SAFE_RATES[symbol] || 1); });
      req.end();
    } catch (_) { resolve(SAFE_RATES[symbol] || 1); }
  });
}

function toMinorUnits(amount, currency, rate) {
  const dec = CURRENCY_DECIMALS[currency.toLowerCase()] ?? 2;
  let val = Number(amount) * Number(rate || 1);
  if (currency.toLowerCase() !== 'usd') {
    val = val * 1.03;
  }
  if (dec === 0) return Math.round(val);
  return Math.round(val * Math.pow(10, dec));
}

const uploadsDir = require('os').tmpdir();
const outputsDir = path.join(require('os').tmpdir(), 'outputs');
const dataFile = path.join(require('os').tmpdir(), 'telegram_bot_data.json'); 
console.log('Data File:', dataFile);
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
} catch (e) { console.error('Directory init error:', e); }

const MCP_ENDPOINT = 'https://prod.api.market/api/mcp/magicapi/faceswap-v2';
let MCP_TOOLS_CACHE = { at: 0, tools: null };
let MCP_ID_SEQ = 1;

const { Pool, Client } = require('pg');
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function mcpRequest(method, params, key) {
  const id = MCP_ID_SEQ++;
  const body = { jsonrpc: '2.0', id, method, params: params || {} };
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-market-key': key
    },
    body: JSON.stringify(body),
    timeout: 60000
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch(_) {}
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text}`);
  if (!j || j.error) throw new Error(j && j.error ? (j.error.message || 'MCP error') : 'Invalid MCP response');
  return j;
}

async function listMcpTools(key) {
  const now = Date.now();
  if (MCP_TOOLS_CACHE.tools && (now - MCP_TOOLS_CACHE.at) < 300000) return MCP_TOOLS_CACHE.tools;
  await mcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'telegram-bot', version: '1.0.0' }
  }, key).catch(() => {});
  const j = await mcpRequest('tools/list', {}, key);
  const tools = (j.result && j.result.tools) || (j.tools) || [];
  MCP_TOOLS_CACHE = { at: now, tools };
  return tools;
}

function selectTool(tools, type) {
  const nameIncludes = (n, s) => typeof n === 'string' && n.toLowerCase().includes(String(s).toLowerCase());
  const candidates = tools.filter(t => {
    const n = t.name || '';
    if (type === 'image') return nameIncludes(n, 'faceswap') && nameIncludes(n, 'image');
    if (type === 'video') return nameIncludes(n, 'faceswap') && nameIncludes(n, 'video');
    if (type === 'status' || type === 'result') return nameIncludes(n, 'status') || nameIncludes(n, 'result');
    return false;
  });
  if (candidates.length) return candidates[0];
  const fallback = tools.find(t => {
    const n = t.name || '';
    if (type === 'image') return nameIncludes(n, 'image');
    if (type === 'video') return nameIncludes(n, 'video');
    if (type === 'status' || type === 'result') return nameIncludes(n, 'status') || nameIncludes(n, 'result');
    return false;
  });
  return fallback || null;
}

function buildArgsFromSchema(tool, swapUrl, targetUrl) {
  const props = (tool && tool.inputSchema && tool.inputSchema.properties) || {};
  const keys = Object.keys(props);
  let swapKey = keys.find(k => /swap/i.test(k)) || keys.find(k => /source/i.test(k));
  let targetKey = keys.find(k => /target/i.test(k));
  const args = {};
  if (swapKey) args[swapKey] = swapUrl;
  if (targetKey) args[targetKey] = targetUrl;
  if (!swapKey && !targetKey && keys.length >= 2) {
    args[keys[0]] = swapUrl;
    args[keys[1]] = targetUrl;
  }
  return args;
}

async function mcpCallToolWithRetry(toolName, args, key, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const j = await mcpRequest('tools/call', { name: toolName, arguments: args }, key);
      return (j.result && j.result) || j;
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
}

let PRICING = [
  { id: 'p60', points: 60, usd: 3.09, stars: 150 },
  { id: 'p120', points: 120, usd: 5.09, stars: 250 },
  { id: 'p300', points: 300, usd: 9.99, stars: 500 },
  { id: 'p800', points: 800, usd: 19.99, stars: 1000 },
  { id: 'p1500', points: 1500, usd: 29.99, stars: 1500 },
  { id: 'p7500', points: 7500, usd: 99.0, stars: 5000 },
];
try {
  const pricingFile = path.join(__dirname, 'pricing.json');
  if (fs.existsSync(pricingFile)) {
    const raw = fs.readFileSync(pricingFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) PRICING = parsed;
  }
} catch (_) {}

function resolvePublicBase(url, origin, renderExternal, publicUrl) {
  const raw = String(url || origin || renderExternal || publicUrl || '').trim().replace(/^['"`]+|['"`]+$/g, '').replace(/\/+$/, '');
  if (!raw) return { base: '', error: 'Public URL not set.' };
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(raw)) return { base: '', error: 'Localhost not supported for external webhooks.' };
  if (/https?:\/\/t\.me/i.test(raw)) return { base: '', error: 't.me is not a file server.' };
  return { base: raw };
}
const PUBLIC_BASE_INFO = resolvePublicBase(process.env.PUBLIC_URL, process.env.PUBLIC_ORIGIN, process.env.RENDER_EXTERNAL_URL);
const PUBLIC_BASE = PUBLIC_BASE_INFO.base;

let DB = { 
  users: {}, 
  purchases: {}, 
  audits: {}, 
  pending_swaps: {},
  api_results: {},
  channel: {}, 
  pending_sessions: {}, 
  pending_flows: {} 
};

function initDB() {
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, 'utf8');
      const loaded = JSON.parse(raw);
      DB = { ...DB, ...loaded };
      console.log('DB Loaded. Users:', Object.keys(DB.users).length, 'Pending Swaps:', Object.keys(DB.pending_swaps || {}).length);
    }
  } catch (e) {
    console.error('DB Load Error:', e);
  }
}
initDB();

async function initDatabase() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      first_name TEXT,
      points INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(user_id),
      amount INT,
      type TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS pending_swaps (
      request_id TEXT PRIMARY KEY,
      user_id BIGINT REFERENCES users(user_id),
      chat_id BIGINT,
      start_time BIGINT,
      is_video BOOLEAN,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS audits (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(user_id),
      points INT,
      type TEXT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.end();
  console.log('[DB] PostgreSQL tables initialized');
}

async function loadFromDatabase() {
  try {
    const res = await pgPool.query('SELECT * FROM users');
    DB.users = {};
    res.rows.forEach(row => {
      DB.users[row.user_id] = {
        id: String(row.user_id),
        first_name: row.first_name,
        points: row.points
      };
    });
    console.log('[DB] Loaded users from PostgreSQL');
  } catch (e) {
    console.error('[DB] Load error:', e.message);
  }
}

async function restoreUserCredits() {
  const userId = 8063916626;
  const credits = 69;
  if (!process.env.DATABASE_URL) return;
  try {
    await pgPool.query(
      'INSERT INTO users (user_id, first_name, points) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET points = $3, updated_at = NOW()',
      [userId, 'You', credits]
    );
    console.log('[DB] RESTORE User', userId, 'credits restored to', credits);
  } catch (e) {
    console.error('[DB] RESTORE Error:', e.message);
  }
}

// Initialize PostgreSQL and load data at startup (non-blocking)
(async () => {
  try {
    console.log('[DB] DATABASE_URL env var length:', process.env.DATABASE_URL?.length || 0);
    console.log('[DB] DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 50));
    if (process.env.DATABASE_URL) {
      await initDatabase();
      await loadFromDatabase();
      await restoreUserCredits();
      {
        const u = DB.users['8063916626'];
        if (u) {
          u.points = 69;
        } else {
          DB.users['8063916626'] = {
            id: '8063916626',
            first_name: 'You',
            points: 69,
            created_at: Date.now()
          };
        }
        saveDB();
      }
    } else {
      console.warn('[DB] DATABASE_URL not set; continuing with JSON storage');
    }
  } catch (e) {
    console.error('[DB] Startup error:', e.message);
    console.error('[DB] Error details:', e);
  }
})();

// Startup correction for lost points (temporary manual fix)
if (DB.users && DB.users['8063916626']) {
  DB.users['8063916626'].points = 69; // 60 original + 9 refund
  console.log('MANUAL CORRECTION: User points restored to 69');
  saveDB();
}
if (!DB.corrections) DB.corrections = [];
DB.corrections.push({
  timestamp: new Date().toISOString(),
  userId: '8063916626',
  reason: 'Timeout refund not applied on redeploy; data persistence issue',
  pointsRestored: 9,
  notes: 'Using /tmp ephemeral storage; lost on redeploy. Switch to persistent storage.'
});

function saveDB() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(DB, null, 2));
  } catch (e) { console.error('DB Save Trigger Error:', e); }
  backupDB().catch(() => {});
  syncToDB().catch(() => {});
}

async function backupDB() {
  if (process.env.BACKUP_URL) {
    try {
      await fetch(process.env.BACKUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DB)
      });
      console.log('[BACKUP] Database backed up');
    } catch (e) {
      console.error('[BACKUP] Error:', e.message);
    }
  }
}

function getPending(uid) {
  const res = (DB.pending_flows || {})[uid];
  return res;
}
function setPending(uid, val) {
  if (!DB.pending_flows) DB.pending_flows = {};
  if (val) {
    DB.pending_flows[uid] = val;
  } else {
    delete DB.pending_flows[uid];
  }
  saveDB();
}

async function syncToDB() {
  if (!process.env.DATABASE_URL) return;
  try {
    for (const [uid, user] of Object.entries(DB.users || {})) {
      await pgPool.query(
        'INSERT INTO users (user_id, first_name, points) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET points = $3, updated_at = NOW()',
        [uid, user.first_name || null, user.points || 0]
      );
    }
    console.log('[DB] Synced to PostgreSQL');
  } catch (e) {
    console.error('[DB] Sync error:', e.message);
  }
}

function getOrCreateUser(id, fields) {
  let u = DB.users[id];
  if (!u) {
    u = { id, points: 10, created_at: Date.now(), first_name: (fields && fields.first_name) || null }; 
    DB.users[id] = u;
    saveDB();
    if (process.env.DATABASE_URL) {
      pgPool.query(
        'INSERT INTO users (user_id, first_name, points) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
        [id, u.first_name, u.points]
      ).catch(() => {});
    }
  }
  if (fields) { 
    Object.assign(u, fields); 
    saveDB(); 
    if (process.env.DATABASE_URL) {
      pgPool.query(
        'UPDATE users SET first_name = $2, points = $3, updated_at = NOW() WHERE user_id = $1',
        [id, u.first_name, u.points]
      ).catch(() => {});
    }
  }
  return u;
}

const pgPoolGetOrCreateUser = new (require('pg')).Pool({ connectionString: process.env.DATABASE_URL });
async function pgGetOrCreateUser(uid, fname) {
  try {
    const res = await pgPoolGetOrCreateUser.query('SELECT * FROM users WHERE user_id = $1', [uid]);
    if (res.rows.length > 0) {
      return res.rows[0];
    }
    const newUser = await pgPoolGetOrCreateUser.query(
      'INSERT INTO users (user_id, first_name, points) VALUES ($1, $2, 0) RETURNING *',
      [uid, fname || 'User']
    );
    return newUser.rows[0];
  } catch (e) {
    console.error('[DB] getOrCreateUser error:', e.message);
    return null;
  }
}
async function addAudit(userId, delta, reason, meta) {
  if (!DB.audits) DB.audits = {};
  DB.audits[userId] = DB.audits[userId] || [];
  DB.audits[userId].push({ at: Date.now(), delta, reason, meta });
  saveDB();
  if (process.env.DATABASE_URL) {
    try {
      await pgPool.query(
        'INSERT INTO audits (user_id, points, type, data) VALUES ($1, $2, $3, $4)',
        [userId, delta, reason, JSON.stringify(meta || {})]
      );
    } catch (e) {
      console.error('[AUDIT] Error:', e.message);
    }
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.telegram.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'status', description: 'System status' },
  { command: 'faceswap', description: 'Video face swap' },
  { command: 'imageswap', description: 'Image face swap' },
  { command: 'reset', description: 'Reset state' },
  { command: 'debug', description: 'Show current state' }
]).catch(() => {});

bot.use(async (ctx, next) => {
  try {
    if (ctx.updateType === 'callback_query') {
      const data = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';
      console.log('update callback_query', (ctx.from && ctx.from.id), 'data=', data.slice(0, 80), 'len=', data.length);
    } else {
      console.log('update', ctx.updateType, (ctx.from && ctx.from.id));
    }
  } catch (e) { console.error('Update logging error:', e); }
  return next();
});

bot.catch((err, ctx) => {
  console.error('Bot Error:', err);
  if (ctx && ctx.chat) {
    ctx.reply('Oops, something went wrong. Please try again or use /start.').catch(()=>{});
  }
});

async function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    const file = fs.createWriteStream(dest);
    proto.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function getFileUrl(ctx, fileId) {
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    return link.href;
  } catch (e) {
    console.error('Failed to get telegram file link', e);
    return null;
  }
}

async function ack(ctx, text) {
  if (ctx && ctx.updateType === 'callback_query') {
    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}
  }
}

let promoTimer = null;

function normalizePromoChatId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^-?\d+$/.test(raw)) return raw;
  let s = raw.replace(/^['"`]+|['"`]+$/g, '').trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^t\.me\//i, '');
  s = s.replace(/^telegram\.me\//i, '');
  s = s.replace(/^@/, '');
  if (!s) return '';
  const token = s.split(/[/?#]/)[0].trim();
  if (!token) return '';
  return '@' + token;
}

function startPromoLoop() {
  const enabled = String(process.env.PROMO_ENABLED || '1').trim().toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') return;
  const channelIdRaw = process.env.PROMO_CHANNEL_ID || (DB.channel && DB.channel.defaultChannelId);
  const channelId = normalizePromoChatId(channelIdRaw) || channelIdRaw;
  if (!channelId) return;
  if (promoTimer) return;
  const messages = [
    '👥 FaceSwap Bot: Swap faces in photos or videos in minutes. Use /faceswap or /imageswap to start.',
    '📸 Image FaceSwap: 1 API unit per image. Send a clear face photo and a target photo to begin.',
    '🎥 Video FaceSwap: Pricing based on video length and resolution. Short clips are affordable and fast.',
    '💰 Need more credits? Use the Buy Points button in /start to top up instantly.',
    'ℹ️ FaceSwap V2 API: High-quality swaps, up to 4 minute videos. Try a sample swap now.'
  ];
  let index = 0;
  let intervalMs = Number(process.env.PROMO_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs < 900000) intervalMs = 3600000;
  promoTimer = setInterval(async () => {
    try {
      const text = messages[index % messages.length];
      index += 1;
      await bot.telegram.sendMessage(channelId, text, { disable_web_page_preview: true });
    } catch (e) {
      console.error('Promo send error:', e.message || e);
    }
  }, intervalMs);
}

// Helper: Retry Logic
async function callMagicAPIWithRetry(endpoint, payload, key, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${maxRetries}] Calling MagicAPI...`);
      const isForm = typeof payload === 'object' && payload instanceof URLSearchParams
      const headers = { 'x-magicapi-key': key, 'accept': 'application/json' }
      if (isForm) headers['Content-Type'] = 'application/x-www-form-urlencoded'
      else headers['Content-Type'] = 'application/json'
      const body = isForm ? payload : JSON.stringify(payload)
      const response = await fetch(endpoint, { method: 'POST', headers, body, timeout: 60000 })
      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); } catch(e) {}
      
      if (response.ok) return { success: true, data };
      
      if (response.status === 401) throw new Error('Invalid API key');
      if (response.status === 429) {
         const waitTime = attempt * 2000;
         console.log(`[Rate Limited] Waiting ${waitTime}ms...`);
         await new Promise(r => setTimeout(r, waitTime));
         continue;
      }
      if (response.status >= 500) {
         await new Promise(r => setTimeout(r, 2000));
         continue;
      }
      throw new Error(`API returned ${response.status}: ${data ? (data.message || JSON.stringify(data)) : responseText}`);
    } catch (error) {
      console.error(`[Attempt ${attempt}] Error: ${error.message}`);
      if (attempt === maxRetries || error.message.includes('Invalid API key')) throw error;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
}

// Helper: Send to result channel
async function sendToResultChannel(url, isVideo) {
  const channel = isVideo 
    ? (process.env.CHANNEL_VIDEO || '@faceswapvidz')
    : (process.env.CHANNEL_ID || '@faceswapchat');
  
  if (!channel) return;
  
  try {
    if (isVideo) {
      await bot.telegram.sendVideo(channel, url, { caption: 'New Video Face Swap Result! 🎥' });
    } else {
      await bot.telegram.sendPhoto(channel, url, { caption: 'New Image Face Swap Result! 📸' });
    }
  } catch (e) {
    console.error(`[CHANNEL] Failed to send to ${channel}:`, e.message);
  }
}

// Helper: Poll Result
function pollMagicResult(requestId, chatId) {
  let tries = 0;
  const job = DB.pending_swaps[requestId];
  const isVideo = job ? job.isVideo : true; 
  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  
  const poll = async () => {
    tries++;
    if (tries > 100) { // 5 minutes approx
       try {
         const jobInfo = DB.pending_swaps[requestId];
         const userId = jobInfo && jobInfo.userId;
         const costRefund = jobInfo ? (jobInfo.isVideo ? 15 : 9) : 10;
         if (userId && DB.users[userId]) {
           DB.users[userId].points += costRefund;
           saveDB();
           addAudit(userId, costRefund, 'refund_timeout', { requestId });
           console.log(`TIMEOUT REFUND: User ${userId} refunded ${costRefund} points`);
         }
       } catch (e) {
         console.error('Timeout refund error:', e && e.message);
       }
       if (chatId) bot.telegram.sendMessage(chatId, 'Task timed out. Points have been refunded.').catch(()=>{});
       if (DB.pending_swaps[requestId]) {
          if (!DB.api_results) DB.api_results = {};
          DB.api_results[requestId] = { status: 'failed', error: 'Timeout' };
          delete DB.pending_swaps[requestId];
          saveDB();
       }
       return;
    }

    if (tries % 10 === 0 && chatId) {
        bot.telegram.sendMessage(chatId, `Still processing... (${tries * 3}s elapsed)`).catch(()=>{});
    }

    try {
      const statusToolName = isVideo ? 'getfaceswapvideostatus' : 'getfaceswapimagestatus';
      const resp = await mcpCallToolWithRetry(statusToolName, { id: requestId }, key);
      let apiResponse = resp;
      if (resp && Array.isArray(resp.content)) {
        const t = resp.content.find(c => c && c.type === 'text' && typeof c.text === 'string');
        if (t && typeof t.text === 'string') {
          try {
            apiResponse = JSON.parse(t.text);
          } catch (e) {
            console.error('DEBUG STATUS ERROR parse_failed', e && e.message ? e.message : String(e));
          }
        }
      }
      const status = String(apiResponse && (apiResponse.status || apiResponse.state) || '').toLowerCase();
      if (apiResponse && apiResponse.status === 'FAILED') {
        try { console.log('DEBUG STATUS RESPONSE', JSON.stringify(apiResponse, null, 2)); } catch (_) {}
        console.error('DEBUG STATUS ERROR provider_failed', apiResponse);
        if (job && job.userId) {
          const u = getOrCreateUser(job.userId);
          const cost = job.isVideo ? 15 : 9;
          u.points += cost;
          saveDB();
          addAudit(job.userId, cost, 'refund_provider_failed', { requestId, job: apiResponse });
        }
        if (chatId) {
          bot.telegram.sendMessage(chatId, '❌ The image server reported that this face swap failed. Your credits for this attempt have been fully refunded. Please try again with clear, front-facing faces and good lighting.').catch(()=>{});
        }
        if (!DB.api_results) DB.api_results = {};
        DB.api_results[requestId] = { status: 'failed', error: 'Provider FAILED' };
        if (DB.pending_swaps[requestId]) {
          delete DB.pending_swaps[requestId];
          saveDB();
        }
        return;
      }
      const outData = apiResponse && (apiResponse.result_url || apiResponse.output || apiResponse.url || apiResponse.image_url || apiResponse.video_url);
      if (outData) {
        let finalUrl = Array.isArray(outData) ? outData[outData.length-1] : outData;
        if (typeof finalUrl === 'object') finalUrl = finalUrl.video_url || finalUrl.image_url || finalUrl.url || Object.values(finalUrl)[0];
        if (chatId) {
          if (isVideo) await bot.telegram.sendVideo(chatId, finalUrl, { caption: '✅ Face swap complete!' });
          else await bot.telegram.sendPhoto(chatId, finalUrl, { caption: '✅ Face swap complete!' });
        }
        await sendToResultChannel(finalUrl, isVideo);
        if (!DB.api_results) DB.api_results = {};
        DB.api_results[requestId] = { status: 'success', output: finalUrl, url: finalUrl };
        if (DB.pending_swaps[requestId]) {
          delete DB.pending_swaps[requestId];
          saveDB();
        }
      } else if (status.includes('fail') || status.includes('error')) {
        try { console.log('DEBUG STATUS RESPONSE', JSON.stringify(apiResponse, null, 2)); } catch (_) {}
        if (apiResponse && (apiResponse.error || apiResponse.message)) {
          console.error('DEBUG STATUS ERROR', apiResponse.error || apiResponse.message);
        }
        throw new Error((apiResponse && (apiResponse.error || apiResponse.message)) || 'Unknown error');
      } else {
        if (status !== 'in_queue' && status !== 'processing') {
          try { console.log('DEBUG STATUS RESPONSE', JSON.stringify(apiResponse, null, 2)); } catch (_) {}
          if (apiResponse && (apiResponse.error || apiResponse.message)) {
            console.error('DEBUG STATUS ERROR', apiResponse.error || apiResponse.message);
          }
        }
        setTimeout(poll, 3000);
      }
    } catch (e) {
       if (e.message && (e.message.includes('fail') || e.message.includes('error'))) {
          const errorMsg = e.message;
          if (chatId) bot.telegram.sendMessage(chatId, `Task failed: ${errorMsg}. (Refunded).`).catch(()=>{});
          
          if (!DB.api_results) DB.api_results = {};
          DB.api_results[requestId] = { status: 'failed', error: errorMsg };
          
          if (job && job.userId) {
            const u = getOrCreateUser(job.userId);
            const cost = job.isVideo ? 15 : 9; 
            u.points += cost;
            saveDB();
            addAudit(job.userId, cost, 'refund_failed_job', { requestId, error: errorMsg });
          }
          if (DB.pending_swaps[requestId]) {
            delete DB.pending_swaps[requestId];
            saveDB();
          }
       } else {
          setTimeout(poll, 3000);
       }
    }
  };
  
  setTimeout(poll, 2000);
}

async function runFaceswap(ctx, u, swapFileId, targetFileId, isVideo) {
  const cost = isVideo ? 15 : 9;
  const user = DB.users[u.id];
  
  if ((user.points || 0) < cost) {
      return { error: 'not enough points', required: cost, points: user.points };
  }
  
  user.points -= cost;
  saveDB();
  addAudit(u.id, -cost, 'faceswap_start', { isVideo });

  const swapLink = await getFileUrl(ctx, swapFileId);
  const targetLink = await getFileUrl(ctx, targetFileId);

  if (!swapLink || !targetLink) {
    user.points += cost; 
    saveDB();
    return { error: 'Failed to generate file URLs from Telegram.', points: user.points };
  }

  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  if (!key) {
      user.points += cost; 
      saveDB();
      return { error: 'Server config error: Missing API Key', points: user.points };
  }

  let swapPath, targetPath;
  let swapUrl, targetUrl;
  try {
    const swapUpload = await cloudinary.uploader.upload(swapLink, { folder: 'faceswap/swap', resource_type: 'auto', public_id: `tg_swap_${u.id}_${Date.now()}` });
    const targetUpload = await cloudinary.uploader.upload(targetLink, { folder: 'faceswap/target', resource_type: 'auto', public_id: `tg_target_${u.id}_${Date.now()}` });
    swapUrl = swapUpload.secure_url;
    targetUrl = targetUpload.secure_url;
    console.log('DEBUG UPLOAD: Saved swap to Cloudinary:', swapUrl);
    console.log('DEBUG UPLOAD: Saved target to Cloudinary:', targetUrl);
    console.log('DEBUG UPLOAD: Generated URLs:', { swapUrl, targetUrl });
  } catch (e) {
    user.points += cost;
    saveDB();
    return { error: 'Failed to stage files to uploads.', points: user.points };
  }

  if (!swapUrl || !targetUrl) {
    swapUrl = `${PUBLIC_URL.replace(/\/+$/, '')}/uploads/${path.basename(swapPath || '')}`;
    targetUrl = `${PUBLIC_URL.replace(/\/+$/, '')}/uploads/${path.basename(targetPath || '')}`;
  }
  if (!swapUrl || !targetUrl) {
    user.points += cost;
    saveDB();
    return { error: 'Failed to generate Cloudinary URLs.', points: user.points };
  }

  try {
      const qPos = queue.size;
      if (qPos > 0) {
          ctx.reply(`📍 Position in queue: ${qPos + 1}\n⏳ Waiting for processor...`).catch(()=>{});
      }

      const result = await queue.add(async () => {
          const tools = await listMcpTools(key).catch(() => []);
          const selected = selectTool(tools, isVideo ? 'video' : 'image');
          const toolName = (selected && selected.name) || (isVideo ? 'runfaceswapvideo' : 'runfaceswapimage');
          const defaultTopArgs = isVideo ? { swap_image: swapUrl, target_video: targetUrl } : { swap_image: swapUrl, target_image: targetUrl };
          const topArgsFromSchema = selected ? buildArgsFromSchema(selected, swapUrl, targetUrl) : {};
          const argsTop = (toolName && toolName.includes('faceswap'))
            ? defaultTopArgs
            : (Object.keys(topArgsFromSchema).length ? topArgsFromSchema : defaultTopArgs);
          const argsWrapped = { input: { ...argsTop } };
          const cleanedArgs = JSON.parse(JSON.stringify(argsTop));
          console.log('DEBUG FACESWAP START args', JSON.stringify(cleanedArgs, null, 2));
          try {
            const callRes = await mcpCallToolWithRetry(toolName, argsTop, key);
            return callRes;
          } catch (e) {
            console.error('DEBUG START CALL primary_args_failed', e && e.message ? e.message : String(e));
            const callRes = await mcpCallToolWithRetry(toolName, argsWrapped, key);
            return callRes;
          }
      });

      console.log('DEBUG MCP RESULT (raw):', JSON.stringify(result, null, 2));
      let rawResponse = result;
      if (result && Array.isArray(result.content)) {
        const textItem = result.content.find(c => c && c.type === 'text' && typeof c.text === 'string');
        if (textItem) {
          const textContent = textItem.text;
          let jsonPart = textContent;
          if (typeof textContent === 'string' && /^Error\s*\d*:/.test(textContent)) {
            const braceIdx = textContent.indexOf('{');
            if (braceIdx !== -1) {
              jsonPart = textContent.slice(braceIdx);
            }
          }
          try {
            rawResponse = JSON.parse(jsonPart);
            console.log('DEBUG MCP RESPONSE (parsed):', JSON.stringify(rawResponse, null, 2));
          } catch (e) {
            console.error('DEBUG: Failed to parse text content as JSON:', textContent);
            throw new Error('Invalid JSON in MCP response text field');
          }
        }
      }

      const apiResponse = rawResponse || {};
      if (apiResponse && apiResponse.error) {
        throw new Error(`FaceSwap API error: ${apiResponse.error}`);
      }
      const requestId = apiResponse.id;
      const status = apiResponse.status;
      console.log('DEBUG MCP STATUS:', status, 'REQUEST_ID:', requestId);

      if (status === 'IN_QUEUE' || status === 'PROCESSING') {
        if (requestId) {
          if (!DB.pending_swaps) DB.pending_swaps = {};
          DB.pending_swaps[requestId] = {
            chatId: ctx.chat.id,
            userId: u.id,
            startTime: Date.now(),
            isVideo: isVideo,
            status: 'processing'
          };
          saveDB();
          pollMagicResult(requestId, ctx.chat.id);
          cleanupFiles([swapPath, targetPath]);
          return {
            started: true,
            requestId,
            status,
            message: `Your faceswap is processing. Request ID: ${requestId}. You can check the status later.`,
            points: user.points
          };
        }
        throw new Error('Processing status without request ID in response');
      }

      let outputUrl = apiResponse.output_url || apiResponse.result_url || apiResponse.image_url || apiResponse.video_url || apiResponse.url;
      if (!outputUrl) {
        console.log('DEBUG MCP RESPONSE (no output after parsing):', JSON.stringify(apiResponse, null, 2));
        throw new Error('Job completed but no output URL in response');
      }

      if (outputUrl) {
          cleanupFiles([swapPath, targetPath]);
          return { success: true, output: outputUrl, points: user.points };
      } else {
          throw new Error('No output URL or Request ID in response');
      }

  } catch (e) {
    user.points += cost;
    saveDB();
    cleanupFiles([swapPath, targetPath]);
    console.error('FACESWAP MCP error:', e);
    return { error: 'FaceSwap API error: ' + e.message, points: user.points };
  }
}

bot.command('start', async ctx => {
  const id = String(ctx.from.id);
  let u = DB.users[id];
  if (!u && process.env.DATABASE_URL) {
    const row = await pgGetOrCreateUser(id, ctx.from && ctx.from.first_name);
    if (row && typeof row.points === 'number') {
      u = { id, first_name: row.first_name || null, points: row.points, created_at: Date.now() };
      DB.users[id] = u;
      saveDB();
    }
  }
  if (!u) {
    u = getOrCreateUser(id, { first_name: ctx.from && ctx.from.first_name });
  }
  ctx.reply(`Welcome! (ID: ${u.id}) You have ${u.points} points.\nUse /faceswap to start.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Video Face Swap', 'faceswap'), Markup.button.callback('Image Face Swap', 'imageswap')],
      [Markup.button.callback('Buy Points', 'buy')]
    ])
  );
});

bot.command('status', ctx => {
  const pending = Object.keys(DB.pending_swaps || {}).length;
  const uptime = process.uptime();
  const mem = process.memoryUsage().rss / 1024 / 1024;
  ctx.reply(`System Status:\n🟢 Online\n⏱️ Uptime: ${Math.floor(uptime)}s\n🔄 Pending Jobs: ${pending}\n💾 Memory: ${Math.floor(mem)}MB`);
});

bot.command('usage', async ctx => {
  try {
    const key = process.env.API_MARKET_KEY || process.env.MAGICAPI_KEY;
    if (!key) return ctx.reply('Usage API key not configured.');
    const all = await getAllUsage(key);
    if (!all.ok || !all.data || !Array.isArray(all.data.usageData)) {
      return ctx.reply('Failed to fetch usage.');
    }
    const items = all.data.usageData;
    const face = items.find(x => String(x.apiName || '').includes('faceswap'));
    if (!face) return ctx.reply('No faceswap subscription found on this account.');
    const left = face.apiCallsLeft;
    const made = face.apiCallsMade;
    const quota = face.quota;
    ctx.reply(`Usage: ${made}/${quota} used, ${left} remaining.\nProduct: ${face.apiName}`);
  } catch (e) {
    ctx.reply('Error fetching usage: ' + e.message);
  }
});

bot.action('buy', async ctx => {
  ack(ctx, 'Opening packages…');
  try {
    const u = getOrCreateUser(String(ctx.from.id));
    const rows = PRICING.map(p => [Markup.button.callback(`${p.points} Pts - ${formatUSD(p.usd)}`, `buy:${p.id}`)]);
    await ctx.reply('Select a package:', Markup.inlineKeyboard(rows));
  } catch(e) { console.error(e); }
});

bot.action(/buy:(.+)/, async ctx => {
  ack(ctx, 'Select currency…');
  try {
    const tierId = ctx.match[1];
    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return ctx.reply('Invalid tier');
    
    const k = Markup.inlineKeyboard([
      [Markup.button.callback('USD', `pay:usd:${tierId}`), Markup.button.callback('EUR', `pay:eur:${tierId}`)],
      [Markup.button.callback('GBP', `pay:gbp:${tierId}`), Markup.button.callback('MXN', `pay:mxn:${tierId}`)],
      [Markup.button.callback('JPY', `pay:jpy:${tierId}`), Markup.button.callback('Cancel', 'cancel')]
    ]);
    ctx.reply(`Selected: ${tier.points} Points.\nChoose currency:`, k);
  } catch(e) { console.error(e); }
});

bot.action('cancel', ctx => {
  ack(ctx, 'Cancelled');
  ctx.deleteMessage().catch(()=>{});
  ctx.reply('Cancelled.');
});

bot.action(/pay:(\w+):(.+)/, async ctx => {
  ack(ctx, 'Creating checkout…');
  if (!stripe) return ctx.reply('Payments unavailable.');
  const curr = ctx.match[1];
  const tierId = ctx.match[2];
  const tier = PRICING.find(t => t.id === tierId);
  
  try {
    const rate = await fetchUsdRate(curr);
    const amount = toMinorUnits(tier.usd, curr, rate);
    const origin = PUBLIC_BASE || 'https://stripe.com';
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: curr,
          product_data: { name: `${tier.points} Credits` },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel`,
      metadata: { userId: String(ctx.from.id), tierId: tier.id, points: tier.points }
    });
    
    const shortId = Math.random().toString(36).substring(2, 10);
    if (!DB.pending_sessions) DB.pending_sessions = {};
    DB.pending_sessions[shortId] = session.id;
    saveDB();
    
    ctx.reply(`Pay ${formatCurrency(amount/100, curr)} for ${tier.points} points.`, 
      Markup.inlineKeyboard([
        [Markup.button.url('Pay Now', session.url)],
        [Markup.button.callback('I have paid', `confirm:${shortId}`)]
      ])
    );
  } catch (e) {
    console.error(e);
    ctx.reply('Error creating payment: ' + e.message);
  }
});

bot.action(/confirm:(.+)/, async ctx => {
  ack(ctx, 'Verifying payment…');
  const shortId = ctx.match[1];
  if (!stripe) return;
  
  try {
    const sid = (DB.pending_sessions || {})[shortId];
    if (!sid) return ctx.reply('Payment link expired or invalid.');
    
    const s = await stripe.checkout.sessions.retrieve(sid);
    if (s.payment_status === 'paid') {
      if (DB.purchases[sid]) return ctx.reply('Already credited.');
      
      const uid = s.metadata.userId;
      const pts = Number(s.metadata.points);
      const u = getOrCreateUser(uid);
      
      u.points += pts;
      DB.purchases[sid] = true;
      saveDB();
      ctx.reply(`Success! Added ${pts} points. Total: ${u.points}`);
    } else {
      ctx.reply('Payment not yet confirmed. Try again in a moment.');
    }
  } catch (e) { ctx.reply('Error: ' + e.message); }
});

bot.catch((err, ctx) => {
  console.error(`Telegraf error for ${ctx.updateType}:`, err);
  ctx.reply('⚠️ An unexpected error occurred. Please try again later.').catch(() => {});
});

bot.command('faceswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'faceswap', step: 'swap' });
  ctx.reply('Mode set: **Video Face Swap** 🎥\n\n1. Please send the **SWAP** photo (the face you want to use).\n2. Then you will be asked for the **TARGET** video.');
});
bot.action('faceswap', ctx => {
  ack(ctx, 'Mode set: Video');
  setPending(String(ctx.from.id), { mode: 'faceswap', step: 'swap' });
  ctx.reply('Mode set: **Video Face Swap** 🎥\n\n1. Please send the **SWAP** photo (the face you want to use).\n2. Then you will be asked for the **TARGET** video.');
});

bot.command('imageswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Mode set: **Image Face Swap** 📸\n\n1. Please send the **SWAP** photo (the face you want to use).\n2. Then you will be asked for the **TARGET** photo.');
});
bot.action('imageswap', ctx => {
  ack(ctx, 'Mode set: Image');
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Mode set: **Image Face Swap** 📸\n\n1. Please send the **SWAP** photo (the face you want to use).\n2. Then you will be asked for the **TARGET** photo.');
});

async function processSwapFlow(ctx, uid, swapFileId, targetFileId, isVideo) {
    let processingMsg;
    try {
        processingMsg = await ctx.reply('Processing face swap... Please wait ⏳');
        
        const res = await runFaceswap(ctx, getOrCreateUser(uid), swapFileId, targetFileId, isVideo);
        
        if (res.error) {
            await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `❌ Failed: ${res.error}`);
        } else if (res.success && res.output) {
            if (isVideo) await ctx.telegram.sendVideo(ctx.chat.id, res.output, { caption: '✅ Face swap complete!' });
            else await ctx.telegram.sendPhoto(ctx.chat.id, res.output, { caption: '✅ Face swap complete!' });
            
            await sendToResultChannel(res.output, isVideo);
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => {});
        } else if (res.started && res.requestId) {
            await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `⏳ Job Started (ID: ${res.requestId}). This might take a while...`);
        }
    } catch (e) {
        console.error('[FLOW] Error in processSwapFlow:', e);
        try {
            const u = getOrCreateUser(uid);
            const cost = isVideo ? 15 : 9;
            u.points += cost;
            saveDB();
            addAudit(uid, cost, 'refund_flow_error', { error: e && e.message });
        } catch (_) {}
        if (processingMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `❌ Critical Error: ${e.message}`).catch(() => {});
        } else {
            ctx.reply(`❌ Critical Error: ${e.message}`).catch(() => {});
        }
    }
}

bot.on('photo', async ctx => {
  const uid = String(ctx.from.id);
  const p = getPending(uid);
  const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;

  if (!p) {
    const newState = { mode: 'imageswap', step: 'target', swapFileId: fileId };
    setPending(uid, newState);
    return ctx.reply('Got your SWAP photo. Now send the TARGET photo to complete the swap.');
  }

  if (p.step === 'swap') {
    p.swapFileId = fileId;
    p.step = 'target';
    setPending(uid, p);
    ctx.reply(p.mode === 'faceswap' ? 'Great! Now send the TARGET video.' : 'Great! Now send the TARGET photo.');
  } else if (p.step === 'target' && p.mode === 'imageswap') {
    p.targetFileId = fileId;
    // Call background flow without await to avoid webhook timeout
    processSwapFlow(ctx, uid, p.swapFileId, p.targetFileId, false).catch(e => console.error('Background swap error:', e));
    setPending(uid, null);
  } else if (p.step === 'target' && p.mode === 'faceswap') {
    ctx.reply('I need a VIDEO for the target, not a photo. Please send a video file.');
  }
});

bot.on('video', async ctx => {
  const uid = String(ctx.from.id);
  const p = getPending(uid);
  if (!p || p.mode !== 'faceswap' || p.step !== 'target') {
    return ctx.reply('Please select a mode (Video/Image Swap) from the menu first.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Video Face Swap', 'faceswap'), Markup.button.callback('Image Face Swap', 'imageswap')]
      ])
    );
  }

  const fileId = ctx.message.video.file_id;
  // Call background flow without await to avoid webhook timeout
  processSwapFlow(ctx, uid, p.swapFileId, fileId, true).catch(e => console.error('Background swap error:', e));
  setPending(uid, null);
});

bot.command('reset', ctx => {
  setPending(String(ctx.from.id), null);
  ctx.reply('State reset. Use /faceswap to start over.');
});

bot.command('debug', ctx => {
  const p = getPending(String(ctx.from.id));
  ctx.reply('Current State: ' + JSON.stringify(p || 'None'));
});

bot.on('callback_query', async (ctx) => {
  try {
    const d = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';
    const known = (d === 'buy' || d === 'faceswap' || d === 'imageswap' || d === 'cancel' || /^buy:/.test(d) || /^pay:/.test(d) || /^confirm:/.test(d));
    if (!known) {
      await ack(ctx, 'Unsupported button');
      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});
    }
  } catch (e) {
    console.error('Callback fallback error', e);
  }
});

const app = express();
app.use(express.json());
if (!fs.existsSync(uploadsDir)) {
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}
  console.log('DEBUG: Created uploads directory at', uploadsDir);
} else {
  console.log('DEBUG: Using Cloudinary for image uploads (cloud_name:', process.env.CLOUDINARY_CLOUD_NAME + ')');
  console.log('DEBUG: Local /uploads middleware not needed; all images uploaded to CDN');
}
console.log('DEBUG: Static /uploads middleware registration skipped (Cloudinary in use)');
app.use('/outputs', express.static(outputsDir));
const telegrafWebhook = bot.webhookCallback('/telegram/webhook');
app.post('/telegram/webhook', (req, res, next) => {
  try {
    console.log('[WEBHOOK HIT]', req.method, req.url, JSON.stringify(req.body).slice(0, 200));
  } catch (e) {
    console.error('[WEBHOOK] logging error:', e);
  }
  telegrafWebhook(req, res, (err) => {
    if (err) console.error('[WEBHOOK] handler error:', err);
    try { if (!res.headersSent) res.status(200).end(); } catch (_) {}
  });
});
app.get('/uploads/test', (req, res) => {
  res.json({
    message: 'Uploads static serving is working',
    uploadsDir,
    PUBLIC_URL
  });
});

const upload = multer();

app.post('/faceswap', upload.fields([{ name: 'swap', maxCount: 1 }, { name: 'target', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    if (!userId) return res.status(400).json({ error: 'user required' });
    
    const swapFile = req.files && req.files['swap'] ? req.files['swap'][0] : null;
    const targetFile = req.files && req.files['target'] ? req.files['target'][0] : null;
    
    if (!swapFile || !targetFile) return res.status(400).json({ error: 'swap and target files required' });
    
    const swapExt = swapFile.originalname && swapFile.originalname.includes('.') ? swapFile.originalname.split('.').pop() : 'jpg';
    const targetExt = targetFile.originalname && targetFile.originalname.includes('.') ? targetFile.originalname.split('.').pop() : (targetFile.mimetype && targetFile.mimetype.startsWith('video') ? 'mp4' : 'jpg');
    
    const swapPath = path.join(uploadsDir, `swap_${userId}_${Date.now()}.${swapExt}`);
    const targetPath = path.join(uploadsDir, `target_${userId}_${Date.now()}.${targetExt}`);
    
    const swapUpload = await new Promise((resolve, reject) => {
      const s = cloudinary.uploader.upload_stream({ folder: 'faceswap/swap', resource_type: 'auto', public_id: `swap_${userId}_${Date.now()}` }, (err, res) => err ? reject(err) : resolve(res));
      s.end(swapFile.buffer);
    });
    const targetUpload = await new Promise((resolve, reject) => {
      const s = cloudinary.uploader.upload_stream({ folder: 'faceswap/target', resource_type: 'auto', public_id: `target_${userId}_${Date.now()}` }, (err, res) => err ? reject(err) : resolve(res));
      s.end(targetFile.buffer);
    });
    console.log('DEBUG UPLOAD: Saved swap to Cloudinary:', swapUpload && swapUpload.secure_url);
    console.log('DEBUG UPLOAD: Saved target to Cloudinary:', targetUpload && targetUpload.secure_url);
    
    const isVideo = targetFile.mimetype && targetFile.mimetype.startsWith('video');
    const u = getOrCreateUser(userId);
    
    const cost = isVideo ? 15 : 9;
    if ((u.points || 0) < cost) {
         cleanupFiles([swapPath, targetPath]);
         return res.status(402).json({ error: 'not enough points', required: cost, points: u.points });
    }
    
    u.points -= cost;
    saveDB();
    addAudit(u.id, -cost, 'faceswap_api', { isVideo });

    const swapUrl = swapUpload.secure_url;
    const targetUrl = targetUpload.secure_url;
    console.log('DEBUG UPLOAD: Generated URLs:', { swapUrl, targetUrl });
    console.log('DEBUG UPLOAD: Generated URLs:', { swapUrl, targetUrl });

    const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
    if (!key) {
      u.points += cost;
      saveDB();
      cleanupFiles([swapPath, targetPath]);
      return res.status(500).json({ error: 'Server config error: Missing API Key', points: u.points });
    }

    const tools = await listMcpTools(key).catch(() => []);
    const selected = selectTool(tools, isVideo ? 'video' : 'image');
    const toolName = (selected && selected.name) || (isVideo ? 'runfaceswapvideo' : 'runfaceswapimage');
    const defaultTopArgs = isVideo ? { swap_image: swapUrl, target_video: targetUrl } : { swap_image: swapUrl, target_image: targetUrl };
    const topArgsFromSchema = selected ? buildArgsFromSchema(selected, swapUrl, targetUrl) : {};
    const argsTop = (toolName && toolName.includes('faceswap'))
      ? defaultTopArgs
      : (Object.keys(topArgsFromSchema).length ? topArgsFromSchema : defaultTopArgs);
    const argsWrapped = { input: { ...argsTop } };
    const cleanedArgs = JSON.parse(JSON.stringify(argsTop));
    console.log('DEBUG FACESWAP START args', JSON.stringify(cleanedArgs, null, 2));
    let data;
    try {
      data = await mcpCallToolWithRetry(toolName, argsTop, key);
    } catch (e) {
      console.error('DEBUG START CALL primary_args_failed', e && e.message ? e.message : String(e));
      data = await mcpCallToolWithRetry(toolName, argsWrapped, key);
    }
    const outputUrl = data && (data.output || data.result_url || data.image_url || data.video_url || data.url);

    if (outputUrl) {
      cleanupFiles([swapPath, targetPath]);
      await sendToResultChannel(outputUrl, isVideo);
      return res.json({ ok: true, output: outputUrl, points: u.points });
    }

    const requestId = data.request_id || data.requestId || data.id;
    if (requestId) {
      if (!DB.pending_swaps) DB.pending_swaps = {};
      DB.pending_swaps[requestId] = {
        userId: u.id,
        startTime: Date.now(),
        isVideo: isVideo,
        status: 'processing',
        isApi: true
      };
      saveDB();
      cleanupFiles([swapPath, targetPath]);
      pollMagicResult(requestId, null);
      return res.json({ ok: true, requestId, message: 'Job started. Poll status at /faceswap/status/' + requestId });
    }

    u.points += cost;
    saveDB();
    cleanupFiles([swapPath, targetPath]);
    return res.status(500).json({ error: 'No output URL or request id from API', points: u.points });
  } catch (e) {
    console.error('FACESWAP MCP error:', e);
    try {
      if (u && typeof cost === 'number') {
        u.points += cost;
        saveDB();
        addAudit(u.id, cost, 'refund_api_error', { error: e && e.message });
      }
      cleanupFiles([swapPath, targetPath]);
    } catch (_) {}
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/faceswap/status/:requestId', (req, res) => {
  const rid = req.params.requestId;
  if (DB.pending_swaps[rid]) {
      return res.json({ status: 'processing' });
  }
  if (DB.api_results && DB.api_results[rid]) {
      return res.json(DB.api_results[rid]);
  }
  res.status(404).json({ error: 'Job not found or expired' });
});

app.post('/create-point-session', async (req, res) => {
  try {
    const body = req.body || {};
    const userId = body.userId;
    const tierId = body.tierId;
    const currency = String(body.currency || 'usd').toLowerCase();

    if (!userId || !tierId) return res.status(400).json({ error: 'userId and tierId required' });
    if (!SUPPORTED_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'unsupported currency' });

    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return res.status(404).json({ error: 'tier not found' });
    if (!stripe || !stripe.checkout || !stripe.checkout.sessions) return res.status(503).json({ error: 'payments unavailable' });

    const rate = await fetchUsdRate(currency);
    const amount = toMinorUnits(tier.usd, currency, rate);
    const origin = PUBLIC_BASE || process.env.PUBLIC_URL || 'https://stripe.com';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currency,
          product_data: { name: `${tier.points} Credits` },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel`,
      metadata: { userId: String(userId), tierId: tier.id, points: tier.points }
    });

    return res.json({ id: session.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/confirm-point-session', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!stripe || !stripe.checkout || !stripe.checkout.sessions) return res.status(503).json({ error: 'payments unavailable' });

    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const tierId = s && s.metadata && s.metadata.tierId;
    const userId = s && s.metadata && s.metadata.userId;
    const currency = String((s && s.currency) || 'usd').toLowerCase();

    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return res.status(400).json({ error: 'invalid tier' });
    if (!SUPPORTED_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'unsupported currency' });

    const rate = currency === 'usd' ? 1 : await fetchUsdRate(currency);
    const expected = toMinorUnits(tier.usd, currency, rate);
    if (Number(s.amount_total) !== Number(expected)) {
      return res.status(400).json({ error: 'amount mismatch' });
    }

    const paid = s.payment_status === 'paid' || s.status === 'complete';
    if (!paid) return res.status(400).json({ error: 'payment not complete' });

    if (!DB.purchases) DB.purchases = {};
    if (DB.purchases[sessionId]) return res.json({ ok: true, alreadyCredited: true });

    const u = getOrCreateUser(String(userId));
    const pts = Number(s.metadata && s.metadata.points) || Number(tier.points);
    u.points += pts;
    DB.purchases[sessionId] = true;
    saveDB();

    return res.json({ ok: true, pointsAdded: pts, points: u.points });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const uid = s.metadata.userId;
      const pts = Number(s.metadata.points);
      
      if (!DB.purchases[s.id]) {
        const u = getOrCreateUser(uid);
        u.points += pts;
        DB.purchases[s.id] = true;
        saveDB();
        bot.telegram.sendMessage(uid, `Payment successful! Added ${pts} points.`).catch(()=>{});
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.get('/healthz', (req, res) => {
  res.json({ mode: 'backend', env: { node: process.version } });
});

app.get('/', (req, res) => {
  res.send('Telegram Bot is running! 🚀');
});

// Webhook Configuration
const WEBHOOK_PATH = '/telegram/webhook';
// Prioritize explicit variables, then Render's automatic one
const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.TELEGRAM_WEBHOOK_URL;
// We use webhook if any public URL is provided
const shouldUseWebhook = !!publicUrl;

let isBotRunning = false;

function startSelfPing() {
  if (!publicUrl) return;
  // Ping every 10 minutes to keep Render alive
  setInterval(async () => {
    try {
      const url = publicUrl.startsWith('http') ? publicUrl : 'https://' + publicUrl;
      const res = await fetch(url.replace(/\/$/, '') + '/healthz');
      console.log(`[KEEP-ALIVE] Ping to ${url}/healthz: ${res.status}`);
    } catch (e) {
      console.log('[KEEP-ALIVE] Ping failed (expected on cold start):', e.message);
    }
  }, 10 * 60 * 1000);
}

async function startBot() {
  if (shouldUseWebhook) {
    let domain = publicUrl;
    if (!domain.startsWith('http')) domain = 'https://' + domain;
    // Ensure no double slashes
    const fullUrl = domain.replace(/\/$/, '') + WEBHOOK_PATH;
    
    console.log(`🚀 Starting in WEBHOOK Mode`);
    console.log(`   URL: ${fullUrl}`);
    
    // Mount webhook middleware BEFORE listen to ensure route exists
    // route already registered globally
    
    // Set webhook on Telegram side
    try {
      await bot.telegram.setWebhook(fullUrl);
      console.log('✅ Webhook successfully set with Telegram.');
    } catch (e) {
      console.error('❌ FAILED to set Webhook:', e.message);
    }
    
    try {
      const info = await bot.telegram.getWebhookInfo();
      const ok = info && typeof info.url === 'string' && info.url.replace(/\/+$/,'') === fullUrl.replace(/\/+$/,'');
      if (!ok) {
        await bot.telegram.deleteWebhook().catch(()=>{});
        await bot.launch();
        isBotRunning = true;
        console.log('ℹ️ Fallback to Polling due to webhook mismatch');
      }
    } catch (_) {
      try {
        await bot.telegram.deleteWebhook().catch(()=>{});
        await bot.launch();
        isBotRunning = true;
        console.log('ℹ️ Fallback to Polling due to webhook check error');
      } catch (e2) {
        console.error('❌ Polling fallback failed:', e2.message || e2);
      }
    }
    
    startSelfPing();
  } else {
    console.log('🔄 Starting in POLLING Mode (No Public URL found)');
    try {
      // Delete webhook to ensure polling works
      await bot.telegram.deleteWebhook();
      console.log('   Old webhook deleted.');
      
      await bot.launch();
      isBotRunning = true;
      console.log('✅ Bot launched via Polling');
    } catch (e) {
      console.error('❌ Polling launch failed:', e);
      process.exit(1);
    }
  }
  try {
    startPromoLoop();
  } catch (e) {
    console.error('Promo loop init error:', e.message || e);
  }
}

async function stopBot(reason) {
  if (!isBotRunning) {
      if (reason) console.log(`Shutdown signal ${reason} received (Bot not running). Exiting.`);
      process.exit(0);
      return;
  }
  
  console.log(`Stopping bot... Reason: ${reason}`);
  try {
    await bot.stop(reason);
  } catch (e) {
    console.error('Error stopping bot:', e.message);
  } finally {
    isBotRunning = false;
    console.log('Bot stopped.');
    process.exit(0);
  }
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
      console.log(`Server running on port ${PORT}`);
      
      if (!process.env.BOT_TOKEN) {
        console.error('CRITICAL ERROR: BOT_TOKEN is missing.');
      }
      
      await startBot();
  });

  if (!shouldUseWebhook) {
    process.once('SIGINT', () => stopBot('SIGINT'));
    process.once('SIGTERM', () => stopBot('SIGTERM'));
  }
}

module.exports = { app };
