'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../js/finance-money.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const BASE = '/api/finance/manual-money';

function workspace() {
    return {
        success: true, currency: 'UAH', coverage: 'manual-only', limitations: [], hasMoreOperations: false,
        accounts: [
            { id: 11, name: 'Till A', type: 'cash', emoji: '💼', enrolled: true, eligible: true, openingMinor: '500000', balanceMinor: '419975', cutoffAt: '2026-10-07T08:00:00Z', openShift: { id: 31, status: 'open', expectedMinor: '419975' } },
            { id: 12, name: 'Till B', type: 'cash', enrolled: true, eligible: true, openingMinor: '0', balanceMinor: '0', openShift: { id: 32, status: 'open', expectedMinor: '0' } },
            { id: 13, name: 'New till', type: 'cash', enrolled: false, eligible: true, balanceMinor: null, openShift: null },
            { id: 14, name: 'Closed till', type: 'cash', enrolled: true, eligible: true, openingMinor: '0', balanceMinor: '0', openShift: null },
            { id: 15, name: 'Unadapted payroll account', type: 'bank', enrolled: false, eligible: false, blockedReason: 'Existing payment evidence' }
        ],
        operations: [{ id: 'operation-one', command: 'booking_receipt', amountMinor: '80025', effectiveAt: '2026-10-07T09:00:00Z', legs: [{ accountId: 11, amountMinor: '80025', shiftId: 31 }] }],
        shifts: [{ id: 31, accountId: 11, status: 'open', openedAt: '2026-10-07T08:00:00Z', openingMinor: '500000', expectedMinor: '419975', actualMinor: null, differenceMinor: null }]
    };
}

async function fixture(t, settings = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/finance' });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.eval(source);
    const requests = [];
    let scope = 'actor-1/business-A';
    let permission = true;
    let data = workspace();
    let categories = [{ id: 21, type: 'expense', name: 'Materials', isActive: true }, { id: 22, type: 'income', name: 'Cafe', isActive: true }];
    let handler = async (method, url) => {
        if (method === 'GET' && url === BASE) return clone(data);
        if (method === 'GET') return { bookingId: 'booking-one', label: 'Party', eligible: true, totalMinor: '1000000', paidMinor: '300000', remainingMinor: '700000', legacyPaidMinor: '0' };
        return { success: true, operationId: 'confirmed' };
    };
    const callbacks = [];
    const config = {
        container: window.document.getElementById('host'),
        apiRequest: async (method, url, body) => { requests.push({ method, url, body: body ? clone(body) : undefined }); return handler(method, url, body); },
        canManage: () => permission,
        getBusinessKey: () => scope,
        getCategories: () => categories,
        onCreateAccount: () => callbacks.push('account'),
        onCreateCategory: value => callbacks.push(value),
        ...settings
    };
    let mounted = window.FinanceMoneyWorkspace.mount(config);
    await mounted.ready;
    const el = id => window.document.getElementById(id);
    const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new window.Event('change', { bubbles: true })); };
    const submit = async () => { el('fmForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
    return {
        window, el, change, submit, requests, callbacks,
        api: window.FinanceMoneyWorkspace,
        handler: value => { handler = value; }, data: value => { data = value; }, scope: value => { scope = value; }, permission: value => { permission = value; },
        categories: value => { categories = value; window.dispatchEvent(new window.Event('finance:categories-updated')); },
        refresh: () => mounted.refresh(),
        remount: async () => { mounted.destroy(); mounted = window.FinanceMoneyWorkspace.mount(config); await mounted.ready; },
        select: (account = '11', action = 'expense') => { change('fmAccount', account); change('fmAction', action); },
        writes: () => requests.filter(request => request.method === 'POST')
    };
}

test('money parsing and display retain exact kopecks above Number precision and reject ambiguous values', async t => {
    const f = await fixture(t);
    assert.equal(f.api.parseMoney('800,25'), '80025');
    assert.equal(f.api.parseMoney('90071992547409.93'), '9007199254740993');
    assert.equal(f.api.formatMinor('9007199254740993'), '90 071 992 547 409,93 ₴');
    assert.equal(f.api.parseMoney('0', true), '0');
    for (const value of ['0', '-1', '1e3', '12.345', '1 000', '', '.50', '1,2.3', '92233720368547758.08']) assert.throws(() => f.api.parseMoney(value), value);
    assert.equal(f.api.formatMinor(null), 'Недоступно');
});

test('expense submit uses actual account/category choices and exact minor string; confirmed draft clears', async t => {
    const f = await fixture(t);
    f.select();
    f.change('fmCategory', '21');
    f.el('fmAmount').value = '800,25';
    f.el('fmDescription').value = 'Materials received';
    await f.submit();
    const body = f.writes()[0].body;
    assert.deepEqual({ ...body, idempotencyKey: 'key' }, { command: 'expense', accountId: 11, categoryId: 21, amountMinor: '80025', description: 'Materials received', idempotencyKey: 'key' });
    assert.match(body.idempotencyKey, /^[a-f0-9-]{36}$/);
    assert.equal(f.el('fmAmount').value, '');
    assert.match(f.el('fmCommandStatus').textContent, /підтверджено/);
    assert.match(f.el('fmAccountSummary').textContent, /4 199,75/);
});

test('unknown POST outcome preserves exact identity through refresh/remount and only retries explicitly', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '1,01';
    f.handler(async method => { if (method === 'POST') throw new Error('Connection lost'); return workspace(); });
    await f.submit();
    const original = f.writes()[0].body;
    assert.equal(f.el('fmPendingBox').hidden, false);
    assert.equal(f.el('fmEditor').hidden, true);
    assert.equal(f.el('fmAmount').value, '1,01');
    await f.refresh(); await f.remount();
    assert.equal(f.writes().length, 1, 'mount and refresh must not auto-retry money writes');
    assert.equal(f.el('fmPendingBox').hidden, false);
    f.handler(async method => method === 'POST' ? { success: true, replayed: true } : workspace());
    f.el('fmRetry').click(); await settle();
    assert.deepEqual(f.writes()[1].body, original);
    assert.equal(f.el('fmPendingBox').hidden, true);
    assert.match(f.el('fmCommandStatus').textContent, /Дубль не створено/);
});

