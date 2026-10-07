'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-page.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'hr.html'), 'utf8');

function functionSource(name) {
    let start = code.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (code.slice(start - 6, start) === 'async ') start -= 6;
    const next = /\n(?:async )?function /.exec(code.slice(start + 1));
    return code.slice(start, start + 1 + next.index);
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

const account = (overrides = {}) => ({ id: 101, staff_id: 1, username: 'qa.worker', role: 'animator', is_active: true, can_mutate: true, ...overrides });

function harness() {
    const section = html.match(/<section id="staffAccountAccess"[\s\S]+?<\/section>/)?.[0];
    assert.ok(section, 'production account section exists');
    const dom = new JSDOM(`<div id="staffEditModal" style="display:block"><input id="editStaffId" value="1">${section}</div>`, { runScripts: 'outside-only' });
    const w = dom.window;
    const state = { context: 'owner:business:session', calls: [], rows: [account()], forms: [], notifications: [], credentials: [], copied: [], denied: false };
    w.AppState = { currentUser: { id: 9, role: 'director' } };
    w.ACCOUNT_SECURITY_ROLES = ['creator', 'director'];
    w.canAccess = () => !state.denied && ['creator', 'director'].includes(w.AppState.currentUser.role);
    w.staffEditOpenSeq = 1;
    w.staffProfileContextKey = state.context;
    w.accountUsers = [];
    w.teamAccessContext = () => state.context;
    w.escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    w.showNotification = (...args) => state.notifications.push(args);
    w.showOneTimeCredentialModal = credential => state.credentials.push(credential);
    w.showManualPasswordResetResult = response => state.credentials.push(response);
    w.loadAccountCenter = async () => { throw new Error('staff card must not load the account center'); };
    w.validateAccountManualPassword = () => null;
    w.formModal = async (_title, fields) => {
        state.forms.push(fields);
        return state.formResult === undefined ? { mode: 'issue', activateOnReset: 'keep' } : state.formResult;
    };
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async value => state.copied.push(value) } });
    w.crmApiFetch = async (url, options) => {
        state.calls.push({ url, options });
        if (state.fetch) return state.fetch(url, options);
        if (url === '/api/users') return state.rows;
        return { success: true, isActive: false, credential: { username: 'qa.worker', password: 'Synthetic234' } };
    };
    const source = ['canManageAccountSecurity', 'currentAccountCanMutateTarget', 'activeEditStaffId', 'isActiveStaffEditLoad', 'openAccountPasswordModal'].map(functionSource).join('\n');
    const accountSource = code.slice(code.indexOf('let staffAccountLoadRequestSeq ='), code.indexOf('function accountCredentialPassword('));
    vm.runInContext(`${source}\n${accountSource}`, dom.getInternalVMContext());
    return { w, state, root: () => w.document.getElementById('staffAccountAccessContent'), section: () => w.document.getElementById('staffAccountAccess'), close: () => w.close() };
}

test('staff account section makes no account request for non-managers or denied directors', async () => {
    const h = harness();
    try {
        for (const role of ['hr', 'animator', 'admin']) {
            h.w.AppState.currentUser.role = role;
            await h.w.loadStaffAccountAccess(1);
            assert.equal(h.section().hidden, true);
        }
        h.w.AppState.currentUser.role = 'director';
        h.state.denied = true;
        await h.w.loadStaffAccountAccess(1);
        assert.equal(h.section().hidden, true);
        assert.equal(h.state.calls.length, 0);
        assert.equal(h.root().textContent, '');
    } finally { h.close(); }
});

test('creator/director cards show only linked logins, status and allowed reset actions', async () => {
    const h = harness();
    try {
        h.state.rows = [account({ username: '<img src=x onerror=alert(1)>', is_active: false }), account({ id: 102, staff_id: 2, username: 'foreign.worker' }), account({ id: 103, username: 'protected.worker', protected_account: true })];
        for (const role of ['creator', 'director']) {
            h.w.AppState.currentUser.role = role;
            await h.w.loadStaffAccountAccess(1);
            assert.equal(h.section().hidden, false);
            assert.match(h.root().textContent, /деактивовано/);
            assert.doesNotMatch(h.root().textContent, /foreign.worker/);
            assert.equal(h.root().querySelector('img'), null);
            const buttons = h.root().querySelectorAll('button[onclick^="openStaffAccountPasswordModal"]');
            assert.equal(buttons.length, 2);
            assert.equal(buttons[0].disabled, false);
            assert.equal(buttons[1].disabled, true);
        }
        await h.w.copyStaffAccountLogin(101);
        assert.equal(h.state.copied[0], '<img src=x onerror=alert(1)>');
        await h.w.openStaffAccountPasswordModal(103);
        assert.equal(h.state.forms.length, 0);
    } finally { h.close(); }
});

