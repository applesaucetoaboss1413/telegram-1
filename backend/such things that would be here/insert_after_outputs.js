const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let raw = fs.readFileSync(target, 'utf8');
let code = raw.replace(/\r\n/g, '\n');

const anchor = "app.use('/outputs', express.static(outputsDir));";
if (!code.includes(anchor)) { console.error('outputs anchor not found'); process.exit(1); }

const addition = `

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
`;

code = code.replace(anchor, anchor + addition);
fs.writeFileSync(target, code.replace(/\n/g, '\r\n'));
console.log('Inserted endpoints after outputs static middleware');
