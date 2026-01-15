const assert = require('assert');
const { calculatePrice } = require('./src/server');

// Test currency conversions
const testRates = { MXN: 18.0, CAD: 1.36, EUR: 0.92, GBP: 0.79 };

// USD should pass through unchanged
assert.equal(calculatePrice(100, 'USD', testRates), 100, 'USD amount should stay same');

// Test conversions with 3% spread
assert.equal(calculatePrice(100, 'MXN', testRates), Math.round((100 / 100) * 18 * 1.03 * 100), 'MXN conversion');
assert.equal(calculatePrice(100, 'CAD', testRates), Math.round((100 / 100) * 1.36 * 1.03 * 100), 'CAD conversion');
assert.equal(calculatePrice(100, 'EUR', testRates), Math.round((100 / 100) * 0.92 * 1.03 * 100), 'EUR conversion');
assert.equal(calculatePrice(100, 'GBP', testRates), Math.round((100 / 100) * 0.79 * 1.03 * 100), 'GBP conversion');

console.log('✅ All payment calculations test passed');
