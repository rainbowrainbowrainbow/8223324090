'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const bookingJsPath = path.join(repoRoot, 'js', 'booking.js');
const indexPath = path.join(repoRoot, 'index.html');
const panelCssPath = path.join(repoRoot, 'css', 'panel.css');
const darkCssPath = path.join(repoRoot, 'css', 'dark-mode.css');
const responsiveCssPath = path.join(repoRoot, 'css', 'responsive.css');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function createElement(tagName, options = {}) {
    const element = {
        tagName: tagName.toUpperCase(),
        id: options.id || '',
        name: options.name || '',
        value: options.value || '',
        checked: Boolean(options.checked),
        hidden: false,
        innerHTML: '',
        textContent: options.textContent || '',
        dataset: options.dataset || {},
        classList: {
            values: new Set(options.classes || []),
            add(...names) { names.forEach(name => this.values.add(name)); },
            remove(...names) { names.forEach(name => this.values.delete(name)); },
            contains(name) { return this.values.has(name); }
        },
        setAttribute(name, value) { this[name] = String(value); },
        removeAttribute(name) { delete this[name]; },
        closest(selector) {
            if (selector === 'input[name="bookingMenuWorkflowMode"]' && this.tagName === 'INPUT' && this.name === 'bookingMenuWorkflowMode') return this;
            return null;
        }
    };
    return element;
}

function createWorkflowHarness() {
    const preorder = createElement('input', { name: 'bookingMenuWorkflowMode', value: 'preorder', checked: true });
    const actual = createElement('input', { name: 'bookingMenuWorkflowMode', value: 'actual' });
    const control = createElement('fieldset', { id: 'bookingMenuWorkflowControl' });
    const hint = createElement('p', { id: 'bookingMenuWorkflowHint' });
    const card = createElement('div', { id: 'bookingMenuWorkflowCard', classes: ['hidden'] });
    const elementsById = new Map([
        ['bookingMenuWorkflowControl', control],
        ['bookingMenuWorkflowHint', hint],
        ['bookingMenuWorkflowCard', card]
    ]);
    const inputs = [preorder, actual];
    const document = {
        getElementById(id) { return elementsById.get(id) || null; },
        querySelectorAll(selector) {
            if (selector === 'input[name="bookingMenuWorkflowMode"]') return inputs;
            return [];
        },
        querySelector(selector) {
            if (selector === 'input[name="bookingMenuWorkflowMode"]:checked') return inputs.find(input => input.checked) || null;
            return null;
        }
    };
    return { document, inputs, preorder, actual, control, hint, card };
}

function loadWorkflowApi(extraSandbox = {}) {
    const source = read(bookingJsPath);
    const start = source.indexOf('const BOOKING_MENU_WORKFLOW_MODES');
    const end = source.indexOf('const BOOKING_SUBMIT_INCOMPLETE_TEXT');
    assert.notEqual(start, -1, 'menu workflow block should exist');
    assert.notEqual(end, -1, 'submit text marker should exist after workflow block');
    const harness = createWorkflowHarness();
    const sandbox = {
        document: harness.document,
        window: { BookingForm: {} },
        BookingPackageState: {
            menuWorkflow: null,
            menuWorkflowTouched: false,
            menuRuleContract: null,
            menuRuleLoadStatus: 'idle',
            menuRuleLoadPromise: null,
            menuRuleError: null
        },
        AppState: { editingBookingId: null },
        API_BASE: '/api',
        formatPrice: value => `${Number(value).toLocaleString('uk-UA')} ₴`,
        escapeHtml: value => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        timelineApiUrl: url => `${url}?businessContext=event_genix`,
        getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
        apiFetchWithAuthRetry: async () => ({
            ok: true,
            json: async () => ({
                success: true,
                rules: {
                    schemaVersion: 1,
                    source: 'price_rules',
                    currency: 'UAH',
                    menuMinimums: {
                        table: { placeLabel: 'Столик', requiredMenuMinimum: 2500, ruleCode: 'banquet_menu_minimum_table' },
                        room: { placeLabel: 'Кімнатка', requiredMenuMinimum: 4000, ruleCode: 'banquet_menu_minimum_room' }
                    },
                    recommendedDeposit: { amount: 2000, ruleCode: 'banquet_recommended_deposit' }
                }
            })
        }),
        fetch: async () => { throw new Error('unexpected fetch fallback'); },
        isBookingKitchenEnabled: () => true,
        bookingMenuPositionsSubtotal: () => 1900,
        renderBookingPackageSummary: () => {},
        updateBookingSubmitState: () => {},
        console: { warn() {} },
        ...extraSandbox
    };
    vm.createContext(sandbox);
    vm.runInContext(`${source.slice(start, end)}\nthis.__api = { normalizeBookingMenuRuleContract, loadBookingMenuRuleContract, setBookingMenuWorkflowMode, collectBookingMenuWorkflowForSubmit, bookingPreorderStatusFromFormData, renderBookingPreorderSummaryWarning, renderBookingMenuWorkflowCard, hydrateBookingMenuWorkflowFromPackage, bookingMenuWorkflowCurrentUserIsCreator, bookingMenuWorkflowFinalizeEndpointUrl };`, sandbox);
    return { ...harness, sandbox, api: sandbox.__api };
}