test('definitive validation error keeps editable draft and gives a changed command a new identity', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '11,50'; f.el('fmDescription').value = 'Keep draft';
    f.handler(async method => { if (method === 'POST') throw Object.assign(new Error('Not enough cash'), { status: 409 }); return workspace(); });
    await f.submit();
    const first = f.writes()[0].body;
    assert.equal(f.el('fmPendingBox').hidden, true);
    assert.equal(f.el('fmAmount').disabled, false);
    assert.equal(f.el('fmAmount').value, '11,50');
    assert.equal(f.el('fmDescription').value, 'Keep draft');
    assert.equal(f.window.document.activeElement.id, 'fmSubmit');
    f.el('fmAmount').value = '10,50';
    await f.submit();
    assert.notEqual(f.writes()[1].body.idempotencyKey, first.idempotencyKey);
});

test('busy submit disables all controls and a repeated submit sends one command', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '2';
    let resolve;
    f.handler(method => method === 'POST' ? new Promise(done => { resolve = done; }) : Promise.resolve(workspace()));
    await f.submit(); await f.submit();
    assert.equal(f.writes().length, 1);
    assert.equal(f.el('fmAccount').disabled, true);
    assert.equal(f.el('fmAmount').disabled, true);
    assert.equal(f.el('fmRefresh').disabled, true);
    resolve({ success: true }); await settle();
    assert.equal(f.el('fmAccount').disabled, false);
});

