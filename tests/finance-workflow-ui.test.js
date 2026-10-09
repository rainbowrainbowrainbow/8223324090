'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js/finance-page.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

// Complete real page/controller, with bootstrap suppressed and only external
// auth, confirmation and transport seams stubbed. No network or database calls.
function fixture(t) {
    const dom = new JSDOM(html, {
        url: 'http://localhost/finance', runScripts: 'outside-only', virtualConsole: new VirtualConsole()
    });
    t.after(() => dom.window.close());
    const window = dom.window;
    const document = window.document;
    const originalAdd = document.addEventListener.bind(document);
    document.addEventListener = (name, listener, options) => {
        if (name !== 'DOMContentLoaded') originalAdd(name, listener, options);
    };
    window.setTimeout = () => 0;
    window.clearTimeout = () => {};
    let business = 'synthetic-business-a';
    let scope = null;
    let permission = true;
    let transport = async () => { throw new Error('Unexpected synthetic API request'); };
    let budget = async () => { throw new Error('Unexpected synthetic budget request'); };
    let confirm = async () => true;
    const requests = [];
    window.AppState = { currentUser: { id: 1 } };
    window.getCrmBusinessContext = () => business;
    window.getCrmBusinessScope = () => scope;
    window.canAccessPage = () => true;
    window.canUseAction = action => action === 'finance.manage' && permission;
    window.getAuthHeaders = () => ({});
    window.handleAuthError = () => false;
    window.confirmModal = (...args) => confirm(...args);
    window.apiGetBudgetComparison = (...args) => budget(...args);
    window.apiFetchWithAuthRetry = (url, options) => {
        const request = { url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, business };
        requests.push(request);
        return transport(request);
    };
    const context = dom.getInternalVMContext();
    vm.runInContext(source, context, { filename: 'js/finance-page.js' });
    const state = vm.runInContext('FinState', context);
    state.categories = [
        { id: 1, name: 'Rent A', type: 'expense', icon: '🏠', color: '#6366f1', isSystem: false },
        { id: 2, name: 'Supplies B', type: 'expense', icon: '🛒', color: '#6366f1', isSystem: false },
        { id: 9, name: 'Booking system', type: 'income', icon: '🎉', color: '#6366f1', isSystem: true }
    ];
    window.refreshCategorySelectors();
    return {
        window, document, state, requests,
        el: id => document.getElementById(id),
        transport: handler => { transport = handler; },
        budget: handler => { budget = handler; },
        confirm: handler => { confirm = handler; },
        business: value => { business = value; },
        scope: value => { scope = value; },
        permission: value => { permission = value; }
    };
}

test('inline category creation selects the result without losing the transaction or unrelated choices', async t => {
    const f = fixture(t);
    f.window.openTransModal();
    f.el('editType').value = 'expense';
    f.window.updateCategoryOptions('expense', '1');
    f.el('editAmount').value = '4321';
    f.el('editDate').value = '2026-10-07';
    f.el('editDescription').value = 'Keep this transaction draft';
    f.el('editPayment').value = 'card';
    f.el('budgetCategorySelect').value = '2';
    f.el('budgetAmountInput').value = '777';
    f.el('categoryFilter').value = '1';
    f.window.openCategoryModal('editCategory');
    f.el('financeCategoryName').value = 'New supplies';
    f.transport(async request => response({ id: 3, ...request.body, isSystem: false }, 201));
    await f.window.saveFinanceCategory();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, 'POST');
    assert.equal(f.requests[0].body.type, 'expense');
    assert.equal(f.el('editCategory').value, '3');
    for (const [id, value] of Object.entries({ editAmount: '4321', editDate: '2026-10-07', editDescription: 'Keep this transaction draft', editPayment: 'card', budgetCategorySelect: '2', budgetAmountInput: '777', categoryFilter: '1' })) {
        assert.equal(f.el(id).value, value, `${id} draft survives inline create`);
    }
    assert.ok(f.el('financeCategoryModal').classList.contains('hidden'));
    assert.ok(!f.el('transEditModal').classList.contains('hidden'));
});

