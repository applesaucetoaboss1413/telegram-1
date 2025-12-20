const express = require('express');
const app = express();
const { getUser, updateUserPoints, addTransaction } = require('./database');
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

        logger.info('Processing checkout session completed', { 
            userId: userId,
            sessionId: session.id,
            amount: session.amount_total 
        });

        if (userId) {
            // Assuming 100 points for the $5 product
            const pointsToAdd = 100; 
            try {
                updateUserPoints(userId, pointsToAdd);
                addTransaction(userId, pointsToAdd, 'purchase_stripe');
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
