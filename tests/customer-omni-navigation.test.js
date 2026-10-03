'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { buildCustomerOmniNavigation, getCustomerOmniSummaries } = require('../services/customerCommunicationHub');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes/customers.js'), 'utf8');
function block(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}

function ui(t) {
    const dom = new JSDOM(`<table><tbody id="customerTableBody"></tbody></table>
        <input id="editInstagram" value="@family_instagram"><input id="editPhone" value="+380000000001">
        <textarea id="editSocialIdentities"></textarea><div id="customerDetailModal" class="hidden">
        <button data-customer-detail-close>Закрити</button><div id="customerDetailContent"></div></div>`, { runScripts: 'outside-only', url: 'https://crm.test/customers' });
    t.after(() => dom.window.close());
    const context = dom.getInternalVMContext();
    const opened = [];
    Object.assign(context, {
        URL, CrmBusinessContext: { normalize: value => value },
        customerBusinessContext: () => 'dar',
        customerBusinessScope: () => ({ mode: 'single', activeContext: 'dar' }),
        escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
        customerPipelineStageMeta: () => ({ label: 'Новий', cls: 'new' }),
        pickCustomerHeaderBooking: () => null, customerHeaderBookingDetails: () => ({ title: 'Бронювань немає', meta: 'Історія порожня', muted: true }), customerInitials: () => 'TC',
        canManageCustomerActions: () => false, canViewCustomerRevenue: () => false,
        isMaysternyaCustomerContext: () => false,
        syncCustomerPresentationUi() {}, renderCustomerExplainability() {}, renderCustomerFilterControls() {},
        getCustomerSourceBadgeKey: () => 'instagram', getCustomerSourceLabel: () => 'Instagram',
        renderCustomerTagPill: () => '', customerChildrenInlineLabel: () => '',
        formatDate: () => '—', formatDateOnly: value => value || '—', formatDateTime: () => '—', formatMoney: value => String(value),
        leadCrmLinkForCustomer: id => '/sales-funnel?lead=' + id,
        showCustomerDetail: id => opened.push(id),
        applyCustomerReadOnlyControls() {}, renderCustomerChildrenSection: () => '',
        loadCommunicationHub() {}, loadCommunications: async () => [],
        CrmState: { customers: [] },
        fetch: () => { throw new Error('Rendering rows must not request the full communication hub'); }
    });
    vm.runInContext(block(page, 'function customerHubText(', 'function leadCrmLinkForCustomer(')
        + block(page, 'function customerContextualizeHref(', 'function getCustomerDeepLinkId(')
        + block(page, 'function renderCustomerTable(', 'function renderPagination('), context);
    return { dom, context, opened };
}

const customer = { id: 101, businessContext: 'dar', name: 'Test family', instagram: 'family_instagram', totalBookings: 0 };
const conversation = { id: 501, channel: 'instagram', status: 'closed', isPrimary: true };

test('one confirmed Instagram conversation stays direct after adding a phone and preserves context', t => {
    const h = ui(t);
    for (const phone of [null, '+380000000001']) {
        const record = { ...customer, phone };
        const navigation = buildCustomerOmniNavigation(record, [conversation]);
        const target = h.context.customerHeaderOmniTarget(record, navigation);
        assert.equal(target.cls, 'exact');
        assert.equal(new URL(target.href, 'https://crm.test').searchParams.get('conversation'), '501');
        assert.equal(new URL(target.href, 'https://crm.test').searchParams.get('businessContext'), 'dar');
        assert.equal(new URL(target.href, 'https://crm.test').searchParams.has('search'), false);
    }
});

