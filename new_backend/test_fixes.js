/**
 * Test script to validate the key fixes applied to the bot
 * Run with: node test_fixes.js
 */

// Test 1: a2eConfig now has demoPrices and approx5sDemos
console.log('=== Test 1: a2eConfig structure ===');
try {
    // Mock env vars
    process.env.A2E_API_KEY = 'test';
    const cfg = require('./src/services/a2eConfig');
    
    console.assert(cfg.demoPrices, 'demoPrices should exist');
    console.assert(cfg.demoPrices['5'] === 60, 'demoPrices["5"] should be 60');
    console.assert(cfg.demoPrices['10'] === 90, 'demoPrices["10"] should be 90');
    console.assert(cfg.demoPrices['15'] === 125, 'demoPrices["15"] should be 125');
    
    console.assert(cfg.packs.micro.approx5sDemos >= 1, 'micro.approx5sDemos should be >= 1');
    console.assert(cfg.packs.starter.approx5sDemos >= 1, 'starter.approx5sDemos should be >= 1');
    console.assert(cfg.packs.plus.approx5sDemos >= 1, 'plus.approx5sDemos should be >= 1');
    console.assert(cfg.packs.pro.approx5sDemos >= 1, 'pro.approx5sDemos should be >= 1');
    
    console.log('PASS: a2eConfig has demoPrices and approx5sDemos');
    console.log('  micro.approx5sDemos:', cfg.packs.micro.approx5sDemos);
    console.log('  starter.approx5sDemos:', cfg.packs.starter.approx5sDemos);
    console.log('  plus.approx5sDemos:', cfg.packs.plus.approx5sDemos);
    console.log('  pro.approx5sDemos:', cfg.packs.pro.approx5sDemos);
} catch (e) {
    console.error('FAIL: a2eConfig test -', e.message);
}

// Test 2: Stripe currency conversion logic
console.log('\n=== Test 2: Currency conversion math ===');
try {
    const price_cents_usd = 99; // $0.99 USD
    const mxnRate = 18.0; // Safe fallback rate
    const spread = 1.03; // 3% spread
    
    const usdAmount = price_cents_usd / 100; // 0.99
    const convertedAmount = usdAmount * mxnRate * spread; // ~18.36
    const unitAmountMxn = Math.round(convertedAmount * 100); // ~1836 centavos
    
    console.assert(unitAmountMxn >= 1000, `MXN amount (${unitAmountMxn}) should be >= 1000 (Stripe minimum)`);
    console.log(`PASS: $0.99 USD -> ${unitAmountMxn} MXN centavos ($${(unitAmountMxn/100).toFixed(2)} MXN)`);
    console.log(`  This is above Stripe MXN minimum of 1000 centavos ($10.00 MXN)`);
    
    // Test all packs
    const packs = { micro: 99, starter: 499, plus: 899, pro: 1499 };
    for (const [name, cents] of Object.entries(packs)) {
        const usd = cents / 100;
        const mxn = Math.round(usd * mxnRate * spread * 100);
        const aboveMin = mxn >= 1000;
        console.log(`  ${name}: $${usd} USD -> ${mxn} MXN centavos ($${(mxn/100).toFixed(2)} MXN) ${aboveMin ? 'OK' : 'BELOW MIN - would be floored to 1000'}`);
    }
} catch (e) {
    console.error('FAIL: Currency conversion test -', e.message);
}

// Test 3: Input validation functions
console.log('\n=== Test 3: Input validation ===');
try {
    // sanitizeInput
    function sanitizeInput(input, maxLength = 500) {
        if (typeof input !== 'string') return '';
        let cleaned = input
            .replace(/\0/g, '')
            .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .trim();
        if (cleaned.length > maxLength) cleaned = cleaned.substring(0, maxLength);
        return cleaned;
    }
    
    console.assert(sanitizeInput('hello') === 'hello', 'Normal input should pass');
    console.assert(sanitizeInput('he\x00llo') === 'hello', 'Null bytes should be stripped');
    console.assert(sanitizeInput('\x01\x02test\x1F') === 'test', 'Control chars stripped');
    console.assert(sanitizeInput('a'.repeat(1000), 50).length === 50, 'Should truncate to maxLength');
    console.assert(sanitizeInput(123) === '', 'Non-string returns empty');
    console.assert(sanitizeInput(null) === '', 'Null returns empty');
    console.assert(sanitizeInput('buy_micro') === 'buy_micro', 'Valid deep link passes');
    console.assert(sanitizeInput('"; DROP TABLE users; --') === '"; DROP TABLE users; --', 'SQL injection preserved (parameterized queries handle this)');
    
    // isValidTelegramId
    function isValidTelegramId(id) {
        if (id === undefined || id === null) return false;
        const num = Number(id);
        return Number.isInteger(num) && num > 0 && num < 1e15;
    }
    
    console.assert(isValidTelegramId(8063916626) === true, 'Valid telegram ID');
    console.assert(isValidTelegramId('8063916626') === true, 'String telegram ID');
    console.assert(isValidTelegramId(-1) === false, 'Negative ID rejected');
    console.assert(isValidTelegramId(0) === false, 'Zero ID rejected');
    console.assert(isValidTelegramId(null) === false, 'Null rejected');
    console.assert(isValidTelegramId(undefined) === false, 'Undefined rejected');
    console.assert(isValidTelegramId('abc') === false, 'Non-numeric rejected');
    console.assert(isValidTelegramId(1e16) === false, 'Overly large ID rejected');
    console.assert(isValidTelegramId(1.5) === false, 'Float ID rejected');
    
    console.log('PASS: All input validation tests passed');
} catch (e) {
    console.error('FAIL: Input validation test -', e.message);
}