test('archiving a selected category never substitutes another budget category or transaction label', async t => {
    const f = fixture(t);
    f.state.transactions = [{ id: 5, type: 'expense', categoryId: 1, categoryName: 'Rent A', amount: 1200, date: '2026-10-07', paymentMethod: 'cash', description: 'Original expense' }];
    f.window.openTransModal(5);
    f.el('editCategory').value = '2';
    f.el('budgetCategorySelect').value = '2';
    f.el('budgetAmountInput').value = '777';
    f.el('categoryFilter').value = '2';
    f.window.openCategoryModal('editCategory');
    f.window.populateCategoryEditor('2');
    f.transport(async () => response({ success: true }));
    await f.window.archiveFinanceCategory();
    assert.equal(f.requests[0].method, 'DELETE');
    assert.equal(f.state.categories.some(category => category.id === 2), false);
    assert.notEqual(f.el('budgetCategorySelect').value, '1', 'must not silently move the same amount to Rent A');
    assert.equal(f.el('budgetAmountInput').value, '777');
    if (f.el('editCategory').value === '2') {
        assert.match(f.el('editCategory').selectedOptions[0].textContent, /Supplies B/);
        assert.doesNotMatch(f.el('editCategory').selectedOptions[0].textContent, /Rent A/);
    } else {
        assert.equal(f.el('editCategory').value, '', 'an unavailable new category must be explicitly unselected');
    }
    assert.equal(f.el('editAmount').value, '1200');
    assert.equal(f.el('editDescription').value, 'Original expense');
    assert.equal(f.el('categoryFilter').value, '2', 'archive keeps the existing report filter visible');
});

test('busy category save locks every field, prevents duplicate writes and restores disabled states after failure', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.window.populateCategoryEditor('9');
    const fields = [...f.document.querySelectorAll('#financeCategoryForm button, #financeCategoryForm input, #financeCategoryForm select')];
    const original = fields.map(control => control.disabled);
    f.el('financeCategoryColor').value = '#112233';
    const pending = deferred();
    f.transport(() => pending.promise);
    f.el('saveFinanceCategoryBtn').focus();
    const saving = f.window.saveFinanceCategory();
    assert.ok(fields.every(control => control.disabled));
    // Browsers may drop focus to body when the focused save button is disabled.
    f.document.body.tabIndex = -1;
    f.document.body.focus();
    await f.window.saveFinanceCategory();
    assert.equal(f.requests.length, 1);
    assert.equal(await f.window.closeCategoryModal(), false);
    pending.resolve(response({ error: 'Synthetic save failed' }, 500));
    await saving;
    assert.deepEqual(fields.map(control => control.disabled), original);
    assert.equal(f.document.activeElement, f.el('saveFinanceCategoryBtn'), 'failed save restores keyboard access to the editor');
    assert.equal(f.el('financeCategoryColor').value, '#112233');
    assert.ok(!f.el('financeCategoryModal').classList.contains('hidden'));
    assert.ok(!f.el('financeCategoryError').hidden);
    assert.match(f.el('financeCategoryError').textContent, /Synthetic save failed/);
});

test('an existing transaction retains its original archived category across selector refreshes', t => {
    const f = fixture(t);
    f.state.transactions = [{ id: 7, type: 'expense', categoryId: 70, categoryName: 'Archived historical category', amount: 100, date: '2026-10-07', paymentMethod: 'cash' }];
    f.window.openTransModal(7);
    assert.equal(f.el('editCategory').value, '70');
    assert.match(f.el('editCategory').selectedOptions[0].textContent, /Archived historical category/);
    f.window.refreshCategorySelectors();
    assert.equal(f.el('editCategory').value, '70');
    assert.match(f.el('editCategory').selectedOptions[0].textContent, /Archived historical category/);
    assert.equal([...f.el('editCategory').options].filter(option => option.value === '70').length, 1);
});

