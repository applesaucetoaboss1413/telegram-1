require('dotenv').config();
console.log('Server script started');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const Replicate = require('replicate');
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath && ffprobePath.path) {
  ffmpeg.setFfprobePath(ffprobePath.path);
}
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
console.log('Env', { BOT_TOKEN: !!process.env.BOT_TOKEN, PUBLIC_URL: !!process.env.PUBLIC_URL, PUBLIC_ORIGIN: !!process.env.PUBLIC_ORIGIN, CHANNEL_ID: process.env.CHANNEL_ID ? process.env.CHANNEL_ID : '' });

const app = express();
const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
const dataFile = path.join(__dirname, 'data.json');
const PRICING = [
  { id: 'p60', points: 60, usd: 3.09, stars: 150, tierBonus: 0.0 },
  { id: 'p120', points: 120, usd: 5.09, stars: 250, tierBonus: 0.02 },
  { id: 'p300', points: 300, usd: 9.99, stars: 500, tierBonus: 0.05 },
  { id: 'p800', points: 800, usd: 19.99, stars: 1000, tierBonus: 0.08 },
  { id: 'p1500', points: 1500, usd: 29.99, stars: 1500, tierBonus: 0.10 },
  { id: 'p7500', points: 7500, usd: 99.0, stars: 5000, tierBonus: 0.12 },
];
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
} catch (e) {
  console.error('Directory init error:', e);
}
const upload = multer({ dest: uploadsDir });

app.use((req, res, next) => {
  if (req.originalUrl === '/stripe/webhook') return next();
  return express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(outputsDir));

function loadData() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    if (!data.users) data.users = {};
    if (!data.purchases) data.purchases = {};
    return data;
  } catch (e) {
    return { users: {}, purchases: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data));
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

app.post('/init-user', async (req, res) => {
  const { id, username, first_name, last_name } = req.body;
  const ref = req.body.ref;
  const promo = req.body.promo;
  if (!id) return res.status(400).json({ error: 'missing id' });
  const data = loadData();
  let u = data.users[id];
  if (!u) {
    u = {
      id,
      username: username || '',
      first_name: first_name || '',
      last_name: last_name || '',
      points: 9,
      stars_balance: 0,
      last_checkin: '',
      invite_count: 0,
      promo_count: 0,
      has_recharged: false,
      recharge_total_points: 0,
      created_at: Date.now(),
    };
    data.users[id] = u;
    if (ref && ref !== id && data.users[ref]) {
      data.users[ref].points = (data.users[ref].points || 0) + 9;
      data.users[ref].invite_count = (data.users[ref].invite_count || 0) + 1;
    }
    if (promo && promo !== id && data.users[promo]) {
      data.users[promo].promo_count = (data.users[promo].promo_count || 0) + 1;
    }
    saveData(data);
  }
  const referral_link = `/?ref=${id}`;
  const botUsername = process.env.BOT_USERNAME || 'your_bot_username';
  const promo_link = `https://t.me/${botUsername}?start=promo_${id}`;
  res.json({ user: u, referral_link, promo_link });
});

app.post('/checkin', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'missing id' });
  const data = loadData();
  const u = data.users[id];
  if (!u) return res.status(404).json({ error: 'user not found' });
  const t = today();
  if (u.last_checkin === t) return res.json({ points: u.points, checked_in: false });
  u.points = (u.points || 0) + 1;
  u.last_checkin = t;
  saveData(data);
  res.json({ points: u.points, checked_in: true });
});

app.get('/leaderboard', (req, res) => {
  const data = loadData();
  const arr = Object.values(data.users);
  const invites = [...arr].sort((a, b) => (b.invite_count || 0) - (a.invite_count || 0)).slice(0, 20);
  const promos = [...arr].sort((a, b) => (b.promo_count || 0) - (a.promo_count || 0)).slice(0, 20);
  res.json({ invites, promos });
});

app.get('/pricing', (req, res) => {
  res.json({ tiers: PRICING });
});

