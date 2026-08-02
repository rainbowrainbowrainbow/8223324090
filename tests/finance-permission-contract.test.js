'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { requireAction } = require('../middleware/auth');
const { resolveCapability } = require('../services/accountAccessPolicy');
const {
    redactRevenueFields,
    shapeBanquetSummaryForRevenueAccess
} = require('../services/revenueAccessPolicy');
const {
    SAFE_SETTING_READ_KEYS,
    isSafeSettingReadKey
} = require('../services/settingsAccessPolicy');
const express = require('express');
const financeRouter = require('../routes/finance');
const analyticsRouter = require('../routes/analytics');

const ROOT = path.resolve(__dirname, '..');
const financeRoute = fs.readFileSync(path.join(ROOT, 'routes', 'finance.js'), 'utf8');
const financePage = fs.readFileSync(path.join(ROOT, 'js', 'finance-page.js'), 'utf8');

function runGuard(user) {
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    requireAction('finance.manage')(
        { user },
        { status(code) { statusCode = code; return this; }, json(value) { payload = value; return this; } },
        () => { nextCalled = true; }
    );
    return { statusCode, payload, nextCalled };
}

test('Finance mutation router guard is capability-based and keeps account/payroll guards in place', () => {
    assert.match(financeRoute, /const requireFinanceManagement = requireAction\('finance\.manage'\);/);
    assert.match(financeRoute, /FINANCE_MUTATION_METHODS\.has\(req\.method\)/);
    assert.match(financeRoute, /assertFinanceTransactionNotPayrollManaged/);
    assert.match(financeRoute, /router\.post\('\/accounts', requireRole\('admin', 'senior_manager'\)/);
    assert.match(financeRoute, /router\.delete\('\/accounts\/:id', requireRole\('admin'\)/);
    assert.match(financePage, /function financeCanManageTransactions\(\)[\s\S]*finance\.manage/);
    assert.match(financePage, /addBtn\.style\.display = canManageTransactions \? '' : 'none'/);
    assert.doesNotMatch(financePage, /MANAGE_ROLES/);
});

test('Finance hydrates capabilities before exposing the verified user to shared auth', () => {
    const hydration = financePage.indexOf('await hydrateActionPermissions(user)');
    const currentUser = financePage.indexOf('AppState.currentUser = user;');
    assert.ok(hydration >= 0, 'Finance must hydrate the capability catalog during initialization');
    assert.ok(currentUser > hydration, 'Finance must not expose a verified user before capability hydration completes');
});
test('explicit Finance deny blocks the mutation guard before an endpoint can run', () => {
    const result = runGuard({ role: 'accountant', action_denylist: ['finance.manage'] });
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.payload, { error: 'Insufficient permissions' });
});
async function withFinanceRouter(user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/api/finance', financeRouter);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}


async function withRouter(router, mountPath, user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use(mountPath, router);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function withMockedGraduationRouter(pool, user, run) {
    const routePath = require.resolve('../routes/graduation');
    const dbPath = require.resolve('../db');
    const opsPath = require.resolve('../services/graduationOpsAutomation');
    const bookingPath = require.resolve('../services/booking');
    const modulePaths = [routePath, dbPath, opsPath, bookingPath];
    const previous = new Map(modulePaths.map(modulePath => [modulePath, require.cache[modulePath]]));
    const install = (modulePath, exports) => {
        require.cache[modulePath] = {
            id: modulePath,
            filename: modulePath,
            loaded: true,
            exports
        };
    };

    delete require.cache[routePath];
    install(dbPath, { pool });
    install(bookingPath, {
        validateBookingWithinWorkingHours: () => ({ valid: true })
    });
    install(opsPath, {
        buildGraduationTimelineItemsForQuote: async () => [],
        buildGraduationSegmentsForQuote: async () => [],
        syncGraduationOpsForQuote: async () => ({ success: true })
    });

    try {
        const graduationRouter = require(routePath);
        await withRouter(graduationRouter, '/api/graduation', user, run);
    } finally {
        for (const modulePath of modulePaths) {
            const cached = previous.get(modulePath);
            if (cached) require.cache[modulePath] = cached;
            else delete require.cache[modulePath];
        }
    }
}

test('explicit Finance deny receives 403 from a real mutation endpoint before route logic', async () => {
    await withFinanceRouter({ role: 'accountant', action_denylist: ['finance.manage'] }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/finance/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
    });
});

test('Finance role fence ignores page and action explicit allows', async () => {
    const restricted = { role: 'senior_manager', page_allowlist: ['/finance'], action_allowlist: ['finance.manage'] };
    const page = resolveCapability(restricted, '/finance', { type: 'page' });
    const action = resolveCapability(restricted, 'finance.manage', { type: 'action' });
    assert.deepEqual([page.allowed, page.reason], [false, 'explicit_allow_disabled']);
    assert.deepEqual([action.allowed, action.reason], [false, 'explicit_allow_disabled']);
    assert.equal(resolveCapability({ role: 'senior_manager', extra_roles: ['accountant'] }, '/finance', { type: 'page' }).allowed, true);
    assert.equal(resolveCapability({ role: 'senior_manager', extra_roles: ['accountant'] }, 'finance.manage', { type: 'action' }).allowed, true);
    assert.ok(financePage.includes("canAccessPage('/finance')"));

    await withFinanceRouter(restricted, async baseUrl => {
        const response = await fetch(baseUrl + '/api/finance/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 403);
    });
});

test('revenue and export capabilities block real financial endpoints before data work', async () => {
    await withFinanceRouter({ role: 'accountant', action_denylist: ['view_revenue'] }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/finance/transactions`);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
    });

    await withFinanceRouter({ role: 'accountant', action_denylist: ['export_data'] }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/finance/export?from=2026-01-01&to=2026-01-31`);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });

        const actResponse = await fetch(`${baseUrl}/api/finance/act/BK-17`);
        assert.equal(actResponse.status, 403);
        assert.deepEqual(await actResponse.json(), { error: 'Insufficient permissions' });
    });

    await withRouter(analyticsRouter, '/api/analytics', { role: 'manager', action_denylist: ['export_data'] }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/analytics/product-sales/export?format=csv`);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
    });

});

test('graduation keeps catalog prices public while quote and service financial fields stay protected', async () => {
    const calls = [];
    const quoteUpdates = [];
    const settingsRows = [
        { key: 'coefficient', value: 6, label: 'Coefficient' },
        { key: 'markup', value: 1.15, label: 'Markup' }
    ];
    let serviceRow = {
        id: 1,
        sort_order: 1,
        name: 'Science show',
        description: 'Public description',
        duration_min: 60,
        price_park: 1200,
        price_per_child: 0,
        price_type: 'formula',
        cost_host: 500,
        cost_costume: 100,
        cost_balloons_per_kid: 10,
        cost_aquagrim_per_kid: 0,
        cost_print_per_kid: 0,
        cost_design_per_kid: 0,
        cost_delivery: 50,
        cost_ice: 0,
        cost_other: 0,
        cost_box: 0,
        cost_markers: 0,
        cost_solution: 0,
        cost_cleaning: 0,
        cost_drinks_per_kid: 0,
        cost_type: 'standard',
        category: 'show',
        min_kids: 7,
        max_kids: 40,
        entry_rule: null,
        is_active: true,
        catalog_description: 'A safe catalog description',
        timeline_visible: true,
        operation_kind: null,
        automation_flags: {}
    };
    let quoteRow = {
        id: 17,
        quote_number: 'GRAD-2026-017',
        customer_id: 21,
        kids_count: 15,
        discount_percent: 10,
        selected_services: [{ serviceId: 1, name: 'Science show', price: 230 }],
        package_id: 5,
        total_per_child: 230,
        total_all: 3105,
        total_cost: 650,
        total_profit: 2455,
        profit_margin: 79,
        status: 'draft',
        booking_id: null,
        event_date: '2026-06-01',
        event_start_time: '10:00',
        event_end_time: '11:00',
        event_time_mode: 'manual',
        service_timing: [],
        child_pack_id: null,
        diploma_context_locked: false,
        notes: 'Initial note',
        created_by: 'creator',
        created_at: '2026-08-02T09:00:00.000Z',
        updated_at: '2026-08-02T09:00:00.000Z'
    };
    const packageRow = {
        id: 5,
        name: 'Science Party',
        slug: 'science-party',
        description: 'Package description',
        image_url: null,
        sort_order: 1,
        min_kids: 7,
        max_kids: 40,
        is_active: true
    };
    const packageItemRow = {
        package_id: 5,
        service_id: 1,
        override_price: null,
        service_name: serviceRow.name,
        service_description: serviceRow.description,
        price_park: serviceRow.price_park,
        price_per_child: serviceRow.price_per_child,
        price_type: serviceRow.price_type,
        duration_min: serviceRow.duration_min,
        category: serviceRow.category,
        sort_order: serviceRow.sort_order,
        timeline_visible: true,
        operation_kind: null
    };
    const pool = {
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            if (normalized === 'SELECT id FROM graduation_services WHERE id = $1') {
                return { rows: [{ id: serviceRow.id }] };
            }
            if (normalized.startsWith('UPDATE graduation_services SET')) {
                serviceRow = { ...serviceRow, description: params[1] ?? serviceRow.description };
                return { rows: [{ ...serviceRow }] };
            }
            if (normalized.includes('FROM graduation_services WHERE is_active = true')) {
                return { rows: [{ ...serviceRow }] };
            }
            if (normalized === 'SELECT id, catalog_description FROM graduation_services WHERE catalog_description IS NOT NULL') {
                return { rows: [{ id: serviceRow.id, catalog_description: serviceRow.catalog_description }] };
            }
            if (normalized === "SELECT key, value FROM graduation_settings WHERE key IN ('coefficient', 'markup')") {
                return { rows: settingsRows.map(row => ({ key: row.key, value: row.value })) };
            }
            if (normalized === 'SELECT * FROM graduation_settings ORDER BY key') {
                return { rows: settingsRows.map(row => ({ ...row })) };
            }
            if (normalized === 'SELECT * FROM graduation_packages WHERE is_active = true ORDER BY sort_order') {
                return { rows: [{ ...packageRow }] };
            }
            if (normalized.includes('FROM graduation_package_items pi')) {
                return { rows: [{ ...packageItemRow }] };
            }
            if (normalized === 'SELECT id FROM graduation_quotes WHERE id = $1') {
                return { rows: [{ id: quoteRow.id }] };
            }
            if (normalized.startsWith('UPDATE graduation_quotes SET')) {
                quoteUpdates.push({ sql: normalized, params: [...params] });
                assert.match(normalized, /^UPDATE graduation_quotes SET notes = \$1, updated_at = NOW\(\) WHERE id = \$2 RETURNING \*$/);
                quoteRow = { ...quoteRow, notes: params[0] };
                return { rows: [{ ...quoteRow }] };
            }
            if (normalized.includes('FROM graduation_child_packs p')) return { rows: [] };
            throw new Error(`Unexpected graduation test query: ${normalized}`);
        }
    };
    const restrictedDirector = {
        role: 'director',
        username: 'restricted-director',
        action_denylist: ['view_revenue']
    };

    await withMockedGraduationRouter(pool, restrictedDirector, async baseUrl => {
        const servicesResponse = await fetch(`${baseUrl}/api/graduation/services`);
        assert.equal(servicesResponse.status, 200);
        const [service] = await servicesResponse.json();
        assert.equal(service.pricePerChild, 230);
        assert.equal(service.description, 'Public description');
        for (const key of ['pricePark', 'priceType', 'costHost', 'costType']) assert.equal(key in service, false, key);

        const packagesResponse = await fetch(`${baseUrl}/api/graduation/packages`);
        assert.equal(packagesResponse.status, 200);
        const [graduationPackage] = await packagesResponse.json();
        assert.equal(graduationPackage.totalPerChild, 230);
        assert.equal(graduationPackage.services[0].pricePerChild, 230);
        assert.equal('priceType' in graduationPackage.services[0], false);

        const settingsResponse = await fetch(`${baseUrl}/api/graduation/settings`);
        assert.equal(settingsResponse.status, 200);
        assert.deepEqual(await settingsResponse.json(), {});

        const catalogResponse = await fetch(`${baseUrl}/api/graduation/catalog/export`);
        assert.equal(catalogResponse.status, 200);
        assert.match(await catalogResponse.text(), /class="info-val">230<\/span>/);

        const serviceUpdate = await fetch(`${baseUrl}/api/graduation/services/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: 'Updated public description' })
        });
        assert.equal(serviceUpdate.status, 200);
        const updatedService = await serviceUpdate.json();
        assert.equal(updatedService.description, 'Updated public description');
        assert.equal(updatedService.pricePerChild, 230);
        assert.equal('costHost' in updatedService, false);

        const beforeDeniedServiceUpdate = calls.length;
        const deniedServiceUpdate = await fetch(`${baseUrl}/api/graduation/services/1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ costHost: 700 })
        });
        assert.equal(deniedServiceUpdate.status, 403);
        assert.deepEqual(await deniedServiceUpdate.json(), { error: 'Insufficient permissions' });
        assert.equal(calls.length, beforeDeniedServiceUpdate, 'financial service PUT must be denied before DB work');

        const updateQuote = async notes => fetch(`${baseUrl}/api/graduation/quotes/17`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
        });
        const quoteUpdate = await updateQuote('Updated operational note');
        assert.equal(quoteUpdate.status, 200);
        const updatedQuote = await quoteUpdate.json();
        assert.equal(updatedQuote.notes, 'Updated operational note');
        assert.equal(updatedQuote.packageId, 5);
        assert.equal(updatedQuote.customerId, 21);
        assert.equal(updatedQuote.eventDate, '2026-06-01');
        assert.deepEqual(updatedQuote.selectedServices, [{ serviceId: 1, name: 'Science show' }]);
        for (const key of ['discountPercent', 'totalPerChild', 'totalAll', 'totalCost', 'totalProfit', 'profitMargin']) {
            assert.equal(key in updatedQuote, false, key);
        }

        const clearNote = await updateQuote(null);
        assert.equal(clearNote.status, 200);
        assert.equal((await clearNote.json()).notes, null, 'explicit null must clear the requested optional field');
        assert.equal(quoteUpdates.length, 2);
        for (const update of quoteUpdates) {
            assert.doesNotMatch(update.sql, /package_id|customer_id|event_date|total_all|total_cost/);
            assert.equal(update.params[1], '17');
        }

        for (const financialPayload of [
            { totalAll: 9999 },
            { kidsCount: 20 },
            { packageId: 7 },
            { selectedServices: [{ serviceId: 1 }] }
        ]) {
            const beforeDeniedQuoteUpdate = calls.length;
            const deniedQuoteUpdate = await fetch(`${baseUrl}/api/graduation/quotes/17`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(financialPayload)
            });
            assert.equal(deniedQuoteUpdate.status, 403, JSON.stringify(financialPayload));
            assert.deepEqual(await deniedQuoteUpdate.json(), { error: 'Insufficient permissions' });
            assert.equal(calls.length, beforeDeniedQuoteUpdate, 'financial quote PUT must be denied before DB work');
        }
    });
});

test('revenue redaction preserves operational counts while removing financial fields and money text', () => {
    const payload = {
        status: 'confirmed',
        total: 12,
        totalBookings: 5,
        guestCount: 24,
        label: 'Банкет 1 200 UAH, залів 2',
        nested: {
            amount: 1200,
            unitPrice: 300,
            revenue: 2400,
            roomCount: 3,
            note: 'Оплачено $25, гостей 8'
        },
        rows: [{ name: 'Пакет', count: 2, price: 450 }]
    };

    assert.deepEqual(redactRevenueFields(payload), {
        status: 'confirmed',
        total: 12,
        totalBookings: 5,
        guestCount: 24,
        label: 'Банкет [сума прихована], залів 2',
        nested: {
            roomCount: 3,
            note: 'Оплачено [сума прихована], гостей 8'
        },
        rows: [{ name: 'Пакет', count: 2 }]
    });
    assert.equal(payload.nested.amount, 1200, 'redaction must not mutate the source payload');
});

test('banquet revenue shaping keeps safe deposit metadata and disables every price mode', () => {
    const summary = {
        success: true,
        group: { id: 'BG-42', status: 'active', guestCount: 18 },
        deposit: {
            id: 77,
            status: 'confirmed',
            confirmedAt: '2026-08-02T09:00:00.000Z',
            confirmedBy: 'director',
            source: 'canonical',
            amount: 1500,
            recommendedDepositAmount: 2000,
            note: 'Отримано 1 500 грн'
        },
        totals: { finalTotal: 6000 },
        finance: { revenue: 6000 },
        menu: [{ name: 'Піца', quantity: 3, price: 500 }],
        modeContract: {
            mode: 'client',
            sections: { overview: true, menu: true, finance: true },
            showPrices: true
        }
    };

    const shaped = shapeBanquetSummaryForRevenueAccess(summary, false);
    assert.deepEqual(shaped.group, summary.group);
    assert.deepEqual(shaped.deposit, {
        id: 77,
        status: 'confirmed',
        confirmedAt: '2026-08-02T09:00:00.000Z',
        confirmedBy: 'director',
        source: 'canonical'
    });
    assert.deepEqual(shaped.menu, [{ name: 'Піца', quantity: 3 }]);
    assert.equal(shaped.totals, undefined);
    assert.equal(shaped.finance, undefined);
    assert.equal(shaped.modeContract.showPrices, false);
    assert.equal(shaped.modeContract.sections.finance, false);
    assert.equal(shaped.modeContract.sections.overview, true);
    assert.equal(shapeBanquetSummaryForRevenueAccess(summary, true), summary);
    assert.equal(summary.deposit.amount, 1500, 'shaping must not mutate the canonical summary');
});

test('settings read policy exposes only the explicit safe allowlist and defaults to deny', () => {
    assert.deepEqual([...SAFE_SETTING_READ_KEYS].sort(), [
        'auto_delete_enabled',
        'auto_delete_hours',
        'bot_username',
        'digest_time',
        'digest_time_weekday',
        'digest_time_weekend',
        'language',
        'reminder_time'
    ]);
    for (const key of SAFE_SETTING_READ_KEYS) assert.equal(isSafeSettingReadKey(key), true, key);
    assert.equal(isSafeSettingReadKey(' LANGUAGE '), true, 'safe keys should normalize case and whitespace');
    for (const key of ['api_key', 'bot_token', 'guardian_ai', 'smtp_password', 'unknown_setting', '', null]) {
        assert.equal(isSafeSettingReadKey(key), false, String(key));
    }
});

test('revenue, settings, and booking summary guards are wired before sensitive work', () => {
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const settingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'settings.js'), 'utf8');
    assert.match(bookingsRoute, /res\.json\(summaryForRevenueAccess\(summary, req\.user\)\);/);
    assert.match(bookingsRoute, /banquet-summary\.pdf', requireAction\('view_revenue'\), requireAction\('export_data'\)/);
    assert.match(settingsRoute, /const requireSettingsManagement = requireAction\('manage_settings'\);/);
    assert.match(settingsRoute, /function requireSettingReadAccess[\s\S]*isSafeSettingReadKey\(req\.params\?\.key\)[\s\S]*requireSettingsManagement/);
    assert.match(settingsRoute, /router\.put\('\/business\/cabinet', requireRole\('creator', 'director'\), requireSettingsManagement/);
    assert.match(settingsRoute, /router\.post\('\/settings', requireRole\('creator', 'director'\), requireSettingsManagement/);
    assert.match(settingsRoute, /router\.get\('\/settings\/:key', requireSettingReadAccess/);
});

test('export routes and UI clients fail closed before preparing downloadable files', () => {
    const analyticsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'analytics.js'), 'utf8');
    const customersRoute = fs.readFileSync(path.join(ROOT, 'routes', 'customers.js'), 'utf8');
    const graduationRoute = fs.readFileSync(path.join(ROOT, 'routes', 'graduation.js'), 'utf8');
    const procurementRoute = fs.readFileSync(path.join(ROOT, 'routes', 'procurement.js'), 'utf8');
    const reportsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'reports.js'), 'utf8');
    const appPage = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    const customersPage = fs.readFileSync(path.join(ROOT, 'js', 'customers-page.js'), 'utf8');
    const financeClient = fs.readFileSync(path.join(ROOT, 'js', 'finance-page.js'), 'utf8');
    const graduationPage = fs.readFileSync(path.join(ROOT, 'js', 'graduation.js'), 'utf8');
    const reportsPage = fs.readFileSync(path.join(ROOT, 'js', 'reports-page.js'), 'utf8');
    const warehousePage = fs.readFileSync(path.join(ROOT, 'js', 'warehouse-page.js'), 'utf8');

    assert.match(analyticsRoute, /router\.use\(requireAction\('view_revenue'\)\);[\s\S]*router\.get\('\/product-sales\/export', requireAction\('export_data'\)/);
    assert.match(customersRoute, /router\.get\('\/export', requireAction\('export_data'\), requireAction\('view_revenue'\)/);
    assert.match(customersRoute, /router\.get\('\/export-vcf', requireAction\('export_data'\)/);
    const catalogExportDeclaration = graduationRoute.split('\n').find(line => line.includes("router.get('/catalog/export'"));
    const proposalDeclaration = graduationRoute.split('\n').find(line => line.includes("router.get('/quotes/:id/proposal'"));
    assert.match(catalogExportDeclaration, /requireAction\('export_data'\)/);
    assert.doesNotMatch(catalogExportDeclaration, /requireAction\('view_revenue'\)/);
    assert.match(proposalDeclaration, /requireAction\('export_data'\).*requireAction\('view_revenue'\)/);
    for (const diplomaRoute of ['diplomas/export/pdf', 'diplomas/export/csv', 'diplomas/export/xlsx', 'diplomas/print-sheet']) {
        const declaration = graduationRoute.split('\n').find(line => (
            line.includes("router.get('/quotes/:id/") && line.includes(diplomaRoute)
        ));
        assert.match(declaration, /requireAction\('export_data'\)/, diplomaRoute);
        assert.doesNotMatch(declaration, /requireAction\('view_revenue'\)/, diplomaRoute);
    }
    assert.match(procurementRoute, /router\.get\('\/export-xlsx', requireAction\('export_data'\), requireAction\('view_revenue'\)/);
    assert.match(financeRoute, /router\.get\('\/act\/:bookingId', requireFinanceExport/);
    assert.match(reportsRoute, /router\.post\('\/table\/export-csv', requireAction\('export_data'\)/);
    assert.match(reportsRoute, /router\.post\('\/table\/export-xlsx', requireAction\('export_data'\)/);

    assert.match(appPage, /async function downloadProductSalesExport[\s\S]*typeof canAccess !== 'function'[\s\S]*!canAccess\('export_data'\)[\s\S]*!canAccess\('view_revenue'\)[\s\S]*if \(!response\.ok\)[\s\S]*response\.blob\(\)/);
    assert.match(customersPage, /function downloadCSV[\s\S]*guardCustomerExport\(true\)[\s\S]*if \(!res\.ok\)[\s\S]*res\.blob\(\)/);
    assert.match(financeClient, /async function exportCSV[\s\S]*!financeCanExportData\(\)[\s\S]*if \(!res\.ok\)[\s\S]*res\.blob\(\)/);
    assert.match(graduationPage, /function exportCatalog\(\)[\s\S]*guardGraduationExport\(\)/);
    assert.match(graduationPage, /function printPackagePage\(index\)[\s\S]*guardGraduationExport\(\)/);
    assert.match(graduationPage, /async function exportDiplomasPdf[\s\S]*guardGraduationExport\(\)[\s\S]*handleAuthError\(response\)[\s\S]*if \(!response\.ok\)[\s\S]*response\.blob\(\)/);
    assert.match(reportsPage, /async function downloadReportTableExport[\s\S]*!canAccess\('export_data'\)[\s\S]*if \(!res\.ok\)[\s\S]*res\.blob\(\)/);
    assert.match(warehousePage, /function canViewProcurementRevenue\(\)[\s\S]*canAccess\('view_revenue'\)[\s\S]*async function exportProcXlsx\(\) \{\s*if \(typeof canAccess !== 'function' \|\| !canAccess\('export_data'\) \|\| !canViewProcurementRevenue\(\)\)[\s\S]*if \(!res\.ok\)[\s\S]*res\.blob\(\)/);
});

test('procurement export route is declared before the generic id route', () => {
    const procurementRoute = fs.readFileSync(path.join(ROOT, 'routes', 'procurement.js'), 'utf8');
    const exportRouteIndex = procurementRoute.indexOf("router.get('/export-xlsx'");
    const genericIdRouteIndex = procurementRoute.indexOf("router.get('/:id'");

    assert.ok(exportRouteIndex >= 0, 'Procurement XLSX export route must exist');
    assert.ok(genericIdRouteIndex >= 0, 'Procurement generic :id route must exist');
    assert.ok(
        exportRouteIndex < genericIdRouteIndex,
        'Static /export-xlsx must be registered before the generic /:id route'
    );
    assert.doesNotMatch(
        procurementRoute,
        /req\.params\.id === 'export-xlsx'.*next\('route'\)/,
        'Route ordering must not depend on a special-case :id escape hatch'
    );
});

test('protected financial UI hides redacted values instead of presenting fake zero amounts', () => {
    const warehousePage = fs.readFileSync(path.join(ROOT, 'js', 'warehouse-page.js'), 'utf8');
    const customersPage = fs.readFileSync(path.join(ROOT, 'js', 'customers-page.js'), 'utf8');
    const graduationPage = fs.readFileSync(path.join(ROOT, 'js', 'graduation.js'), 'utf8');
    const graduationRoute = fs.readFileSync(path.join(ROOT, 'routes', 'graduation.js'), 'utf8');

    assert.match(warehousePage, /function canViewProcurementRevenue\(\)[\s\S]*canAccess\('view_revenue'\)/);
    assert.match(warehousePage, /const canExportProcurement = typeof canAccess === 'function' && canAccess\('export_data'\) && canViewRevenue/);
    assert.match(warehousePage, /const totalFmt = canViewProcurementRevenue\(\) && list\.totalEstimated > 0\s*\? `<span class="proc-card-total">\$\{list\.totalEstimated\.toLocaleString\('uk-UA'\)\}[^\`]*<\/span>` : '';/);
    assert.match(warehousePage, /const priceFmt = canViewProcurementRevenue\(\) && item\.estimatedPrice > 0\s*\? `<span class="proc-item-price">\$\{\(item\.quantity \* item\.estimatedPrice\)\.toLocaleString\('uk-UA'\)\}[^\`]*<\/span>` : '';/);
    assert.doesNotMatch(warehousePage, /\$\{(?:list\.totalEstimated|item\.estimatedPrice)\s*(?:\|\||\?\?)\s*0\}/);
    assert.match(warehousePage, /const price = canViewProcurementRevenue\(\) \? \(parseInt\(document\.getElementById\('pd-item-price'\)\?\.value\) \|\| 0\) : null;/);
    assert.match(warehousePage, /const itemPayload = \{ name, quantity: qty, contractorId \};\s*if \(canViewProcurementRevenue\(\)\) itemPayload\.estimatedPrice = price;/);
    assert.match(warehousePage, /if \(canViewProcurementRevenue\(\)\) document\.getElementById\('pd-item-price'\)\.value = 0;/);
    assert.match(warehousePage, /const receiptPayload = \{[\s\S]*if \(canViewProcurementRevenue\(\)\) receiptPayload\.finalPrice = item\?\.estimatedPrice \|\| 0;/);
    assert.doesNotMatch(warehousePage, /apiAddProcurementItem\([^\n]*\{\s*name, quantity: qty, estimatedPrice: price/);

    assert.match(customersPage, /function canViewCustomerRevenue\(\)[\s\S]*canAccess\('view_revenue'\)/);
    assert.match(customersPage, /function canExportCustomerData\(includeRevenue = false\)[\s\S]*canAccess\('export_data'\)[\s\S]*canViewCustomerRevenue\(\)/);
    assert.match(customersPage, /const revenueCard = canViewCustomerRevenue\(\) \? `[\s\S]*s\.averages\?\.avg_spent[\s\S]*` : '';/);
    assert.match(customersPage, /const canViewRevenue = canViewCustomerRevenue\(\);[\s\S]*\$\{canViewRevenue \? `<td>[\s\S]*c\.totalSpent[\s\S]*` : ''\}/);
    assert.match(customersPage, /\$\{canViewRevenue \? `<div class="detail-field">[\s\S]*customer\.totalSpent[\s\S]*` : ''\}/);
    assert.doesNotMatch(customersPage, /formatMoney\((?:customer\.totalSpent|c\.totalSpent)\s*(?:\|\||\?\?)\s*0\)/);

    assert.match(graduationPage, /function canUseGraduationCapability\(capability\)[\s\S]*!user \|\| typeof window\.resolveCapability !== 'function'[\s\S]*resolveCapability\(user, capability, \{ type: 'action' \}\)\.allowed === true[\s\S]*function canViewGraduationRevenue\(\)[\s\S]*canUseGraduationCapability\('view_revenue'\)/);
    assert.match(graduationPage, /canViewGraduationRevenue\(\) \? `<span>[\s\S]*formatPrice\(q\.totalAll\)[\s\S]*<\/span>` : ''/);
    assert.doesNotMatch(graduationPage, /formatPrice\(q\.totalAll \|\| 0\)/);
    assert.match(graduationPage, /const avg = d\.averageCheck \|\| \{\};[\s\S]*\$\{canViewGraduationRevenue\(\) \? `[\s\S]*formatPrice\(avg\.perChild\)[\s\S]*formatPrice\(avg\.total\)[\s\S]*` : ''\}/);
    assert.doesNotMatch(graduationPage, /\['constructor', 'packages', 'settings'\]/);
    const catalogUi = graduationPage.slice(
        graduationPage.indexOf('function openCatalogViewer'),
        graduationPage.indexOf('async function renderQuotes')
    );
    assert.doesNotMatch(catalogUi, /guardGraduationRevenue\(\)/);
    const selectPackageUi = graduationPage.slice(
        graduationPage.indexOf('async function selectPackage'),
        graduationPage.indexOf('// #26: Customer search')
    );
    assert.doesNotMatch(selectPackageUi, /guardGraduationRevenue\(\)/);
    assert.match(graduationPage, /const canViewRevenue = canViewGraduationRevenue\(\);[\s\S]*\$\{canViewRevenue \? `[\s\S]*formatPrice\(totals\.totalAll\)/);
    assert.match(graduationPage, /isDirector\(\) && canViewRevenue \? `[\s\S]*formatPrice\(totals\.totalCost\)[\s\S]*totals\.margin/);
    assert.doesNotMatch(graduationRoute, /installRevenueResponseShaper/);
    assert.match(graduationRoute, /function mapPublicServiceRow[\s\S]*pricePerChild: calculateCatalogPrice[\s\S]*function mapServiceRowForAccess/);
    assert.match(graduationRoute, /router\.put\('\/services\/:id',[^\n]*requireRevenueForFinancialMutation/);
    assert.match(graduationRoute, /router\.put\('\/quotes\/:id',[^\n]*requireQuoteRevenueForFinancialMutation/);
    assert.match(graduationRoute, /function buildGraduationQuoteUpdate[\s\S]*Object\.prototype\.hasOwnProperty\.call[\s\S]*updated_at = NOW\(\)/);
});

test('critical Finance and HR permission contracts are mandatory CI coverage', () => {
    const packageJson = require('../package.json');
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(packageJson.scripts['test:permission-contracts'], /finance-permission-contract.test.js/);
    assert.match(packageJson.scripts['test:permission-contracts'], /hr-capability-contract.test.js/);
    assert.match(packageJson.scripts.verify, /npm run test:permission-contracts/);
    const fastBaseline = workflow.indexOf('Run fast verification baseline');
    assert.ok(fastBaseline >= 0);
    assert.match(workflow.slice(fastBaseline, fastBaseline + 160), /run: npm test/);
});