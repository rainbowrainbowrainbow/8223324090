'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function routeSource(name) {
    return fs.readFileSync(path.join(ROOT, 'routes', name), 'utf8');
}

test('print and graduation settings mutations require manage_settings', () => {
    const print = routeSource('print.js');
    const graduation = routeSource('graduation.js');

    assert.match(print, /const \{ authenticateToken, canUseAction, requireAction \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(print, /installRevenueResponseShaper\([\s\S]*canUseAction\(req\.user, 'view_revenue'\)/);
    assert.match(print, /router\.post\('\/templates', requireAction\('manage_settings'\), async/);
    assert.match(print, /router\.put\('\/templates\/:id', requireAction\('manage_settings'\), async/);

    assert.match(print, /router\.get\('\/templates', async/);
    assert.match(print, /router\.post\('\/preflight', async/);
    assert.match(
        print,
        /router\.post\('\/jobs', requirePlainPrintJobData, loadPrintJobTemplate, requirePrintJobRevenue, shapePrintJobRevenue, async/
    );
    assert.doesNotMatch(print, /router\.get\('\/templates', requireAction\('manage_settings'\)/);
    assert.doesNotMatch(print, /router\.post\('\/(?:preflight|jobs)', requireAction\('manage_settings'\)/);

    assert.match(
        graduation,
        /router\.patch\('\/diploma\/template', requireRole\('creator', 'director'\), requireAction\('manage_settings'\), async/
    );
});

test('support retention and SLA configuration require manage_settings', () => {
    const support = routeSource('support.js');

    assert.match(support, /const \{ authenticateToken, requireAction, requireMinRole \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(support, /router\.post\('\/sla', requireAction\('manage_settings'\), async/);
    assert.match(support, /router\.get\('\/retention', requireAction\('manage_settings'\), async/);
    assert.match(support, /router\.put\('\/retention\/:id', requireAction\('manage_settings'\), async/);
    assert.match(
        support,
        /router\.post\('\/retention\/run', requireMinRole\('manager'\), requireAction\('manage_settings'\), async/
    );
    assert.match(support, /router\.get\('\/sla', async/);
    assert.doesNotMatch(support, /router\.get\('\/sla', requireAction\('manage_settings'\)/);
});

test('page-status writes and internal status administration require manage_settings', () => {
    const pageStatuses = routeSource('page-statuses.js');
    const status = routeSource('status.js');

    assert.match(
        pageStatuses,
        /router\.patch\('\/\*', requireMinRole\('director'\), requireAction\('manage_settings'\), async/
    );
    assert.match(
        status,
        /router\.get\('\/components', authenticateToken, requireAction\('manage_settings'\), async/
    );
    assert.match(
        status,
        /router\.put\('\/components\/:code', authenticateToken, requireAction\('manage_settings'\), async/
    );
    assert.match(
        status,
        /router\.post\('\/incidents', authenticateToken, requireAction\('manage_settings'\), async/
    );
    assert.match(
        status,
        /router\.post\('\/incidents\/:id\/update', authenticateToken, requireAction\('manage_settings'\), async/
    );
    assert.match(
        status,
        /router\.get\('\/incidents', authenticateToken, requireAction\('manage_settings'\), async/
    );

    assert.match(status, /router\.get\('\/public', async/);
    assert.doesNotMatch(status, /router\.get\('\/public', (?:authenticateToken, )?requireAction\('manage_settings'\)/);
});

test('catalog, lead-assistant, and program-icon settings use manage_settings', () => {
    const catalogs = routeSource('catalogs.js');
    const omnichannel = routeSource('omnichannel.js');
    const products = routeSource('products.js');

    assert.match(catalogs, /const \{ requireRole, requireAction, authenticateToken \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(catalogs, /router\.put\('\/settings\/:catalogId', requireAction\('manage_settings'\), async/);

    assert.match(omnichannel, /const \{ authenticateToken: auth, requireMinRole, requireAction \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(omnichannel, /const manageLeadAssistantSettings = requireAction\('manage_settings'\);/);
    assert.match(omnichannel, /router\.put\('\/lead-assistant\/settings', auth, manageLeadAssistantSettings, async/);

    assert.match(products, /const \{ requireRole, authenticateToken \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(products, /const \{ requireAction \} = require\('\.\.\/middleware\/auth'\);/);
    assert.match(products, /router\.get\('\/program-icon-settings', requireAction\('manage_settings'\), async/);
    assert.match(products, /router\.put\('\/program-icon-settings', requireAction\('manage_settings'\), async/);
});