app.post('/create-point-session', async (req, res) => {
  const { userId, tierId } = req.body || {};
  if (!userId || !tierId) return res.status(400).json({ error: 'missing params' });
  const tier = PRICING.find(t => t.id === tierId);
  if (!tier) return res.status(404).json({ error: 'tier not found' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `${tier.points} Points` },
          unit_amount: Math.round(tier.usd * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/?cancel=1`,
      metadata: { userId: String(userId), tierId },
    });
    res.json({ id: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/confirm-point-session', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || (session.payment_status !== 'paid' && session.status !== 'complete')) {
      return res.status(402).json({ error: 'payment not completed' });
    }
    const data = loadData();
    if (data.purchases[sessionId]) {
      const userId = session.metadata && session.metadata.userId;
      const u = userId ? data.users[userId] : null;
      return res.json({ points: u ? u.points : null, already_processed: true });
    }
    const userId = session.metadata && session.metadata.userId;
    const tierId = session.metadata && session.metadata.tierId;
    const u = userId ? data.users[userId] : null;
    const tier = PRICING.find(t => t.id === tierId);
    if (!u || !tier) return res.status(404).json({ error: 'not found' });
    const firstBonus = u.has_recharged ? 0 : 0.20;
    const loyaltyBonus = tier.tierBonus;
    const addPoints = Math.floor(tier.points * (1 + firstBonus + loyaltyBonus));
    u.points = (u.points || 0) + addPoints;
    u.has_recharged = true;
    u.recharge_total_points = (u.recharge_total_points || 0) + tier.points;
    data.purchases[sessionId] = true;
    saveData(data);
    res.json({ points: u.points, added: addPoints, bonus_rate: firstBonus + loyaltyBonus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/create-payment', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Mini App Service' },
          unit_amount: 100,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success`,
      cancel_url: `${req.headers.origin}/cancel`,
    });
    res.json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/faceswap', upload.fields([{ name: 'photo' }, { name: 'video' }]), async (req, res) => {
  const photoPath = req.files.photo[0].path;
  const videoPath = req.files.video ? req.files.video[0].path : null;
  const userId = req.body.userId;
  const data = loadData();
  const u = userId ? data.users[userId] : null;
  if (!u) return res.status(400).json({ error: 'missing user' });
  let cost = 3;
  if (videoPath) {
    try {
      const info = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, d) => {
          if (err) reject(err); else resolve(d);
        });
      });
      const duration = Math.ceil((info.format && info.format.duration) ? info.format.duration : 0);
      cost = duration * 3;
    } catch (e) {
      return res.status(500).json({ error: 'duration error' });
    }
  }
  if ((u.points || 0) < cost) return res.status(402).json({ error: 'not enough points', required: cost, points: u.points });
  u.points -= cost;
  saveData(data);
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const output = await replicate.run("lucataco/faceswap:9b847c5a94de1e8129b3da549d5ce1a4c6c1a883d8106901b16a86e5c8c1b33", {
      input: {
        target_image: fs.createReadStream(videoPath || photoPath),
        swap_image: fs.createReadStream(photoPath)
      }
    });
    res.json({ result: output, points: u.points });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-video', upload.fields([{ name: 'photo' }, { name: 'video' }]), (req, res) => {
  const photoPath = req.files.photo[0].path;
  const videoPath = req.files.video[0].path;
  const outputPath = path.join(outputsDir, `short-${Date.now()}.mp4`);

  ffmpeg(videoPath)
    .setDuration(10)
    .addInput(photoPath)
    .complexFilter('overlay=0:0')
    .save(outputPath)
    .on('end', () => {
      const publicUrl = `/outputs/${path.basename(outputPath)}`;
      res.json({ url: publicUrl });
    })
    .on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
});

const { Telegraf, Markup } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN || '');
bot.use(async (ctx, next) => { try { console.log('update', ctx.updateType, ctx.updateSubTypes || [], (ctx.from && ctx.from.id) || null, (ctx.chat && ctx.chat.type) || null, (ctx.chat && ctx.chat.id) || null, (ctx.chat && ctx.chat.title) || null); } catch (_) {} return next(); });

app.get('/healthz', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json({ mode: global.__botLaunchMode || 'none', webhook_info: info, env: { BOT_TOKEN: !!process.env.BOT_TOKEN, PUBLIC_URL: !!process.env.PUBLIC_URL, PUBLIC_ORIGIN: !!process.env.PUBLIC_ORIGIN } });
  } catch (e) {
    res.json({ mode: global.__botLaunchMode || 'none', error: e.message });
  }
});

function getOrCreateUser(id, fields) {
  const data = loadData();
  let u = data.users[id];
  if (!u) {
    u = {
      id,
      username: '',
      first_name: '',
      last_name: '',
      points: 9,
      last_checkin: '',
      invite_count: 0,
      promo_count: 0,
      has_recharged: false,
      recharge_total_points: 0,
      created_at: Date.now(),
    };
    data.users[id] = u;
    saveData(data);
  }
  if (fields) {
    Object.assign(u, fields);
    saveData(data);
  }
  return u;
}

async function downloadTo(url, dest) {
  const proto = url.startsWith('https') ? require('https') : require('http');
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    proto.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function ffprobeDuration(p) {
  return await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(p, (err, d) => {
      if (err) reject(err); else resolve((d.format && d.format.duration) ? Math.ceil(d.format.duration) : 0);
    });
  });
}

async function runFaceswap(u, photoPath, videoPath) {
  let cost = 3;
  if (videoPath) {
    const duration = await ffprobeDuration(videoPath);
    cost = duration * 3;
  }
  const data = loadData();
  const user = data.users[u.id];
  if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };
  user.points -= cost;
  saveData(data);
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const output = await replicate.run("lucataco/faceswap:9b847c5a94de1e8129b3da549d5ce1a4c6c1a883d8106901b16a86e5c8c1b33", {
    input: { target_image: fs.createReadStream(videoPath || photoPath), swap_image: fs.createReadStream(photoPath) }
  });
  return { result: output, points: user.points };
}

bot.start(async ctx => {
  const payload = ctx.startPayload || '';
  const u = getOrCreateUser(String(ctx.from.id), { username: ctx.from.username || '', first_name: ctx.from.first_name || '', last_name: ctx.from.last_name || '' });
  if (payload && payload.startsWith('ref_')) {
    const ref = payload.substring(4);
    const data = loadData();
    if (ref && ref !== String(ctx.from.id) && data.users[ref]) {
      data.users[ref].points = (data.users[ref].points || 0) + 9;
      data.users[ref].invite_count = (data.users[ref].invite_count || 0) + 1;
      saveData(data);
    }
  }
  if (payload && payload.startsWith('promo_')) {
    const promo = payload.substring(6);
    const data = loadData();
    if (promo && promo !== String(ctx.from.id) && data.users[promo]) {
      u.promoter_id = promo;
      data.users[promo].promo_count = (data.users[promo].promo_count || 0) + 1;
      saveData(data);
    }
  }
  const referral_link = `/?ref=${u.id}`;
  const botUsername = process.env.BOT_USERNAME || '';
  const promo_link = botUsername ? `https://t.me/${botUsername}?start=promo_${u.id}` : '';
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Points', 'points'), Markup.button.callback('Check-In', 'checkin')],
    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Faceswap', 'faceswap')],
    [Markup.button.callback('Create Video', 'createvideo'), Markup.button.callback('Leaderboard', 'leaderboard')],
    [Markup.button.callback('Promote', 'promote'), Markup.button.callback('Help', 'help')]
  ]);
  await ctx.reply(`Hello ${u.first_name || ''}. Points: ${u.points}\nInvite: ${referral_link}${promo_link ? '\nPromo: ' + promo_link : ''}`, keyboard);
});