test('category updates preserve amount and description and never substitute an archived category', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '12,30'; f.el('fmDescription').value = 'Draft';
    f.el('fmCreateCategory').click();
    assert.equal(f.callbacks[0].targetId, 'fmCategory');
    assert.equal(f.callbacks[0].type, 'expense');
    f.categories([{ id: 21, type: 'expense', name: 'Archived', isActive: false }, { id: 23, type: 'expense', name: 'New' }]);
    assert.equal(f.el('fmCategory').value, '');
    assert.equal(f.el('fmAmount').value, '12,30');
    assert.equal(f.el('fmDescription').value, 'Draft');
    await f.submit(); assert.equal(f.writes().length, 0);
    assert.match(f.el('fmCommandError').textContent, /активну категорію/);
});

test('viewer and revoked permission cannot write or trigger creation callbacks including pending retry', async t => {
    const f = await fixture(t);
    f.permission(false); await f.refresh(); f.select();
    assert.equal(f.el('fmEditor').hidden, true);
    assert.equal(f.el('fmCreateAccount').hidden, true);
    await f.submit();
    f.el('fmCreateAccount').click(); f.el('fmCreateCategory').click();
    assert.equal(f.writes().length, 0); assert.equal(f.callbacks.length, 0);
    f.permission(true); await f.refresh(); f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '2';
    f.handler(async method => { if (method === 'POST') throw new Error('Network'); return workspace(); });
    await f.submit(); f.permission(false); f.el('fmRetry').click(); await settle();
    assert.equal(f.writes().length, 1);
});

test('manual entries exclude system categories owned by booking, certificates and payroll writers', async t => {
    const f = await fixture(t);
    f.categories([
        { id: 21, type: 'expense', name: 'Materials' },
        { id: 22, type: 'income', name: 'Cafe' },
        { id: 23, type: 'expense', name: 'Payroll', isSystem: true },
        { id: 24, type: 'income', name: 'Booking', is_system: true }
    ]);
    f.select();
    assert.deepEqual([...f.el('fmCategory').options].map(option => option.value), ['', '21']);
    f.change('fmAction', 'income');
    assert.deepEqual([...f.el('fmCategory').options].map(option => option.value), ['', '22']);
    f.el('fmCategory').add(new f.window.Option('Injected system category', '24'));
    f.change('fmCategory', '24'); f.el('fmAmount').value = '100'; await f.submit();
    assert.equal(f.writes().length, 0, 'command validation must also reject a system category');
    assert.match(f.el('fmCommandError').textContent, /активну категорію/);
});

test('account enrollment is explicit with a zero opening; cash operations need a separate open shift', async t => {
    const f = await fixture(t);
    f.change('fmAccount', '13');
    assert.equal(f.el('fmAction').value, 'enroll');
    f.el('fmAmount').value = '0'; f.el('fmReason').value = 'Counted empty till';
    await f.submit();
    assert.equal(f.writes()[0].body.openingMinor, '0');
    f.change('fmAccount', '14');
    assert.deepEqual([...f.el('fmAction').options].map(option => option.value), ['open_shift']);
    await f.submit();
    assert.equal(f.writes()[1].body.command, 'open_shift');
    assert.equal(f.writes()[1].body.accountId, 14);
    f.change('fmAccount', '15');
    assert.equal(f.el('fmEditor').hidden, true);
    assert.match(f.el('fmAccountNote').textContent, /Existing payment evidence/);
});

test('booking receipt requires fresh lookup, shows remaining debt and rejects overpayment', async t => {
    const f = await fixture(t);
    f.select('11', 'booking_receipt'); f.el('fmBookingRef').value = 'BK-TEST'; f.el('fmFindBooking').click(); await settle();
    assert.match(f.el('fmBookingSummary').textContent, /Залишок до сплати: 7 000,00/);
    f.el('fmAmount').value = '7000,01'; await f.submit(); assert.equal(f.writes().length, 0);
    f.el('fmAmount').value = '3000'; await f.submit();
    assert.equal(f.writes()[0].body.bookingId, 'booking-one'); assert.equal(f.writes()[0].body.amountMinor, '300000');
    f.el('fmBookingRef').value = 'OTHER'; f.el('fmBookingRef').dispatchEvent(new f.window.Event('input')); f.el('fmAmount').value = '1';
    await f.submit(); assert.equal(f.writes().length, 1);
});

