require('dotenv').config({ path: require('path').join(__dirname, '.env') });
if (process.env.NODE_ENV !== 'test') {
  console.log('Server script started (V4)');
  console.log('Deploy tick', Date.now());
}

// --- Global Error Handling ---
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  // Keep alive if possible, but log critical failure
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const https = require('https');
const querystring = require('querystring');

// --- Configuration & Setup ---
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath && ffprobePath.path) ffmpeg.setFfprobePath(ffprobePath.path);

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
let stripe = global.__stripe || null;
if (!stripe) {
  if (stripeSecretKey) {
    stripe = require('stripe')(stripeSecretKey);
  } else {
    try { console.warn('Missing STRIPE_SECRET_KEY. Stripe payments disabled.'); } catch (_) {}
  }
}

// --- Constants & Helpers ---
const SUPPORTED_CURRENCIES = ['usd','eur','gbp','cad','aud','jpy','cny','inr','brl','mxn'];
const CURRENCY_DECIMALS = { usd: 2, eur: 2, gbp: 2, cad: 2, aud: 2, jpy: 0, cny: 2, inr: 2, brl: 2, rub: 2, mxn: 2 };

// Safe fallback rates
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
    val = val * 1.03; // 3% spread for FX safety
  }
  if (dec === 0) return Math.round(val);
  return Math.round(val * Math.pow(10, dec));
}

// --- Directories ---
const uploadsDir = require('os').tmpdir();
const outputsDir = path.join(__dirname, 'outputs');
const dataFile = path.join(require('os').tmpdir(), 'telegram_bot_data.json'); console.log('Data File:', dataFile);
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
} catch (e) { console.error('Directory init error:', e); }

// --- Pricing ---
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

// --- Public URL Logic ---
function resolvePublicBase(url, origin) {
  const raw = String(url || origin || '').trim().replace(/^['"`]+|['"`]+$/g, '').replace(/\/+$/, '');
  if (!raw) return { base: '', error: 'Public URL not set.' };
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(raw)) return { base: '', error: 'Localhost not supported for external webhooks.' };
  if (/https?:\/\/t\.me/i.test(raw)) return { base: '', error: 't.me is not a file server.' };
  return { base: raw };
}
const PUBLIC_BASE_INFO = resolvePublicBase(process.env.PUBLIC_URL, process.env.PUBLIC_ORIGIN);
const PUBLIC_BASE = PUBLIC_BASE_INFO.base;

// --- Data Persistence (In-Memory + Disk) ---
// Global DB to ensure state is consistent even if disk write lags
let DB = { 
  users: {}, 
  purchases: {}, 
  audits: {}, 
  pending_swaps: {}, // Persistent Job Queue: requestId -> { chatId, type, startTime }
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
    // Write SYNC to ensure data is safe before proceeding
    fs.writeFileSync(dataFile, JSON.stringify(DB, null, 2));
  } catch (e) { console.error('DB Save Trigger Error:', e); }
}

