'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../js/finance-money.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
    const dom = new JSDOM('<div id="host"></div>', { runScripts: 'outside-only', url: 'https://crm.example/finance' });
    t.after(() => dom.window.close());
    const { window } = dom;
    const qa = { runId: 'finance-run-a', actorId: 47, businessContext: 'event_genix', expiresAt: new Date(Date.now() + 600000).toISOString() };
    window.FINANCE_QA_CONTEXT = { ...qa };
    window.eval(source);
    let responseQa = { ...qa };
    let handler = async () => { throw new Error('Response lost'); };
    const writes = [];
    const response = () => ({ success: true, qa: responseQa, accounts: [{ id: 1, name: 'QA cash', type: 'cash', eligible: true, enrolled: false }], operations: [], shifts: [] });
    const options = {
        container: window.document.getElementById('host'), canManage: true, getBusinessKey: () => '47/event_genix',
        onCreateAccount() {},
        apiRequest: async (method, url, body) => {
            if (method === 'GET') return response();
            writes.push(JSON.parse(JSON.stringify(body)));
            return handler(body);
        }
    };
    let mounted = window.FinanceMoneyWorkspace.mount(options);
    await mounted.ready;
    const el = id => window.document.getElementById(id);
    const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new window.Event('change')); };
    return {
        window, qa, el, writes, change,
        responseQa(value) { responseQa = value; }, handler(value) { handler = value; },
        refresh: () => mounted.refresh(),
        async remount() { mounted.destroy(); mounted = window.FinanceMoneyWorkspace.mount(options); await mounted.ready; },
        async submit() {
            change('fmAccount', '1'); change('fmAction', 'enroll');
            el('fmAmount').value = '10'; el('fmReason').value = 'QA opening';
            el('fmForm').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle();
        }
    };
}

test('QA editor requires coherent server-confirmed run, actor, business and expiry', async t => {
    const f = await fixture(t);
    assert.equal(f.el('fmCreateAccount').hidden, false);
    assert.match(f.el('fmQaNotice').textContent, /Тестовий режим: лише записи/);
    for (const mismatch of [{ runId: 'other' }, { actorId: 48 }, { businessContext: 'dar' }, { expiresAt: new Date(Date.now() + 900000).toISOString() }]) {
        f.responseQa({ ...f.qa, ...mismatch });
        await f.refresh();
        assert.equal(f.el('fmCreateAccount').hidden, true);
        assert.equal(f.el('fmEditor').hidden, true);
        assert.match(f.el('fmLoadStatus').textContent, /контекст не збігається/);
    }
    f.responseQa(null); await f.refresh();
    assert.equal(f.el('fmCreateAccount').hidden, true, 'public marker cannot enable ordinary workspace');
    assert.equal(f.writes.length, 0);
});

test('pending QA command survives reload within run but cannot cross into the next run', async t => {
    const f = await fixture(t);
    await f.submit();
    const original = f.writes[0];
    await f.remount();
    assert.equal(f.el('fmPendingBox').hidden, false);
    f.window.FINANCE_QA_CONTEXT = { ...f.qa, runId: 'finance-run-b' };
    f.responseQa({ ...f.qa, runId: 'finance-run-b' });
    await f.refresh();
    assert.equal(f.el('fmPendingBox').hidden, true);
    assert.equal(f.writes.length, 1, 'no automatic retry on run change');
    f.window.FINANCE_QA_CONTEXT = { ...f.qa };
    f.responseQa({ ...f.qa });
    await f.refresh();
    f.handler(async () => ({ success: true, replayed: true }));
    f.el('fmRetry').click(); await settle();
    assert.deepEqual(f.writes[1], original);
    assert.equal(f.el('fmPendingBox').hidden, true);
    const stored = f.window.sessionStorage.getItem('finance.manualMoney.pending.v1');
    assert.doesNotMatch(stored, /token|password|Authorization/i);
});

test('expired QA context blocks retry without retiring the unresolved command', async t => {
    const f = await fixture(t);
    await f.submit();
    f.window.Date.now = () => Date.parse(f.qa.expiresAt) + 1;
    f.el('fmRetry').click(); await settle();
    assert.equal(f.writes.length, 1);
    await f.refresh();
    assert.equal(f.el('fmPendingBox').hidden, false);
    assert.equal(f.el('fmRetry').disabled, true);
    assert.equal(f.el('fmCreateAccount').hidden, true);
});

test('access rejection after an unknown outcome preserves the command for an exact retry', async t => {
    const f = await fixture(t);
    await f.submit();
    const original = f.writes[0];
    for (const status of [403, 401]) {
        f.handler(async () => { throw Object.assign(new Error('Access unavailable'), { status }); });
        f.el('fmRetry').click(); await settle();
        assert.deepEqual(f.writes.at(-1), original);
        assert.equal(f.el('fmPendingBox').hidden, false);
        assert.match(f.el('fmRetryError').textContent, /результат невідомий; ключ збережено/);
        assert.match(f.el('fmRetryError').textContent, /Відновіть доступ/);
        await f.remount();
        assert.equal(f.el('fmPendingBox').hidden, false, 'reload must retain unresolved financial identity');
    }
    f.handler(async () => ({ success: true, replayed: true }));
    f.el('fmRetry').click(); await settle();
    assert.deepEqual(f.writes.at(-1), original);
    assert.equal(f.el('fmPendingBox').hidden, true);
});

test('late workspace response cannot confirm a different public QA run', async t => {
    const f = await fixture(t);
    f.window.FINANCE_QA_CONTEXT = { ...f.qa, runId: 'finance-run-b' };
    await f.refresh();
    assert.equal(f.el('fmCreateAccount').hidden, true);
    assert.match(f.el('fmQaNotice').textContent, /не підтверджено/);
    f.responseQa({ ...f.qa, runId: 'finance-run-b' });
    await f.refresh();
    assert.equal(f.el('fmCreateAccount').hidden, false);
});