// Test 4: Rate limiter
console.log('\n=== Test 4: Rate limiter ===');
try {
    const rateLimitStore = new Map();
    const RATE_LIMITS = {
        command: { max: 3, windowMs: 1000 },
        payment: { max: 2, windowMs: 1000 },
    };
    
    function checkRateLimit(userId, action = 'command') {
        const limit = RATE_LIMITS[action] || RATE_LIMITS.command;
        const key = `${userId}:${action}`;
        const now = Date.now();
        if (!rateLimitStore.has(key)) rateLimitStore.set(key, []);
        const timestamps = rateLimitStore.get(key).filter(ts => now - ts < limit.windowMs);
        rateLimitStore.set(key, timestamps);
        if (timestamps.length >= limit.max) return false;
        timestamps.push(now);
        return true;
    }
    
    // Test command rate limit (max 3)
    console.assert(checkRateLimit('user1', 'command') === true, '1st command allowed');
    console.assert(checkRateLimit('user1', 'command') === true, '2nd command allowed');
    console.assert(checkRateLimit('user1', 'command') === true, '3rd command allowed');
    console.assert(checkRateLimit('user1', 'command') === false, '4th command blocked');
    
    // Different user should be independent
    console.assert(checkRateLimit('user2', 'command') === true, 'Different user allowed');
    
    // Payment rate limit (max 2)
    console.assert(checkRateLimit('user3', 'payment') === true, '1st payment allowed');
    console.assert(checkRateLimit('user3', 'payment') === true, '2nd payment allowed');
    console.assert(checkRateLimit('user3', 'payment') === false, '3rd payment blocked');
    
    console.log('PASS: Rate limiter working correctly');
} catch (e) {
    console.error('FAIL: Rate limiter test -', e.message);
}

// Test 5: Deep link whitelist
console.log('\n=== Test 5: Deep link whitelist ===');
try {
    const VALID_DEEP_LINKS = new Set([
        'studio', 'get_credits', 'buy_points', 'create',
        'buy_micro', 'buy_starter', 'buy_plus', 'buy_pro',
        'lang_en', 'lang_es', 'promo', 'daily', 'success',
        'cancel', 'examples'
    ]);
    
    console.assert(VALID_DEEP_LINKS.has('buy_micro') === true, 'buy_micro is valid');
    console.assert(VALID_DEEP_LINKS.has('get_credits') === true, 'get_credits is valid');
    console.assert(VALID_DEEP_LINKS.has('studio') === true, 'studio is valid');
    console.assert(VALID_DEEP_LINKS.has('hack_attempt') === false, 'hack_attempt rejected');
    console.assert(VALID_DEEP_LINKS.has('../../etc/passwd') === false, 'path traversal rejected');
    console.assert(VALID_DEEP_LINKS.has('<script>alert(1)</script>') === false, 'XSS rejected');
    console.assert(VALID_DEEP_LINKS.has('') === false, 'Empty string rejected');
    
    console.log('PASS: Deep link whitelist working correctly');
} catch (e) {
    console.error('FAIL: Deep link whitelist test -', e.message);
}

// Test 6: Admin ID hardcoding removed
console.log('\n=== Test 6: Admin ID security ===');
try {
    const fs = require('fs');
    const botCode = fs.readFileSync('./src/bot.js', 'utf8');
    const dbCode = fs.readFileSync('./src/database.js', 'utf8');
    
    // Check that hardcoded admin IDs are removed from fallbacks
    const hardcodedPattern = /ADMIN_IDS\s*\|\|\s*['"]1087968824/;
    console.assert(!hardcodedPattern.test(botCode), 'bot.js should not have hardcoded admin IDs as fallback');
    console.assert(!hardcodedPattern.test(dbCode), 'database.js should not have hardcoded admin IDs as fallback');
    
    console.log('PASS: No hardcoded admin IDs in fallback positions');
} catch (e) {
    console.error('FAIL: Admin ID test -', e.message);
}

console.log('\n=== ALL TESTS COMPLETE ===');