bot.action('menu', async ctx => {
  await ctx.answerCbQuery();
  const id = String(ctx.from.id);
  const u = getOrCreateUser(id);
  const referral_link = `/?ref=${u.id}`;
  const botUsername = process.env.BOT_USERNAME || '';
  const promo_link = botUsername ? `https://t.me/${botUsername}?start=promo_${u.id}` : '';
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Points', 'points'), Markup.button.callback('Check-In', 'checkin')],
    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Faceswap', 'faceswap')],
    [Markup.button.callback('Create Video', 'createvideo'), Markup.button.callback('Leaderboard', 'leaderboard')],
    [Markup.button.callback('Promote', 'promote'), Markup.button.callback('Help', 'help')]
  ]);
  await ctx.reply(`Main Menu\nPoints: ${u.points}\nInvite: ${referral_link}${promo_link ? '\nPromo: ' + promo_link : ''}`, keyboard);
});

bot.command('menu', async ctx => {
  const id = String(ctx.from.id);
  const u = getOrCreateUser(id);
  const referral_link = `/?ref=${u.id}`;
  const botUsername = process.env.BOT_USERNAME || '';
  const promo_link = botUsername ? `https://t.me/${botUsername}?start=promo_${u.id}` : '';
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Points', 'points'), Markup.button.callback('Check-In', 'checkin')],
    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Faceswap', 'faceswap')],
    [Markup.button.callback('Create Video', 'createvideo'), Markup.button.callback('Leaderboard', 'leaderboard')],
    [Markup.button.callback('Clone', 'clone'), Markup.button.callback('Help', 'help')]
  ]);
  await ctx.reply(`Main Menu\nPoints: ${u.points}\nInvite: ${referral_link}${promo_link ? '\nPromo: ' + promo_link : ''}`, keyboard);
});

bot.action('points', async ctx => {
  const u = getOrCreateUser(String(ctx.from.id));
  await ctx.answerCbQuery();
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Check-In', 'checkin')],
    [Markup.button.callback('Main Menu', 'menu')]
  ]);
  await ctx.reply(`Points: ${u.points}`, kb);
});

bot.action('checkin', async ctx => {
  await ctx.answerCbQuery();
  const id = String(ctx.from.id);
  const data = loadData();
  const u = data.users[id] || getOrCreateUser(id);
  const t = today();
  if (u.last_checkin === t) return ctx.reply(`Already checked in. Points: ${u.points}`);
  u.points = (u.points || 0) + 1;
  u.last_checkin = t;
  saveData(data);
  await ctx.reply(`Checked in. Points: ${u.points}`);
});

bot.action('leaderboard', async ctx => {
  await ctx.answerCbQuery();
  const data = loadData();
  const arr = Object.values(data.users);
  const invites = [...arr].sort((a, b) => (b.invite_count || 0) - (a.invite_count || 0)).slice(0, 10);
  const promos = [...arr].sort((a, b) => (b.promo_count || 0) - (a.promo_count || 0)).slice(0, 10);
  await ctx.reply(`Top Invites:\n${invites.map(x => `${x.username || x.first_name || x.id}: ${x.invite_count || 0}`).join('\n')}`);
  await ctx.reply(`Top Promoters:\n${promos.map(x => `${x.username || x.first_name || x.id}: ${x.promo_count || 0}`).join('\n')}`);
});

bot.action('buy', async ctx => {
  await ctx.answerCbQuery();
  const rows = PRICING.map(t => [Markup.button.callback(`${t.points} / $${t.usd}`, `buy:${t.id}`)]);
  try {
    await ctx.reply('Select a package:', Markup.inlineKeyboard(rows));
  } catch (e) {
    try { await bot.telegram.sendMessage(ctx.from.id, 'Select a package:', Markup.inlineKeyboard(rows)); } catch (_) {}
  }
});