test('multiple confirmed dialogs require selection and deduplicate ids without adopting a lead primary', t => {
    const h = ui(t);
    const navigation = buildCustomerOmniNavigation(customer, [conversation, { ...conversation }, { id: 502, channel: 'whatsapp', status: 'open' }]);
    assert.equal(navigation.action, 'choose');
    assert.equal(navigation.links.omniExact, null);
    assert.equal(navigation.exactConversationCount, 2);
    const host = h.dom.window.document.createElement('div');
    host.innerHTML = h.context.renderCustomerOmniNavigation(customer, navigation);
    assert.ok(host.querySelector('details > summary'));
    assert.match(host.textContent, /Обрати діалог \(2\)/);
    assert.match(host.textContent, /закритий/);
    assert.deepEqual([...host.querySelectorAll('a')].map(link => new URL(link.href).searchParams.get('conversation')), ['501', '502']);
    assert.ok([...host.querySelectorAll('a')].every(link => new URL(link.href).searchParams.get('businessContext') === 'dar'));
});

test('suggestions never become a confirmed shortcut and a default-business link overrides current dar context', t => {
    const h = ui(t);
    const record = { ...customer, businessContext: 'event_genix', phone: '+380000000001' };
    const navigation = buildCustomerOmniNavigation(record, []);
    navigation.links.omniSuggested = '/omni?conversation=999&businessContext=dar';
    const target = h.context.customerHeaderOmniTarget(record, navigation);
    const href = new URL(target.href, 'https://crm.test');
    assert.equal(target.cls, 'search');
    assert.equal(href.searchParams.has('conversation'), false);
    assert.equal(href.searchParams.get('businessContext'), 'event_genix');
    assert.equal(href.searchParams.get('search'), record.phone);
});

test('list renders batch shortcuts and interactive links do not also open the customer card', t => {
    const h = ui(t);
    h.context.CrmState.customers = [{ ...customer, omniNavigation: buildCustomerOmniNavigation(customer, [conversation]) }];
    h.context.renderCustomerTable();
    const doc = h.dom.window.document;
    assert.ok(doc.querySelector('[data-label="Контакти"]'));
    doc.addEventListener('click', event => event.preventDefault());
    const link = doc.querySelector('a[href*="conversation="]');
    link.click();
    link.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(h.opened, []);
    doc.querySelector('tr').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(h.opened, [101]);
});

test('hero provides one Omni action while the hub presents context without repeating it', t => {
    const h = ui(t);
    const navigation = buildCustomerOmniNavigation(customer, [conversation]);
    const context = { links: navigation.links, live: { status: 'exact', exactConversations: [{ ...conversation, confidence: 'exact' }], suggestedConversations: [] } };
    const host = h.dom.window.document.createElement('div');
    host.innerHTML = h.context.renderCustomerDetailHero(customer, context) + h.context.renderCustomerCommunicationHub(context);
    assert.equal(host.querySelectorAll('a[href*="/omni"]').length, 1);
});

test('WhatsApp survives normalization and Telegram quick-add does not borrow the Instagram handle', t => {
    const h = ui(t);
    h.context.addCustomerIdentityLine('telegram');
    assert.equal(h.dom.window.document.getElementById('editSocialIdentities').value.trim(), 'telegram:');
    h.context.addCustomerIdentityLine('whatsapp');
    const entered = h.context.parseSocialIdentitiesInput(h.dom.window.document.getElementById('editSocialIdentities').value);
    const server = vm.createContext({});
    vm.runInContext(block(route, 'function cleanText(', 'function formatSocialIdentities('), server);
    const saved = server.normalizeSocialIdentities(entered, { instagram: 'family_instagram' });
    assert.ok(saved.some(identity => identity.channel === 'whatsapp' && identity.handle === '+380000000001'));
    assert.equal(saved.some(identity => identity.channel === 'telegram'), false);
    const display = h.context.renderSocialIdentities(saved, '@family_instagram');
    assert.match(display, /WhatsApp/);
    assert.equal(display.match(/Instagram/g).length, 1);
});

