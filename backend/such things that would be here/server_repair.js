const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function replace(re, repl) { code = code.replace(re, repl); }

// Collapse any stray content between ack() and runFaceswap()
replace(/(async function ack\([\s\S]*?\}\s*\n)[\s\S]*?(async function runFaceswap)/m, '$1\n$2');

// Remove orphaned callback_query fragments
replace(/\nif\s*\(!known\)[\s\S]*?\);\s*\n/gm, '\n');

// Remove orphaned 'Creating checkout…' fragment
replace(/\nawait ack\(ctx, 'Creating checkout…'\)[\s\S]*?\);\s*\n/gm, '\n');


// Fix extra brace before persistence start in runFaceswap
// Ensure proper block closure before persistence start in runFaceswap
replace(/return \{ error: 'API Error: ' \+ \(result\.message \|\| JSON\.stringify\(result\)\), points: user\.points \};\s*\n\s*\/\/ --- PERSISTENCE START ---/m,
  "return { error: 'API Error: ' + (result.message || JSON.stringify(result)), points: user.points };\n    }\n\n  // --- PERSISTENCE START ---");
// Remove any accidental extra brace before persistence start
replace(/\n\s*\}\s*\n\s*\n\s*\/\/ --- PERSISTENCE START ---/m, "\n\n    // --- PERSISTENCE START ---");

// Remove orphaned API endpoint fragment blocks
replace(/\nif\s*\(!uid\)[\s\S]*?\);\s*\n/gm, '\n');
replace(/\n\s*const u = getOrCreateUser\(uid\);[\s\S]*?\n\}\);\s*/gm, '\n');
replace(/\s*const u = getOrCreateUser\(uid\);[\s\S]*?\n\}\);\s*/gm, '\n');

// Restore missing catch in Stripe config try block
replace(/try\s*\{\s*console\.warn\('Missing STRIPE_SECRET_KEY\.[\s\S]*?\}\s*\n/, "try { console.warn('Missing STRIPE_SECRET_KEY. Stripe payments disabled.'); } catch (_) {}\n");

// Restore missing catch for pricing file loader
replace(/\n\}\s*\n\s*\/\/ --- Public URL Logic ---/m, "\n} catch (_) {}\n\n// --- Public URL Logic ---");

// Restore missing catch in bot.use logging middleware
replace(/\n\s*\}\s*\r?\n\s*return next\(\);/g, "\n  } catch (_) {}\n  return next();");

fs.writeFileSync(target, code);
console.log('server repaired at', target);
