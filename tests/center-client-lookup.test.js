const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Center clears client data and ignores stale requests when scope or permissions change', async t => {
    const dom = new JSDOM(read('center.html'), { runScripts: 'outside-only', url: 'http://localhost/center' });
    t.after(() => dom.window.close());
    const w = dom.window;
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    w.eval(read('js/center-page.js'));
    let directoryAccess = false;
    w.canOpenWorkspacePage = page => page === '/center' || directoryAccess;
    w.getPermissionLifecycle = () => ({ status: 'ready' });
    w.canAccess = () => false;
    w.initCenterClientLookup();

    const id = name => w.document.getElementById(name);
    const pending = [];
    w.apiSearchClients = () => new Promise(resolve => pending.push(resolve));
    w.apiClientBookings = () => new Promise(resolve => pending.push(resolve));
    const customer = { id: 42, name: 'Lookup fixture', phone: 'Test phone', total_spent: 15800 };

    const staleSearch = w.searchClients();
    w.dispatchEvent(new w.Event('crmBusinessScopeChanged'));
    pending.shift()({ clients: [customer] });
    await staleSearch;
    assert.equal(id('clientsContent').textContent, '');

    const search = w.searchClients();
    pending.shift()({ clients: [customer] });
    await search;
    assert.match(id('clientsContent').textContent, /Lookup fixture/);
    assert.equal(id('clientsContent').querySelector('.revenue'), null);
    const profile = w.showClientProfile(42);
    pending.shift()({ bookings: [{ program_name: 'Synthetic program', status: 'confirmed', price: 2250 }] });
    await profile;
    assert.match(id('clientBookingsContent').textContent, /Synthetic program/);
    assert.doesNotMatch(id('clientBookingsContent').textContent, /Витрачено/);
    assert.equal(id('clientBookingsContent').querySelector('.client-booking-price'), null);

    const staleProfile = w.showClientProfile(42);
    directoryAccess = true;
    w.dispatchEvent(new w.Event('permissions:lifecycle'));
    pending.shift()({ bookings: [{ program_name: 'Old business result', status: 'confirmed' }] });
    await staleProfile;
    for (const element of ['clientsContent', 'clientBookingsContent']) assert.equal(id(element).textContent, '');
    assert.equal(id('centerClientLookup').classList.contains('hidden'), true);
    assert.equal(id('centerCustomersLink').classList.contains('hidden'), false);
    await w.searchClients();
    await w.showClientProfile(42);
    assert.equal(pending.length, 0);
});