bot.action(/buy:(.+)/, async ctx => {
  await ctx.answerCbQuery();
  try {
    const tierId = ctx.match[1];
    const id = String(ctx.from.id);
    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return ctx.reply('Not found');
    const originRaw = (process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN || (process.env.BOT_USERNAME ? `https://t.me/${process.env.BOT_USERNAME}` : 'https://t.me'));
    const origin = String(originRaw).trim().replace(/^`+|`+$/g, '');
    const chatMeta = (ctx.chat && ctx.chat.type === 'channel') ? String(ctx.from.id) : String(ctx.chat.id);
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price_data: { currency: 'usd', product_data: { name: `${tier.points} Points` }, unit_amount: Math.round(tier.usd * 100) }, quantity: 1 }],
        mode: 'payment',
        success_url: `${origin}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?cancel=1`,
        metadata: { userId: String(id), tierId, chatId: chatMeta, promoterId: String(getOrCreateUser(id).promoter_id || '') }
      });
    } catch (e) {
      try { await bot.telegram.sendMessage(id, `Payment error: ${e.message}`); } catch (_) {}
      return;
    }
    const kb = Markup.inlineKeyboard([
      [Markup.button.url(`Pay $${tier.usd}`, session.url || 'https://stripe.com')],
      [Markup.button.callback('Confirm Payment', `confirm:${session.id}`)],
      [Markup.button.callback('Main Menu', 'menu')]
    ]);
    try {
      await ctx.reply('Complete your purchase, then tap Confirm:', kb);
    } catch (e) {
      try { await bot.telegram.sendMessage(id, 'Complete your purchase, then tap Confirm:', kb); } catch (_) {}
    }
  } catch (e) {
    try { await ctx.reply(`Error: ${e.message}`); } catch (_) {}
  }
});

bot.action(/confirm:(.+)/, async ctx => {
  await ctx.answerCbQuery();
  const sessionId = ctx.match[1];
  const r = await stripe.checkout.sessions.retrieve(sessionId);
  if (!r || (r.payment_status !== 'paid' && r.status !== 'complete')) return ctx.reply('Payment not completed');
  const data = loadData();
  if (data.purchases[sessionId]) {
    const uid = r.metadata && r.metadata.userId;
    const u = uid ? data.users[uid] : null;
    return ctx.reply(`Already processed. Points: ${u ? u.points : ''}`);
  }
  const uid = r.metadata && r.metadata.userId;
  const tierId = r.metadata && r.metadata.tierId;
  const u = uid ? data.users[uid] : null;
  const tier = PRICING.find(t => t.id === tierId);
  if (!u || !tier) return ctx.reply('Not found');
  const firstBonus = u.has_recharged ? 0 : 0.20;
  const loyaltyBonus = tier.tierBonus;
  const addPoints = Math.floor(tier.points * (1 + firstBonus + loyaltyBonus));
  u.points = (u.points || 0) + addPoints;
  u.has_recharged = true;
  u.recharge_total_points = (u.recharge_total_points || 0) + tier.points;
  const promoterId = (r.metadata && r.metadata.promoterId) || u.promoter_id || null;
  if (promoterId && data.users[promoterId]) {
    const amount = r.amount_total ? r.amount_total / 100 : tier.usd;
    const reward = Math.round(amount * 0.20 * 100) / 100;
    data.users[promoterId].reward_balance = (data.users[promoterId].reward_balance || 0) + reward;
  }
  data.purchases[sessionId] = true;
  saveData(data);
  await ctx.reply(`Credited ${addPoints} points. Balance: ${u.points}`);
});

bot.command('confirm', async ctx => {
  const parts = (ctx.message.text || '').split(' ').filter(Boolean);
  const sessionId = parts[1];
  if (!sessionId) return ctx.reply('Provide session id');
  const r = await stripe.checkout.sessions.retrieve(sessionId);
  if (!r || (r.payment_status !== 'paid' && r.status !== 'complete')) return ctx.reply('Payment not completed');
  const data = loadData();
  if (data.purchases[sessionId]) {
    const uid = r.metadata && r.metadata.userId;
    const u = uid ? data.users[uid] : null;
    return ctx.reply(`Already processed. Points: ${u ? u.points : ''}`);
  }
  const uid = r.metadata && r.metadata.userId;
  const tierId = r.metadata && r.metadata.tierId;
  const u = uid ? data.users[uid] : null;
  const tier = PRICING.find(t => t.id === tierId);
  if (!u || !tier) return ctx.reply('Not found');
  const firstBonus = u.has_recharged ? 0 : 0.20;
  const loyaltyBonus = tier.tierBonus;
  const addPoints = Math.floor(tier.points * (1 + firstBonus + loyaltyBonus));
  u.points = (u.points || 0) + addPoints;
  u.has_recharged = true;
  u.recharge_total_points = (u.recharge_total_points || 0) + tier.points;
  const promoterId = (r.metadata && r.metadata.promoterId) || u.promoter_id || null;
  if (promoterId && data.users[promoterId]) {
    const amount = r.amount_total ? r.amount_total / 100 : tier.usd;
    const reward = Math.round(amount * 0.20 * 100) / 100;
    data.users[promoterId].reward_balance = (data.users[promoterId].reward_balance || 0) + reward;
  }
  data.purchases[sessionId] = true;
  saveData(data);
  await ctx.reply(`Credited ${addPoints} points. Balance: ${u.points}`);
});