test('failed category create preserves its draft and reports the API error', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.el('financeCategoryName').value = 'Keep unsaved name';
    f.el('financeCategoryIcon').value = '🛒';
    f.transport(async () => response({ error: 'Synthetic validation error' }, 400));
    await f.window.saveFinanceCategory();
    assert.equal(f.state.categories.length, 3);
    assert.equal(f.el('financeCategoryName').value, 'Keep unsaved name');
    assert.equal(f.el('financeCategoryIcon').value, '🛒');
    assert.equal(f.el('financeCategoryError').textContent, 'Synthetic validation error');
    assert.ok(!f.el('financeCategoryModal').classList.contains('hidden'));
});

test('finance.manage denial blocks save and archive even when an editor was already opened', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.window.populateCategoryEditor('1');
    f.permission(false);
    await f.window.saveFinanceCategory();
    await f.window.archiveFinanceCategory();
    assert.equal(f.requests.length, 0);
    await f.window.closeCategoryModal(true);
    f.window.openCategoryModal();
    assert.ok(f.el('financeCategoryModal').classList.contains('hidden'));
});

test('system categories permit appearance updates without renaming or archiving', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.window.populateCategoryEditor('9');
    assert.ok(f.el('financeCategoryName').disabled);
    assert.ok(f.el('archiveFinanceCategoryBtn').hidden);
    await f.window.archiveFinanceCategory();
    assert.equal(f.requests.length, 0);
    f.el('financeCategoryColor').value = '#abcdef';
    f.transport(async () => response({ success: true }));
    await f.window.saveFinanceCategory();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, 'PUT');
    assert.equal(Object.hasOwn(f.requests[0].body, 'name'), false);
    assert.equal(f.state.categories.find(category => category.id === 9).name, 'Booking system');
    assert.equal(f.state.categories.find(category => category.id === 9).color, '#abcdef');
});

test('late category reads and creates cannot overwrite another business state', async t => {
    const f = fixture(t);
    const read = deferred();
    f.transport(() => read.promise);
    const reading = f.window.fetchCategories();
    f.business('synthetic-business-b');
    f.state.categories = [{ id: 40, name: 'Business B category', type: 'expense' }];
    read.resolve(response([{ id: 20, name: 'Business A stale', type: 'expense' }]));
    await reading;
    assert.equal(f.state.categories[0].id, 40);
    f.window.refreshCategorySelectors();
    f.window.openCategoryModal();
    f.el('financeCategoryName').value = 'Late create';
    const write = deferred();
    f.transport(() => write.promise);
    const saving = f.window.saveFinanceCategory();
    f.business('synthetic-business-c');
    f.state.categories = [{ id: 60, name: 'Business C category', type: 'expense' }];
    write.resolve(response({ id: 50, name: 'Late create', type: 'expense' }, 201));
    await saving;
    assert.equal(f.state.categories.length, 1);
    assert.equal(f.state.categories[0].id, 60);
    assert.match(f.el('financeCategoryError').textContent, /Бізнес.*змінився/);
});

test('archive checks business and permissions again after confirmation before sending DELETE', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.window.populateCategoryEditor('1');
    const confirmation = deferred();
    f.confirm(() => confirmation.promise);
    const archiving = f.window.archiveFinanceCategory();
    f.business('synthetic-business-b');
    confirmation.resolve(true);
    await archiving;
    assert.equal(f.requests.length, 0);

    f.window.openCategoryModal();
    f.window.populateCategoryEditor('1');
    const secondConfirmation = deferred();
    f.confirm(() => secondConfirmation.promise);
    const second = f.window.archiveFinanceCategory();
    f.permission(false);
    secondConfirmation.resolve(true);
    await second;
    assert.equal(f.requests.length, 0);
});

