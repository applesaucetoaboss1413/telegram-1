const express = require('express');
const app = express();
const { getUser, updateUserPoints, addTransaction } = require('./database');

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Telegram Bot Backend V2 Running');
});

// Admin Endpoint
app.post('/admin/grant', (req, res) => {
    const { secret, userId, amount } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
    
    updateUserPoints(userId, amount);
    addTransaction(userId, amount, 'admin_grant');
    res.json({ success: true });
});

module.exports = app;
