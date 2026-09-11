'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../js/graduation.js'), 'utf8');
const calculations = source.slice(source.indexOf('    function getCoefficient()'), source.indexOf('    function timeToMinutes('));
const packageCalculation = source.slice(source.indexOf('    function calcPackageTotals('), source.indexOf('    function renderPackages('));

function runtime(records, options = {}) {
    const context = vm.createContext({
        settings: { coefficient: { value: '6.00' }, markup: { value: '1.15' } },
        services: records, selectedServiceIds: new Set(records.map(record => record.id)),
        currentKidsCount: 15, currentDiscount: 10, currentTab: 'constructor',
        document: { getElementById: () => null }, getServiceIcon: () => '', ...options
    });
    vm.runInContext(calculations + packageCalculation, context);
    return expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

const records = [
    { id: 1, name: 'Entry', priceType: 'fixed', pricePerChild: '10.00', entryRule: { 8: 1, 16: 2, 99: 3 }, costHost: '0.00' },
    { id: 2, name: 'Formula', priceType: 'formula', pricePark: '600.00', durationMin: 60, costHost: '80.50', costCostume: '10.00', costBalloonsPerKid: '2.00' },
    { id: 3, name: 'Fixed', priceType: 'fixed', pricePerChild: '80.00', durationMin: 30, costDelivery: '5.00', costOther: '0.00' }
];

test('PostgreSQL decimal strings add numerically for totals, costs, profit and margin', () => {
    const calculate = runtime(records);
    const totals = calculate('calcTotals()');
    assert.equal(totals.totalAll, 2718);
    assert.equal(totals.totalPerChild, 201);
    assert.equal(totals.totalCost, 125.5);
    assert.equal(totals.profit, 2592.5);
    assert.equal(totals.margin, 2592.5 / 2718 * 100);
    assert.equal(totals.totalDuration, 90);
    assert.equal(calculate('getEffectivePrice({pricePerChild: "0.00"})'), 0);
});

test('each cost component accepts API decimals while external costs retain their existing rule', () => {
    const calculate = runtime(records);
    const costs = Object.fromEntries(['Host','Costume','Delivery','Ice','Other','Box','Markers','Solution','Cleaning',
        'BalloonsPerKid','AquagrimPerKid','PrintPerKid','DesignPerKid','DrinksPerKid'].map(field => [`cost${field}`, '1.50']));
    assert.equal(calculate(`calcServiceCost(${JSON.stringify(costs)}, 10)`), 88.5);
    assert.equal(calculate('calcServiceCost({costType:"mk_external"}, 10)'), null);
    assert.equal(calculate('calcServiceCost({}, 10)'), 0);
});

test('package numeric strings and overrides give the same totals as numeric payloads', () => {
    const calculate = runtime(records);
    const result = calculate('calcPackageTotals({services:[{serviceId:1},{serviceId:2},{serviceId:3,overridePrice:"90.00"}]})');
    assert.equal(result.totalPerChild, 220);
    assert.deepEqual(result.rows.map(row => row.price), [10, 120, 90]);
    assert.equal(result.totalDuration, 90);
    assert.equal(calculate('calcPackageTotals({services:[{serviceId:3,overridePrice:0}]}).totalPerChild'), 80);
});

test('package manual child count uses the same 1–99 limits as its stepper', () => {
    for (const [input, expected] of [['100', 99], ['-2', 1], ['15', 15], ['', 15]]) {
        const calculate = runtime(records, { currentTab: 'packages', document: { getElementById: () => ({ value: input }) } });
        assert.equal(calculate('getKidsCount()'), expected);
    }
});

test('package cards activate by Enter/Space without hijacking nested controls', () => {
    const dom = new JSDOM('<div id="gradContent"></div>', { url: 'http://localhost/graduation', runScripts: 'dangerously' });
    const { window } = dom;
    try {
        window.eval(source.replace('    // Public API', `
            services = ${JSON.stringify(records)};
            packages = [{ name: 'Fixture package', slug: 'best-dj', services: [{serviceId:2}, {serviceId:3}] }];
            window.renderTestPackages = () => renderPackages(document.getElementById('gradContent'));
            // Public API`));
        window.renderTestPackages();
        const opened = [];
        window.GradPage.openCatalogViewer = index => opened.push(index);
        const card = window.document.querySelector('.grad-package-card');
        const imagePath = card.querySelector('img').getAttribute('src');
        assert.equal(imagePath, 'images/catalogs/graduation/best-dj-banner.png');
        assert.ok(fs.existsSync(path.join(__dirname, '..', imagePath)));
        for (const key of ['Enter', ' ']) {
            const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            card.dispatchEvent(event);
            assert.equal(event.defaultPrevented, true);
        }
        card.querySelector('input').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        assert.deepEqual(opened, [0, 0]);
        assert.match(card.textContent, /200 ₴/);
        assert.doesNotMatch(card.textContent, /NaN/);
    } finally {
        dom.window.close();
    }
});

test('Escape closes the local info modal without removing the sidebar', async () => {
    const dom = new JSDOM('<nav id="sidebarLinks"><a href="/programs">Products</a></nav><div id="gradInfoModal" style="display:flex"></div>',
        { url: 'http://localhost/graduation', runScripts: 'dangerously' });
    try {
        dom.window.apiCall = async () => [];
        dom.window.eval(source);
        dom.window.GradPage.init();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.equal(dom.window.document.getElementById('gradInfoModal').style.display, 'none');
        assert.equal(dom.window.document.querySelector('#sidebarLinks a').getAttribute('href'), '/programs');
        await new Promise(resolve => setImmediate(resolve));
    } finally { dom.window.close(); }
});