test('100 customer summaries use one lightweight read, omit messages, and remain separate per customer', async () => {
    const customers = Array.from({ length: 100 }, (_, index) => ({ ...customer, id: 101 + index }));
    const queries = [];
    const summaries = await getCustomerOmniSummaries(customers, { pool: { async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [{ navigation_customer_id: 101, ...conversation }, { navigation_customer_id: 102, id: 502, channel: 'telegram', status: 'open' }] };
    } } });
    assert.equal(queries.length, 1);
    assert.equal(queries[0].params[0].length, 100);
    assert.doesNotMatch(queries[0].sql, /conversation_messages|communication_log|is_primary|is_origin/);
    assert.match(queries[0].sql, /customer_link.business_context = lcl.business_context/);
    assert.match(queries[0].sql, /COALESCE\(c.business_context/);
    assert.match(queries[0].sql, /c.customer_id IS NULL/);
    assert.equal(summaries.get(101).conversations[0].id, 501);
    assert.equal(summaries.get(102).conversations[0].id, 502);
    assert.equal(summaries.get(103).action, 'search');
    assert.equal(Object.hasOwn(summaries.get(101).conversations[0], 'lastMessage'), false);
});

test('summary errors remain errors rather than claiming there are no confirmed conversations', async () => {
    await assert.rejects(() => getCustomerOmniSummaries([customer], { pool: { async query() { throw new Error('Lookup failed'); } } }), /Lookup failed/);
});

for (const scenario of ['older-success', 'older-error', 'scope-change', 'late-journal']) {
    test('customer card ignores ' + scenario + ' so links and notes remain attached to the visible customer', async t => {
        const h = ui(t);
        vm.runInContext(block(page, 'let customerDetailRequestSeq =', 'function closeCustomerDetailModal('), h.context);
        const records = new Map();
        const journals = new Map();
        const applied = [];
        h.context.fetchCustomerDetail = id => new Promise((resolve, reject) => records.set(id, { resolve, reject }));
        h.context.fetchCustomerCommunicationContext = async id => ({ links: { omniExact: `/omni?conversation=${id}&businessContext=dar` } });
        h.context.loadCommunicationHub = id => applied.push(id);
        h.context.loadCommunications = id => new Promise(resolve => journals.set(id, resolve));
        const record = id => ({ ...customer, id, name: 'Customer ' + id, bookings: [], tags: [], certificates: [] });
        const a = h.context.showCustomerDetail(101);
        if (scenario === 'late-journal') {
            records.get(101).resolve(record(101));
            await a;
        }
        if (scenario === 'scope-change') h.context.customerBusinessScope = () => ({ mode: 'single', activeContext: 'event_genix' });
        const b = h.context.showCustomerDetail(102);
        records.get(102).resolve(record(102));
        await b;
        journals.get(102)([{ summary: 'Customer B note', type: 'note' }]);
        if (scenario === 'older-error') records.get(101).reject(new Error('Old failure'));
        else if (scenario === 'late-journal') journals.get(101)([{ summary: 'Customer A note', type: 'note' }]);
        else records.get(101).resolve(record(101));
        await a;
        await new Promise(resolve => setImmediate(resolve));
        const content = h.dom.window.document.getElementById('customerDetailContent');
        assert.match(content.textContent, /Customer 102/);
        assert.match(content.textContent, /Customer B note/);
        assert.doesNotMatch(content.textContent, /Customer A note|Помилка завантаження/);
        assert.equal(content.querySelector('a[href*="conversation="]').getAttribute('href'), '/omni?conversation=102&businessContext=dar');
        assert.deepEqual(applied, scenario === 'late-journal' ? [101,102] : [102]);
    });
}

test('unavailable batch metadata offers an explicitly unverified search', t => {
    const h = ui(t);
    const html = h.context.renderCustomerOmniNavigation(customer, { action: 'unavailable', links: {} });
    assert.match(html, /зв’язки не перевірено/);
    assert.doesNotMatch(html, /conversation=/);
});
