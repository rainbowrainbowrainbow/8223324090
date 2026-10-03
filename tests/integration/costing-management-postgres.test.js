'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

test('management P&L links performed revenue, explicit refund, and allocated labor without double counting finance', {
    skip: !process.env.COSTING_TEST_PG_PORT, timeout: 120000
}, async () => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    const connection = { host: '127.0.0.1', port: Number(process.env.COSTING_TEST_PG_PORT), user: 'postgres',
        password: process.env.COSTING_TEST_PG_PASSWORD, ssl: false, connectionTimeoutMillis: 5000 };
    assert.ok(Number.isInteger(connection.port) && connection.port > 1024 && connection.password?.length >= 12);
    const database = `eventgenix_costing_management_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    let pool;
    let server;
    let browser;
    let page;
    let created = false;
    const cachePaths = ['../../db', '../../routes/finance', '../../routes/finance-costing',
        '../../routes/finance-costing-actual', '../../routes/finance-costing-management'].map(require.resolve);
    const savedCache = cachePaths.map(key => require.cache[key]);
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8 });
        for (const migration of ['375_universal_costing_plan_foundation.sql', '376_costing_actual_provenance.sql',
            '377_costing_group_composition_revisions.sql', '378_costing_management_reconciliation.sql',
            '379_costing_execution_booking_identity.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        await pool.query(`
            CREATE TABLE finance_categories (id INTEGER PRIMARY KEY, name TEXT, icon TEXT, type TEXT, business_context TEXT);
            CREATE TABLE finance_transactions (id INTEGER PRIMARY KEY, business_context TEXT, type TEXT,
                category_id INTEGER, amount INTEGER, date VARCHAR(20), recognition_date DATE,
                source TEXT, booking_id VARCHAR(50));
            CREATE TABLE bookings (id VARCHAR(50) PRIMARY KEY, business_context TEXT, price INTEGER,
                date DATE, status TEXT, linked_to VARCHAR(50));
            CREATE TABLE education_attendance (id BIGINT PRIMARY KEY, business_context TEXT, booking_id VARCHAR(50),
                status TEXT, lesson_date DATE);
            CREATE TABLE fiscal_profiles (id BIGINT PRIMARY KEY, crm_profile_key TEXT);
            CREATE TABLE payment_orders (id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT, source_type TEXT, source_id TEXT,
                total_amount_minor BIGINT, status TEXT, payment_status TEXT);
            CREATE TABLE payment_refunds (id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT, payment_order_id BIGINT,
                status TEXT, amount_minor BIGINT);
            CREATE TABLE payroll_reports (id BIGINT PRIMARY KEY, status TEXT, staff_id INTEGER, finance_transaction_id INTEGER);
            CREATE TABLE payroll_installments (id BIGINT PRIMARY KEY, payroll_report_id BIGINT, business_context TEXT,
                workflow_status TEXT, allocation_status TEXT, locked_amount INTEGER);
            CREATE TABLE hr_time_records (id INTEGER PRIMARY KEY, business_context TEXT, staff_id INTEGER,
                total_worked_minutes INTEGER, clock_out TIMESTAMPTZ, auto_closed BOOLEAN);
            INSERT INTO finance_categories VALUES (1,'Services','', 'income','event_genix'),(2,'Labor','', 'expense','event_genix');
            INSERT INTO finance_transactions VALUES
                (1,'event_genix','income',1,2160,'2026-10-01',NULL,'cashier','lesson-qa'),
                (2,'event_genix','expense',2,1158,'2026-10-12',NULL,'manual',NULL),
                (3,'event_genix','expense',2,1000,'2026-10-12',NULL,'payroll',NULL),
                (4,'event_genix','income',1,50,'2026-10-05',NULL,'legacy',NULL),
                (5,'dar','income',1,2160,'2026-10-01',NULL,'cashier',NULL);
            INSERT INTO bookings VALUES ('lesson-qa','event_genix',2160,'2026-10-12','confirmed',NULL),
                ('other-lesson','event_genix',2160,'2026-10-12','confirmed',NULL);
            INSERT INTO education_attendance VALUES (11,'event_genix','lesson-qa','present','2026-10-12');
            INSERT INTO fiscal_profiles VALUES (41,'event_genix'),(42,'dar');
            INSERT INTO payment_orders VALUES (51,41,'booking','lesson-qa',100000,'payment_recorded','recorded');
            INSERT INTO payment_refunds VALUES (61,41,51,'money_refunded',30000);
            INSERT INTO payroll_reports VALUES (21,'approved',7,3);
            INSERT INTO payroll_installments VALUES (31,21,'event_genix','approved','single',1000);
            INSERT INTO hr_time_records VALUES (71,'event_genix',7,120,'2026-10-12T12:00:00Z',FALSE);
        `);
        require.cache[cachePaths[0]] = { id: cachePaths[0], filename: cachePaths[0], loaded: true, exports: { pool } };
        for (const key of cachePaths.slice(1)) delete require.cache[key];
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'costing_management_fixture', role: req.headers['x-fixture-role'] === 'viewer' ? 'viewer' : 'creator',
                businessContexts: ['event_genix'] };
            next();
        });
        app.get('/api/finance/categories', (_req, res) => res.json([]));
        app.get('/api/finance/dashboard', (_req, res) => res.json({ totals: { income: 0, expense: 0, profit: 0 },
            bookingRevenue: { revenue: 0, count: 0 } }));
        app.use('/api/finance', require('../../routes/finance'));
        if (process.env.COSTING_BROWSER_E2E === '1') {
            const root = path.resolve(__dirname, '../..');
            const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
            const boot = `<script>
window.AppState = {};
window.apiVerifyToken = async () => ({name:'Disposable Management QA',role:'creator'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => true;
window.getAuthHeaders = () => ({'Content-Type':'application/json','X-Business-Context':'event_genix'});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready','dark-mode');
};
window.getLegacyBusinessSurfaceAvailability = () => ({available:false,message:'Disposable Management QA'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
document.documentElement.setAttribute('data-theme','dark');
</script><script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;
            app.get('/finance', (_req, res) => res.type('html').send(html.replace('</body>', `${boot}</body>`)));
            app.use('/js', express.static(path.join(root, 'js')));
            app.use('/css', express.static(path.join(root, 'css')));
        }
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const origin = `http://127.0.0.1:${server.address().port}/api/finance`;
        const pageErrors = [];
        const httpErrors = [];
        if (process.env.COSTING_BROWSER_E2E === '1') {
            const { chromium } = require('playwright');
            browser = await chromium.launch({ headless: true,
                ...(process.env.COSTING_BROWSER_EXECUTABLE ? { executablePath: process.env.COSTING_BROWSER_EXECUTABLE } : {}) });
            page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 500) {
                httpErrors.push(`${response.status()} ${response.url()}`);
            } });
            const rootUrl = `http://127.0.0.1:${server.address().port}`;
            await page.route('**/*', route => route.request().url().startsWith(rootUrl + '/') ? route.continue() : route.abort());
            await page.goto(`${rootUrl}/finance?tab=costing`);
            await page.locator('#costManagementRefresh').waitFor();
            await page.locator('#costManagementFrom').fill('2026-10-01');
            await page.locator('#costManagementTo').fill('2026-10-31');
        }
        async function browserReport(expectedRevenue, expectedCost = null) {
            if (!page) return;
            await page.locator('#costManagementFrom').fill('2026-10-01');
            await page.locator('#costManagementTo').fill('2026-10-31');
            await page.locator('#costManagementRefresh').click();
            const waitForAmount = (position, expected) => page.waitForFunction(({ position, expected }) => {
                const actual = document.querySelector(`#costManagementSummary .cost-result-grid > div:nth-child(${position}) strong`)?.textContent;
                return actual?.replace(/\s/g, ' ').trim() === expected.replace(/\s/g, ' ').trim();
            }, { position, expected });
            await waitForAmount(1, expectedRevenue);
            if (expectedCost) await waitForAmount(2, expectedCost);
        }
        async function request(method, endpoint, body, context = 'event_genix', role = 'creator') {
            const response = await fetch(origin + endpoint, { method, signal: AbortSignal.timeout(10000),
                headers: { 'Content-Type': 'application/json', 'X-Business-Context': context, 'X-Fixture-Role': role },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        }
        const base = '/costing';
        const template = await request('POST', `${base}/templates`, { name: 'Lesson fixture', kind: 'lesson',
            effectiveFrom: '2026-01-01', definition: { revenueBasis: 'execution', revenueRateMinor: '216000',
                lines: [{ code: 'room', label: 'Room', basis: 'execution', rateMinor: '115800' }] } });
        assert.equal(template.status, 201, JSON.stringify(template.body));
        const plan = await request('POST', `${base}/plans`, { templateId: template.body.template.id,
            expectedVersionId: template.body.version.id, executionDate: '2026-10-12', executionLabel: 'Lesson QA',
            bookingId: 'lesson-qa', clientKey: crypto.randomUUID(), inputs: {} });
        assert.equal(plan.status, 201, JSON.stringify(plan.body));
        const planId = plan.body.planId;
        const management = `${base}/management`;
        const reportPath = `${management}/pnl?from=2026-10-01&to=2026-10-31`;
        const legacyBefore = await request('GET', '/report/pnl?year=2026&month=10');
        assert.equal(legacyBefore.status, 200, JSON.stringify(legacyBefore.body));
        assert.equal(legacyBefore.body.summary.totalIncome, 2210);
        assert.equal(legacyBefore.body.summary.totalExpenses, 2158);
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '0');
        assert.equal((await request('GET', reportPath, undefined, 'event_genix', 'viewer')).status, 403);
        const wrongPlan = await request('POST', `${base}/plans`, { templateId: template.body.template.id,
            expectedVersionId: template.body.version.id, executionDate: '2026-10-12', executionLabel: 'Other booking QA',
            bookingId: 'other-lesson', clientKey: crypto.randomUUID(), inputs: {} });
        assert.equal(wrongPlan.status, 201, JSON.stringify(wrongPlan.body));
        const wrongSource = await request('POST', `${base}/actual/plans/${wrongPlan.body.planId}/sources`, {
            externalId: 'wrong_booking_qa', economicRole: 'lesson_sale', category: 'revenue',
            amountMinor: '216000', evidenceState: 'confirmed', semantic: 'charge'
        });
        assert.equal(wrongSource.status, 201, JSON.stringify(wrongSource.body));
        assert.equal((await request('POST', `${management}/plans/${wrongPlan.body.planId}/performance`, {
            expectedRevision: 0, state: 'performed', performedOn: '2026-10-12', evidenceType: 'operator',
            reason: 'Synthetic other booking performed'
        })).status, 201);
        const wrongLink = await request('POST', `${management}/sources/${wrongSource.body.sourceId}/links`, {
            expectedRevision: 0, kind: 'earned_revenue', effectOn: '2026-10-12',
            financeTransactionId: 1, reason: 'Same business and amount, but another booking'
        });
        assert.equal(wrongLink.status, 409);
        assert.match(wrongLink.body.error, /exact booking fixed on this execution plan/);
        const unlinkedPlan = await request('POST', `${base}/plans`, { templateId: template.body.template.id,
            expectedVersionId: template.body.version.id, executionDate: '2026-10-12', executionLabel: 'No booking QA',
            clientKey: crypto.randomUUID(), inputs: {} });
        assert.equal(unlinkedPlan.status, 201, JSON.stringify(unlinkedPlan.body));
        const unlinkedSource = await request('POST', `${base}/actual/plans/${unlinkedPlan.body.planId}/sources`, {
            externalId: 'unlinked_booking_qa', economicRole: 'lesson_sale', category: 'revenue',
            amountMinor: '216000', evidenceState: 'confirmed', semantic: 'charge'
        });
        assert.equal(unlinkedSource.status, 201, JSON.stringify(unlinkedSource.body));
        assert.equal((await request('POST', `${management}/plans/${unlinkedPlan.body.planId}/performance`, {
            expectedRevision: 0, state: 'performed', performedOn: '2026-10-12', evidenceType: 'operator',
            reason: 'Synthetic unlinked plan performed'
        })).status, 201);
        const unlinkedEarned = await request('POST', `${management}/sources/${unlinkedSource.body.sourceId}/links`, {
            expectedRevision: 0, kind: 'earned_revenue', effectOn: '2026-10-12',
            financeTransactionId: 1, reason: 'No booking identity was fixed on this plan'
        });
        assert.equal(unlinkedEarned.status, 409);
        assert.match(unlinkedEarned.body.error, /exact booking fixed on this execution plan/);
        async function source(externalId, role, category, amountMinor, semantic, evidenceState = 'confirmed') {
            const response = await request('POST', `${base}/actual/plans/${planId}/sources`, {
                externalId, economicRole: role, category, amountMinor, evidenceState, semantic
            });
            assert.equal(response.status, 201, JSON.stringify(response.body));
            return response.body.sourceId;
        }
        const revenueId = await source('earned_qa', 'lesson_sale', 'revenue', '216000', 'charge', 'estimate');
        const earned = { expectedRevision: 0, kind: 'earned_revenue', effectOn: '2026-10-12',
            financeTransactionId: 1, paymentOrderId: 51, reason: 'Performed lesson and reconciled finance income' };
        assert.equal((await request('POST', `${management}/sources/${revenueId}/links`, earned)).status, 409);
        const active = await request('GET', `${base}/actual/plans/${planId}`);
        const estimate = active.body.sources.find(item => String(item.id) === String(revenueId));
        assert.equal((await request('POST', `${base}/actual/sources/${revenueId}/correct`, {
            amountMinor: '216000', evidenceState: 'confirmed', semantic: 'charge',
            reason: 'Final earned price checked against finance entry'
        })).status, 201);
        assert.ok(estimate);
        if (page) {
            await page.reload();
            await page.locator('#costManagementPlan option').filter({ hasText: 'Lesson QA' }).waitFor({ state: 'attached' });
            await page.locator('#costManagementPlan').selectOption(String(planId));
            await page.locator('#costManagementSource option').filter({ hasText: 'earned_qa' }).waitFor({ state: 'attached' });
            await page.locator('#costManagementEvidence').selectOption('attendance');
            await page.locator('#costManagementAttendanceId').fill('11');
            await page.locator('#costManagementPerformanceReason').fill('Present attendance confirms lesson delivery');
            await page.locator('#costManagementPerform').click();
            await page.locator('#costManagementPerformanceStatus').getByText('Факт виконання додано').waitFor();
        } else {
            const performed = await request('POST', `${management}/plans/${planId}/performance`, {
                expectedRevision: 0, state: 'performed', performedOn: '2026-10-12', evidenceType: 'attendance', evidenceId: 11,
                reason: 'Present attendance confirms lesson delivery'
            });
            assert.equal(performed.status, 201, JSON.stringify(performed.body));
        }
        assert.equal((await request('POST', `${management}/plans/${planId}/performance`, {
            expectedRevision: 0, state: 'performed', performedOn: '2026-10-12', evidenceType: 'operator', reason: 'Stale'
        })).status, 409);
        if (page) {
            await page.locator('#costManagementSource').selectOption(String(revenueId));
            await page.locator('#costManagementFinanceId').fill('1');
            await page.locator('#costManagementPaymentOrderId').fill('51');
            await page.locator('#costManagementLinkReason').fill(earned.reason);
            await page.locator('#costManagementLink').click();
            await page.locator('#costManagementLinkStatus').getByText('Зв’язок #').waitFor();
        } else {
            assert.equal((await request('POST', `${management}/sources/${revenueId}/links`, earned)).status, 201);
        }
        const originalLink = (await request('GET', `${management}/sources/${revenueId}/links`)).body.current.id;
        const early = await request('GET', `${management}/pnl?from=2026-10-01&to=2026-10-11`);
        assert.equal(early.body.summary.earnedRevenueMinor, '0', 'cash deposit is not earned before performance');
        const afterPerformance = await request('GET', reportPath);
        assert.equal(afterPerformance.status, 200, JSON.stringify(afterPerformance.body));
        assert.equal(afterPerformance.body.summary.earnedRevenueMinor, '216000');
        assert.equal(afterPerformance.body.legacyUnlinked.finance.count, 3);
        await browserReport('2 160,00 ₴');
        const duplicate = await source('duplicate_income', 'second_sale', 'revenue', '216000', 'charge');
        assert.equal((await request('POST', `${management}/sources/${duplicate}/links`, earned)).status, 409);
        assert.equal((await request('POST', `${management}/sources/${duplicate}/links`, { ...earned, financeTransactionId: 5 })).status, 404);
        assert.equal((await request('POST', `${management}/sources/${revenueId}/links`, earned, 'dar')).status, 403);
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '216000',
            'cash refund by itself does not reverse earned revenue');
        const refundId = await source('refund_qa', 'lesson_refund', 'revenue', '-30000', 'refund');
        const correction = await request('POST', `${management}/sources/${refundId}/links`, {
            expectedRevision: 0, kind: 'revenue_correction', effectOn: '2026-10-20', originalLinkId: originalLink,
            paymentRefundId: 61, reason: 'Approved price reversal for the completed lesson'
        });
        assert.equal(correction.status, 201, JSON.stringify(correction.body));
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '186000');
        await browserReport('1 860,00 ₴');
        const correctionOnlyPath = `${management}/pnl?from=2026-10-20&to=2026-10-31`;
        assert.equal((await request('GET', correctionOnlyPath)).body.summary.earnedRevenueMinor, '-30000');
        await pool.query('UPDATE finance_transactions SET amount=2100 WHERE id=1');
        const drifted = await request('GET', correctionOnlyPath);
        assert.equal(drifted.body.summary.earnedRevenueMinor, '0', 'correction cannot survive invalid original finance income');
        assert.ok(drifted.body.unresolved.some(item => String(item.sourceId) === String(revenueId)));
        assert.ok(drifted.body.unresolved.some(item => String(item.sourceId) === String(refundId) &&
            item.issues.some(issue => /Original earned revenue/.test(issue))));
        if (page) {
            await browserReport('0,00 ₴');
            assert.match(await page.locator('#costManagementSummary').innerText(), /Початкова виручка більше не проходить фінансову перевірку/);
            const injection = '<img src=x onerror="window.__costingXss=1">';
            const injectUnresolved = async route => {
                const response = await route.fetch();
                const data = await response.json();
                data.unresolved.push({ linkId: injection, sourceId: injection, issues: [injection] });
                await route.fulfill({ response, json: data });
            };
            await page.route('**/api/finance/costing/management/pnl?**', injectUnresolved);
            await browserReport('0,00 ₴');
            await page.waitForFunction(() => document.querySelector('#costManagementSummary')?.textContent.includes('<img src=x'));
            assert.match(await page.locator('#costManagementSummary').innerText(), /<img src=x/);
            assert.equal(await page.locator('#costManagementSummary img').count(), 0);
            assert.equal(await page.evaluate(() => window.__costingXss), undefined);
            await page.unroute('**/api/finance/costing/management/pnl?**', injectUnresolved);
        }
        await pool.query('UPDATE finance_transactions SET amount=2160 WHERE id=1');
        await pool.query("UPDATE finance_transactions SET booking_id='other-lesson' WHERE id=1");
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '0',
            'report rechecks the immutable execution booking against the finance booking');
        await pool.query("UPDATE finance_transactions SET booking_id='lesson-qa' WHERE id=1");
        const repeatedRefund = await source('refund_duplicate', 'refund_duplicate', 'revenue', '-10000', 'refund');
        assert.equal((await request('POST', `${management}/sources/${repeatedRefund}/links`, {
            expectedRevision: 0, kind: 'revenue_correction', effectOn: '2026-10-20', originalLinkId: originalLink,
            paymentRefundId: 61, reason: 'Attempt to reuse the same cash refund'
        })).status, 409);
        const oversizedCorrection = await source('oversized_adjustment', 'price_adjustment', 'revenue', '-200000', 'adjustment');
        assert.equal((await request('POST', `${management}/sources/${oversizedCorrection}/links`, {
            expectedRevision: 0, kind: 'revenue_correction', effectOn: '2026-10-20', originalLinkId: originalLink,
            reason: 'Attempt to exceed earned revenue'
        })).status, 409);
        const directId = await source('room_qa', 'room_cost', 'direct_cost', '115800', 'cost');
        assert.equal((await request('POST', `${management}/sources/${directId}/links`, {
            expectedRevision: 0, kind: 'direct_cost', effectOn: '2026-10-12', financeTransactionId: 2,
            reason: 'Room invoice already present in finance ledger'
        })).status, 201);
        const pieceId = await source('piece_qa', 'teacher_piecework', 'direct_cost', '30000', 'cost');
        const hourlyId = await source('hourly_qa', 'teacher_hourly', 'direct_cost', '20000', 'cost');
        assert.equal((await request('POST', `${management}/sources/${pieceId}/links`, {
            expectedRevision: 0, kind: 'piecework', effectOn: '2026-10-12', financeTransactionId: 3,
            payrollInstallmentId: 31, reason: 'Piecework allocated to this lesson'
        })).status, 201);
        assert.equal((await request('POST', `${management}/sources/${hourlyId}/links`, {
            expectedRevision: 0, kind: 'hourly', effectOn: '2026-10-12', financeTransactionId: 3,
            payrollInstallmentId: 31, hrTimeRecordId: 71, confirmedMinutes: 120, hourlyRateMinor: '10000',
            reason: 'Two confirmed hours allocated to this lesson'
        })).status, 201);
        const final = await request('GET', reportPath);
        assert.equal(final.status, 200, JSON.stringify(final.body));
        assert.deepEqual(final.body.summary, {
            earnedRevenueMinor: '186000', directCostMinor: '215800', contributionMinor: '-29800'
        });
        assert.equal(final.body.lines.filter(item => item.financeTransactionId === '3').length, 3,
            'piecework, hourly, and one unallocated business-level remainder use finance expense once');
        assert.equal(final.body.lines.find(item => item.kind === 'unallocated_payroll').amountMinor, '50000');
        assert.equal(final.body.legacyUnlinked.finance.count, 1);
        assert.equal(final.body.legacyUnlinked.finance.income_minor, '5000');
        await browserReport('1 860,00 ₴', '2 158,00 ₴');
        if (page) {
            const visible = await page.locator('#costManagementSummary').innerText();
            for (const kind of ['earned_revenue', 'revenue_correction', 'piecework', 'hourly', 'unallocated_payroll']) {
                assert.match(visible, new RegExp(kind));
            }
            const bounds = await page.locator('#tabCosting .cost-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().right));
            assert.ok(bounds.every(right => right <= 821), JSON.stringify(bounds));
            assert.deepEqual(pageErrors, []);
            assert.deepEqual(httpErrors, []);
            const output = path.resolve(__dirname, '../../output/playwright/costing-management-db-ui');
            fs.mkdirSync(output, { recursive: true });
            await page.screenshot({ path: path.join(output, 'tablet.png'), fullPage: true });
        }
        await pool.query("UPDATE payment_refunds SET status='requested' WHERE id=61");
        const refundUnresolved = await request('GET', reportPath);
        assert.equal(refundUnresolved.body.summary.earnedRevenueMinor, '216000');
        assert.ok(refundUnresolved.body.unresolved.some(item => String(item.sourceId) === String(refundId)));
        await pool.query("UPDATE payment_refunds SET status='money_refunded' WHERE id=61");
        await pool.query('UPDATE hr_time_records SET total_worked_minutes=90 WHERE id=71');
        const timeUnresolved = await request('GET', reportPath);
        assert.ok(timeUnresolved.body.unresolved.some(item => String(item.sourceId) === String(hourlyId)));
        assert.equal(timeUnresolved.body.lines.filter(item => item.financeTransactionId === '3').length, 2,
            'payroll finance expense remains one total with the invalid share at business level');
        await pool.query('UPDATE hr_time_records SET total_worked_minutes=120 WHERE id=71');
        assert.equal((await request('POST', `${management}/plans/${planId}/performance`, {
            expectedRevision: 1, state: 'voided', reason: 'Synthetic disputed delivery'
        })).status, 201);
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '0');
        assert.equal((await request('POST', `${management}/plans/${planId}/performance`, {
            expectedRevision: 2, state: 'performed', performedOn: '2026-10-12',
            evidenceType: 'attendance', evidenceId: 11, reason: 'Present attendance rechecked'
        })).status, 201);
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '186000');
        const legacyAfter = await request('GET', '/report/pnl?year=2026&month=10');
        assert.deepEqual(legacyAfter.body.summary, legacyBefore.body.summary, 'legacy P&L remains unchanged');
        assert.equal((await request('POST', `${base}/actual/sources/${revenueId}/correct`, {
            amountMinor: '216000', evidenceState: 'confirmed', semantic: 'charge',
            reason: 'New evidence revision requires a new accounting link'
        })).status, 201);
        const invalidated = await request('GET', reportPath);
        assert.equal(invalidated.body.summary.earnedRevenueMinor, '0');
        assert.ok(invalidated.body.unresolved.some(item => String(item.sourceId) === String(revenueId)));
        assert.ok(invalidated.body.unresolved.some(item => String(item.sourceId) === String(refundId)),
            'dependent refund link is blocked while its original finance evidence is stale');
        const renewed = await request('POST', `${management}/sources/${revenueId}/links`, {
            ...earned, expectedRevision: 1, reason: 'Rechecked same finance row against corrected evidence'
        });
        assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
        const renewedCorrection = await request('POST', `${management}/sources/${refundId}/links`, {
            expectedRevision: 1, kind: 'revenue_correction', effectOn: '2026-10-20',
            originalLinkId: renewed.body.link.id, paymentRefundId: 61,
            reason: 'Rechecked refund against renewed earned-revenue link'
        });
        assert.equal(renewedCorrection.status, 201, JSON.stringify(renewedCorrection.body));
        assert.equal((await request('GET', reportPath)).body.summary.earnedRevenueMinor, '186000');
        await pool.query("INSERT INTO finance_transactions VALUES (6,'event_genix','expense',2,10,'2026-10-12',NULL,'manual',NULL)");
        const racingA = await source('race_cost_a', 'race_cost', 'direct_cost', '1000', 'cost');
        const racingB = await source('race_cost_b', 'race_cost', 'direct_cost', '1000', 'cost');
        const race = await Promise.all([racingA, racingB].map(sourceId => request('POST',
            `${management}/sources/${sourceId}/links`, { expectedRevision: 0, kind: 'direct_cost',
                effectOn: '2026-10-12', financeTransactionId: 6, reason: 'Concurrent exact finance claim' })));
        assert.deepEqual(race.map(item => item.status).sort(), [201, 409]);
        assert.equal((await request('GET', reportPath)).body.lines.filter(item => item.financeTransactionId === '6').length, 1);
        await pool.query("INSERT INTO finance_transactions VALUES (7,'event_genix','income',1,100,'2026-10-01',NULL,'subscription','lesson-qa')");
        await pool.query("INSERT INTO payment_orders VALUES (52,41,'subscription','lesson-qa',10000,'payment_recorded','recorded')");
        const subscription = await source('subscription_qa', 'subscription_sale', 'revenue', '10000', 'charge');
        assert.equal((await request('POST', `${management}/sources/${subscription}/links`, {
            expectedRevision: 0, kind: 'earned_revenue', effectOn: '2026-10-12',
            financeTransactionId: 7, paymentOrderId: 52, reason: 'Subscription allocation is not yet defined'
        })).status, 409);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM finance_transactions')).rows[0].count, 7);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_refunds')).rows[0].count, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payroll_installments')).rows[0].count, 1);
        await assert.rejects(pool.query('UPDATE costing_management_links SET amount_minor=1 WHERE id=$1', [originalLink]), /immutable/);
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        cachePaths.forEach((key, index) => { if (savedCache[index]) require.cache[key] = savedCache[index]; else delete require.cache[key]; });
        if (created) await admin.query(`DROP DATABASE "${database}"`);
        await admin.end();
    }
});
