const fs = require('fs');
const path = require('path');

const dataFile = path.resolve(__dirname, '../data.json');
const db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const userId = '8063916626';
db.users = db.users || {};
const u = db.users[userId] || { id: userId, points: 0 };
const prev = Number(u.points || 0);
const target = 60;
const delta = target - prev;
u.points = target;
u.has_recharged = true;
u.recharge_total_points = Number(u.recharge_total_points || 0) + Math.max(0, delta);
db.users[userId] = u;

db.audits = db.audits || {};
db.audits[userId] = db.audits[userId] || [];
db.audits[userId].push({ at: Date.now(), delta, reason: 'admin_refund_missing_credits', meta: { from: prev, to: target } });

fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
console.log('Restored user', userId, 'from', prev, 'to', target, 'credits');