test('a late archive response cannot replace the categories of another business', async t => {
    const f = fixture(t);
    f.window.openCategoryModal();
    f.window.populateCategoryEditor('1');
    const pending = deferred();
    f.transport(() => pending.promise);
    const archiving = f.window.archiveFinanceCategory();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 1);
    f.business('synthetic-business-b');
    const nextBusinessCategories = [{ id: 40, name: 'Business B category', type: 'expense' }];
    f.state.categories = nextBusinessCategories;
    pending.resolve(response({ success: true }));
    await archiving;
    assert.equal(f.state.categories, nextBusinessCategories);
    assert.match(f.el('financeCategoryError').textContent, /Бізнес.*змінився/);
});

test('budget distinguishes unplanned spending, zero plans and unavailable percentages; errors clear old amounts', async t => {
    const f = fixture(t);
    f.budget(async () => ({
        totals: { incomeActual: 0, incomePlanned: 0, expenseActual: 12345, expensePlanned: 0, profitActual: -12345, profitPlanned: 0 },
        comparison: [
            { categoryName: 'Unplanned supplies', categoryType: 'expense', hasPlan: false, planned: null, actual: 12000, diff: 12000, percentUsed: null },
            { categoryName: 'Explicit zero plan', categoryType: 'expense', hasPlan: true, planned: 0, actual: 345, diff: 345, percentUsed: null }
        ]
    }));
    await f.window.loadBudgetComparison();
    const rows = [...f.el('budgetComparison').querySelectorAll('tbody tr')];
    assert.match(rows[0].cells[0].textContent, /Поза планом/);
    assert.equal(rows[0].cells[1].textContent, '—');
    assert.equal(rows[0].cells[4].textContent, '—');
    assert.equal(rows[1].cells[1].textContent, f.window.formatMoney(0));
    assert.equal(rows[1].cells[4].textContent, '—');
    f.budget(async () => { throw new Error('Synthetic budget outage'); });
    await f.window.loadBudgetComparison();
    assert.ok(f.el('budgetComparison').querySelector('[role="alert"]'));
    assert.equal(f.el('budgetComparison').querySelector('table'), null);
    assert.doesNotMatch(f.el('budgetComparison').textContent, /Unplanned supplies|12.?345/);
});

test('debt summary uses full result totals and exposes truncation; an API failure clears stale records', async t => {
    const f = fixture(t);
    f.transport(async () => response({
        count: 101, totalDebt: 98765, hasMore: true,
        debts: [{ bookingId: 'SYNTHETIC-1', date: '2026-10-07', label: 'Visible debt sample', price: 1000, paidAmount: 100, debtAmount: 900 }]
    }));
    await f.window.loadDebts();
    const panel = f.el('debtsContent');
    assert.equal(panel.querySelector('.fin-stat-value').textContent, f.window.formatMoney(98765));
    assert.match(panel.querySelector('[role="status"]').textContent, /Показано 1 із 101/);
    assert.equal(panel.querySelectorAll('tbody tr').length, 1);
    f.transport(async () => response({ error: 'Synthetic debt outage' }, 503));
    await f.window.loadDebts();
    assert.ok(panel.querySelector('[role="alert"]'));
    assert.equal(panel.querySelector('table'), null);
    assert.doesNotMatch(panel.textContent, /Visible debt sample|98.?765/);
});

function overviewResponse(request, income) {
    if (request.url.startsWith('/api/finance/dashboard')) return { totals: { income, expense: 0, profit: income } };
    if (request.url.startsWith('/api/analytics/overview')) return { finance: { income, expense: 0, profit: income }, bookings: { total: 1, revenue: income } };
    if (request.url.startsWith('/api/analytics/charts')) return { dailyFinance: [], weekdayLoad: [], customerSegments: {} };
    if (request.url.startsWith('/api/analytics/deals-lifecycle')) return { accepted: 1, closed: 0, trend: [] };
    return {};
}

