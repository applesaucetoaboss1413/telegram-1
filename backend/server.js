require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fetch = require('node-fetch');
const { default: PQueue } = require('p-queue');

const queue = new PQueue({ concurrency: 1, timeout: 300000 });

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
const { Telegraf, Markup } = require('telegraf');

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

function resolvePublicBase(url, origin, renderExternal) {
  const raw = String(url || origin || renderExternal || '').trim().replace(/^['"`]+|['"`]+$/g, '').replace(/\/+$/, '');
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

function saveDB() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(DB, null, 2));
  } catch (e) { console.error('DB Save Trigger Error:', e); }
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

function getOrCreateUser(id, fields) {
  let u = DB.users[id];
  if (!u) {
    u = { id, points: 10, created_at: Date.now() }; 
    DB.users[id] = u;
    saveDB();
  }
  if (fields) { Object.assign(u, fields); saveDB(); }
  return u;
}
function addAudit(userId, delta, reason, meta) {
  if (!DB.audits) DB.audits = {};
  DB.audits[userId] = DB.audits[userId] || [];
  DB.audits[userId].push({ at: Date.now(), delta, reason, meta });
  saveDB();
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
  } catch (_) {}
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

// Helper: Retry Logic
async function callMagicAPIWithRetry(endpoint, payload, key, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${maxRetries}] Calling MagicAPI...`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'x-magicapi-key': key, 'Content-Type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 60000
      });
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

// Helper: Poll Result
function pollMagicResult(requestId, chatId) {
  let tries = 0;
  const job = DB.pending_swaps[requestId];
  const isVideo = job ? job.isVideo : true; 
  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  
  const poll = async () => {
    tries++;
    if (tries > 100) { // 5 minutes approx
       if (chatId) bot.telegram.sendMessage(chatId, 'Task timed out. Please contact support.').catch(()=>{});
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
      let response;
      if (isVideo) {
          // Capix Polling (POST)
          const params = new URLSearchParams();
          params.append('request_id', requestId);
          response = await fetch('https://api.magicapi.dev/api/v1/capix/faceswap/result/', {
              method: 'POST',
              headers: { 
                  'x-magicapi-key': key, 
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'accept': 'application/json'
              },
              body: params
          });
      } else {
          // Fallback/Legacy Polling (GET)
          response = await fetch(`https://api.magicapi.dev/api/v1/magicapi/faceswap-v2/faceswap/video/status/${requestId}`, {
              method: 'GET',
              headers: { 'x-magicapi-key': key, 'Content-Type': 'application/json' }
          });
      }

      const text = await response.text();
      let j;
      try { j = JSON.parse(text); } catch(e) {}

      if (response.ok && j) {
          const status = (j.status || j.state || '').toLowerCase();
          const outData = j.output || j.result || j.url || j.image_url || j.video_url || (j.data && j.data.result);
          
          if (outData) {
            // Success
            let finalUrl = Array.isArray(outData) ? outData[outData.length-1] : outData;
            if (typeof finalUrl === 'object') finalUrl = finalUrl.video_url || finalUrl.image_url || finalUrl.url || Object.values(finalUrl)[0];

            if (chatId) {
                if (isVideo) await bot.telegram.sendVideo(chatId, finalUrl, { caption: '✅ Face swap complete!' });
                else await bot.telegram.sendPhoto(chatId, finalUrl, { caption: '✅ Face swap complete!' });
            }
            
            if (!DB.api_results) DB.api_results = {};
            DB.api_results[requestId] = { status: 'success', output: finalUrl, url: finalUrl };
            
            if (DB.pending_swaps[requestId]) {
              delete DB.pending_swaps[requestId];
              saveDB();
            }
          } else if (status.includes('fail') || status.includes('error')) {
             // Failed
             throw new Error(j.error || j.message || 'Unknown error');
          } else {
             // Still processing
             setTimeout(poll, 3000);
          }
      } else {
          // API error or not ready
          setTimeout(poll, 3000);
      }
    } catch (e) {
       // Check if we should stop polling on error
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

  const swapUrl = await getFileUrl(ctx, swapFileId);
  const targetUrl = await getFileUrl(ctx, targetFileId);

  if (!swapUrl || !targetUrl) {
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

  const endpoint = isVideo 
    ? 'https://api.magicapi.dev/api/v1/capix/faceswap/faceswap/v1/video'
    : 'https://api.magicapi.dev/api/v1/magicapi/faceswap/faceswap';
  
  const payload = isVideo ? {
    target_url: targetUrl, swap_url: swapUrl
  } : {
    swap_image: swapUrl, target_image: targetUrl
  };

  try {
      const qPos = queue.size;
      if (qPos > 0) {
          ctx.reply(`📍 Position in queue: ${qPos + 1}\n⏳ Waiting for processor...`).catch(()=>{});
      }

      const result = await queue.add(async () => {
          return await callMagicAPIWithRetry(endpoint, payload, key);
      });

      const data = result.data;
      const outputUrl = data && (data.output || data.image_url || data.video_url || data.url || (data.result && data.result.video_url));

      if (outputUrl) {
          return { success: true, output: outputUrl, points: user.points };
      } else if (data && data.request_id) {
          if (!DB.pending_swaps) DB.pending_swaps = {};
          DB.pending_swaps[data.request_id] = {
            chatId: ctx.chat.id,
            userId: u.id,
            startTime: Date.now(),
            isVideo: isVideo,
            status: 'processing'
          };
          saveDB();
          pollMagicResult(data.request_id, ctx.chat.id);
          return { started: true, requestId: data.request_id, points: user.points };
      } else {
          throw new Error('No output URL or Request ID in response');
      }

  } catch (e) {
    user.points += cost;
    saveDB();
    console.error('[FACESWAP] Error:', e);
    return { error: 'Error: ' + e.message, points: user.points };
  }
}

bot.command('start', ctx => {
  const u = getOrCreateUser(String(ctx.from.id));
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

bot.command('faceswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'faceswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for VIDEO Face Swap.', Markup.forceReply());
});
bot.action('faceswap', ctx => {
  ack(ctx, 'Mode set: Video');
  setPending(String(ctx.from.id), { mode: 'faceswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for VIDEO Face Swap.', Markup.forceReply());
});

bot.command('imageswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for IMAGE Face Swap.', Markup.forceReply());
});
bot.action('imageswap', ctx => {
  ack(ctx, 'Mode set: Image');
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for IMAGE Face Swap.', Markup.forceReply());
});

async function processSwapFlow(ctx, uid, swapFileId, targetFileId, isVideo) {
    const processingMsg = await ctx.reply('Processing face swap... Please wait ⏳');
    
    const res = await runFaceswap(ctx, getOrCreateUser(uid), swapFileId, targetFileId, isVideo);
    
    if (res.error) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `❌ Failed: ${res.error}`);
    } else if (res.success && res.output) {
        await ctx.telegram.sendPhoto(ctx.chat.id, res.output, { caption: '✅ Face swap complete!' });
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } else if (res.started && res.requestId) {
        // Handle legacy/async polling if needed, but for now we assume sync or just notify
        await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `⏳ Job Started (ID: ${res.requestId}). This might take a while...`);
        // We could re-implement polling here if necessary
    }
}

