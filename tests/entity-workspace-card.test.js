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

test('lead customer-card modal keeps explicit close controls and dirty guard path', () => {
    const leadsHtml = read('leads.html');
    const leadsJs = read('js', 'leads-page.js');

    assert.match(leadsHtml, /entity-card-icon-close/);
    assert.match(leadsHtml, /closeCustomerCardModal\(false\)/);
    assert.match(leadsJs, /function isCustomerCardDirty/);
    assert.match(leadsJs, /UnsafeDismissGuard\.attemptCloseEditableSurface\(overlay/);
});