test('slower previous overview cannot overwrite the latest period; failure clears all previous totals', async t => {
    const f = fixture(t);
    f.state.mode = 'overview';
    const old = [];
    f.transport(request => {
        const pending = deferred();
        old.push({ request, pending });
        return pending.promise;
    });
    const previous = f.window.fetchUnifiedOverview();
    assert.equal(old.length, 5);
    f.transport(async request => response(overviewResponse(request, 22222)));
    await f.window.fetchUnifiedOverview();
    assert.equal(f.state.analyticsOverview.finance.income, 22222);
    for (const item of old) item.pending.resolve(response(overviewResponse(item.request, 11111)));
    await previous;
    assert.equal(f.state.analyticsOverview.finance.income, 22222);
    assert.equal(f.el('faExecutiveZone').querySelector('.fa-exec-value').textContent, f.window.formatMoney(22222));
    f.transport(async () => response({ error: 'Synthetic analytics outage' }, 503));
    await f.window.fetchUnifiedOverview();
    for (const key of ['dashboard', 'analyticsOverview', 'analyticsCharts', 'comparison', 'dealsLifecycle']) assert.equal(f.state[key], null);
    assert.equal(f.el('faExecutiveZone').querySelector('.fa-exec-value'), null);
    assert.ok(f.el('faWorkspace').querySelector('[role="alert"]'));
    assert.doesNotMatch(f.el('faExecutiveZone').textContent, /22.?222|0 ₴/);
});

test('an overview response is discarded when selected businesses change without changing the active business', async t => {
    const f = fixture(t);
    f.state.mode = 'overview';
    f.scope({ mode: 'selected', selectedContexts: ['synthetic-business-a', 'synthetic-business-b'] });
    const pending = [];
    f.transport(request => {
        const result = deferred();
        pending.push({ request, result });
        return result.promise;
    });
    const loading = f.window.fetchUnifiedOverview();
    f.scope({ mode: 'selected', selectedContexts: ['synthetic-business-a', 'synthetic-business-c'] });
    for (const item of pending) item.result.resolve(response(overviewResponse(item.request, 11111)));
    await loading;
    assert.equal(f.state.analyticsOverview, null);
    assert.equal(f.state.unifiedLoaded, false);
    assert.equal(f.el('faExecutiveZone').querySelector('.fa-exec-value'), null);
    f.transport(async request => response(overviewResponse(request, 33333)));
    await f.window.fetchUnifiedOverview();
    assert.equal(f.state.analyticsOverview.finance.income, 33333);
});

test('business category invalidation clears old active and archived options before loading the new business', async t => {
    const f = fixture(t);
    f.window.openTransModal();
    f.el('editType').value = 'expense'; f.window.updateCategoryOptions('expense', '1');
    f.el('editAmount').value = '777';
    f.el('budgetCategorySelect').value = '2'; f.el('categoryFilter').value = '1';
    f.window.openCategoryModal('editCategory'); f.el('financeCategoryName').value = 'Unsaved category draft';
    const pending = deferred(); f.transport(() => pending.promise);
    f.business('synthetic-business-b');
    f.window.dispatchEvent(new f.window.Event('crmBusinessContextChanged'));
    assert.equal(f.state.categories.length, 0);
    for (const id of ['editCategory', 'budgetCategorySelect', 'categoryFilter']) {
        assert.equal(f.el(id).value, '');
        assert.ok(!f.el(id).textContent.includes('Rent A'));
        assert.ok(!f.el(id).textContent.includes('Supplies B'));
        assert.ok(!f.el(id).textContent.includes('архівна'));
    }
    assert.equal(f.el('editAmount').value, '777', 'unrelated transaction draft survives');
    assert.equal(f.el('financeCategoryName').value, 'Unsaved category draft');
    assert.match(f.el('financeCategoryError').textContent, /змінився/);
    pending.resolve(response([{ id: 31, name: 'Business B category', type: 'expense', icon: '📁' }]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.categories[0].id, 31);
    assert.ok(f.el('editCategory').textContent.includes('Business B category'));
    assert.equal(f.el('editCategory').value, '');
    await f.window.saveFinanceCategory();
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 0, 'old editor cannot save under new business');
});

