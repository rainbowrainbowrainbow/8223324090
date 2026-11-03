'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
const code = source.slice(source.indexOf('function getTimelineProductsBusinessContext()'), source.indexOf('// v21.14.0:'));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
    let business = 'event_genix';
    const context = vm.createContext({
        Date, PRODUCTS_CACHE_TTL: 300000, EVENT_GENIX_PROGRAMS: [], PROGRAMS: [{ id: 'legacy-fallback' }],
        IS_TIMELINE_PARK_MODE: true, IS_MAYSTERNYA_DOLI_TIMELINE: false,
        AppState: { selectedDate: new Date('2026-10-25T00:00:00') },
        window: { TimelineBusinessContext: { current: () => ({ apiValue: business }) } }
    });
    vm.runInContext(code, context);
    return { context, changeBusiness(value) { business = value; } };
}

for (const scope of ['date', 'business']) {
    test(`late products from a previous ${scope} cannot replace the current catalog or reach its renderer`, async () => {
        const { context, changeBusiness } = harness();
        const old = deferred();
        let requests = 0;
        context.apiGetProducts = async () => ++requests === 1 ? old.promise : [{ id: 'current-catalog-product', duration: 60 }];
        const previousRead = context.getProducts();
        if (scope === 'date') context.AppState.selectedDate = new Date('2026-10-26T00:00:00');
        else changeBusiness('maysternya_doli');
        const currentRead = await context.getProducts();
        assert.equal(currentRead[0].id, 'current-catalog-product');
        old.resolve([{ id: 'obsolete-catalog-product', duration: 30 }]);
        const oldCallerResult = await previousRead;
        assert.equal(context.getProductsSync()[0].id, 'current-catalog-product');
        assert.equal(oldCallerResult[0].id, 'current-catalog-product', 'an old render caller receives the currently scoped catalog');
        assert.equal(requests, 2, 'the already loaded current catalog is reused');
    });
}

test('a stale failed products response cannot fall back over a newer successful catalog', async () => {
    const { context } = harness();
    const old = deferred();
    let requests = 0;
    context.apiGetProducts = async () => ++requests === 1 ? old.promise : [{ id: 'current-product', duration: 60 }];
    const previousRead = context.getProducts();
    context.AppState.selectedDate = new Date('2026-10-26T00:00:00');
    await context.getProducts();
    old.resolve(null);
    assert.equal((await previousRead)[0].id, 'current-product');
    assert.equal(context.getProductsSync()[0].id, 'current-product');
});

test('non-API display modes preserve the existing local catalog behavior', async () => {
    const { context } = harness();
    context.IS_TIMELINE_PARK_MODE = false;
    context.apiGetProducts = async () => { throw new Error('Unexpected API read'); };
    assert.equal((await context.getProducts())[0].id, 'legacy-fallback');
    assert.equal(context.getProductsSync()[0].id, 'legacy-fallback');
});
