'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('lead revenue fields are shaped and explicit writes require view_revenue', () => {
    const route = read('routes/leads.js');
    const page = read('js/leads-page.js');
    const html = read('leads.html');

    assert.match(route, /canUseAction, requireRole/);
    assert.match(route, /function requireRevenueForExplicitFields[\s\S]*canUseAction\(req\.user, 'view_revenue'\)/);
    assert.match(route, /stripLegacyCustomerCardBudgetLines\([\s\S]*stripLeadPotentialFields\(redactRevenueFieldKeys\(payload\)\)/);
    assert.match(route, /section\.includes\('\[legacy customer_card:'\)[\s\S]*\^\\s\*Бюджет\\s\*:/);
    assert.match(route, /router\.get\('\/', shapeRevenueResponse/);
    assert.match(route, /router\.get\('\/hot', shapeRevenueResponse/);
    assert.match(route, /router\.get\('\/pipeline', shapeRevenueResponse/);
    assert.match(route, /router\.patch\('\/:id', requireRevenueForExplicitFields\('potential_value', 'potentialValue'\), shapeRevenueResponse/);
    assert.match(route, /router\.post\('\/:id\/card', requireRevenueForExplicitFields\('budget_approx', 'budgetApprox'\), shapeRevenueResponse/);
    assert.match(route, /router\.get\('\/:id\/workspace', shapeRevenueResponse/);
    assert.match(route, /budget_approx: budgetValue\.provided \? budgetValue\.value : \(lead\.potential_value \?\? null\)/);

    assert.match(page, /function canViewLeadRevenue\(\)[\s\S]*canAccess\('view_revenue'\)/);
    assert.match(page, /if \(!canViewLeadRevenue\(\)\) return 0;/);
    assert.match(page, /function workspaceMoney\(value\) \{\s*if \(!canViewLeadRevenue\(\)\) return '—';/);
    assert.match(page, /if \(canViewLeadRevenue\(\)\) body\.budget_approx =/);
    assert.doesNotMatch(page, /celebrants: ccCelebrants,\s*budget_approx:/);
    assert.match(html, /id="ccBudgetGroup"/);
});

test('lead revenue projection removes only generated legacy budget lines', () => {
    const route = read('routes/leads.js');
    const start = route.indexOf('function stripLegacyCustomerCardBudgetLines');
    const end = route.indexOf('\nfunction shapeRevenueResponse', start);
    assert.ok(start >= 0 && end > start);

    const context = vm.createContext({ Buffer });
    vm.runInContext(`
        ${route.slice(start, end)}
        this.projectLegacyNotes = stripLegacyCustomerCardBudgetLines;
    `, context, { filename: 'routes/leads.js' });

    const source = {
        notes: [
            'Оператор записав: Бюджет: уточнити пізніше',
            '[legacy customer_card:lead:17]\nТип події: День народження\nБюджет: 5000\nКанал: phone',
            'Інша нотатка без фінансового маркера'
        ].join('\n\n')
    };
    const projected = context.projectLegacyNotes(source);

    assert.match(projected.notes, /Оператор записав: Бюджет: уточнити пізніше/);
    assert.match(projected.notes, /\[legacy customer_card:lead:17\]/);
    assert.match(projected.notes, /Тип події: День народження/);
    assert.match(projected.notes, /Канал: phone/);
    assert.doesNotMatch(projected.notes, /Бюджет: 5000/);
    assert.match(projected.notes, /Інша нотатка без фінансового маркера/);
    assert.match(source.notes, /Бюджет: 5000/, 'projection must not mutate stored notes');
});

test('loyalty responses redact financial values and partial updates preserve omitted fields', () => {
    const route = read('routes/loyalty.js');

    assert.match(route, /router\.use\(shapeLoyaltyRevenueResponse\);/);
    assert.match(route, /if \(key === 'min_order'\) continue;/);
    assert.match(route, /if \(key === 'value' && isDiscountRecord\) continue;/);
    assert.match(route, /\? 'c\.total_spent DESC'\s*: 'c\.updated_at DESC NULLS LAST, c\.id DESC'/);
    assert.match(route, /router\.put\('\/tiers\/:id', requireRevenueForExplicitFields\('min_spent', 'discount_percent'\)/);
    assert.match(route, /router\.post\('\/discounts', requireLoyaltyRevenue/);
    assert.match(route, /router\.put\('\/discounts\/:id', requireLoyaltyRevenue/);
    assert.match(route, /router\.delete\('\/discounts\/:id', requireLoyaltyRevenue/);
    assert.match(route, /router\.post\('\/discounts\/validate', requireRevenueForExplicitFields\('price'\)/);
    assert.match(route, /router\.post\('\/proposals', requireRevenueForExplicitFields\('discount_code_id'\)/);

    assert.match(route, /max_uses = CASE WHEN \$6::boolean THEN \$7 ELSE max_uses END/);
    assert.match(route, /valid_from = CASE WHEN \$8::boolean THEN \$9::date ELSE valid_from END/);
    assert.match(route, /valid_until = CASE WHEN \$10::boolean THEN \$11::date ELSE valid_until END/);
    assert.match(route, /category = CASE WHEN \$12::boolean THEN \$13 ELSE category END/);
    assert.match(route, /hasOwnBodyField\(req, 'max_uses'\), max_uses/);
});

test('shared revenue shaper covers group B financial field names without fake zeros or mutation', () => {
    const { redactRevenueFields } = require('../services/revenueAccessPolicy');
    const payload = {
        id: 1,
        name: 'Operational record',
        budget_approx: 4500,
        total_spent: 12000,
        price_info: '5 000 UAH',
        price_details: { child_price: 300 },
        min_spent: 1000,
        discount_percent: 10,
        count: 4
    };

    assert.deepEqual(redactRevenueFields(payload), {
        id: 1,
        name: 'Operational record',
        count: 4
    });
    assert.equal(payload.budget_approx, 4500, 'redaction must not mutate source data');
});