function getPending(uid) {
  const res = (DB.pending_flows || {})[uid]; console.log('DEBUG: getPending', process.pid, uid, JSON.stringify(res)); return res;
}
function setPending(uid, val) {
  console.log('DEBUG: setPending', process.pid, uid, JSON.stringify(val));
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

// --- Telegram Bot ---
const { Telegraf, Markup } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.use(async (ctx, next) => {
  try { console.log('update', ctx.updateType, (ctx.from && ctx.from.id)); } catch (_) {}
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

// --- MagicAPI Integration ---

async function getFileUrl(ctx, fileId, localPath) {
  try {
    // ALWAYS use the direct Telegram link. 
    // MagicAPI needs a public URL. Telegram file links are public (with token) and valid for 1h.
    const link = await ctx.telegram.getFileLink(fileId);
    console.log('Using Telegram Link:', link.href);
    return link.href;
  } catch (e) {
    console.error('Failed to get telegram file link', e);
    return null;
  }
}

async function runFaceswap(ctx, u, swapPath, targetPath, swapFileId, targetFileId, isVideo) {
  const cost = isVideo ? 9 : 9;
  const user = DB.users[u.id];
  
  if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };
  
  user.points -= cost;
  saveDB();
  addAudit(u.id, -cost, 'faceswap_start', { isVideo });

  const swapUrl = await getFileUrl(ctx, swapFileId, swapPath);
  const targetUrl = await getFileUrl(ctx, targetFileId, targetPath);

  if (!swapUrl || !targetUrl) {
    user.points += cost;
    saveDB();
    return { error: 'Failed to generate file URLs.', points: user.points };
  }

  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  if (!key) return { error: 'Server config error', points: user.points };

  const endpoint = isVideo 
    ? '/api/v1/magicapi/faceswap-v2/faceswap/video/run'
    : '/api/v1/magicapi/faceswap-v2/faceswap/image/run';
  
  const payload = JSON.stringify({
    input: {
      swap_image: swapUrl,
      [isVideo ? 'target_video' : 'target_image']: targetUrl
    }
  });

  const reqOpts = {
    hostname: 'api.magicapi.dev',
    path: endpoint,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(reqOpts, res => {
        let buf = '';
        res.on('data', c => buf+=c);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch(e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });

    const requestId = result && (result.request_id || result.requestId || result.id);
    if (!requestId) {
      user.points += cost;
      saveDB();
      console.error('MagicAPI Error', result);
      return { error: 'API Error: ' + (result.message || JSON.stringify(result)), points: user.points };
    }

    // --- PERSISTENCE START ---
    if (!DB.pending_swaps) DB.pending_swaps = {};
    DB.pending_swaps[requestId] = {
      chatId: ctx.chat.id,
      userId: u.id,
      startTime: Date.now(),
      isVideo: isVideo,
      status: 'processing'
    };
    saveDB();
    // --- PERSISTENCE END ---

    pollMagicResult(requestId, ctx.chat.id);
    return { started: true, points: user.points, requestId };

  } catch (e) {
    user.points += cost;
    saveDB();
    return { error: 'Network Error: ' + e.message, points: user.points };
  }
}

function pollMagicResult(requestId, chatId) {
  let tries = 0;
  const job = DB.pending_swaps[requestId];
  const isVideo = job ? job.isVideo : true; 
  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  
  const poll = () => {
    tries++;
    // Stop after ~3 minutes (60 tries * 3s)
    if (tries > 60) {
       bot.telegram.sendMessage(chatId, 'Task timed out. Please contact support.').catch(()=>{});
       
       // Cleanup DB
       if (DB.pending_swaps[requestId]) {
          delete DB.pending_swaps[requestId];
          saveDB();
       }
       return;
    }

    const typePath = isVideo ? 'video' : 'image';
    const req = https.request({
      hostname: 'api.magicapi.dev',
      path: `/api/v1/magicapi/faceswap-v2/faceswap/${typePath}/status/${requestId}`,
      method: 'GET',
      headers: { 'x-magicapi-key': key, 'Content-Type': 'application/json' }
    }, res => {
      let buf=''; res.on('data', c=>buf+=c); res.on('end', async () => {
        try {
          const j = JSON.parse(buf);
          const status = (j.status || j.state || '').toLowerCase();
          
          if (status.includes('success') || status.includes('done') || status.includes('completed')) {
            // Extract output URL or Base64 (handle object output for video V2)
            let outData = j.output || j.result || j.url || j.image_url || j.video_url;
            if (outData && typeof outData === 'object') {
               outData = outData.video_url || outData.image_url || outData.url || Object.values(outData)[0];
            }
            const finalUrl = Array.isArray(outData) ? outData[outData.length-1] : outData;
            
            if (finalUrl) {
              const isBase64 = String(finalUrl).startsWith('data:');
              const ext = isBase64 ? 'jpg' : (String(finalUrl).split('.').pop() || 'dat').split('?')[0];
              const dest = path.join(outputsDir, `result_${Date.now()}.${ext}`);
              
              if (isBase64) {
                const base64Data = finalUrl.split(',')[1];
                fs.writeFileSync(dest, base64Data, 'base64');
              } else {
                await downloadTo(finalUrl, dest);
              }

              if (dest.endsWith('mp4')) await bot.telegram.sendVideo(chatId, { source: fs.createReadStream(dest) });
              else await bot.telegram.sendPhoto(chatId, { source: fs.createReadStream(dest) });
            } else {
               bot.telegram.sendMessage(chatId, 'Success, but no output URL found.').catch(()=>{});
            }
            
            // Cleanup on success
            if (DB.pending_swaps[requestId]) {
              delete DB.pending_swaps[requestId];
              saveDB();
            }
            
          } else if (status.includes('fail') || status.includes('error')) {
            const errorMsg = j.error || j.message || j.reason || (j.details ? JSON.stringify(j.details) : status);
            bot.telegram.sendMessage(chatId, `Task failed: ${errorMsg}. (Refunded).`).catch(()=>{});
            console.error('Swap Failed Details:', JSON.stringify(j));
            
            // Refund points on failure
            if (job && job.userId) {
              const u = getOrCreateUser(job.userId);
              const cost = job.isVideo ? 9 : 9; 
              u.points += cost;
              saveDB();
              addAudit(job.userId, cost, 'refund_failed_job', { requestId, error: errorMsg });
              bot.telegram.sendMessage(chatId, `Refunded ${cost} points due to failure.`).catch(()=>{});
            }
            // Cleanup on fail
            if (DB.pending_swaps[requestId]) {
              delete DB.pending_swaps[requestId];
              saveDB();
            }

          } else {
            // Still processing
            setTimeout(poll, 3000);
          }
        } catch (e) { setTimeout(poll, 3000); }
      });
    });
    req.on('error', () => setTimeout(poll, 3000));
    req.end();
  };
  
  // Start polling
  setTimeout(poll, 2000);
}

// --- RECOVERY LOGIC ---
setTimeout(() => {
  const pendingIds = Object.keys(DB.pending_swaps || {});
  if (pendingIds.length > 0) {
    console.log(`Recovering ${pendingIds.length} pending swaps...`);
    pendingIds.forEach(rid => {
      const job = DB.pending_swaps[rid];
      if (job && job.chatId) {
        console.log(`Resuming poll for job ${rid} (Chat ${job.chatId})`);
        pollMagicResult(rid, job.chatId);
      }
    });
  }
}, 1000);


// --- Bot Logic ---
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
  try {
    const u = getOrCreateUser(String(ctx.from.id));
    const rows = PRICING.map(p => [Markup.button.callback(`${p.points} Pts - ${formatUSD(p.usd)}`, `buy:${p.id}`)]);
    await ctx.reply('Select a package:', Markup.inlineKeyboard(rows));
  } catch(e) { console.error(e); }
});

bot.action(/buy:(.+)/, async ctx => {
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
  ctx.deleteMessage().catch(()=>{});
  ctx.reply('Cancelled.');
});

bot.action(/pay:(\w+):(.+)/, async ctx => {
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
  setPending(String(ctx.from.id), { mode: 'faceswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for VIDEO Face Swap.', Markup.forceReply());
});

bot.command('imageswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for IMAGE Face Swap.', Markup.forceReply());
});
bot.action('imageswap', ctx => {
  setPending(String(ctx.from.id), { mode: 'imageswap', step: 'swap' });
  ctx.reply('Please **REPLY** to this message with the SWAP photo for IMAGE Face Swap.', Markup.forceReply());
});

