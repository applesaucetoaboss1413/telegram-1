const express = require('express');
const app = express();
const { getUser, updateUserPoints, addTransaction, markPurchased, trackEvent } = require('./database');
const { grantWelcomeCredits, recordPurchase, grantCredits } = require('./services/creditsService');
const demoCfg = require('./services/a2eConfig');
const { bot } = require('./bot');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const HealthMonitor = require('./health');
const winston = require('winston');
const https = require('https');

// MXN exchange rate helper (same as in bot.js)
const SAFE_RATES = { MXN: 18.0 };
async function fetchUsdRate(toCurrency) {
    return new Promise((resolve) => {
        try {
            const symbol = String(toCurrency || '').toUpperCase();
            if (symbol === 'USD') return resolve(1);
            
            const req = https.request({ 
                hostname: 'api.exchangerate-api.com', 
                path: '/v4/latest/USD', 
                method: 'GET',
                timeout: 4000 
            }, res => {
                let buf = ''; 
                res.on('data', c => buf += c); 
                res.on('end', () => {
                    try { 
                        const j = JSON.parse(buf); 
                        const rate = j && j.rates && j.rates[symbol]; 
                        if (typeof rate === 'number') resolve(rate);
                        else resolve(SAFE_RATES[symbol] || 1);
                    } catch (_) { 
                        resolve(SAFE_RATES[symbol] || 1); 
                    }
                });
            });
            req.on('error', () => resolve(SAFE_RATES[symbol] || 1));
            req.on('timeout', () => { req.destroy(); resolve(SAFE_RATES[symbol] || 1); });
            req.end();
        } catch (_) { 
            resolve(SAFE_RATES[toCurrency.toUpperCase()] || 1); 
        }
    });
}

// Configure logging
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

const healthMonitor = new HealthMonitor();

