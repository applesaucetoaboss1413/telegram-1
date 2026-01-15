const assert = require('assert');

// Test calculatePrice logic directly
const calculatePrice = (priceCents, currency, rate) => {
    if (currency === 'usd') return priceCents;
    return Math.round((priceCents / 100) * rate * 1.03 * 100);
};

function testConversions() {
    // Test $0.99 conversions
    const testPrice = 99;

    // USD should stay same
    assert.equal(calculatePrice(testPrice, 'usd', 1), 99, 'USD amount should stay same');

    // Test MXN conversion (0.99 * 18 * 1.03 = 18.3546 → 1835 cents)
    assert.equal(calculatePrice(testPrice, 'mxn', 18), 1835, 'MXN conversion');

    // Test CAD conversion (0.99 * 1.36 * 1.03 = 1.386792 → 139 cents)
    assert.equal(calculatePrice(testPrice, 'cad', 1.36), 139, 'CAD conversion');

    console.log('✅ All payment calculations test passed');
}

testConversions();
