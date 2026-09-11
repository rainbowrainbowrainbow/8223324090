'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pricing = require('../services/productPricing');
const bookingPackage = require('../services/bookingPackage');
const source = fs.readFileSync(path.join(__dirname, '../js/graduation.js'), 'utf8');
const formula = source.slice(source.indexOf('    function getCoefficient()'), source.indexOf('    function timeToMinutes('));
const packageFormula = source.slice(source.indexOf('    function calcPackageTotals('), source.indexOf('    function renderPackages('));
const services = [
    { id: 1, name: 'Entry fixture', priceType: 'fixed', pricePerChild: 50, entryRule: { 10: 10, 50: 15 } },
    { id: 2, name: 'Formula fixture', priceType: 'formula', pricePark: 600, durationMin: 60 },
    { id: 3, name: 'Fixed fixture', priceType: 'fixed', pricePerChild: 80, durationMin: 30 }
];
function calculate(kids, discount, expression) {
    const context = vm.createContext({
        settings: {}, services, selectedServiceIds: new Set([1, 2, 3]),
        currentKidsCount: kids, currentDiscount: discount, currentTab: 'constructor',
        document: { getElementById: () => null }, getServiceIcon: () => ''
    });
    vm.runInContext(formula + packageFormula, context);
    return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('kitchen booking lines preserve product, serving unit and quantity subtotal', () => {
    const line = bookingPackage.normalizeMenuPosition({ productId: 'fixture-cake', name: 'Fixture cake', quantity: 2.5, unitPrice: 80, servingUnit: '100 г', kitchenType: 'cake' });
    assert.equal(line.productId, 'fixture-cake');
    assert.equal(line.servingUnit, '100 г');
    assert.equal(line.quantity, 2.5);
    assert.equal(line.subtotal, 200);
    assert.equal(bookingPackage.menuPositionsSubtotal([line]), 200);
});
test('unchanged graduation formulas retain baseline totals across thresholds and discounts', () => {
    // Recorded from base a52725f; fixtures are synthetic, not commercial prices.
    for (const [kids, total, perChild, entry] of [[10,2500,250,500],[11,2950,268,750],[15,3750,250,750]]) {
        for (const discount of [0, 10]) {
            const actual = calculate(kids, discount, 'calcTotals()');
            assert.equal(actual.totalAll, total * (1 - discount / 100));
            assert.equal(actual.totalPerChild, perChild);
            assert.equal(actual.entryFlat, entry);
            assert.equal(actual.totalDuration, 90);
            assert.equal(actual.animators, kids === 10 ? 1 : 2);
        }
    }
});
test('package override keeps existing zero fallback and positive override semantics', () => {
    const actual = calculate(15, 0, 'calcPackageTotals({services:[{serviceId:2,overridePrice:0},{serviceId:3,overridePrice:90}]})');
    assert.equal(actual.totalPerChild, 210);
    assert.equal(actual.rows[0].price, 120);
    assert.equal(actual.rows[1].price, 90);
    assert.equal(actual.totalDuration, 90);
});
test('product pricing retains date, context, zero, next rule and booking subtotal semantics', async () => {
    const row = { id: 'fixture-animation', business_context: 'event_genix', is_per_child: true,
        price: 999, price_rule_code: 'fixture-rule', price_rule_value: 100, price_rule_unit: 'child',
        price_rule_effective_from: '2026-09-01', next_price_rule_value: 120, next_price_rule_effective_from: '2026-10-01' };
    const mapped = pricing.mapProductPriceFields(row, { priceDate: '2026-09-11' });
    assert.equal(mapped.price, 100);
    assert.equal(mapped.nextPrice, 120);
    assert.equal(mapped.effectivePriceDate, '2026-09-11');
    assert.equal(pricing.mapProductPriceFields({ ...row, price_rule_value: 0 }).price, 0);
    assert.equal(pricing.mapProductPriceFields({ price: null }).price, null);
    const queryable = { query: async (sql, values) => {
        assert.deepEqual(values, ['fixture-animation', '2026-09-11', 'event_genix']);
        assert.match(sql, /effective_from <= \$2/);
        assert.match(sql, /effective_from > \$2/);
        return { rows: [row] };
    } };
    const booking = { programId: row.id, businessContext: 'event_genix', date: '2026-09-11', kidsCount: 10,
        extraData: { bookingPackage: { positionsSubtotal: 200, entrySubtotal: 50 } } };
    const snapshot = await pricing.applyEffectiveBookingPrice(queryable, booking);
    assert.equal(snapshot.productId, row.id);
    assert.equal(snapshot.price, 100);
    assert.equal(booking.price, 1250);
    assert.equal(snapshot.source, 'price_rules');
});