// Use raw body for webhook handling
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    logger.info('Webhook received', { 
        signature: sig ? 'present' : 'missing',
        bodySize: req.body.length 
    });

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        logger.info('Webhook signature verified', { eventType: event.type });
    } catch (err) {
        logger.error('Webhook signature verification failed', { 
            error: err.message,
            signature: sig 
        });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const pointsFromMetadata = session.metadata && session.metadata.points ? parseInt(session.metadata.points) : 0;
        const creditsFromMetadata = session.metadata && session.metadata.credits ? parseInt(session.metadata.credits) : 0;
        const isWelcomeCredits = session.metadata && session.metadata.type === 'welcome_credits';
        const packType = session.metadata && session.metadata.pack_type;
        const amount = session.amount_total || 0;

        logger.info('Processing checkout session completed', { 
            userId,
            sessionId: session.id,
            amount,
            mode: session.mode,
            pointsFromMetadata,
            creditsFromMetadata,
            isWelcomeCredits,
            packType
        });

        if (userId) {
            // Track the purchase event
            trackEvent(userId, 'checkout_completed', { 
                amount, 
                packType, 
                mode: session.mode,
                isWelcomeCredits 
            });

            // Handle 69 welcome credits flow (setup mode - no charge)
            if ((session.mode === 'setup' || isWelcomeCredits) && creditsFromMetadata > 0) {
                try {
                    const stripeCustomerId = session.customer || session.setup_intent || `setup_${session.id}`;
                    const granted = grantWelcomeCredits({ telegramUserId: userId, stripeCustomerId });
                    
                    if (granted) {
                        logger.info('Welcome credits granted via setup mode', { userId, credits: creditsFromMetadata });
                        trackEvent(userId, 'welcome_credits_granted', { credits: creditsFromMetadata });
                        
                        try {
                            await bot.telegram.sendMessage(userId, 
`🎉 *Welcome Bonus Activated!*

✅ ${creditsFromMetadata} FREE credits added!
✅ Enough for your first video + extras

Ready to create your first face swap?
Tap /start to begin!`, { parse_mode: 'Markdown' });
                        } catch (err) {
                            logger.error('Failed to send welcome credits message', { userId, error: err.message });
                        }
                    } else {
                        logger.info('Welcome credits already granted for user', { userId });
                        try {
                            await bot.telegram.sendMessage(userId, `You've already received your welcome credits. Use /start to check your balance!`);
                        } catch (err) {
                            logger.error('Failed to send already-granted message', { userId, error: err.message });
                        }
                    }
                } catch (error) {
                    logger.error('Failed to grant welcome credits', { userId, error: error.message });
                }
                return res.json({ received: true });
            }

            // Handle paid checkout (points/credits purchase)
            let pointsToAdd = pointsFromMetadata;
            
            if (!pointsToAdd) {
                // Fallback logic if metadata is missing
                if (amount >= 1499) pointsToAdd = demoCfg.packs.pro.points;
                else if (amount >= 899) pointsToAdd = demoCfg.packs.plus.points;
                else if (amount >= 499) pointsToAdd = demoCfg.packs.starter.points;
                else if (amount >= 99) pointsToAdd = demoCfg.packs.micro.points;
                else pointsToAdd = 80; // Minimum fallback
            }
            
            try {
                // Add points to user account
                updateUserPoints(userId, pointsToAdd);
                addTransaction(userId, pointsToAdd, 'purchase_stripe');
                
                // Also grant as credits for the new system
                grantCredits({ telegramUserId: userId, amount: pointsToAdd });
                
                // Record the purchase
                recordPurchase({ 
                    telegramUserId: userId, 
                    amount, 
                    packType: packType || 'unknown',
                    stripeSessionId: session.id 
                });
                
                trackEvent(userId, 'purchase_completed', { 
                    amount, 
                    points: pointsToAdd, 
                    packType 
                });

                // Grant welcome credits for paid purchases too (if first time)
                const stripeCustomerId = session.customer;
                if (stripeCustomerId) {
                    const granted = grantWelcomeCredits({ telegramUserId: userId, stripeCustomerId });
                    if (granted) {
                        try {
                            await bot.telegram.sendMessage(userId, `🎁 *BONUS:* 69 extra welcome credits added on top of your purchase!`, { parse_mode: 'Markdown' });
                        } catch (err) {
                            logger.error('Failed to send welcome credits message', { userId, error: err.message });
                        }
                    }
                }

                // Referral Logic
                const user = getUser(userId);
                if (user && !user.has_purchased && user.referred_by) {
                    const referrerId = user.referred_by;
                    const rewardPoints = demoCfg.referralReward || 60;
                    
                    updateUserPoints(referrerId, rewardPoints);
                    addTransaction(referrerId, rewardPoints, 'referral_reward');
                    grantCredits({ telegramUserId: referrerId, amount: rewardPoints });
                    markPurchased(userId);
                    
                    logger.info(`referral reward – referrer=${referrerId} got ${rewardPoints} pts`);
                    trackEvent(referrerId, 'referral_reward_received', { amount: rewardPoints, referredUser: userId });
                    
                    try {
                        await bot.telegram.sendMessage(referrerId, 
`🎉 *Referral Bonus!*

Your friend just made their first purchase!
You earned *${rewardPoints} credits* (enough for a free video!)

Keep sharing to earn more!`, { parse_mode: 'Markdown' });
                    } catch (e) {
                        logger.error('Failed to notify referrer', { error: e.message });
                    }
                } else if (user && !user.has_purchased) {
                    markPurchased(userId);
                }

                logger.info('Points added successfully', { userId, pointsAdded: pointsToAdd });

                // Send purchase confirmation with upsell for next purchase
                try {
                    const videosCount = Math.floor(pointsToAdd / 60);
                    let successMsg = `✅ *¡Pago Exitoso!*

+${pointsToAdd} créditos agregados a tu cuenta
📹 ¡Son suficientes para ~${videosCount} videos!

¿Listo para crear? Presiona /start`;

                    // Add upsell for micro purchasers with MXN pricing
                    if (packType === 'micro') {
                        const rate = await fetchUsdRate('mxn');
                        const starterMxn = ((demoCfg.packs.starter.price_cents / 100) * rate).toFixed(2);
                        successMsg += `

💡 *Consejo:* ¿Te gustó? Actualiza al Paquete Starter para mejor valor - 400 créditos por MX$${starterMxn} (¡ahorra 40%!)`;
                    }

                    await bot.telegram.sendMessage(userId, successMsg, { parse_mode: 'Markdown' });
                } catch (err) {
                    logger.error('Failed to send purchase confirmation', { userId, error: err.message });
                }
            } catch (error) {
                logger.error('Failed to add points', { userId, pointsToAdd, error: error.message });
            }
        } else {
            logger.warn('No userId found in session', { sessionId: session.id });
        }
    }

    res.json({ received: true });
});

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Telegram Bot Backend V2 - Monetization Optimized');
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const healthStatus = await healthMonitor.runAllChecks();
        const statusCode = healthStatus.overall === 'healthy' ? 200 : 503;
        
        logger.info('Health check performed', { status: healthStatus.overall });
        res.status(statusCode).json(healthStatus);
    } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Readiness check endpoint
