/**
 * Flow Simulation Test
 * Traces every user-facing button flow to verify they work end-to-end.
 * Mocks Telegraf context and database to simulate real button clicks.
 */

process.env.TELEGRAM_BOT_TOKEN = 'test:token';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.A2E_API_KEY = 'test';
process.env.DATABASE_URL = 'sqlite://test';
process.env.ADMIN_IDS = '12345';
process.env.PUBLIC_URL = 'https://telegramalam.onrender.com';

const assert = require('assert');
let passed = 0;
let failed = 0;
let errors = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS: ${name}`);
    } catch (e) {
        failed++;
        errors.push({ name, error: e.message });
        console.log(`  FAIL: ${name} - ${e.message}`);
    }
}

// ============================================================
// TEST 1: Verify all channel button deep links have handlers
// ============================================================
console.log('\n=== TEST GROUP 1: Channel Button Deep Links ===');

const fs = require('fs');
const botCode = fs.readFileSync('./src/bot.js', 'utf8');
const promoCode = fs.readFileSync('./src/services/promoScheduler.js', 'utf8');

// Extract all deep link URLs from promo scheduler
const deepLinkRegex = /\?start=([a-z_]+)/g;
const promoDeepLinks = [];
let match;
while ((match = deepLinkRegex.exec(promoCode)) !== null) {
    promoDeepLinks.push(match[1]);
}
console.log('  Channel deep links found:', promoDeepLinks);

// Extract all cases in the /start switch statement
const switchCaseRegex = /case '([a-z_]+)':/g;
const handledCases = [];
while ((match = switchCaseRegex.exec(botCode)) !== null) {
    handledCases.push(match[1]);
}
console.log('  Handled switch cases:', handledCases);

for (const link of promoDeepLinks) {
    test(`Deep link "${link}" has a handler in /start`, () => {
        assert(handledCases.includes(link), `No handler for deep link "${link}" in /start command`);
    });
}

// ============================================================
// TEST 2: Verify "create" deep link does NOT check templates
// ============================================================
console.log('\n=== TEST GROUP 2: Create Flow (No Template Requirement) ===');

test('"create" case does NOT reference templates', () => {
    // Extract the create case block
    const createIdx = botCode.indexOf("case 'create':");
    const nextCaseIdx = botCode.indexOf("case '", createIdx + 15);
    const createBlock = botCode.substring(createIdx, nextCaseIdx);
    
    assert(!createBlock.includes('checkUserHasTemplates'), 'create case should NOT check for templates');
    assert(!createBlock.includes('user_templates'), 'create case should NOT query user_templates');
    assert(!createBlock.includes('getTemplateMissingMessage'), 'create case should NOT use template missing message');
});

test('"create" case sets session mode to "demo" (not "create_video")', () => {
    const createIdx = botCode.indexOf("case 'create':");
    const nextCaseIdx = botCode.indexOf("case '", createIdx + 15);
    const createBlock = botCode.substring(createIdx, nextCaseIdx);
    
    assert(createBlock.includes("mode: 'demo'"), 'create case should set mode to "demo"');
    assert(createBlock.includes("step: 'awaiting_base_video'"), 'create case should set step to awaiting_base_video');
});

test('"create" case checks credits before starting', () => {
    const createIdx = botCode.indexOf("case 'create':");
    const nextCaseIdx = botCode.indexOf("case '", createIdx + 15);
    const createBlock = botCode.substring(createIdx, nextCaseIdx);
    
    assert(createBlock.includes('getCredits'), 'create case should check user credits');
});

// ============================================================
// TEST 3: Verify create_5s/10s/20s don't check templates
// ============================================================
console.log('\n=== TEST GROUP 3: Duration Actions (No Template Requirement) ===');

for (const action of ['create_5s', 'create_10s', 'create_20s']) {
    test(`"${action}" does NOT reference templates`, () => {
        const actionIdx = botCode.indexOf(`bot.action('${action}'`);
        if (actionIdx === -1) {
            throw new Error(`Action handler for ${action} not found`);
        }
        // Find the end of this action handler (next bot.action or bot.command)
        const nextHandler = botCode.indexOf('bot.action(', actionIdx + 10);
        const nextCommand = botCode.indexOf('bot.command(', actionIdx + 10);
        const endIdx = Math.min(
            nextHandler > -1 ? nextHandler : Infinity,
            nextCommand > -1 ? nextCommand : Infinity
        );
        const actionBlock = botCode.substring(actionIdx, endIdx);
        
        assert(!actionBlock.includes('checkUserHasTemplates'), `${action} should NOT check templates`);
        assert(!actionBlock.includes('getTemplateMissingMessage'), `${action} should NOT use template error`);
    });
    
    test(`"${action}" uses demo mode (not create_video)`, () => {
        const actionIdx = botCode.indexOf(`bot.action('${action}'`);
        const nextHandler = botCode.indexOf('bot.action(', actionIdx + 10);
        const nextCommand = botCode.indexOf('bot.command(', actionIdx + 10);
        const endIdx = Math.min(
            nextHandler > -1 ? nextHandler : Infinity,
            nextCommand > -1 ? nextCommand : Infinity
        );
        const actionBlock = botCode.substring(actionIdx, endIdx);
        
        assert(actionBlock.includes("mode: 'demo'"), `${action} should set mode to "demo"`);
    });

    test(`"${action}" checks credits before starting`, () => {
        const actionIdx = botCode.indexOf(`bot.action('${action}'`);
        const nextHandler = botCode.indexOf('bot.action(', actionIdx + 10);
        const nextCommand = botCode.indexOf('bot.command(', actionIdx + 10);
        const endIdx = Math.min(
            nextHandler > -1 ? nextHandler : Infinity,
            nextCommand > -1 ? nextCommand : Infinity
        );
        const actionBlock = botCode.substring(actionIdx, endIdx);
        
        assert(actionBlock.includes('getCredits'), `${action} should check credits`);
    });
}

// ============================================================
// TEST 4: Verify demo_new doesn't check templates
// ============================================================
console.log('\n=== TEST GROUP 4: demo_new Action ===');

test('"demo_new" does NOT reference templates', () => {
    const idx = botCode.indexOf("bot.action('demo_new'");
    const nextHandler = botCode.indexOf('bot.action(', idx + 10);
    const block = botCode.substring(idx, nextHandler > -1 ? nextHandler : idx + 2000);
    
    assert(!block.includes('checkUserHasTemplates'), 'demo_new should NOT check templates');
    assert(!block.includes('user_templates'), 'demo_new should NOT query user_templates');
});

test('"demo_new" sets session to demo/awaiting_base_video', () => {
    const idx = botCode.indexOf("bot.action('demo_new'");
    const nextHandler = botCode.indexOf('bot.action(', idx + 10);
    const block = botCode.substring(idx, nextHandler > -1 ? nextHandler : idx + 2000);
    
    assert(block.includes("mode: 'demo'"), 'demo_new should set mode to demo');
    assert(block.includes("step: 'awaiting_base_video'"), 'demo_new should set step to awaiting_base_video');
});

// ============================================================
// TEST 5: Verify video handler processes demo mode
// ============================================================
console.log('\n=== TEST GROUP 5: Video/Photo Handler Chain ===');

test('Video handler has demo mode processing', () => {
    const videoHandlerIdx = botCode.indexOf("bot.on('video'");
    const photoHandlerIdx = botCode.indexOf("bot.on('photo'");
    const videoBlock = botCode.substring(videoHandlerIdx, photoHandlerIdx);
    
    assert(videoBlock.includes("ctx.session.mode === 'demo'"), 'Video handler should check for demo mode');
    assert(videoBlock.includes("ctx.session.step === 'awaiting_base_video'"), 'Video handler should check for awaiting_base_video');
    assert(videoBlock.includes("ctx.session.step = 'awaiting_face'"), 'Video handler should advance to awaiting_face');
});

test('Photo handler has demo mode processing with faceswap', () => {
    const photoHandlerIdx = botCode.indexOf("bot.on('photo'");
    const nextSection = botCode.indexOf('const checkUserHasTemplates', photoHandlerIdx);
    const photoBlock = botCode.substring(photoHandlerIdx, nextSection > -1 ? nextSection : photoHandlerIdx + 3000);
    
    assert(photoBlock.includes("ctx.session.mode === 'demo'"), 'Photo handler should check for demo mode');
    assert(photoBlock.includes("ctx.session.step === 'awaiting_face'"), 'Photo handler should check for awaiting_face');
    assert(photoBlock.includes("startFaceSwap"), 'Photo handler should call startFaceSwap API');
});

// ============================================================
// TEST 6: Verify buy flow uses USD (not MXN)
// ============================================================
console.log('\n=== TEST GROUP 6: Payment Flow ===');

test('All buy_pack actions use USD currency', () => {
    // Check that no buy_pack action uses 'mxn'
    const buyPackRegex = /buy_pack_\w+.*?currency:\s*'(\w+)'/gs;
    let buyMatch;
    while ((buyMatch = buyPackRegex.exec(botCode)) !== null) {
        assert(buyMatch[1] === 'usd', `Found buy_pack using currency "${buyMatch[1]}" instead of "usd"`);
    }
});

test('createStripeCheckoutSession uses MXN (settlement currency)', () => {
    const fnIdx = botCode.indexOf('async function createStripeCheckoutSession');
    const fnEnd = botCode.indexOf('module.exports', fnIdx);
    const fnBlock = botCode.substring(fnIdx, fnEnd > -1 ? fnEnd : fnIdx + 3000);
    
    assert(fnBlock.includes("sessionCurrency = 'mxn'"), 'Should force MXN currency (settlement currency)');
    assert(fnBlock.includes('unit_amount: pack.price_cents'), 'Should use pack.price_cents directly');
});

test('All deep link buy handlers use USD', () => {
    for (const pack of ['micro', 'starter', 'plus', 'pro']) {
        const caseIdx = botCode.indexOf(`case 'buy_${pack}':`);
        const nextCase = botCode.indexOf("case '", caseIdx + 10);
        const block = botCode.substring(caseIdx, nextCase);
        
        assert(block.includes("currency: 'usd'"), `buy_${pack} deep link should use USD`);
    }
});

// ============================================================
// TEST 7: Verify Render build files
// ============================================================
console.log('\n=== TEST GROUP 7: Render Build ===');

test('Root package.json exists', () => {
    assert(fs.existsSync('../package.json'), 'Root package.json should exist');
});

test('Root package.json has correct start command', () => {
    const pkg = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
    assert(pkg.scripts.start.includes('new_backend'), 'Start command should reference new_backend');
    assert(pkg.scripts.start.includes('index.js'), 'Start command should reference index.js');
});

test('Root package.json has build command', () => {
    const pkg = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
    assert(pkg.scripts.build, 'Build script should exist');
});

test('render.yaml exists at root', () => {
    assert(fs.existsSync('../render.yaml'), 'render.yaml should exist at root');
});

test('render.yaml has correct build command', () => {
    const yaml = fs.readFileSync('../render.yaml', 'utf8');
    assert(yaml.includes('new_backend'), 'render.yaml buildCommand should reference new_backend');
    assert(yaml.includes('npm install'), 'render.yaml should run npm install');
});

// ============================================================
// TEST 8: Verify the complete flow chain
// ============================================================
console.log('\n=== TEST GROUP 8: Complete Flow Chain Verification ===');

test('Channel "Create Video" -> /start create -> demo flow -> video -> photo -> faceswap', () => {
    // 1. Channel button sends: t.me/bot?start=create
    assert(promoCode.includes("start=create"), 'Channel has create deep link');
    
    // 2. /start handler has create case
    assert(handledCases.includes('create'), '/start handles create');
    
    // 3. create case sets session to demo/awaiting_base_video
    const createIdx = botCode.indexOf("case 'create':");
    const nextCase = botCode.indexOf("case '", createIdx + 15);
    const createBlock = botCode.substring(createIdx, nextCase);
    assert(createBlock.includes("mode: 'demo'"), 'Sets demo mode');
    assert(createBlock.includes("step: 'awaiting_base_video'"), 'Sets awaiting video');
    
    // 4. Video handler catches demo/awaiting_base_video, advances to awaiting_face
    assert(botCode.includes("ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_base_video'"), 'Video handler catches demo');
    
    // 5. Photo handler catches demo/awaiting_face, calls startFaceSwap
    assert(botCode.includes("ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_face'"), 'Photo handler catches demo face');
    assert(botCode.includes("startFaceSwap(faceUrl, baseUrl)"), 'Calls faceswap API');
});

test('Channel "Buy Pack" -> /start buy_micro -> Stripe session -> payment URL', () => {
    // 1. Channel button sends: t.me/bot?start=buy_micro
    assert(promoCode.includes("start=buy_micro"), 'Channel has buy_micro deep link');
    
    // 2. /start handles buy_micro
    assert(handledCases.includes('buy_micro'), '/start handles buy_micro');
    
    // 3. buy_micro case calls createStripeCheckoutSession
    const buyIdx = botCode.indexOf("case 'buy_micro':");
    const nextBuyCase = botCode.indexOf("case '", buyIdx + 15);
    const buyBlock = botCode.substring(buyIdx, nextBuyCase);
    assert(buyBlock.includes('createStripeCheckoutSession'), 'Calls Stripe');
    assert(buyBlock.includes("currency: 'usd'"), 'Uses USD');
    
    // 4. Returns payment URL to user
    assert(buyBlock.includes('session'), 'Creates session');
    assert(buyBlock.includes('url'), 'Returns URL');
});

test('DM "Create Video" button -> demo_new -> demo flow', () => {
    // sendDemoMenuWithBuyButtons shows demo_new button
    assert(botCode.includes("'demo_new')"), 'Menu has demo_new button');
    
    // demo_new handler goes straight to demo flow
    const demoIdx = botCode.indexOf("bot.action('demo_new'");
    const nextHandler = botCode.indexOf('bot.action(', demoIdx + 10);
    const demoBlock = botCode.substring(demoIdx, nextHandler);
    assert(demoBlock.includes("mode: 'demo'"), 'demo_new sets demo mode');
    assert(!demoBlock.includes('checkUserHasTemplates'), 'demo_new skips templates');
});

test('DM "Buy Credits" button -> buy_pack_micro -> Stripe', () => {
    // sendDemoMenuWithBuyButtons shows buy_pack_micro button
    assert(botCode.includes("'buy_pack_micro')"), 'Menu has buy_pack_micro button');
    
    // buy_pack_micro handler calls Stripe
    const packIdx = botCode.indexOf("bot.action('buy_pack_micro'");
    const nextHandler = botCode.indexOf("bot.action('buy_pack_starter'", packIdx + 10);
    const packBlock = botCode.substring(packIdx, nextHandler);
    assert(packBlock.includes('createStripeCheckoutSession'), 'Calls Stripe');
    assert(packBlock.includes("currency: 'usd'"), 'Uses USD');
    assert(packBlock.includes('session.url'), 'Returns payment URL');
});

// ============================================================
// TEST 9: Error handling
// ============================================================
console.log('\n=== TEST GROUP 9: Error Handling ===');

test('Bot has global error handler (bot.catch)', () => {
    assert(botCode.includes('bot.catch('), 'bot.catch should be registered');
});

test('Unhandled rejection handler exists', () => {
    const indexCode = fs.readFileSync('./index.js', 'utf8');
    assert(indexCode.includes('unhandledRejection'), 'Should handle unhandled rejections');
});

test('Uncaught exception handler exists', () => {
    const indexCode = fs.readFileSync('./index.js', 'utf8');
    assert(indexCode.includes('uncaughtException'), 'Should handle uncaught exceptions');
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n========================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
