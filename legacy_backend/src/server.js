const express = require('express');
const stripe = require('stripe');
const { PORT, STRIPE_SECRET_KEY, NOT_CONFIGURED_ERROR, DIRS, PUBLIC_ORIGIN, BOT_TOKEN } = require('./config');
const { initBot, bot } = require('./bot/index');
const { getOrCreateUser, loadData, saveData } = require('./services/dataService');
const path = require('path');

const app = express();
const stripeClient = STRIPE_SECRET_KEY ? stripe(STRIPE_SECRET_KEY) : null;

// Initialize Bot
initBot();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(DIRS.uploads));
app.use('/outputs', express.static(DIRS.outputs));

// Routes - Define GET routes BEFORE webhook to avoid conflicts
app.get('/', (req, res) => {
    res.send('TBot Backend v2 Running');
});

// Webhook setup
if (PUBLIC_ORIGIN) {
    const hookPath = `/telegram-webhook`;
    bot.telegram.setWebhook(`${PUBLIC_ORIGIN}${hookPath}`).then(() => {
        console.log(`Webhook set to ${PUBLIC_ORIGIN}${hookPath}`);
    }).catch(console.error);

    // Use POST specifically for webhook to avoid conflicts with GET routes
    app.post(hookPath, (req, res, next) => {
        console.log(`[Webhook] ${req.method} ${req.path} received`);
        next();
    }, bot.webhookCallback(hookPath));
}


// Simple Stripe Checkout creation
app.get('/create-checkout-session', async (req, res) => {
    if (!stripeClient) return res.send('Stripe not configured');

    const { userId, tierId } = req.query;
    if (!userId || !tierId) return res.send('Missing params');

    // Find price amount usually, but for now strict map
    const tierMap = {
        'p60': { amount: 309, pts: 60 },
        'p120': { amount: 509, pts: 120 },
        'p300': { amount: 999, pts: 300 },
        'p800': { amount: 1999, pts: 800 },
        'p1500': { amount: 2999, pts: 1500 },
        'p7500': { amount: 9900, pts: 7500 },
    };

    const tier = tierMap[tierId];
    if (!tier) return res.send('Invalid tier');

    try {
        const session = await stripeClient.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: `${tier.pts} Points Package` },
                    unit_amount: tier.amount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${PUBLIC_ORIGIN}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${PUBLIC_ORIGIN}/cancel`,
            metadata: { userId, pts: tier.pts }
        });
        res.redirect(session.url);
    } catch (e) {
        res.send(`Error: ${e.message}`);
    }
});

app.get('/success', async (req, res) => {
    const sessionId = req.query.session_id;
    if (sessionId && stripeClient) {
        try {
            const session = await stripeClient.checkout.sessions.retrieve(sessionId);
            if (session.payment_status === 'paid') {
                const userId = session.metadata.userId;
                const pts = parseInt(session.metadata.pts || '0');

                const data = loadData();
                if (!data.purchases[sessionId]) {
                    data.purchases[sessionId] = true;
                    if (data.users[userId]) {
                        data.users[userId].points = (data.users[userId].points || 0) + pts;
                        saveData(data);
                        try { await bot.telegram.sendMessage(userId, `Payment successful! Added ${pts} points.`); } catch (_) { }
                    }
                }
            }
        } catch (e) {
            console.error('Verify error', e);
        }
    }
    res.send('Payment Successful! You can close this window and return to the bot.');
});

app.get('/cancel', (req, res) => res.send('Payment cancelled.'));

// Start
app.listen(PORT, () => {
    console.log(`Server v2 running on port ${PORT}`);
});