test('transfer chooses another open till and refund/reversal bind the original without exposing ids in labels', async t => {
    const f = await fixture(t);
    f.select('11', 'transfer');
    assert.deepEqual([...f.el('fmToAccount').options].map(option => option.value), ['', '12']);
    f.change('fmToAccount', '12'); f.el('fmAmount').value = '2000'; f.el('fmReason').value = 'Float'; await f.submit();
    assert.equal(f.writes()[0].body.toAccountId, 12);
    f.change('fmAction', 'refund'); f.change('fmOriginal', 'operation-one'); f.el('fmAmount').value = '0,25'; f.el('fmReason').value = 'Customer return'; await f.submit();
    assert.equal(f.writes()[1].body.originalId, 'operation-one');
    assert.equal(f.writes()[1].body.amountMinor, '25');
    assert.ok(!f.el('fmOriginal').textContent.includes('operation-one'));
    f.change('fmAction', 'reverse'); f.change('fmOriginal', 'operation-one'); f.el('fmReason').value = 'Entry correction'; await f.submit();
    assert.equal(f.writes()[2].body.command, 'reverse');
    assert.equal(f.writes()[2].body.amountMinor, undefined);
});

test('closing shift posts actual amount against selected shift and preserves explanation', async t => {
    const f = await fixture(t);
    f.select('11', 'close_shift'); f.el('fmAmount').value = '4199,70'; f.el('fmReason').value = 'Count differs by 5 kopecks';
    assert.match(f.el('fmActionNote').textContent, /4 199,75/);
    await f.submit();
    assert.equal(f.writes()[0].body.shiftId, 31); assert.equal(f.writes()[0].body.actualMinor, '419970');
});

test('business changes ignore late reads and refuse a draft write until new scope loads', async t => {
    const f = await fixture(t);
    let resolve;
    f.handler(() => new Promise(done => { resolve = done; }));
    const loading = f.refresh();
    f.scope('actor-1/business-B');
    f.handler(async () => ({ ...workspace(), accounts: [{ ...workspace().accounts[0], id: 99, name: 'Business B' }] }));
    await f.refresh();
    resolve(workspace()); await loading;
    assert.ok(f.el('fmAccount').textContent.includes('Business B'));
    assert.ok(!f.el('fmAccount').textContent.includes('Till A'));
    f.change('fmAccount', '99'); f.change('fmAction', 'expense'); f.change('fmCategory', '21'); f.el('fmAmount').value = '1';
    f.scope('actor-2/business-B'); await f.submit(); assert.equal(f.writes().length, 0);
});

test('unavailable and failed workspace never display stale balances as actual money or zero', async t => {
    const f = await fixture(t);
    f.select(); assert.match(f.el('fmAccountSummary').textContent, /4 199,75/);
    f.handler(async () => { throw new Error('Database unavailable'); }); await f.refresh();
    assert.equal(f.el('fmAccountSummary').textContent, '');
    assert.match(f.el('fmAvailability').textContent, /недоступні/);
    assert.equal(f.el('fmCreateAccount').hidden, true);
    f.handler(async () => ({ available: false, reason: 'Лише ізольоване локальне середовище' })); await f.refresh();
    assert.equal(f.el('fmEditor').hidden, true);
    assert.match(f.el('fmAvailability').textContent, /Лише ізольоване/);
    assert.equal(f.el('fmCreateAccount').hidden, true);
});