bot.action('clone', async ctx => {
  await ctx.answerCbQuery();
  const id = String(ctx.from.id);
  const botUsername = process.env.BOT_USERNAME || '';
  const promoLink = botUsername ? `https://t.me/${botUsername}?start=promo_${id}` : '';
  const refLink = `https://t.me/${botUsername}?start=ref_${id}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.url('Promo Link', promoLink || refLink)],
    [Markup.button.url('Invite Link', refLink)],
    [Markup.button.callback('Main Menu', 'menu')]
  ]);
  await ctx.reply('Share these links to promote. Purchases via your links credit you 20% and add promo counts.', kb);
});

bot.action('pricing', async ctx => {
  await ctx.answerCbQuery();
  const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
  await ctx.reply(`Prices:\n${lines.join('\n')}`);
});

bot.action('promote', async ctx => {
  await ctx.answerCbQuery();
  const id = String(ctx.from.id);
  const u = process.env.BOT_USERNAME || '';
  const promo = u ? `https://t.me/${u}?start=promo_${id}` : '';
  const ref = u ? `https://t.me/${u}?start=ref_${id}` : '';
  const kb = Markup.inlineKeyboard([
    [Markup.button.url('Promo Link', promo || ref)],
    [Markup.button.url('Invite Link', ref || promo)],
    [Markup.button.callback('Main Menu', 'menu')]
  ]);
  await ctx.reply('Share these links to promote. Purchases via your links credit you 20% and add promo counts.', kb);
});

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata && session.metadata.userId;
    const tierId = session.metadata && session.metadata.tierId;
    const chatId = session.metadata && session.metadata.chatId;
    const promoterId = session.metadata && session.metadata.promoterId;
    const data = loadData();
    if (!data.purchases[session.id]) {
      const u = userId ? data.users[userId] : null;
      const tier = PRICING.find(t => t.id === tierId);
      if (u && tier) {
        const firstBonus = u.has_recharged ? 0 : 0.20;
        const loyaltyBonus = tier.tierBonus;
        const addPoints = Math.floor(tier.points * (1 + firstBonus + loyaltyBonus));
        u.points = (u.points || 0) + addPoints;
        u.has_recharged = true;
        u.recharge_total_points = (u.recharge_total_points || 0) + tier.points;
        if (promoterId && data.users[promoterId]) {
          const amount = session.amount_total ? session.amount_total / 100 : tier.usd;
          const reward = Math.round(amount * 0.20 * 100) / 100;
          data.users[promoterId].reward_balance = (data.users[promoterId].reward_balance || 0) + reward;
        }
        data.purchases[session.id] = true;
        saveData(data);
        if (chatId) {
          bot.telegram.sendMessage(chatId, `Payment received. Credited ${addPoints} points. New balance: ${u.points}`);
        }
      }
    }
  }
  res.json({ received: true });
});

const pending = {};
const pendingChannel = {};

bot.command('faceswap', async ctx => {
  const isChannel = (ctx.chat && ctx.chat.type) === 'channel';
  if (isChannel) {
    pendingChannel[String(ctx.chat.id)] = { mode: 'faceswap', swap: null, target: null };
  } else {
    pending[String(ctx.from.id)] = { mode: 'faceswap', swap: null, target: null };
  }
  await ctx.reply('Send a photo of the face to swap, then a target video (optional).');
});

bot.action('faceswap', async ctx => {
  await ctx.answerCbQuery();
  const isChannel = (ctx.chat && ctx.chat.type) === 'channel';
  if (isChannel) {
    pendingChannel[String(ctx.chat.id)] = { mode: 'faceswap', swap: null, target: null };
  } else {
    pending[String(ctx.from.id)] = { mode: 'faceswap', swap: null, target: null };
  }
  try { await ctx.reply('Send a photo of the face to swap, then a target video (optional).'); } catch (e) { try { await bot.telegram.sendMessage(ctx.from.id, 'Send a photo of the face to swap, then a target video (optional).'); } catch (_) {} }
});

bot.action('createvideo', async ctx => {
  await ctx.answerCbQuery();
  const isChannel = (ctx.chat && ctx.chat.type) === 'channel';
  if (isChannel) {
    pendingChannel[String(ctx.chat.id)] = { mode: 'createvideo', photo: null, video: null };
  } else {
    pending[String(ctx.from.id)] = { mode: 'createvideo', photo: null, video: null };
  }
  try { await ctx.reply('Send overlay photo, then base video.'); } catch (e) { try { await bot.telegram.sendMessage(ctx.from.id, 'Send overlay photo, then base video.'); } catch (_) {} }
});

bot.on('photo', async ctx => {
  try {
    const pid = String(ctx.from.id);
    if (!pending[pid]) return;
    const p = pending[pid];
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const dest = path.join(uploadsDir, `photo_${pid}_${Date.now()}.jpg`);
    await downloadTo(String(link), dest);
    if (p.mode === 'faceswap') {
      p.swap = dest;
      if (p.target) {
        const u = getOrCreateUser(pid);
        let r;
        try { r = await runFaceswap(u, p.swap, p.target); } catch (e) { await ctx.reply(`Error: ${e.message}`); delete pending[pid]; return; }
        delete pending[pid];
        if (r.error) {
          const kb = Markup.inlineKeyboard([
            [Markup.button.callback('Buy Points', 'buy')],
            [Markup.button.callback('Main Menu', 'menu')]
          ]);
          return ctx.reply(`Not enough points. Required: ${r.required}, Your Points: ${r.points}`, kb);
        }
        await ctx.reply(`Done. Points: ${r.points}`);
        await ctx.reply(String(r.result));
      } else {
        await ctx.reply('Now send target video.');
      }
    } else if (p.mode === 'createvideo') {
      p.photo = dest;
      await ctx.reply('Now send base video.');
    }
  } catch (e) {
    try { await ctx.reply(`Error: ${e.message}`); } catch (_) {}
  }
});