test('fresh staff lookup rejects older card and session responses and can recover from failures', async () => {
    const h = harness();
    try {
        const old = deferred();
        h.state.fetch = () => old.promise;
        const pending = h.w.loadStaffAccountAccess(1);
        h.w.document.getElementById('editStaffId').value = '2';
        h.w.staffEditOpenSeq += 1;
        h.state.fetch = async () => [account({ staff_id: 2, username: 'current.worker' })];
        await h.w.loadStaffAccountAccess(2);
        old.resolve([account({ username: 'stale.worker' })]);
        assert.equal((await pending).stale, true);
        assert.match(h.root().textContent, /current.worker/);
        assert.doesNotMatch(h.root().textContent, /stale.worker/);
        const oldSession = deferred();
        h.state.fetch = () => oldSession.promise;
        const sessionPending = h.w.loadStaffAccountAccess(2);
        h.state.context = 'different-session';
        oldSession.resolve([account({ staff_id: 2, username: 'old.session' })]);
        assert.equal((await sessionPending).stale, true);
        assert.doesNotMatch(h.root().textContent, /old.session/);
        h.w.staffProfileContextKey = h.state.context;
        h.state.fetch = async () => { throw new Error('offline'); };
        await h.w.loadStaffAccountAccess(2);
        assert.ok(h.root().querySelector('[role="alert"]'));
        assert.equal(h.root().getAttribute('aria-busy'), 'false');
        h.state.fetch = async () => [];
        await h.w.loadStaffAccountAccess(2);
        assert.match(h.root().textContent, /не привʼязано/);
    } finally { h.close(); }
});

test('reset reuses canonical API, displays new credential once and keeps inactive accounts disabled', async () => {
    const h = harness();
    try {
        h.state.rows = [account({ is_active: false })];
        await h.w.loadStaffAccountAccess(1);
        await h.w.openStaffAccountPasswordModal(101);
        assert.equal(h.state.forms[0].find(field => field.key === 'activateOnReset').defaultValue, 'keep');
        const reset = h.state.calls.find(call => call.url.endsWith('/reset-password'));
        assert.equal(reset.url, '/api/users/101/reset-password');
        assert.equal(reset.options.body.issueOneTime, true);
        assert.equal(reset.options.body.activateOnReset, false);
        assert.equal(h.state.credentials.length, 1);
        assert.doesNotMatch(h.root().textContent, /Synthetic234/);
        assert.equal(h.state.calls.filter(call => call.url === '/api/users').length, 2);
        h.state.formResult = null;
        await h.w.openStaffAccountPasswordModal(101);
        assert.equal(h.state.calls.filter(call => call.url.endsWith('/reset-password')).length, 1);
    } finally { h.close(); }
});

test('stale form cannot reset another card and stale response cannot expose a credential', async () => {
    const h = harness();
    try {
        await h.w.loadStaffAccountAccess(1);
        const form = deferred();
        h.w.formModal = () => form.promise;
        const pending = h.w.openStaffAccountPasswordModal(101);
        h.w.staffEditOpenSeq += 1;
        form.resolve({ mode: 'issue' });
        await pending;
        assert.equal(h.state.calls.filter(call => call.url.endsWith('/reset-password')).length, 0);
        h.w.formModal = async () => ({ mode: 'issue' });
        const response = deferred();
        h.state.fetch = () => response.promise;
        const resetting = h.w.openStaffAccountPasswordModal(101);
        await Promise.resolve();
        h.state.context = 'different-session';
        response.resolve({ success: true, credential: { password: 'Synthetic234' } });
        await resetting;
        assert.equal(h.state.credentials.length, 0);
    } finally { h.close(); }
});

test('failed reset restores the action and does not emit or persist credentials', async () => {
    const h = harness();
    try {
        await h.w.loadStaffAccountAccess(1);
        const button = h.root().querySelector('button[onclick^="openStaffAccountPasswordModal"]');
        h.state.fetch = async () => { throw new Error('offline'); };
        await h.w.openStaffAccountPasswordModal(101, button);
        assert.equal(button.disabled, false);
        assert.equal(h.state.credentials.length, 0);
        assert.match(h.state.notifications.at(-1)[0], /Не вдалося змінити пароль/);
    } finally { h.close(); }
});
