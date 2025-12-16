// --- STATELESS FLOW CHECK ---
  const replyText = (ctx.message.reply_to_message && ctx.message.reply_to_message.text) || '';
  let orphanedFilePath = null; // Track file path for cleanup if needed
  if (replyText) {
    const fileId = ctx.message.photo[ctx.message.photo.length-1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const localPath = path.join(uploadsDir, `photo_${uid}_${Date.now()}.jpg`);
    orphanedFilePath = localPath; // Track for potential cleanup
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
    // Clean up the file downloaded in replyText block since it wasn't used
    cleanupFiles([orphanedFilePath]);
    orphanedFilePath = null; // Clear since we've cleaned it up
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
    cleanupFiles([localPath]); // Not used, so delete
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
app.post('/faceswap', upload.fields([{ name: 'swap', maxCount: 1 }, { name: 'target', maxCount: 1 }]), async (req, res) => {
  try {
    const userId = req.body && req.body.userId;
    if (!userId) return res.status(400).json({ error: 'user required' });
    
    // Check files
    const swapFile = req.files && req.files['swap'] ? req.files['swap'][0] : null;
    const targetFile = req.files && req.files['target'] ? req.files['target'][0] : null;
    
    if (!swapFile || !targetFile) return res.status(400).json({ error: 'swap and target files required' });
    
    // Save files
    const swapPath = path.join(uploadsDir, `swap_${userId}_${Date.now()}.${swapFile.originalname.split('.').pop()}`);
    const targetPath = path.join(uploadsDir, `target_${userId}_${Date.now()}.${targetFile.originalname.split('.').pop()}`);
    
    fs.writeFileSync(swapPath, swapFile.buffer);
    fs.writeFileSync(targetPath, targetFile.buffer);
    
    const isVideo = targetFile.mimetype.startsWith('video');
    const u = getOrCreateUser(userId);
    
    const cost = isVideo ? 15 : 9;
    if ((u.points || 0) < cost) {
         cleanupFiles([swapPath, targetPath]);
         return res.status(402).json({ error: 'not enough points', required: cost, points: u.points });
    }
    
    u.points -= cost;
    saveDB();
    addAudit(u.id, -cost, 'faceswap_api', { isVideo });
    
    const swapUrl = `${PUBLIC_BASE}/uploads/${path.basename(swapPath)}`;
    const targetUrl = `${PUBLIC_BASE}/uploads/${path.basename(targetPath)}`;
    
    // Call MagicAPI
    const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
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
    
    const result = await new Promise((resolve, reject) => {
      const r = https.request(reqOpts, res => {
        let buf = ''; res.on('data', c => buf+=c);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(e); } });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    
    const requestId = result && (result.request_id || result.requestId || result.id);
    if (!requestId) {
        // Refund
        u.points += cost;
        saveDB();
        cleanupFiles([swapPath, targetPath]);
        return res.status(500).json({ error: 'API Error', details: result });
    }
    
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
    
    pollMagicResult(requestId, null); // Start polling without chatId
    
    res.json({ ok: true, requestId, message: 'Job started. Poll status at /faceswap/status/' + requestId });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    // Security: Only allow ADMIN_SECRET from environment, no hardcoded fallback
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) { 
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

// Error handling middleware
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected field. Please use "swap" and "target" fields.' });
  }
  if (err) {
    console.error('Express Error:', err);
    return res.status(500).json({ error: err.message });
  }
  next();
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
      const fullUrl = (process.env.TELEGRAM_WEBHOOK_URL || PREFERRED_URL).replace(/\/$/, '') + WEBHOOK_PATH;
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
      try {
        await bot.telegram.deleteWebhook();
        console.log('Webhook deleted, running in polling mode.');
      } catch(e) {
        console.warn('Could not delete webhook. If you run into issues, make sure one is not set.', e.message);
      }
      bot.launch().then(() => console.log('Bot launched via Polling')).catch(e => console.error('Bot polling launch failed', e));
    }

  });
}

module.exports = { app };

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
