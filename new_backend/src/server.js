const express = require('express');
const app = express();
const { getUser, updateUserPoints, addTransaction, markPurchased } = require('./database');
const { grantWelcomeCredits } = require('./services/creditsService');
const demoCfg = require('./services/a2eConfig');
const bot = require('./bot'); // Ensure bot is exported and available
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const HealthMonitor = require('./health');
const winston = require('winston');

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
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
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
        const amount = session.amount_total;

        logger.info('Processing checkout session completed', { 
            userId: userId,
            sessionId: session.id,
            amount: amount,
            pointsFromMetadata: pointsFromMetadata
        });

        if (userId) {
            // Determine points to add: prefer metadata, fallback to amount-based logic, or default to 100
            let pointsToAdd = pointsFromMetadata;
            
            if (!pointsToAdd) {
                // Fallback logic if metadata is missing (e.g. legacy sessions)
                if (amount >= 1499) pointsToAdd = demoCfg.packs.pro.points;
                else if (amount >= 899) pointsToAdd = demoCfg.packs.plus.points;
                else if (amount >= 499) pointsToAdd = demoCfg.packs.starter.points;
                else pointsToAdd = 100; // Final fallback
            }
            
            try {
                updateUserPoints(userId, pointsToAdd);
                addTransaction(userId, pointsToAdd, 'purchase_stripe');
                
                // Grant 69 welcome credits if applicable
                const stripeCustomerId = session.customer;
                if (stripeCustomerId) {
                    const granted = grantWelcomeCredits({ telegramUserId: userId, stripeCustomerId });
                    if (granted) {
                        try {
                            bot.telegram.sendMessage(userId, `Welcome! 69 credits added to your account. Your first 5-second video costs 60 credits; you’ll have 9 credits left.`);
                        } catch (err) {
                            logger.error('Failed to send welcome credits message', { userId, error: err.message });
                        }
                    }
                }

                // Referral Logic
                const user = getUser(userId);
                if (user && !user.has_purchased && user.referred_by) {
                    const referrerId = user.referred_by;
                    const rewardPoints = demoCfg.demoPrices['5'] || 60; // Default to 60 if missing
                    
                    updateUserPoints(referrerId, rewardPoints);
                    addTransaction(referrerId, rewardPoints, 'referral_reward');
                    markPurchased(userId);
                    
                    logger.info(`referral reward – referrer=${referrerId} got ${rewardPoints} pts because referred user ${userId} made first purchase.`);
                    
                    // Notify referrer
                    try {
                         bot.telegram.sendMessage(referrerId, `🎉 *Referral Bonus!*
Your friend just made their first purchase!
You received ${rewardPoints} points (enough for a free 5s demo).`, { parse_mode: 'Markdown' });
                    } catch (e) {
                        logger.error('Failed to notify referrer', { error: e.message });
                    }
                } else if (user && !user.has_purchased) {
                    markPurchased(userId);
                }

                logger.info('Points added successfully', { 
                    userId: userId,
                    pointsAdded: pointsToAdd 
                });
            } catch (error) {
                logger.error('Failed to add points', { 
                    userId: userId,
                    pointsToAdd: pointsToAdd,
                    error: error.message 
                });
            }
        } else {
            logger.warn('No userId found in session', { sessionId: session.id });
        }
    }

    res.json({ received: true });
});

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Telegram Bot Backend V2 Running');
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

// Admin Endpoint
app.post('/admin/grant', (req, res) => {
    const { secret, userId, amount } = req.body;
    
    logger.info('Admin grant request received', { 
        userId: userId,
        amount: amount,
        hasSecret: !!secret 
    });
    
    if (secret !== process.env.ADMIN_SECRET) {
        logger.warn('Invalid admin secret provided', { 
            userId: userId,
            providedSecret: secret ? 'present' : 'missing' 
        });
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    try {
        updateUserPoints(userId, amount);
        addTransaction(userId, amount, 'admin_grant');
        
        logger.info('Admin grant successful', { 
            userId: userId,
            amount: amount 
        });
        
        res.json({ success: true });
    } catch (error) {
        logger.error('Admin grant failed', { 
            userId: userId,
            amount: amount,
            error: error.message 
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = app;