bot.on('video', async ctx => {
  try {
    const pid = String(ctx.from.id);
    if (!pending[pid]) return;
    const p = pending[pid];
    const fileId = ctx.message.video.file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const dest = path.join(uploadsDir, `video_${pid}_${Date.now()}.mp4`);
    await downloadTo(String(link), dest);
    if (p.mode === 'faceswap') {
      p.target = dest;
      if (p.swap) {
        const u = getOrCreateUser(pid);
        let r;
        try { r = await runFaceswap(u, p.swap, p.target); } catch (e) { await ctx.reply(`Error: ${e.message}`); delete pending[pid]; return; }
        delete pending[pid];
        if (r.error) {
          const kb = Markup.inlineKeyboard([
            [Markup.button.callback('Buy Points', 'buy')],
            [Markup.button.callback('Main Menu', 'menu')]
          ]);
          return ctx.reply(`Not enough points. Required: ${r.required}, Your Points: ${r.points}`, kb);
        }
        await ctx.reply(`Done. Points: ${r.points}`);
        await ctx.reply(String(r.result));
      } else {
        await ctx.reply('Now send swap photo.');
      }
    } else if (p.mode === 'createvideo') {
      p.video = dest;
      if (p.photo) {
        const outputPath = path.join(outputsDir, `short-${Date.now()}.mp4`);
        ffmpeg(p.video)
          .setDuration(10)
          .addInput(p.photo)
          .complexFilter('overlay=0:0')
          .save(outputPath)
          .on('end', async () => {
            delete pending[pid];
            try {
              await ctx.replyWithVideo({ source: fs.createReadStream(outputPath) });
            } catch (e) {
              await ctx.reply(`Video ready at /outputs/${path.basename(outputPath)}`);
            }
          })
          .on('error', async (err) => {
            delete pending[pid];
            await ctx.reply(`Error: ${err.message}`);
          });
      } else {
        await ctx.reply('Now send overlay photo.');
      }
    }
  } catch (e) {
    try { await ctx.reply(`Error: ${e.message}`); } catch (_) {}
  }
});

bot.on('message', async ctx => {
  const type = ctx.chat && ctx.chat.type;
  if (type === 'group' || type === 'supergroup') {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('Prices', 'pricing'), Markup.button.callback('Help', 'help')],
      [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Promote', 'promote')],
      [Markup.button.callback('Menu', 'menu')]
    ]);
    const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
    await ctx.reply(`Welcome! Use the buttons below or type commands.\nPrices:\n${lines.join('\n')}`, kb);
  }
});

bot.on('chat_member', async ctx => {
  const type = ctx.chat && ctx.chat.type;
  if (type === 'group' || type === 'supergroup' || type === 'channel') {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('Prices', 'pricing'), Markup.button.callback('Help', 'help')],
      [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Promote', 'promote')],
      [Markup.button.callback('Menu', 'menu')]
    ]);
    const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
    await ctx.reply(`Welcome! Use the buttons below or type commands.\nPrices:\n${lines.join('\n')}`, kb);
  }
});

bot.on('my_chat_member', async ctx => {
  const id = ctx.chat && ctx.chat.id;
  if (!id) return;
  try { await postChannelGreet(String(id)); } catch (_) {}
});

bot.on('channel_post', async ctx => {
  if (ctx.from && ctx.from.is_bot) return;
  const chatId = String(ctx.chat.id);
  const post = ctx.channelPost || {};
  const text = post.text || '';
  if (text && /^\/chatid/i.test(text)) {
    try { await ctx.reply(`chat.id: ${chatId}\nchat.type: ${ctx.chat.type}\nchat.title: ${ctx.chat.title || ''}`); } catch (_) {}
    return;
  }
  if (text && /^\/resolve\b/i.test(text)) {
    const parts = text.split(' ').filter(Boolean);
    const target = parts[1];
    if (!target) { try { await ctx.reply('Provide @username or id'); } catch (_) {} return; }
    try {
      const info = await bot.telegram.getChat(target);
      try { await ctx.reply(`chat.id: ${String(info.id)}\nchat.type: ${info.type || ''}\nchat.title: ${info.title || ''}`); } catch (_) {}
    } catch (e) {
      try { await ctx.reply('Unable to resolve'); } catch (_) {}
    }
    return;
  }
  try {
    if (post.photo && pendingChannel[chatId]) {
      const photos = post.photo;
      const fileId = photos[photos.length - 1].file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const dest = path.join(uploadsDir, `photo_${chatId}_${Date.now()}.jpg`);
      await downloadTo(String(link), dest);
      const p = pendingChannel[chatId];
      if (p.mode === 'faceswap') {
        p.swap = dest;
        await ctx.reply('Now send target video.');
      } else if (p.mode === 'createvideo') {
        p.photo = dest;
        await ctx.reply('Now send base video.');
      }
      return;
    }
    if (post.video && pendingChannel[chatId]) {
      const fileId = post.video.file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      const dest = path.join(uploadsDir, `video_${chatId}_${Date.now()}.mp4`);
      await downloadTo(String(link), dest);
      const p = pendingChannel[chatId];
      if (p.mode === 'faceswap') {
        p.target = dest;
        if (p.swap) {
          const uid = ctx.from && ctx.from.id ? String(ctx.from.id) : null;
          if (!uid) { delete pendingChannel[chatId]; await ctx.reply('DM the bot to run faceswap.'); return; }
          const u = getOrCreateUser(uid);
          let r;
          try { r = await runFaceswap(u, p.swap, p.target); } catch (e) { await ctx.reply(`Error: ${e.message}`); delete pendingChannel[chatId]; return; }
          delete pendingChannel[chatId];
          if (r.error) {
            const kb = Markup.inlineKeyboard([
              [Markup.button.callback('Buy Points', 'buy')],
              [Markup.button.callback('Main Menu', 'menu')]
            ]);
            await ctx.reply(`Not enough points. Required: ${r.required}, Your Points: ${r.points}`, kb);
          } else {
            await ctx.reply(`Done. Points: ${r.points}`);
            await ctx.reply(String(r.result));
          }
        } else {
          await ctx.reply('Now send swap photo.');
        }
      } else if (p.mode === 'createvideo') {
        p.video = dest;
        if (p.photo) {
          const outputPath = path.join(outputsDir, `short-${Date.now()}.mp4`);
          ffmpeg(p.video)
            .setDuration(10)
            .addInput(p.photo)
            .complexFilter('overlay=0:0')
            .save(outputPath)
            .on('end', async () => {
              delete pendingChannel[chatId];
              try { await ctx.replyWithVideo({ source: fs.createReadStream(outputPath) }); } catch (e) { await ctx.reply(`Video ready at /outputs/${path.basename(outputPath)}`); }
            })
            .on('error', async (err) => {
              delete pendingChannel[chatId];
              await ctx.reply(`Error: ${err.message}`);
            });
        } else {
          await ctx.reply('Now send overlay photo.');
        }
      }
      return;
    }
  } catch (e) {
    try { await ctx.reply(`Error: ${e.message}`); } catch (_) {}
  }
  try { await postChannelGreet(chatId); } catch (_) {}
});