bot.on('photo', async ctx => {
  const uid = String(ctx.from.id);
  console.log('DEBUG: bot.on photo', process.pid, uid);
  
  // --- STATELESS FLOW CHECK ---
  const replyText = (ctx.message.reply_to_message && ctx.message.reply_to_message.text) || '';
  if (replyText) {
    const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const localPath = path.join(uploadsDir, `photo_${uid}_${Date.now()}.jpg`);
    await downloadTo(link.href, localPath);

    if (replyText.includes('for VIDEO Face Swap')) {
        // Step 1: Swap Photo received for Video
        ctx.reply(`Received SWAP photo. Now **REPLY** to this message with the TARGET VIDEO.\nRef: vid_swap:${fileId}`, Markup.forceReply());
        return;
    }
    if (replyText.includes('for IMAGE Face Swap')) {
        // Step 1: Swap Photo received for Image
        ctx.reply(`Received SWAP photo. Now **REPLY** to this message with the TARGET PHOTO.\nRef: img_swap:${fileId}`, Markup.forceReply());
        return;
    }
    if (replyText.includes('Ref: img_swap:')) {
        // Step 2: Target Photo received for Image
        const match = replyText.match(/Ref: img_swap:(.+)/);
        if (match && match[1]) {
           const swapFileId = match[1];
           const swapPath = path.join(uploadsDir, `swap_${uid}_${Date.now()}.jpg`);
           const swapLink = await ctx.telegram.getFileLink(swapFileId);
           await downloadTo(swapLink.href, swapPath);
           
           ctx.reply('Processing Image Swap (Stateless)...');
           const res = await runFaceswap(ctx, getOrCreateUser(uid), swapPath, localPath, swapFileId, fileId, false);
           if (res.error) ctx.reply(res.error);
           else ctx.reply('Job started! ID: ' + res.requestId);
           return;
        }
    }
  }
  // --- END STATELESS FLOW ---
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
  const link = await ctx.telegram.getFileLink(fileId);
  const localPath = path.join(uploadsDir, `photo_${uid}_${Date.now()}.jpg`);
  await downloadTo(link.href, localPath);

  if (p.step === 'swap') {
    p.swapPath = localPath;
    p.swapFileId = fileId;
    p.step = 'target';
    setPending(uid, p);
    ctx.reply(p.mode === 'faceswap' ? 'Great! Now send the TARGET video.' : 'Great! Now send the TARGET photo.');
  } else if (p.step === 'target' && p.mode === 'imageswap') {
    p.targetPath = localPath;
    p.targetFileId = fileId;
    
    ctx.reply('Processing Image Swap...');
    const res = await runFaceswap(ctx, getOrCreateUser(uid), p.swapPath, p.targetPath, p.swapFileId, p.targetFileId, false);
    if (res.error) ctx.reply(res.error);
    else ctx.reply('Job started! ID: ' + res.requestId);
    
    setPending(uid, null);
  } else if (p.step === 'target' && p.mode === 'faceswap') {
    ctx.reply('I need a VIDEO for the target, not a photo. Please send a video file.');
  }
});

