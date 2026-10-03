'use strict';

// Actual costing routes + disposable PostgreSQL + browser UI, with synthetic auth and no external services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/costing-db-ui');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const boot = `<script>
window.AppState = {};
window.apiVerifyToken = async () => ({name:'Disposable DB QA',role:'creator'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => true;
window.getAuthHeaders = () => ({'Content-Type':'application/json','X-Business-Context':'event_genix'});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready','dark-mode');
};
window.getLegacyBusinessSurfaceAvailability = () => ({available:false,message:'Disposable DB QA'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
document.documentElement.setAttribute('data-theme','dark');
</script><script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;

async function main() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    const connection = { host: '127.0.0.1', port: Number(process.env.COSTING_TEST_PG_PORT), user: 'postgres',
        password: process.env.COSTING_TEST_PG_PASSWORD, ssl: false, connectionTimeoutMillis: 5000 };
    assert.ok(Number.isInteger(connection.port) && connection.port > 1024 && connection.password?.length >= 12);
    const name = `eventgenix_costing_browser_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    let pool;
    let server;
    let browser;
    let created = false;
    const cachePaths = ['../../db', '../../routes/finance', '../../routes/finance-costing', '../../routes/finance-costing-actual'].map(require.resolve);
    const savedCache = cachePaths.map(key => require.cache[key]);
    try {
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        pool = new Pool({ ...connection, database: name, max: 5 });
        for (const migration of ['375_universal_costing_plan_foundation.sql', '376_costing_actual_provenance.sql',
            '377_costing_group_composition_revisions.sql']) {
            await pool.query(fs.readFileSync(path.join(root, 'db/migrations', migration), 'utf8'));
        }
        await pool.query("CREATE TABLE bookings (id VARCHAR(50) PRIMARY KEY, business_context VARCHAR(64), price INTEGER, status TEXT)");
        await pool.query("INSERT INTO bookings VALUES ('lesson-qa','event_genix',2160,'confirmed')");
        require.cache[cachePaths[0]] = { id: cachePaths[0], filename: cachePaths[0], loaded: true, exports: { pool } };
        for (const key of cachePaths.slice(1)) delete require.cache[key];
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'disposable_costing_browser',
                role: req.headers['x-fixture-role'] === 'viewer' ? 'viewer' : 'creator', businessContexts: ['event_genix'],
                action_denylist: req.headers['x-fixture-deny-manage'] ? ['finance.manage'] : [] };
            next();
        });
        app.get('/api/finance/categories', (_req, res) => res.json([]));
        app.get('/api/finance/dashboard', (_req, res) => res.json({ totals: { income: 0, expense: 0, profit: 0 },
            bookingRevenue: { revenue: 0, count: 0 } }));
        app.use('/api/finance', require('../../routes/finance'));
        app.use('/api', (_req, res) => res.json({}));
        app.get('/finance', (_req, res) => res.type('html').send(html.replace('</body>', `${boot}</body>`)));
        app.use('/js', express.static(path.join(root, 'js')));
        app.use('/css', express.static(path.join(root, 'css')));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const denied = await fetch(`${origin}/api/finance/costing/templates`, { headers: { 'X-Fixture-Role':'viewer' } });
        assert.equal(denied.status, 403);
        const deniedMutation = await fetch(`${origin}/api/finance/costing/actual/source-links/preview`, { method: 'POST',
            headers: { 'Content-Type':'application/json', 'X-Fixture-Deny-Manage':'1' }, body: JSON.stringify({
                type: 'booking', sourceId: 'lesson-qa', expectedAmountMinor: '216000'
            }) });
        assert.equal(deniedMutation.status, 403);
        async function post(endpoint, body) {
            const response = await fetch(`${origin}/api/finance/costing${endpoint}`, { method: 'POST',
                headers: { 'Content-Type':'application/json', 'X-Business-Context':'event_genix' }, body: JSON.stringify(body) });
            const data = await response.json();
            assert.equal(response.status, 201, JSON.stringify(data));
            return data;
        }
        // Seed only through the actual API. The browser performs the plan and actual workflow.
        await post('/templates', { name: 'Disposable group lesson', kind: 'lesson', effectiveFrom: '2026-01-01',
            definition: { revenueBasis: 'participant', revenueRateMinor: '30000', lines: [
                { code: 'teacher', label: 'Teacher', basis: 'hour', rateMinor: '25000' },
                { code: 'materials', label: 'Materials', basis: 'participant', rateMinor: '4000' },
                { code: 'room', label: 'Room', basis: 'execution', rateMinor: '15000' },
                { code: 'fee', label: 'Fee', basis: 'percent', percentBps: 500, percentBase: 'revenue' }
            ] } });
        fs.mkdirSync(output, { recursive: true });
        browser = await chromium.launch({ headless: true,
            executablePath: 'C:\\Users\\Plotva\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
        const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
        const errors = [];
        const httpErrors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().startsWith(`${origin}/api/`) && response.status() >= 500) httpErrors.push(`${response.status()} ${response.url()}`); });
        await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        await page.goto(`${origin}/finance?tab=costing`);
        await page.locator('#costTemplateSelect option[value="1"]').waitFor({ state: 'attached' });
        await page.locator('#costTemplateSelect').selectOption('1');
        await page.locator('#costExecutionLabel').fill('Disposable lesson');
        await page.locator('#costExecutionDate').fill('2026-10-12');
        await page.locator('#costParticipants').fill('10');
        await page.locator('#costPaidParticipants').fill('8');
        await page.locator('#costHours').fill('2');
        await page.locator('#costDiscountPercent').fill('10');
        await page.locator('#costPreview').click();
        await page.locator('#costPreviewResult').getByText('1 002,00 ₴').waitFor();
        await page.locator('#costSavePlan').click();
        await page.locator('#costActualSummary').getByText('Ще не визначено').waitFor();
        for (const item of [
            { id: 'sale-qa', role: 'lesson_sale', category: 'revenue', amount: '2160' },
            { id: 'cost-qa', role: 'lesson_cost', category: 'direct_cost', amount: '1158' }
        ]) {
            await page.locator('#costSourceExternalId').fill(item.id);
            await page.locator('#costSourceRole').fill(item.role);
            await page.locator('#costSourceCategory').selectOption(item.category);
            await page.locator('#costSourceAmount').fill(item.amount);
            await page.locator('#costSourceEvidence').selectOption('confirmed');
            await page.locator('#costAddSource').click();
        }
        for (const category of ['revenue', 'direct_cost']) {
            await page.locator('#costCompletionCategory').selectOption(category);
            await page.locator('#costCompletionReason').fill(`Disposable ${category} reconciliation`);
            await page.locator('#costCompletionConfirmed').check();
            await page.locator('#costCompleteCategory').click();
        }
        await page.locator('#costActualSummary').getByText('1 002,00 ₴').last().waitFor();
        await page.locator('#costGroupLabel').fill('Disposable course');
        await page.locator('#costGroupMembers [data-plan-id="1"] [data-include-revenue]').check();
        await page.locator('#costGroupMembers [data-plan-id="1"] [data-include-cost]').check();
        await page.locator('#costCreateGroup').click();
        await page.locator('#costGroupSummary').getByText('Disposable course').waitFor();
        await page.locator('#costGroupEditMembers [data-plan-id="1"] [data-include-cost]').uncheck();
        await page.locator('#costGroupRevisionReason').fill('Move shared costs to a separate allocation');
        await page.locator('#costSaveGroupRevision').click();
        await page.locator('#costGroupSummary').getByText('ревізія 2').waitFor();
        assert.match(await page.locator('#costGroupHistory').innerText(), /Ревізія 1[\s\S]*Ревізія 2/);
        assert.match(await page.locator('#costGroupHistory').innerText(), /Ревізія 2[\s\S]*без витрат/);
        await page.locator('#costLinkId').fill('lesson-qa');
        await page.locator('#costLinkAmount').fill('2160');
        await page.locator('#costPreviewLink').click();
        await page.locator('#costLinkResult').getByText('Перевірено ID, бізнес і суму').waitFor();
        const counts = await pool.query(`SELECT
            (SELECT COUNT(*)::int FROM costing_plan_snapshots) AS plans,
            (SELECT COUNT(*)::int FROM costing_actual_sources) AS sources,
            (SELECT COUNT(*)::int FROM costing_actual_entries) AS entries,
            (SELECT COUNT(*)::int FROM costing_execution_groups) AS groups,
            (SELECT COUNT(*)::int FROM costing_group_revisions) AS revisions,
            (SELECT COUNT(*)::int FROM costing_actual_completions WHERE group_id IS NOT NULL AND is_complete=FALSE) AS invalidations`);
        assert.deepEqual(counts.rows[0], { plans: 1, sources: 2, entries: 2, groups: 1, revisions: 2, invalidations: 2 });
        assert.deepEqual(errors, []);
        assert.deepEqual(httpErrors, []);
        const bounds = await page.locator('#tabCosting .cost-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().right));
        assert.ok(bounds.every(right => right <= 821), JSON.stringify(bounds));
        await page.screenshot({ path: path.join(output, 'tablet-fullstack.png'), fullPage: true });
        console.log(JSON.stringify({ passed: true, counts: counts.rows[0], output }));
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        cachePaths.forEach((key, index) => { if (savedCache[index]) require.cache[key] = savedCache[index]; else delete require.cache[key]; });
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