bot.on('photo', async ctx => {
  const uid = String(ctx.from.id);
  const replyText = (ctx.message.reply_to_message && ctx.message.reply_to_message.text) || '';
  
  if (replyText) {
    const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;
    
    if (replyText.includes('for VIDEO Face Swap')) {
        ctx.reply(`Received SWAP photo. Now **REPLY** to this message with the TARGET VIDEO.\nRef: vid_swap:${fileId}`, Markup.forceReply());
        return;
    }
    if (replyText.includes('for IMAGE Face Swap')) {
        ctx.reply(`Received SWAP photo. Now **REPLY** to this message with the TARGET PHOTO.\nRef: img_swap:${fileId}`, Markup.forceReply());
        return;
    }
    if (replyText.includes('Ref: img_swap:')) {
        const match = replyText.match(/Ref: img_swap:(.+)/);
        if (match && match[1]) {
           const swapFileId = match[1];
           await processSwapFlow(ctx, uid, swapFileId, fileId, false);
           return;
        }
    }
  }
  
  const p = getPending(uid);
  if (!p) {
    return ctx.reply(
      '⚠️ **Action Required**\n\nTo perform a Face Swap, you must:\n1. Select a mode below.\n2. When asked, **REPLY** to the bot\'s message with your photo.\n\n(Simply sending a photo without replying will not work).', 
      Markup.inlineKeyboard([
        [Markup.button.callback('Video Face Swap', 'faceswap'), Markup.button.callback('Image Face Swap', 'imageswap')]
      ])
    );
  }

  const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;

  if (p.step === 'swap') {
    p.swapFileId = fileId;
    p.step = 'target';
    setPending(uid, p);
    ctx.reply(p.mode === 'faceswap' ? 'Great! Now send the TARGET video.' : 'Great! Now send the TARGET photo.');
  } else if (p.step === 'target' && p.mode === 'imageswap') {
    p.targetFileId = fileId;
    await processSwapFlow(ctx, uid, p.swapFileId, p.targetFileId, false);
    setPending(uid, null);
  } else if (p.step === 'target' && p.mode === 'faceswap') {
    ctx.reply('I need a VIDEO for the target, not a photo. Please send a video file.');
  }
});