test('actor changes reject late category saves and old selections even in the same business', async t => {
    const f = fixture(t);
    f.window.openCategoryModal(); f.el('financeCategoryName').value = 'Actor A draft';
    const pending = deferred();
    f.transport(request => request.method === 'POST' ? pending.promise : Promise.resolve(response([{ id: 77, name: 'Actor B category', type: 'expense', icon: '📁' }])));
    const save = f.window.saveFinanceCategory();
    f.window.AppState.currentUser = { id: 2 };
    f.window.dispatchEvent(new f.window.Event('permissions:lifecycle'));
    await new Promise(resolve => setImmediate(resolve));
    pending.resolve(response({ id: 42, name: 'Actor A draft', type: 'expense', icon: '📁' }, 201));
    await save;
    assert.deepEqual(Array.from(f.state.categories, category => category.id), [77]);
    assert.equal(f.el('financeCategoryName').value, 'Actor A draft');
    assert.match(f.el('financeCategoryError').textContent, /користувач/);
});

test('reused account editor rejects a draft submitted in a different business or by another actor', async t => {
    for (const change of ['business', 'actor']) {
        const f = fixture(t);
        f.window.openAddAccountModal(); f.el('accName').value = 'Original account draft';
        if (change === 'business') f.business('synthetic-business-b'); else f.window.AppState.currentUser = { id: 2 };
        await f.window.saveAccount();
        assert.equal(f.requests.length, 0);
        assert.equal(f.el('accName').value, 'Original account draft');
        assert.ok(!f.el('addAccountModal').classList.contains('hidden'));
        assert.match(f.document.getElementById('toastContainer').textContent, /Бізнес або користувач змінився/);
    }
});

test('account editor locks a single request and preserves fields and disabled state after an error', async t => {
    const f = fixture(t);
    f.window.openAddAccountModal(); f.el('accName').value = 'Retry account'; f.el('accDescription').value = 'Keep notes';
    const saveButton = f.el('addAccountModal').querySelector('[onclick="saveAccount()"]');
    saveButton.focus();
    f.el('accType').disabled = true;
    const pending = deferred(); f.transport(() => pending.promise);
    const save = f.window.saveAccount();
    await f.window.saveAccount();
    assert.equal(f.requests.length, 1);
    assert.equal(f.el('accName').disabled, true);
    assert.equal(saveButton.disabled, true);
    assert.equal(await f.window.closeAddAccountModal(true), false);
    pending.resolve(response({ error: 'Rejected synthetic account' }, 400)); await save;
    assert.equal(f.el('accName').value, 'Retry account');
    assert.equal(f.el('accDescription').value, 'Keep notes');
    assert.equal(f.el('accName').disabled, false);
    assert.equal(f.el('accType').disabled, true);
    assert.equal(saveButton.disabled, false);
    assert.ok(!f.el('addAccountModal').classList.contains('hidden'));
});

test('late account creation success leaves the prior draft intact and does not refresh another business', async t => {
    const f = fixture(t);
    f.window.openAddAccountModal(); f.el('accName').value = 'Prior business account';
    const pending = deferred(); f.transport(() => pending.promise);
    const save = f.window.saveAccount();
    f.business('synthetic-business-b');
    pending.resolve(response({ success: true, account: { id: 42 } })); await save;
    assert.equal(f.requests.length, 1, 'no accounts refresh in the new business from an old success');
    assert.equal(f.el('accName').value, 'Prior business account');
    assert.ok(!f.el('addAccountModal').classList.contains('hidden'));
    assert.match(f.el('toastContainer').textContent, /попереднього бізнесу/);
});

