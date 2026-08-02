'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'routes', 'center.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'js', 'center-page.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'center.html'), 'utf8');

test('Center backend guards financial-only reads and settings-backed price mutations', () => {
    assert.match(route, /installRevenueResponseShaper/);
    assert.match(route, /canUseAction\(req\.user, 'view_revenue'\)/);
    assert.match(route, /router\.get\('\/prices', requireCenterRevenue/);
    assert.match(route, /router\.get\('\/goals', requireCenterRevenue/);
    assert.match(route, /router\.get\('\/reconciliation', requireCenterRevenue/);
    assert.match(route, /router\.put\('\/prices\/:code', requireMinRole\('senior_manager'\), requireCenterSettings, requireCenterRevenue/);
    assert.match(route, /router\.post\('\/tickets\/:code\/tariffs', requireMinRole\('senior_manager'\), requireCenterSettings, requireCenterRevenue/);
    assert.match(route, /router\.get\('\/tickets', allowPublicCatalogRevenueResponse/);
    assert.match(route, /router\.get\('\/event-log', shapeCenterReadOnlyRevenueText/);
    const operationsStart = route.indexOf("router.get('/operations/today'");
    const operationsEnd = route.indexOf("router.get('/reconciliation'", operationsStart);
    const operationsRoute = route.slice(operationsStart, operationsEnd);
    assert.ok(operationsStart >= 0 && operationsEnd > operationsStart);
    assert.match(operationsRoute, /'professionKey', hssr\.profession_key/);
});

test('Center frontend fails closed and does not load financial-only sections', () => {
    assert.match(page, /let canViewCenterRevenue = false;/);
    assert.match(page, /let canManageCenterSettings = false;/);
    assert.match(page, /canAccess\('view_revenue'\)/);
    assert.match(page, /canAccess\('manage_settings'\)/);
    assert.match(page, /CENTER_FINANCIAL_ONLY_SECTIONS = new Set/);
    assert.match(page, /if \(!canViewCenterRevenue && CENTER_FINANCIAL_ONLY_SECTIONS\.has\(sectionId\)\) return null;/);
    assert.match(page, /section\.hidden = !canViewCenterRevenue/);
    assert.match(page, /if \(!canViewCenterRevenue\) return '\\u2014';/);
});

test('Center mixed operational views remove financial fragments without fake zero labels', () => {
    assert.match(page, /function scrubCenterFinancialFragments\(\)/);
    for (const selector of [
        '.briefing-day-count',
        '.addon-row-revenue',
        '.client-card .revenue',
        '.client-booking-price'
    ]) assert.ok(page.includes(selector), selector);
    const scrubStart = page.indexOf('function scrubCenterFinancialFragments');
    const scrubEnd = page.indexOf('const centerSectionState', scrubStart);
    assert.doesNotMatch(page.slice(scrubStart, scrubEnd), /\.catalog-card-price/);
    assert.match(page, /const performanceTable = document\.querySelector\('#perfContent table'\)/);
    assert.match(page, /canViewCenterRevenue && rev \? ` \| \$\{formatPrice\(rev\.revenue\)\}` : ''/);
    assert.match(page, /const paymentLabel = canViewCenterRevenue \?/);
    assert.match(page, /paymentLabel \? opsBadge\(paymentLabel, paymentTone\) : ''/);
    assert.match(page, /\$\{renderOpsSummaryTile\('Оплати'/);
    assert.match(route, /const bookingRevenueState = new Map\(\);/);
    assert.match(route, /pendingPayments: pendingPayments\.length/);
    assert.match(route, /canViewRevenue \? `Борг \$\{booking\.debtAmount\} грн` : 'Є непогашений залишок'/);
});

test('Admission tariff editing requires both settings and revenue capability', () => {
    assert.match(page, /canEditAdmissionTicketTariffs = canViewCenterRevenue\s*&& canManageCenterSettings/);
    const scrubStart = page.indexOf('function scrubCenterFinancialFragments');
    const scrubEnd = page.indexOf('const centerSectionState', scrubStart);
    assert.doesNotMatch(page.slice(scrubStart, scrubEnd), /ticket-tariff-cell > strong/);
    assert.doesNotMatch(page, /value\.textContent = 'Приховано'/);
});
test('Center public catalog price stays visible without revenue access', () => {
    const formatStart = page.indexOf('function formatPrice');
    const formatEnd = page.indexOf('\nfunction formatDateShort', formatStart);
    const scrubStart = page.indexOf('function scrubCenterFinancialFragments');
    const scrubEnd = page.indexOf('const centerSectionState', scrubStart);
    const catalogStart = page.indexOf('function renderCatalog');
    const catalogEnd = page.indexOf('\nfunction filterCatalog', catalogStart);
    assert.ok(formatStart >= 0 && formatEnd > formatStart);
    assert.ok(scrubStart >= 0 && scrubEnd > scrubStart);
    assert.ok(catalogStart >= 0 && catalogEnd > catalogStart);

    const dom = new JSDOM('<!doctype html><body><div id="catalogTabs"></div><div id="catalogContent"></div></body>', {
        runScripts: 'outside-only',
        url: 'https://crm.test/center'
    });
    const context = dom.getInternalVMContext();
    vm.runInContext(`
        let canViewCenterRevenue = false;
        let catalogProducts = [];
        let catalogFilter = 'all';
        ${page.slice(formatStart, formatEnd)}
        ${page.slice(scrubStart, scrubEnd)}
        ${page.slice(catalogStart, catalogEnd)}
        this.__catalogRevenueHooks = { formatPrice, formatCatalogPrice, renderCatalog, scrubCenterFinancialFragments };
    `, context, { filename: 'js/center-page.js' });

    const hooks = context.__catalogRevenueHooks;
    hooks.renderCatalog([{
        name: 'Public kids program',
        category: 'animation',
        price: 1250,
        isPerChild: true
    }]);
    hooks.scrubCenterFinancialFragments();

    assert.equal(hooks.formatPrice(1250), '\u2014', 'financial formatter remains capability-gated');
    assert.equal(hooks.formatCatalogPrice(1250).replace(/\s+/g, ' '), '1 250 ₴');
    const price = dom.window.document.querySelector('.catalog-card-price');
    assert.ok(price, 'public catalog price is not scrubbed');
    assert.equal(price.textContent.replace(/\s+/g, ' '), '1 250 ₴/дит');
    dom.window.close();
});

test('Center denied loyalty view keeps operational tier data without undefined financial labels', async () => {
    const formatStart = page.indexOf('function formatPrice');
    const formatEnd = page.indexOf('\nfunction formatDateShort', formatStart);
    const syncStart = page.indexOf('function syncCenterRevenueUi');
    const syncEnd = page.indexOf('\nfunction scrubCenterFinancialFragments', syncStart);
    const loyaltyStart = page.indexOf('function renderLoyaltyTiers');
    const loyaltyEnd = page.indexOf('\nasync function recalculateLoyalty', loyaltyStart);
    const recalculateStart = loyaltyEnd + 1;
    const recalculateEnd = page.indexOf('\n// ==========================================', recalculateStart);
    assert.ok(syncStart >= 0 && syncEnd > syncStart);
    assert.ok(loyaltyStart >= 0 && loyaltyEnd > loyaltyStart);
    assert.ok(recalculateStart > 0 && recalculateEnd > recalculateStart);

    const dom = new JSDOM(`<!doctype html><body>
        <section class="center-section" id="loyaltySection">
            <button data-revenue-action="recalculate-loyalty">Recalculate</button>
            <div id="loyaltyTiersGrid"></div>
            <div id="loyaltyStats"></div>
        </section>
    </body>`, { runScripts: 'outside-only', url: 'https://crm.test/center' });
    const context = dom.getInternalVMContext();
    vm.runInContext(`
        let canViewCenterRevenue = false;
        const CENTER_FINANCIAL_ONLY_SECTIONS = new Set([]);
        let recalculateCalls = 0;
        ${page.slice(formatStart, formatEnd)}
        ${page.slice(syncStart, syncEnd)}
        ${page.slice(loyaltyStart, loyaltyEnd)}
        async function apiRecalculateLoyalty() { recalculateCalls += 1; return { success: true, updated: 1 }; }
        function showNotification() {}
        function loadLoyalty() {}
        ${page.slice(recalculateStart, recalculateEnd)}
        this.__loyaltyRevenueHooks = {
            syncCenterRevenueUi,
            renderLoyaltyTiers,
            recalculateLoyalty,
            recalculateCalls: () => recalculateCalls
        };
    `, context, { filename: 'js/center-page.js' });

    const hooks = context.__loyaltyRevenueHooks;
    hooks.syncCenterRevenueUi();
    hooks.renderLoyaltyTiers([{
        name: 'Silver',
        color: '#777777',
        min_bookings: 3
    }], { Silver: 4 });
    await hooks.recalculateLoyalty();

    const tier = dom.window.document.querySelector('.loyalty-tier-card');
    assert.ok(tier);
    assert.match(tier.textContent, /Silver/);
    assert.match(tier.textContent, /від 3 броней/);
    assert.match(tier.textContent, /4 клієнтів/);
    assert.doesNotMatch(tier.textContent, /undefined/);
    assert.equal(tier.querySelector('.loyalty-tier-discount'), null);
    assert.equal(dom.window.document.querySelector('[data-revenue-action="recalculate-loyalty"]').hidden, true);
    assert.equal(hooks.recalculateCalls(), 0);
    assert.match(html, /data-revenue-action="recalculate-loyalty"[^>]*hidden/);
    dom.window.close();
});