bot.on('video', async ctx => {
  const uid = String(ctx.from.id);
  const replyText = (ctx.message.reply_to_message && ctx.message.reply_to_message.text) || '';
  
  if (replyText.includes('Ref: vid_swap:')) {
      const fileId = ctx.message.video.file_id;
      const match = replyText.match(/Ref: vid_swap:(.+)/);
      if (match && match[1]) {
         const swapFileId = match[1];
         await processSwapFlow(ctx, uid, swapFileId, fileId, true);
         return;
      }
  }
  
  const p = getPending(uid);
  if (!p || p.mode !== 'faceswap' || p.step !== 'target') {
    return ctx.reply('Please select a mode (Video/Image Swap) from the menu first.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Video Face Swap', 'faceswap'), Markup.button.callback('Image Face Swap', 'imageswap')]
      ])
    );
  }

  const fileId = ctx.message.video.file_id;
  await processSwapFlow(ctx, uid, p.swapFileId, fileId, true);
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
app.use('/uploads', express.static(uploadsDir));
app.use('/outputs', express.static(outputsDir));

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
  res.json({ mode: 'backend', env: { node: process.version, public: !!PUBLIC_BASE } });
});

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    if (!process.env.BOT_TOKEN) {
      console.error('CRITICAL ERROR: BOT_TOKEN is missing.');
      return;
    }

    const WEBHOOK_PATH = '/telegram/webhook';
    const shouldUseWebhook = process.env.TELEGRAM_WEBHOOK_URL || (process.env.ENABLE_WEBHOOK === 'true' && typeof PUBLIC_BASE !== 'undefined' && PUBLIC_BASE) || process.env.RENDER_EXTERNAL_URL;
    
    // Prioritize RENDER_EXTERNAL_URL if available
    let baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.TELEGRAM_WEBHOOK_URL || PREFERRED_URL;
    if (baseUrl && !baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
    
    if (shouldUseWebhook && baseUrl) {
      const fullUrl = baseUrl.replace(/\/$/, '') + WEBHOOK_PATH;
      console.log(`Configuring Webhook at: ${fullUrl}`);
      
      app.use(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
      
      try {
        await bot.telegram.setWebhook(fullUrl);
        console.log('Webhook successfully set with Telegram.');
      } catch (e) {
        console.error('FAILED to set Webhook:', e.message);
      }
    } else {
      console.log('Starting in POLLING mode (Webhook disabled)...');
      try { await bot.telegram.deleteWebhook(); } catch(e) {}
      
      bot.launch().then(() => console.log('Bot launched via Polling')).catch(e => console.error('Bot polling launch failed', e));
    }

  });

module.exports = { app };

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