test('booking drawer exposes explicit preorder and actual menu controls', () => {
    const html = read(indexPath);
    assert.match(html, /id="bookingMenuWorkflowControl"/);
    assert.match(html, /name="bookingMenuWorkflowMode" value="preorder"/);
    assert.match(html, /name="bookingMenuWorkflowMode" value="actual"/);
    assert.match(html, /Передзамовлення/);
    assert.match(html, /Меню по факту/);
    assert.match(html, /id="bookingMenuWorkflowCard"/);
});

test('booking menu workflow styles cover default, dark, mobile, and status card states', () => {
    const panelCss = read(panelCssPath);
    const darkCss = read(darkCssPath);
    const responsiveCss = read(responsiveCssPath);
    assert.match(panelCss, /\.booking-menu-workflow\b/);
    assert.match(panelCss, /\.booking-menu-workflow-option:has\(input:checked\)/);
    assert.match(panelCss, /\.booking-menu-workflow-card__grid/);
    assert.match(panelCss, /\.booking-menu-workflow-finalize\b/);
    assert.match(panelCss, /\.booking-menu-workflow-exception-reason/);
    assert.match(darkCss, /html\[data-theme="dark"\] \.booking-menu-workflow/);
    assert.match(darkCss, /body\.dark-mode \.booking-menu-workflow-card/);
    assert.match(darkCss, /html\[data-theme="dark"\] \.booking-menu-workflow-finalize__preview/);
    assert.match(responsiveCss, /\.booking-menu-workflow-options/);
    assert.match(responsiveCss, /\.booking-menu-workflow-card__grid/);
});

test('booking menu warning logic uses canonical server rules instead of frontend minimum constants', () => {
    const source = read(bookingJsPath);
    const workflowBlock = source.slice(source.indexOf('const BOOKING_MENU_WORKFLOW_MODES'), source.indexOf('const BOOKING_SUBMIT_INCOMPLETE_TEXT'));
    assert.match(workflowBlock, /bookings\/banquet-menu-rules/);
    assert.match(workflowBlock, /loadBookingMenuRuleContract/);
    assert.doesNotMatch(workflowBlock, /BANQUET_PREORDER_MENU_MINIMUMS/);
    assert.doesNotMatch(workflowBlock, /BANQUET_PREORDER_RECOMMENDED_DEPOSIT/);
});

test('preorder below minimum keeps menu and deposit warnings separate', async () => {
    const { api, sandbox } = loadWorkflowApi();
    await api.loadBookingMenuRuleContract({ force: true });
    const status = api.bookingPreorderStatusFromFormData({
        kitchenEnabled: true,
        room: 'Столик 4',
        positionsSubtotal: 1900,
        deposit: { provided: false },
        menuWorkflow: { mode: 'preorder' }
    });
    assert.equal(status.requiredMenuMinimum, 2500);
    assert.equal(status.missingMenuAmount, 600);
    assert.equal(status.menuStatus, 'below_minimum');
    assert.equal(JSON.stringify(status.warnings.map(warning => warning.code)), JSON.stringify(['banquet_menu_minimum_below', 'banquet_deposit_missing']));

    const warningHtml = api.renderBookingPreorderSummaryWarning(status);
    assert.match(warningHtml, /booking-preorder-warning--menu/);
    assert.match(warningHtml, /booking-preorder-warning--deposit/);
    assert.match(warningHtml, /2\s?500|2&nbsp;500/);
    assert.equal(sandbox.BookingPackageState.menuRuleContract.menuMinimums.table.requiredMenuMinimum, 2500);
});