app.get('/ready', (req, res) => {
    const status = healthMonitor.getHealthStatus();
    res.status(200).json(status);
});

// Liveness check endpoint
app.get('/alive', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Stats endpoint for monitoring conversions
app.get('/stats', (req, res) => {
    try {
        const { db } = require('./database');
        const { getTotalVideosCreated, getTotalPayingUsers } = require('./services/creditsService');
        
        const totalVideos = getTotalVideosCreated();
        const payingUsers = getTotalPayingUsers();
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
        const totalRevenue = db.prepare('SELECT SUM(amount_cents) as total FROM purchases').get()?.total || 0;
        
        res.json({
            totalVideos,
            payingUsers,
            totalUsers,
            conversionRate: totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(2) + '%' : '0%',
            totalRevenue: `$${(totalRevenue / 100).toFixed(2)}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin Endpoint
app.post('/admin/grant', (req, res) => {
    const { secret, userId, amount } = req.body;
    
    logger.info('Admin grant request received', { userId, amount, hasSecret: !!secret });
    
    if (secret !== process.env.ADMIN_SECRET) {
        logger.warn('Invalid admin secret provided', { userId });
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    try {
        updateUserPoints(userId, amount);
        addTransaction(userId, amount, 'admin_grant');
        grantCredits({ telegramUserId: userId, amount });
        
        logger.info('Admin grant successful', { userId, amount });
        
        res.json({ success: true });
    } catch (error) {
        logger.error('Admin grant failed', { userId, amount, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== MINI APP API ====================
const path = require('path');
const multer = require('multer');
const { uploadFromBuffer } = require('./services/cloudinaryService');
const { getCredits, deductCredits } = require('./services/creditsService');
const {
    startFaceSwap, checkFaceSwapTaskStatus,
    startImage2Video, checkImage2VideoStatus,
    startTalkingAvatar, checkTalkingAvatarStatus,
    startVideoEnhancement, checkVideoEnhancementStatus,
    startBackgroundRemoval, checkBackgroundRemovalStatus
} = require('./services/magicService');

// Serve Mini App static files
app.use('/miniapp', express.static(path.join(__dirname, '../miniapp')));

// Multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Service cost configurations
const SERVICE_COSTS = {
    faceswap: { base: 60, perSecond: 5 },
    avatar: { base: 80 },
    img2vid: { base: 50 },
    enhance: { base: 40 },
    bgremove: { base: 20 }
};

// Mini App: Get credits
app.get('/api/miniapp/credits', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    
    try {
        const credits = getCredits({ telegramUserId: userId });
        res.json({ credits });
    } catch (e) {
        logger.error('Mini app credits error', { error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// Mini App: Get recent creations
app.get('/api/miniapp/creations', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    
    try {
        const { db } = require('./database');
        const creations = db.prepare(`
            SELECT * FROM miniapp_creations 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 10
        `).all(userId);
        res.json({ creations: creations || [] });
    } catch (e) {
        // Table might not exist yet
        res.json({ creations: [] });
    }
});

// Mini App: Upload file
app.post('/api/miniapp/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        
        const resourceType = file.mimetype.startsWith('video/') ? 'video' : 
                            file.mimetype.startsWith('audio/') ? 'video' : 'image';
        
        const result = await uploadFromBuffer(file.buffer, resourceType);
        res.json({ url: result });
    } catch (e) {
        logger.error('Mini app upload error', { error: e.message });
        res.status(500).json({ error: e.message });
    }
});

// Mini App: Process service
app.post('/api/miniapp/process', async (req, res) => {
    const { userId, service, files, inputs } = req.body;
    
    if (!userId || !service) {
        return res.status(400).json({ error: 'userId and service required' });
    }
    
    try {
        // Check credits
        const credits = getCredits({ telegramUserId: userId });
        const cost = SERVICE_COSTS[service]?.base || 50;
        
        if (credits < cost) {
            return res.status(402).json({ error: 'Insufficient credits', required: cost, available: credits });
        }
        
        let taskId;
        
        switch (service) {
            case 'faceswap':
                if (!files.face || !files.video) {
                    return res.status(400).json({ error: 'Face photo and video required' });
                }
                taskId = await startFaceSwap(files.face, files.video);
                break;
                
            case 'avatar':
                if (!files.photo) {
                    return res.status(400).json({ error: 'Photo required' });
                }
                taskId = await startTalkingAvatar(files.photo, files.audio, inputs?.text);
                break;
                
            case 'img2vid':
                if (!files.image) {
                    return res.status(400).json({ error: 'Image required' });
                }
                taskId = await startImage2Video(files.image, inputs?.prompt || 'subtle motion');
                break;
                
            case 'enhance':
                if (!files.video) {
                    return res.status(400).json({ error: 'Video required' });
                }
                taskId = await startVideoEnhancement(files.video, '4k');
                break;
                
            case 'bgremove':
                if (!files.image) {
                    return res.status(400).json({ error: 'Image required' });
                }
                const bgResult = await startBackgroundRemoval(files.image);
                if (bgResult.instant) {
                    // Instant result - deduct credits and return
                    deductCredits({ telegramUserId: userId, amount: cost });
                    saveCreation(userId, service, bgResult.result_url);
                    return res.json({ taskId: bgResult.id, instant: true, result_url: bgResult.result_url });
                }
                taskId = bgResult.id;
                break;
                
            default:
                return res.status(400).json({ error: 'Invalid service' });
        }
        
        // Deduct credits
        deductCredits({ telegramUserId: userId, amount: cost });
        
        // Store task for tracking
        storeTask(userId, service, taskId, cost);
        
        logger.info('Mini app task started', { userId, service, taskId, cost });
        res.json({ taskId, cost });
        
    } catch (e) {
        logger.error('Mini app process error', { error: e.message, service });
        res.status(500).json({ error: e.message });
    }
});

// Mini App: Check status
app.get('/api/miniapp/status', async (req, res) => {
    const { taskId, service } = req.query;
    
    if (!taskId || !service) {
        return res.status(400).json({ error: 'taskId and service required' });
    }
    
    try {
        let result;
        
        switch (service) {
            case 'faceswap':
                result = await checkFaceSwapTaskStatus(taskId);
                break;
            case 'avatar':
                result = await checkTalkingAvatarStatus(taskId);
                break;
            case 'img2vid':
                result = await checkImage2VideoStatus(taskId);
                break;
            case 'enhance':
                result = await checkVideoEnhancementStatus(taskId);
                break;
            case 'bgremove':
                result = await checkBackgroundRemovalStatus(taskId);
                break;
            default:
                return res.status(400).json({ error: 'Invalid service' });
        }
        
        // Save creation if completed
        if (result.status === 'completed' && result.result_url) {
            const task = getTask(taskId);
            if (task) {
                saveCreation(task.user_id, service, result.result_url);
            }
        }
        
        res.json(result);
        
    } catch (e) {
        logger.error('Mini app status error', { error: e.message, taskId });
        res.status(500).json({ error: e.message });
    }
});

// Mini App: Create checkout
app.post('/api/miniapp/checkout', async (req, res) => {
    const { userId, packType, currency } = req.body;
    
    if (!userId || !packType) {
        return res.status(400).json({ error: 'userId and packType required' });
    }
    
    const pack = demoCfg.packs[packType];
    if (!pack) {
        return res.status(400).json({ error: 'Invalid pack type' });
    }
    
    // Supported currencies
    const SUPPORTED_CURRENCIES = ['usd', 'mxn', 'eur', 'gbp', 'cad'];
    const curr = (currency || 'usd').toLowerCase();
    
    if (!SUPPORTED_CURRENCIES.includes(curr)) {
        return res.status(400).json({ error: 'Unsupported currency' });
    }
    
    try {
        // Get live exchange rate
        const rate = await fetchUsdRate(curr);
        
        // Convert USD cents to target currency cents
        // pack.price_cents is in USD cents (e.g., 99 = $0.99)
        // We need to convert to target currency cents
        const usdAmount = pack.price_cents / 100; // Convert to dollars first
        let amountInCurrency;
        
        if (curr === 'usd') {
            amountInCurrency = pack.price_cents;
        } else {
            // Apply exchange rate and 3% spread, then convert to minor units
            const convertedAmount = usdAmount * rate * 1.03;
            amountInCurrency = Math.round(convertedAmount * 100);
        }
        
        logger.info('Mini app checkout', { 
            userId, 
            packType, 
            currency: curr, 
            rate, 
            usdCents: pack.price_cents,
            targetCents: amountInCurrency,
            targetAmount: (amountInCurrency / 100).toFixed(2)
        });
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'], // Force card only, disable Link
            line_items: [{
                price_data: {
                    currency: curr,
                    product_data: { name: pack.label },
                    unit_amount: amountInCurrency,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: process.env.MINIAPP_URL || `https://t.me/ImMoreThanJustSomeBot?start=success`,
            cancel_url: process.env.MINIAPP_URL || `https://t.me/ImMoreThanJustSomeBot?start=cancel`,
            client_reference_id: userId,
            metadata: {
                points: String(pack.points),
                pack_type: packType,
                source: 'miniapp',
                currency: curr,
                usd_equivalent: String(pack.price_cents)
            }
        });
        
        res.json({ url: session.url });
        
    } catch (e) {
        logger.error('Mini app checkout error', { error: e.message, stack: e.stack });
        res.status(500).json({ error: e.message });
    }
});

// Helper functions for task tracking
const taskStore = new Map();

function storeTask(userId, service, taskId, cost) {
    taskStore.set(taskId, { user_id: userId, service, cost, created_at: Date.now() });
}

function getTask(taskId) {
    return taskStore.get(taskId);
}

function saveCreation(userId, type, resultUrl) {
    try {
        const { db } = require('./database');
        
        // Create table if not exists
        db.exec(`
            CREATE TABLE IF NOT EXISTS miniapp_creations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                result_url TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);
        
        db.prepare(`
            INSERT INTO miniapp_creations (user_id, type, result_url, created_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, type, resultUrl, Date.now());
        
    } catch (e) {
        logger.error('Save creation error', { error: e.message });
    }
}

module.exports = app;
