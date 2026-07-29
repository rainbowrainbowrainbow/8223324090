const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

test('customer and lead cards use the shared entity workspace shell', () => {
    const customersHtml = read('customers.html');
    const leadsHtml = read('leads.html');
    const entityCss = read('css', 'entity-card.css');

    assert.match(customersHtml, /css\/entity-card\.css\?v=/);
    assert.match(leadsHtml, /css\/entity-card\.css\?v=/);
    assert.match(customersHtml, /modal-content modal-medium entity-card-modal/);
    assert.match(leadsHtml, /lead-workspace entity-card-shell entity-card-lead-workspace/);
    assert.match(leadsHtml, /lead-modal entity-card-shell entity-card-shell-edit entity-card-lead-customer/);
    assert.match(entityCss, /\.entity-card-header/);
    assert.match(entityCss, /\.entity-card-actions/);
    assert.match(entityCss, /\.entity-card-shell \.detail-section/);
});

test('customer detail card uses guarded outside-click close instead of generic modal dismissal', () => {
    const customersJs = read('js', 'customers-page.js');

    assert.match(customersJs, /function bindEntityModalSafeClose/);
    assert.match(customersJs, /event\.target !== modal/);
    assert.match(customersJs, /startedOnBackdrop/);
    assert.match(customersJs, /closeCustomerDetailModal/);
    assert.doesNotMatch(customersJs, /Close modals on backdrop click[\s\S]*?else modal\.classList\.add\('hidden'\)/);
});

test('customer detail close is keyboard-native and preserves the guarded close path', () => {
    const customersHtml = read('customers.html');
    const customersJs = read('js', 'customers-page.js');
    const sharedUi = read('js', 'ui.js');
    const customerCss = read('css', 'pages-customers.css');

    assert.match(customersHtml, /<button type="button" class="modal-close" data-customer-detail-close aria-label="[^"]+">&times;<\/button>/);
    assert.doesNotMatch(customersHtml, /id="customerDetailModal"[\s\S]{0,300}<span class="modal-close"/);
    assert.match(customerCss, /\.customer-hero-danger-group \.entity-card-action\.danger/);
    assert.match(customerCss, /body\.dark-mode \.customer-hero-danger-group \.entity-card-action\.danger/);
    assert.match(customerCss, /#customerDetailModal \.entity-card-modal > \.modal-close:focus-visible/);
    assert.match(customersJs, /modal\.querySelector\('\[data-customer-detail-close\]'\)\?\.focus/);
    assert.match(customersJs, /const returnFocus = modal\._customerDetailReturnFocus/);
    assert.match(customersJs, /const restoreFocus = \(\) => \{[\s\S]*returnFocus\.focus\(\{ preventScroll: true \}\)/);
    assert.match(customersJs, /returnFocus\.focus\(\{ preventScroll: true \}\);[\s\S]*modal\.classList\.add\('hidden'\);[\s\S]*requestAnimationFrame\(\(\) => requestAnimationFrame\(restoreFocus\)\)/);
    assert.match(customersJs, /else if \(modal\?\.id === 'customerDetailModal'\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*closeCustomerDetailModal\(\);/);
    assert.match(sharedUi, /control\.hasAttribute\('data-customer-detail-close'\)/);
});

test('customer card layout browser smoke guards computed layout at required widths', () => {
    const smoke = read('tests', 'browser', 'customer-card-layout-browser-smoke.js');
    const customerCss = read('css', 'pages-customers.css');
    const packageJson = JSON.parse(read('package.json'));
    const longValueRule = customerCss.slice(customerCss.indexOf('.customer-hero-contact-summary span,'), customerCss.indexOf('.customer-hero-omni'));

    assert.equal(
        packageJson.scripts['test:browser:customer-card-layout'],
        'npx --yes --package playwright node tests/browser/customer-card-layout-browser-smoke.js'
    );
    assert.match(smoke, /assert\.equal\(metrics\.display, 'grid'/);
    assert.match(smoke, /assert\.equal\(metrics\.headingPosition, 'static'/);
    assert.match(smoke, /headingBackground/);
    assert.match(smoke, /title\.width >= viewport\.minTitleWidth/);
    assert.match(smoke, /documentScrollWidth <= metrics\.viewportWidth/);
    assert.match(smoke, /customer-card-\$\{theme\}-\$\{viewport\.label\}\.png/);
    assert.match(smoke, /const THEMES = Object\.freeze\(\['dark', 'light'\]\)/);
    assert.match(smoke, /contrastRatio\(metrics\.editAction\.color, metrics\.editAction\.background\) >= 4\.5/);
    assert.match(smoke, /CUSTOMER_CARD_LAYOUT_SMOKE_SIMULATE_REGRESSION/);
    for (const width of [1440, 1024, 720, 390]) {
        assert.match(smoke, new RegExp(`width: ${width}`));
    }
    assert.ok(customerCss.includes('button.entity-card-action:not(.danger):not(:disabled):not([aria-disabled="true"])'));
    assert.match(customerCss, /color: #F8FAFC;/);
    assert.match(customerCss, /background: #1E293B;/);
    assert.match(longValueRule, /overflow-wrap: anywhere;/);
    assert.match(longValueRule, /text-wrap: pretty;/);
    assert.doesNotMatch(longValueRule, /overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap/);
    assert.match(smoke, /CUSTOMER_CARD_LAYOUT_SMOKE_CUSTOMER_ID/);
    assert.match(smoke, /blockedMutations/);
});

test('lead customer-card modal keeps explicit close controls and dirty guard path', () => {
    const leadsHtml = read('leads.html');
    const leadsJs = read('js', 'leads-page.js');

    assert.match(leadsHtml, /entity-card-icon-close/);
    assert.match(leadsHtml, /closeCustomerCardModal\(false\)/);
    assert.match(leadsJs, /function isCustomerCardDirty/);
    assert.match(leadsJs, /UnsafeDismissGuard\.attemptCloseEditableSurface\(overlay/);
});