bot.catch(err => console.error('Bot error:', err));

if (process.env.BOT_TOKEN) {
  bot.telegram.setMyCommands([
    { command: 'menu', description: 'Open main menu' },
    { command: 'faceswap', description: 'Swap face using your photo/video' },
    { command: 'confirm', description: 'Confirm Stripe session id' },
    { command: 'pricing', description: 'Show prices' },
    { command: 'promote', description: 'Share promo/invite links' },
    { command: 'help', description: 'Show help' },
    { command: 'resolve', description: 'Resolve @username to chat id' },
    { command: 'chatid', description: 'Show current chat id' },
    { command: 'status', description: 'Show webhook/polling status' }
  ]).catch(err => console.error('setMyCommands error', err));
  const forcePolling = String(process.env.TELEGRAM_FORCE_POLLING || '').toLowerCase();
  const shouldForcePolling = forcePolling === '1' || forcePolling === 'true' || forcePolling === 'yes';
  global.__botLaunchMode = 'none';
  if (shouldForcePolling) {
    bot.telegram.deleteWebhook().catch(() => {});
    bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched (forced polling)'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(err => console.error('Bot launch error', err));
  } else if ((process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN)) {
    try {
      const pathHook = (process.env.TELEGRAM_WEBHOOK_PATH || '/telegram/webhook');
      const baseRaw = (process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN);
      const base = String(baseRaw).trim().replace(/^['"`]+|['"`]+$/g, '');
      app.get(pathHook, (req, res) => res.send('ok'));
      app.use(pathHook, express.json(), bot.webhookCallback(pathHook));
      const invalidBase = /(^https?:\/\/t\.me)/i.test(base) || /(^https?:\/\/localhost)/i.test(base) || /(^https?:\/\/127\.0\.0\.1)/i.test(base);
      if (invalidBase) {
        console.error('Invalid PUBLIC_URL/PUBLIC_ORIGIN for webhook:', base);
        bot.telegram.deleteWebhook().catch(() => {});
        bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched (invalid webhook base)'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(err => console.error('Bot launch error', err));
      } else {
        bot.telegram.setWebhook(`${base}${pathHook}`).then(() => {
          global.__botLaunchMode = 'webhook';
          console.log('Webhook set');
          bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err));
        }).catch(e => {
          console.error('Webhook set error', e);
          bot.telegram.deleteWebhook().catch(() => {});
          bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched (fallback)'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(err => console.error('Bot launch error', err));
        });
      }
    } catch (e) {
      console.error('Webhook init error', e);
      bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched (fallback)'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(err => console.error('Bot launch error', err));
    }
  } else {
    bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(e => console.error('Bot launch error', e));
  }
} else {
  console.error('Missing BOT_TOKEN');
}