test('confirmed account creation closes its editor and refreshes accounts only after save unlocks', async t => {
    const f = fixture(t);
    f.window.openAddAccountModal(); f.el('accName').value = 'New cash till'; f.el('accEmoji').value = '💼';
    f.transport(request => Promise.resolve(response(request.method === 'POST'
        ? { success: true, account: { id: 42 } }
        : { accounts: [{ id: 42, name: 'New cash till', emoji: '💼', type: 'cash' }] })));
    await f.window.saveAccount();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
    assert.equal(f.requests[0].body.emoji, '💼');
    assert.ok(f.el('addAccountModal').classList.contains('hidden'));
    assert.ok(f.el('accountsList').textContent.includes('New cash till'));
    assert.equal(f.el('accName').disabled, false);
});

test('inline selection reuses a category without a metadata write and preserves the budget draft', async t => {
    const f = fixture(t);
    f.el('budgetCategorySelect').value = '1';
    f.el('budgetAmountInput').value = '987';
    f.window.openCategoryModal('budgetCategorySelect');
    f.window.populateCategoryEditor('2');
    await f.window.useFinanceCategory();
    assert.equal(f.el('budgetCategorySelect').value, '2');
    assert.equal(f.el('budgetAmountInput').value, '987');
    assert.equal(f.requests.length, 0);
    assert.ok(f.el('financeCategoryModal').classList.contains('hidden'));
});

test('duplicate category offers the existing selection and cannot apply after business changes during confirmation', async t => {
    const f = fixture(t);
    f.el('budgetCategorySelect').value = '2';
    f.window.openCategoryModal('budgetCategorySelect');
    f.el('financeCategoryName').value = ' rent a ';
    await f.window.saveFinanceCategory();
    assert.equal(f.requests.length, 0);
    assert.equal(f.el('useFinanceCategoryBtn').hidden, false);
    const confirmation = deferred();
    f.confirm(() => confirmation.promise);
    const using = f.window.useFinanceCategory();
    f.business('synthetic-business-b');
    confirmation.resolve(true);
    await using;
    assert.equal(f.el('budgetCategorySelect').value, '2');
});

test('account metadata edit keeps type and sends only supported metadata fields', async t => {
    const f = fixture(t);
    const account = { id: 42, name: 'Till A', type: 'cash', emoji: '🧾', description: 'Original' };
    f.transport(async request => response(request.method === 'GET'
        ? { accounts: [account] } : { success: true, account: { ...account, ...request.body } }));
    await f.window.loadAccounts();
    f.window.openEditAccountModal(42);
    assert.equal(f.el('accEmoji').value, '🧾', 'legacy custom emoji survives');
    assert.equal(f.el('accType').disabled, true);
    f.el('accName').value = 'Till B';
    f.el('accDescription').value = 'Updated';
    await f.window.saveAccount();
    const write = f.requests.find(request => request.method === 'PATCH');
    assert.equal(write.url, '/api/finance/accounts/42');
    assert.deepEqual(write.body, { name: 'Till B', emoji: '🧾', description: 'Updated' });
    f.window.openAddAccountModal();
    assert.equal(f.el('accType').disabled, false);
});

test('late accounts reads cannot render data belonging to another business or actor', async t => {
    for (const change of ['business', 'actor']) {
        const f = fixture(t);
        const pending = deferred(); f.transport(() => pending.promise);
        const loading = f.window.loadAccounts();
        if (change === 'business') f.business('synthetic-business-b'); else f.window.AppState.currentUser = { id: 2 };
        pending.resolve(response({ accounts: [{ id: 1, name: 'Prior scope private account', type: 'cash' }] }));
        await loading;
        assert.doesNotMatch(f.el('accountsList').textContent, /Prior scope/);
    }
});