test('actual awaiting mode suppresses menu save modal warning but keeps deposit warning and status card', async () => {
    const { api, card } = loadWorkflowApi();
    await api.loadBookingMenuRuleContract({ force: true });
    api.setBookingMenuWorkflowMode('actual', { touched: true });
    const workflow = api.collectBookingMenuWorkflowForSubmit({ kitchenEnabled: true });
    assert.equal(JSON.stringify(workflow), JSON.stringify({ mode: 'actual', status: 'awaiting_actual' }));
    assert.equal(Object.prototype.hasOwnProperty.call(workflow, 'selectedBy'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(workflow, 'selectedAt'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(workflow, 'minimumSnapshot'), false);

    const status = api.bookingPreorderStatusFromFormData({
        kitchenEnabled: true,
        room: 'Столик 4',
        positionsSubtotal: 1900,
        deposit: { provided: false },
        menuWorkflow: workflow
    });
    assert.equal(status.actualAwaiting, true);
    assert.equal(JSON.stringify(status.warnings.map(warning => warning.code)), JSON.stringify(['banquet_deposit_missing']));
    assert.equal(JSON.stringify(status.menuWarnings.map(warning => warning.code)), JSON.stringify(['banquet_menu_minimum_below']));

    api.renderBookingMenuWorkflowCard(status);
    assert.equal(card.hidden, false);
    assert.equal(card.classList.contains('hidden'), false);
    assert.match(card.innerHTML, /Меню по факту · очікує закриття/);
    assert.match(card.innerHTML, /Minimum snapshot/);
    assert.match(card.innerHTML, /Поточне орієнтовне меню/);
    assert.match(card.innerHTML, /Різниця до мінімуму/);
    assert.match(card.innerHTML, /Попередня сума/);
    assert.doesNotMatch(card.innerHTML, /Фінальна сума/);
});

test('actual awaiting status card exposes finalize action and creator-only exception UI', async () => {
    const { api, card, sandbox } = loadWorkflowApi({
        getUserRoles: () => ['manager', 'creator']
    });
    sandbox.AppState.editingBookingId = 42;
    sandbox.AppState.currentUser = { id: 1, username: 'owner', role: 'creator' };
    await api.loadBookingMenuRuleContract({ force: true });
    const status = api.bookingPreorderStatusFromFormData({
        kitchenEnabled: true,
        room: 'Столик 4',
        positionsSubtotal: 1900,
        menuWorkflow: { mode: 'actual', status: 'awaiting_actual', minimumSnapshot: { minimumAmount: 2500 } }
    });

    assert.equal(api.bookingMenuWorkflowCurrentUserIsCreator(), true);
    assert.equal(api.bookingMenuWorkflowFinalizeEndpointUrl(42), '/api/bookings/42/menu-workflow/finalize?businessContext=event_genix');
    api.renderBookingMenuWorkflowCard(status);

    assert.match(card.innerHTML, /id="bookingMenuWorkflowFinalizeBtn"/);
    assert.match(card.innerHTML, /Закрити меню по факту/);
    assert.match(card.innerHTML, /id="bookingMenuWorkflowExceptionToggle"/);
    assert.match(card.innerHTML, /id="bookingMenuWorkflowExceptionReason"/);
    assert.match(card.innerHTML, /до нарахування/);
});

test('actual workflow hydrates after reopen but legacy bookings remain compatible preorder until touched', () => {
    const { api, sandbox, preorder, actual } = loadWorkflowApi();
    api.hydrateBookingMenuWorkflowFromPackage({
        extraData: {
            bookingPackage: {
                menuWorkflow: {
                    mode: 'actual',
                    status: 'awaiting_actual',
                    selectedAt: '2026-07-22T12:00:00.000Z',
                    selectedBy: { id: '7', username: 'manager' },
                    minimumSnapshot: { minimumAmount: 2500 }
                }
            }
        }
    });
    assert.equal(actual.checked, true);
    assert.equal(preorder.checked, false);
    assert.equal(JSON.stringify(api.collectBookingMenuWorkflowForSubmit({ kitchenEnabled: true })), JSON.stringify({ mode: 'actual', status: 'awaiting_actual' }));

    sandbox.AppState.editingBookingId = 'booking-legacy';
    api.hydrateBookingMenuWorkflowFromPackage({ extraData: { bookingPackage: {} } });
    assert.equal(preorder.checked, true);
    assert.equal(actual.checked, false);
    assert.equal(api.collectBookingMenuWorkflowForSubmit({ kitchenEnabled: true }), null);

    api.setBookingMenuWorkflowMode('actual', { touched: true });
    assert.equal(JSON.stringify(api.collectBookingMenuWorkflowForSubmit({ kitchenEnabled: true })), JSON.stringify({ mode: 'actual', status: 'awaiting_actual' }));
});

test('booking payload serializes menuWorkflow without server-owned audit fields', () => {
    const source = read(bookingJsPath);
    assert.match(source, /menuWorkflow: kitchenEnabled \? collectBookingMenuWorkflowForSubmit\(\{ kitchenEnabled \}\) : null/);
    assert.match(source, /obj\.menuWorkflow = \{ \.\.\.formData\.menuWorkflow \};/);
    assert.match(source, /obj\.extraData\.bookingPackage\.menuWorkflow = \{ \.\.\.formData\.menuWorkflow \};/);
    assert.doesNotMatch(source, /collectBookingMenuWorkflowForSubmit[\s\S]{0,900}selectedBy/);
    assert.doesNotMatch(source, /collectBookingMenuWorkflowForSubmit[\s\S]{0,900}selectedAt/);
    assert.match(source, /bookings\/\$\{encodeURIComponent\(bookingId\)\}\/menu-workflow\/finalize/);
    assert.match(source, /actualMenuPositions: formData\.menuPositions/);
    assert.match(source, /allowBelowMinimumException/);
    assert.match(source, /exceptionReason/);
});
