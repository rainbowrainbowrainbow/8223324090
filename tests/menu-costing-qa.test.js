'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Execute the actual pure route helpers; exclude imports, router registration,
// provider calls and database initialization. No dependencies or real data required.
const source = fs.readFileSync(path.join(__dirname, '../routes/products.js'), 'utf8');
const start = source.indexOf('const MENU_AI_BLOCK_KEYS');
const end = source.indexOf('router.use(authenticateToken);');
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context, { filename: 'routes/products.js:pure-helpers' });
const run = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
const stock = [{ id: 1, name: 'Fixture ingredient', unit: 'г', purchase_unit_price: 10 }];
function draftCost(value, quantity = 2) {
    const raw = { ingredients: [{ stockId: 1, label: 'Fixture ingredient', quantity, unit: 'г' }], priceCost: { estimatedCost: value } };
    return run(`buildMenuAiDraftFromRaw(${JSON.stringify(raw)}, {warehouseItems:${JSON.stringify(stock)}}).blocks.priceCost.proposal`);
}

test('missing/empty estimated cost uses stock fallback while explicit zero remains zero', () => {
    for (const value of [undefined, null, '', '   ', true, false, [], {}]) assert.equal(draftCost(value).estimatedCost, 20);
    assert.equal(draftCost(0).estimatedCost, 0);
    assert.equal(draftCost('0').estimatedCost, 0);
    assert.equal(draftCost('12.6').estimatedCost, 13);
    assert.equal(draftCost(-4).estimatedCost, 20);
});

test('negative/fractional AI ingredient quantities do not fabricate a cost', () => {
    // The existing tech-card API contract requires positive integer quantities.
    for (const quantity of [-2, 0, 0.5, 1.5, 'bad']) {
        assert.equal(draftCost(undefined, quantity).estimatedCost, null);
        assert.equal(draftCost(undefined, quantity).confidence, 'unknown');
    }
    assert.equal(draftCost(undefined, '3').estimatedCost, 30);
    const normalized = run(`normalizeMenuAiIngredient({stockId:1,quantity:0.5},0,${JSON.stringify(stock)})`);
    assert.equal(normalized.quantity, 1, 'editable draft defaults retain their existing contract');
});

test('estimator skips invalid rows without poisoning valid totals or converting units', () => {
    const ingredients = [
        { stockId: 1, quantity: 2, unit: 'г' },
        { stockId: 1, quantity: -3, unit: 'г' },
        { stockId: 1, quantity: 1.5, unit: 'г' },
        { stockId: 1, quantity: 10, unit: 'кг' },
        { stockId: 99, quantity: 2, unit: 'г' }
    ];
    const result = run(`estimateMenuCostFromIngredients(${JSON.stringify(ingredients)},${JSON.stringify(stock)})`);
    assert.equal(result.estimatedCost, 20);
    assert.equal(result.confidence, 'low');
    assert.equal(run('estimateMenuCostFromIngredients([],[])').estimatedCost, null);
    assert.equal(run(`estimateMenuCostFromIngredients([{stockId:1,quantity:2,unit:'г'}],[{id:1,unit:'г',purchase_unit_price:-10}])`).estimatedCost, null);
    assert.equal(run(`estimateMenuCostFromIngredients([{stockId:1,quantity:2,unit:'г'}],[{id:1,unit:'г',purchase_unit_price:'bad'}])`).estimatedCost, null);
});