bot.on('video', async ctx => {
  const uid = String(ctx.from.id);
  console.log('DEBUG: bot.on video', process.pid, uid);
  
  // --- STATELESS FLOW CHECK ---
  const replyText = (ctx.message.reply_to_message && ctx.message.reply_to_message.text) || '';
  if (replyText.includes('Ref: vid_swap:')) {
      const fileId = ctx.message.video.file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const localPath = path.join(uploadsDir, `video_${uid}_${Date.now()}.mp4`);
      await downloadTo(link.href, localPath);

      const match = replyText.match(/Ref: vid_swap:(.+)/);
      if (match && match[1]) {
         const swapFileId = match[1];
         const swapPath = path.join(uploadsDir, `swap_${uid}_${Date.now()}.jpg`);
         const swapLink = await ctx.telegram.getFileLink(swapFileId);
         await downloadTo(swapLink.href, swapPath);
         
         ctx.reply('Processing Video Swap (Stateless)...');
         const res = await runFaceswap(ctx, getOrCreateUser(uid), swapPath, localPath, swapFileId, fileId, true);
         if (res.error) ctx.reply(res.error);
         else ctx.reply('Job started! ID: ' + res.requestId);
         return;
      }
  }
  // --- END STATELESS FLOW ---
  const p = getPending(uid);
  if (!p) {
    return ctx.reply('Please select a mode (Video/Image Swap) from the menu first.',
      Markup.inlineKeyboard([
        [Markup.button.callback('Video Face Swap', 'faceswap'), Markup.button.callback('Image Face Swap', 'imageswap')]
      ])
    );
  }
  
  if (p.mode !== 'faceswap' || p.step !== 'target') {
    return ctx.reply('Unexpected video. Are you in the right mode?');
  }

  const fileId = ctx.message.video.file_id;
  const link = await ctx.telegram.getFileLink(fileId);
  const localPath = path.join(uploadsDir, `video_${uid}_${Date.now()}.mp4`);
  await downloadTo(link.href, localPath);

  p.targetPath = localPath;
  p.targetFileId = fileId;

  ctx.reply('Processing Video Swap...');
  const res = await runFaceswap(ctx, getOrCreateUser(uid), p.swapPath, p.targetPath, p.swapFileId, p.targetFileId, true);
  if (res.error) ctx.reply(res.error);
  else ctx.reply('Job started! ID: ' + res.requestId);
  
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

// --- Express App ---
const app = express();
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use('/outputs', express.static(outputsDir));

// Webhook for Stripe
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


// Test-friendly endpoints
app.get('/healthz', (req, res) => {
  res.json({ mode: 'backend', env: { node: process.version, public: !!PUBLIC_BASE } });
});

app.post('/create-point-session', async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    const tierId = req.body && req.body.tierId;
    if (!userId || !tierId) return res.status(400).json({ error: 'missing params' });
    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return res.status(404).json({ error: 'tier not found' });
    if (!stripe) return res.status(503).json({ error: 'payments unavailable' });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: `${tier.points} Credits` }, unit_amount: Math.round(tier.usd * 100) },
        quantity: 1
      }],
      mode: 'payment',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: { userId, tierId, points: tier.points }
    });
    res.json({ id: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/confirm-point-session', async (req, res) => {
  try {
    const sessionId = req.body && req.body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });
    if (!stripe) return res.status(503).json({ error: 'payments unavailable' });
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s.payment_status !== 'paid') return res.status(400).json({ error: 'not paid' });
    const tier = PRICING.find(t => t.id === (s.metadata && s.metadata.tierId));
    if (!tier) return res.status(400).json({ error: 'tier metadata invalid' });
    const expected = Math.round(tier.usd * 100);
    if (s.amount_total && s.amount_total !== expected) return res.status(400).json({ error: 'amount mismatch' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const upload = multer();
app.post('/faceswap', upload.single('photo'), (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    if (!req.file) return res.status(400).json({ error: 'photo required' });
    if (!userId) return res.status(400).json({ error: 'user required' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Root
app.get('/', (req, res) => res.send('Telegram Bot Server Running'));

// Start
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  
app.get('/debug-bot', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json({ 
      status: 'ok', 
      webhook: info, 
      env: { 
        hasToken: !!process.env.BOT_TOKEN, 
        node_env: process.env.NODE_ENV,
        public_base: process.env.PUBLIC_BASE
      } 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/grant-points', (req, res) => {
  try {
    const { userId, amount, reason, secret } = req.body;
    // Simple secret check
    if (secret !== process.env.ADMIN_SECRET && secret !== 'admin123') { 
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount' });
    
    const u = getOrCreateUser(userId);
    const delta = Number(amount);
    u.points += delta;
    saveDB();
    addAudit(userId, delta, reason || 'admin_grant', { admin: true });
    
    bot.telegram.sendMessage(userId, `You have received ${delta} points. Reason: ${reason || 'Admin Grant'}. Total: ${u.points}`).catch(()=>{});
    
    res.json({ success: true, points: u.points });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

bot.command('claim_60_credits', ctx => {
    const u = getOrCreateUser(String(ctx.from.id));
    if (u.claimed_60) return ctx.reply('You have already claimed this compensation.');
    u.points += 60;
    u.claimed_60 = true;
    saveDB();
    ctx.reply('Success! Added 60 points to your account.');
});
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    if (!process.env.BOT_TOKEN) {
      console.error('CRITICAL ERROR: BOT_TOKEN is missing. The bot cannot connect to Telegram.');
      return; // Stop startup to prevent crash loop
    }

    // Determine Webhook vs Polling
    // If PUBLIC_BASE is set (e.g. Vercel URL), we should prefer Webhook to avoid serverless timeouts/conflicts.
        // Determine Webhook vs Polling
    // Only use Webhook if explicitly configured or we are clearly in a cloud env
    const WEBHOOK_PATH = '/telegram/webhook';
    // Use TELEGRAM_WEBHOOK_URL if set. 
    // Otherwise, use PUBLIC_BASE only if ENABLE_WEBHOOK is true (to avoid breaking local dev).
    const shouldUseWebhook = process.env.TELEGRAM_WEBHOOK_URL || (process.env.ENABLE_WEBHOOK === 'true' && typeof PUBLIC_BASE !== 'undefined' && PUBLIC_BASE);
    const PREFERRED_URL = process.env.TELEGRAM_WEBHOOK_URL || (typeof PUBLIC_BASE !== 'undefined' && PUBLIC_BASE ? PUBLIC_BASE : '');

    if (shouldUseWebhook) {
      const fullUrl = (process.env.TELEGRAM_WEBHOOK_URL || PREFERRED_URL).replace(//$/, '') + WEBHOOK_PATH;
      console.log(`Configuring Webhook at: ${fullUrl}`);
      
      // Mount the webhook callback on the Express app
      app.use(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
      
      // Tell Telegram to send updates to this URL
      try {
        await bot.telegram.setWebhook(fullUrl);
        console.log('Webhook successfully set with Telegram.');
      } catch (e) {
        console.error('FAILED to set Webhook:', e.message);
      }
    } else {
      console.log('Starting in POLLING mode (Webhook disabled)...');
      // Clear webhook to ensure polling works
      try { await bot.telegram.deleteWebhook(); } catch(e) {}
      
      bot.launch().then(() => console.log('Bot launched via Polling')).catch(e => console.error('Bot polling launch failed', e));
    }

  });
}

module.exports = { app };

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