test('account actions use the current permission and recheck context after archive confirmation', async t => {
    const f = fixture(t);
    f.transport(async () => response({ accounts: [{ id: 42, name: 'Till A', type: 'cash' }] }));
    await f.window.loadAccounts();
    const confirmation = deferred(); f.confirm(() => confirmation.promise);
    const archiving = f.window.toggleAccount(42, false);
    f.business('synthetic-business-b');
    confirmation.resolve(true); await archiving;
    assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 0);
    f.permission(false);
    await f.window.loadAccounts();
    assert.equal(f.el('accountsList').querySelectorAll('button').length, 0);
    assert.equal(f.el('addFinanceAccountBtn').hidden, true);
    await f.window.toggleAccount(42, false);
    f.window.openEditAccountModal(42);
    assert.ok(f.el('addAccountModal').classList.contains('hidden'));
    assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 0);
});

test('account archive reports an unconfirmed response as failure instead of removing the account', async t => {
    const f = fixture(t);
    f.transport(async request => response(request.method === 'GET'
        ? { accounts: [{ id: 42, name: 'Till A', type: 'cash' }] } : { success: false }));
    await f.window.loadAccounts();
    await f.window.toggleAccount(42, false);
    assert.match(f.el('accountsList').textContent, /Till A/);
    assert.equal(f.requests.filter(request => request.method === 'GET').length, 1);
    assert.doesNotMatch(f.el('toastContainer').textContent, /Рахунок деактивовано/);
    assert.match(f.el('toastContainer').textContent, /не підтвердив/);
});

test('account edit response cannot close or refresh another business after a successful metadata save', async t => {
    const f = fixture(t);
    f.transport(async () => response({ accounts: [{ id: 42, name: 'Till A', type: 'cash' }] }));
    await f.window.loadAccounts();
    f.window.openEditAccountModal(42);
    f.el('accName').value = 'Unsaved new name';
    const pending = deferred(); f.transport(() => pending.promise);
    const saving = f.window.saveAccount();
    f.window.AppState.currentUser = { id: 2 };
    pending.resolve(response({ success: true, account: { id: 42 } }));
    await saving;
    assert.equal(f.requests.length, 2, 'no reload after stale metadata response');
    assert.equal(f.el('accName').value, 'Unsaved new name');
    assert.ok(!f.el('addAccountModal').classList.contains('hidden'));
});

test('account archive sends only one pending write and keeps a failed refresh visibly unavailable', async t => {
    const f = fixture(t);
    f.transport(async () => response({ accounts: [{ id: 42, name: 'Till A', type: 'cash' }] }));
    await f.window.loadAccounts();
    const pending = deferred();
    f.transport(request => request.method === 'PATCH' ? pending.promise : Promise.resolve(response({ error: 'Unavailable' }, 503)));
    const archiving = f.window.toggleAccount(42, false);
    await new Promise(resolve => setImmediate(resolve));
    await f.window.toggleAccount(42, false);
    assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 1);
    pending.resolve(response({ success: true, account: { id: 42, is_active: false } }));
    await archiving;
    assert.ok(f.el('accountsList').querySelector('[role="alert"]'));
    assert.doesNotMatch(f.el('accountsList').textContent, /Рахунків ще немає/);
});

test('permission lifecycle invalidates pending account reads even when actor and business are unchanged', async t => {
    const f = fixture(t);
    const pending = deferred(); f.transport(() => pending.promise);
    const loading = f.window.loadAccounts();
    f.permission(false);
    f.window.dispatchEvent(new f.window.Event('permissions:lifecycle'));
    pending.resolve(response({ accounts: [{ id: 42, name: 'Stale permission snapshot', type: 'cash' }] }));
    await loading;
    assert.doesNotMatch(f.el('accountsList').textContent, /Stale permission snapshot/);
    assert.equal(f.el('addFinanceAccountBtn').hidden, true);
});
