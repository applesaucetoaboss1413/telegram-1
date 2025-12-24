const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function mergeConflictSection(src) {
  const start = src.indexOf('<<<<<<< HEAD');
  const end = src.indexOf('>>>>>>>');
  if (start === -1 || end === -1) return src;
  const before = src.slice(0, start);
  const after = src.slice(end + 7); // skip '>>>>>>>'
  const merged = `// --- Configuration & Setup ---\nif (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);\nif (ffprobePath && ffprobePath.path) ffmpeg.setFfprobePath(ffprobePath.path);\n\nconst stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';\nlet stripe = global.__stripe || null;\nif (!stripe) {\n  if (stripeSecretKey) {\n    stripe = require('stripe')(stripeSecretKey);\n  } else {\n    try { console.warn('Missing STRIPE_SECRET_KEY. Stripe payments disabled.'); } catch (_) {}\n  }\n}\n\n// --- Constants & Helpers ---\nconst SUPPORTED_CURRENCIES = ['usd','eur','gbp','cad','aud','jpy','cny','inr','brl','mxn'];\nconst CURRENCY_DECIMALS = { usd: 2, eur: 2, gbp: 2, cad: 2, aud: 2, jpy: 0, cny: 2, inr: 2, brl: 2, rub: 2, mxn: 2 };\n\n// Safe fallback rates\nconst SAFE_RATES = { \n  EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.52, JPY: 148.0, \n  CNY: 7.2, INR: 83.0, BRL: 5.0, RUB: 92.0, MXN: 17.0\n};\n\nfunction formatCurrency(amount, currency = 'usd') {\n  try {\n    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);\n  } catch (e) {\n    return \`${'${'}currency.toUpperCase()} ${'${'}Number(amount).toFixed(2)}\`;\n  }\n}\n\nfunction formatUSD(amount) {\n  return formatCurrency(amount, 'usd');\n}\n\nasync function fetchUsdRate(to) {\n  return await new Promise((resolve) => {\n    try {\n      const symbol = String(to || '').toUpperCase();\n      if (symbol === 'USD') return resolve(1);\n      \n      const req = https.request({ \n        hostname: 'api.exchangerate-api.com', \n        path: '/v4/latest/USD', \n        method: 'GET',\n        timeout: 4000 \n      }, res => {\n        let buf=''; \n        res.on('data', c => buf+=c); \n        res.on('end', () => {\n          try { \n            const j = JSON.parse(buf); \n            const rate = j && j.rates && j.rates[symbol]; \n            if (typeof rate === 'number') resolve(rate);\n            else resolve(SAFE_RATES[symbol] || 1);\n          }\n          catch (_) { resolve(SAFE_RATES[symbol] || 1); }\n        });\n      });\n      req.on('error', () => resolve(SAFE_RATES[symbol] || 1));\n      req.on('timeout', () => { req.destroy(); resolve(SAFE_RATES[symbol] || 1); });\n      req.end();\n    } catch (_) { resolve(SAFE_RATES[symbol] || 1); }\n  });\n}\n\nfunction toMinorUnits(amount, currency, rate) {\n  const dec = CURRENCY_DECIMALS[currency.toLowerCase()] ?? 2;\n  let val = Number(amount) * Number(rate || 1);\n  if (currency.toLowerCase() !== 'usd') {\n    val = val * 1.03; // 3% spread for FX safety\n  }\n  if (dec === 0) return Math.round(val);\n  return Math.round(val * Math.pow(10, dec));\n}\n\nconst app = express();\n// Short ID mapping to satisfy Telegram callback data limit\nconst pendingSessions = {};\n`;
  return before + merged + after;
}

code = mergeConflictSection(code);
// Ensure duplicate pendingSessions removed
code = code.replace(/\n\s*\/\/ Short ID mapping[\s\S]*?const pendingSessions = \{\};\n\s*\n\s*\/\/ Short ID mapping[\s\S]*?const pendingSessions = \{\};/, '\n// Short ID mapping to satisfy Telegram callback data limit\nconst pendingSessions = {};\n');

fs.writeFileSync(target, code);
console.log('server.js merge conflicts resolved');