console.log('Server is about to start...');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
let chs = (process.env.CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
let __webhookMonitorStarted = false;
function startWebhookMonitor() {
  if (__webhookMonitorStarted) return;
  __webhookMonitorStarted = true;
  setInterval(async () => {
    if ((global.__botLaunchMode || '') !== 'webhook') return;
    try {
      const info = await bot.telegram.getWebhookInfo();
      const errMsg = info && info.last_error_message;
      if (errMsg) {
        console.error('Webhook delivery error', errMsg);
        bot.telegram.deleteWebhook().catch(() => {});
        bot.launch().then(() => { global.__botLaunchMode = 'polling'; console.log('Bot launched (fallback)'); bot.telegram.getWebhookInfo().then(info => console.log('Webhook info', info)).catch(err => console.error('Webhook info err', err)); }).catch(err => console.error('Bot launch error', err));
      }
    } catch (e) {}
  }, 30000);
}
startWebhookMonitor();
function channelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Prices', 'pricing'), Markup.button.callback('Help', 'help')],
    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Promote', 'promote')],
    [Markup.button.callback('Menu', 'menu')]
  ]);
}
function channelGreetText() {
  const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
  return `Welcome! Use the buttons below or type commands.\nPrices:\n${lines.join('\n')}`;
}
async function postChannelGreet(chatId) {
  const kb = channelKeyboard();
  const msg = await bot.telegram.sendMessage(chatId, channelGreetText(), { reply_markup: kb.reply_markup });
  try { await bot.telegram.pinChatMessage(chatId, msg.message_id); } catch (e) {}
  const data = loadData();
  data.channel = data.channel || {};
  data.channel[chatId] = data.channel[chatId] || {};
  data.channel[chatId].last_greet_at = Date.now();
  data.channel[chatId].last_greet_message_id = msg.message_id;
  saveData(data);
}
async function resolveChannelIds() {
  try {
    const resolved = [];
    for (const id of chs) {
      if (id.startsWith('@')) {
        try {
          const info = await bot.telegram.getChat(id);
          if (info && info.id) resolved.push(String(info.id)); else resolved.push(id);
        } catch (_) { resolved.push(id); }
      } else {
        resolved.push(id);
      }
    }
    chs = Array.from(new Set(resolved)).filter(Boolean);
  } catch (e) {}
}
resolveChannelIds().then(() => {
  if (chs.length) {
    for (const id of chs) postChannelGreet(id).catch(() => {});
    setInterval(() => {
      try {
        const data = loadData();
        for (const id of chs) {
          const lastMap = (data.channel && data.channel[id] && data.channel[id].last_greet_at) || 0;
          const lastLegacy = (data.channel && data.channel.last_greet_at) || 0;
          const last = Math.max(lastMap, lastLegacy);
          if (Date.now() - last > 45 * 60 * 1000) postChannelGreet(id).catch(() => {});
        }
      } catch (e) {}
    }, 5 * 60 * 1000);
  }
}).catch(() => {});
bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Main Menu', 'menu')],
    [Markup.button.callback('Buy Points', 'buy')],
    [Markup.button.callback('Faceswap', 'faceswap'), Markup.button.callback('Create Video', 'createvideo')],
    [Markup.button.callback('Check-In', 'checkin'), Markup.button.callback('Leaderboard', 'leaderboard')]
  ]);
  await ctx.reply('Use the buttons below to perform actions. No typing needed. Buy points to unlock features, then try Faceswap or Create Video. Check-In daily for bonuses. Share Clone links to earn 20% rewards.', kb);
});

bot.command('help', async ctx => {
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Main Menu', 'menu')],
    [Markup.button.callback('Buy Points', 'buy')],
    [Markup.button.callback('Faceswap', 'faceswap'), Markup.button.callback('Create Video', 'createvideo')],
    [Markup.button.callback('Check-In', 'checkin'), Markup.button.callback('Leaderboard', 'leaderboard')]
  ]);
  await ctx.reply('Use the buttons below to perform actions. No typing needed. Buy points to unlock features, then try Faceswap or Create Video. Check-In daily for bonuses. Share Clone links to earn 20% rewards.', kb);
});

bot.command('buy', async ctx => {
  const rows = PRICING.map(t => [Markup.button.callback(`${t.points} / $${t.usd}`, `buy:${t.id}`)]);
  await ctx.reply('Select a package:', Markup.inlineKeyboard(rows));
});

bot.command('createvideo', async ctx => {
  const isChannel = (ctx.chat && ctx.chat.type) === 'channel';
  if (isChannel) {
    pendingChannel[String(ctx.chat.id)] = { mode: 'createvideo', photo: null, video: null };
  } else {
    pending[String(ctx.from.id)] = { mode: 'createvideo', photo: null, video: null };
  }
  await ctx.reply('Send overlay photo, then base video.');
});

bot.command('pricing', async ctx => {
  const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
  await ctx.reply(`Prices:\n${lines.join('\n')}`);
});

bot.command('promote', async ctx => {
  const id = String(ctx.from.id);
  const botUsername = process.env.BOT_USERNAME || '';
  const promoLink = botUsername ? `https://t.me/${botUsername}?start=promo_${id}` : '';
  const refLink = botUsername ? `https://t.me/${botUsername}?start=ref_${id}` : '';
  const kb = Markup.inlineKeyboard([
    [Markup.button.url('Promo Link', promoLink || refLink)],
    [Markup.button.url('Invite Link', refLink || promoLink)],
    [Markup.button.callback('Main Menu', 'menu')]
  ]);
  await ctx.reply('Share these links to promote. Purchases via your links credit you 20% and add promo counts.', kb);
});

bot.command('chatid', async ctx => {
  const id = String(ctx.chat.id);
  await ctx.reply(`chat.id: ${id}\nchat.type: ${ctx.chat.type}\nchat.title: ${ctx.chat.title || ''}`);
});

bot.command('status', async ctx => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    const mode = global.__botLaunchMode || 'none';
    const url = info && info.url ? String(info.url) : '';
    const pending = info && typeof info.pending_update_count === 'number' ? info.pending_update_count : 0;
    const lastErr = info && info.last_error_message ? String(info.last_error_message) : '';
    await ctx.reply(`mode: ${mode}\nwebhook.url: ${url}\npending: ${pending}\nerror: ${lastErr}`);
  } catch (e) {
    await ctx.reply(`mode: ${global.__botLaunchMode || 'none'}\nerror: ${e.message}`);
  }
});

bot.command('resolve', async ctx => {
  const parts = (ctx.message.text || '').split(' ').filter(Boolean);
  const target = parts[1];
  if (!target) return ctx.reply('Provide @username or id');
  try {
    const info = await bot.telegram.getChat(target);
    await ctx.reply(`chat.id: ${String(info.id)}\nchat.type: ${info.type || ''}\nchat.title: ${info.title || ''}`);
  } catch (e) {
    await ctx.reply('Unable to resolve');
  }
});