test('scope switch during posting hides previous balances immediately and late success cannot alter new scope', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '2';
    let finishPost;
    f.handler(method => method === 'POST' ? new Promise(resolve => { finishPost = resolve; }) : Promise.resolve(workspace()));
    await f.submit();
    f.scope('actor-2/business-B');
    let finishRead;
    f.handler(() => new Promise(resolve => { finishRead = resolve; }));
    const newScope = f.refresh();
    assert.equal(f.el('fmAccountSummary').textContent, '', 'old account balance disappears before new response');
    assert.equal(f.el('fmAccount').options.length, 1);
    assert.equal(f.el('fmPendingBox').hidden, true, 'actor A pending identity is never shown under actor B');
    const other = { ...workspace(), accounts: [{ ...workspace().accounts[0], id: 99, name: 'Other actor account' }] };
    finishRead(other); await newScope;
    f.handler(async () => other);
    finishPost({ success: true }); await settle();
    assert.equal(f.el('fmCommandStatus').textContent, '');
    assert.match(f.el('fmAccount').textContent, /Other actor account/);
    assert.equal(f.el('fmPendingBox').hidden, true);
    f.scope('actor-1/business-A'); f.handler(async () => workspace()); await f.refresh();
    assert.equal(f.el('fmPendingBox').hidden, true, 'confirmed original scope identity is retired');
});

test('unknown POST after actor switch retains retry only in its original actor scope', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '3,33';
    let failPost;
    f.handler(method => method === 'POST' ? new Promise((resolve, reject) => { failPost = reject; }) : Promise.resolve(workspace()));
    await f.submit();
    const original = f.writes()[0].body;
    f.scope('actor-2/business-A'); f.handler(async () => workspace()); await f.refresh();
    failPost(new Error('Lost response')); await settle();
    assert.equal(f.el('fmPendingBox').hidden, true);
    f.scope('actor-1/business-A'); await f.refresh();
    assert.equal(f.el('fmPendingBox').hidden, false);
    f.handler(async method => method === 'POST' ? { success: true, replayed: true } : workspace());
    f.el('fmRetry').click(); await settle();
    assert.deepEqual(f.writes()[1].body, original);
});

test('definitive POST rejection retires original scope identity even after scope switch', async t => {
    const f = await fixture(t);
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '3';
    let failPost;
    f.handler(method => method === 'POST' ? new Promise((resolve, reject) => { failPost = reject; }) : Promise.resolve(workspace()));
    await f.submit();
    f.scope('actor-2/business-B'); f.handler(async () => workspace()); await f.refresh();
    failPost(Object.assign(new Error('Definitively rejected'), { status: 409 })); await settle();
    f.scope('actor-1/business-A'); await f.refresh();
    assert.equal(f.el('fmPendingBox').hidden, true);
    assert.equal(f.writes().length, 1);
});

test('storage failure still preserves pending identity in memory and warns before reload', async t => {
    const f = await fixture(t, { storage: { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } } });
    f.select(); f.change('fmCategory', '21'); f.el('fmAmount').value = '2';
    f.handler(async method => { if (method === 'POST') throw new Error('Network'); return workspace(); });
    await f.submit();
    const event = new f.window.Event('beforeunload', { cancelable: true }); f.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.match(f.el('fmPendingDescription').textContent, /Не закривайте вкладку/);
    f.el('fmRetry').click(); await settle();
    assert.deepEqual(f.writes()[0].body, f.writes()[1].body);
});

test('truncated business shift history remains explicit with both matching and absent account rows', async t => {
    const f = await fixture(t);
    const data = workspace();
    data.hasMoreShifts = true;
    data.shifts = [{ ...data.shifts[0], accountId: 12, id: 32 }];
    f.data(data); await f.refresh();
    f.change('fmAccount', '12');
    assert.match(f.el('fmShifts').textContent, /останню частину змін бізнесу/);
    assert.match(f.el('fmShifts').textContent, /Відкрита зміна/);
    f.change('fmAccount', '11');
    assert.match(f.el('fmShifts').textContent, /У показаній частині історії немає змін цієї каси/);
    assert.doesNotMatch(f.el('fmShifts').textContent, /ще немає/);
    data.hasMoreShifts = false; f.data(data); await f.refresh();
    assert.match(f.el('fmShifts').textContent, /Ручних змін цієї каси ще немає/);
    assert.doesNotMatch(f.el('fmShifts').textContent, /останню частину/);
});
