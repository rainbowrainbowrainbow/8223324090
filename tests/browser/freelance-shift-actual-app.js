'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { chromium } = require('../helpers/playwright')();
const { assertSafeIsolatedTestUrl, assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

async function run() {
    assert.equal(process.env.RUN_FREELANCE_SHIFT_BROWSER, 'true');
    const base = assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    const membership = process.env.FREELANCE_BROWSER_MEMBERSHIP === 'true';
    const out = path.resolve(__dirname, '../../output/playwright', membership ? 'freelance-shift-park' : 'freelance-shift');
    fs.mkdirSync(out, { recursive: true });
    const suffix = randomUUID().slice(0, 8);
    const kyivDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' });
    const date = kyivDate.format(new Date());
    // In the first hour of the Kyiv day, UTC is still on the previous date.
    const browserTime = new Date(Date.parse(date + 'T00:00:00Z') - 90 * 60_000);
    assert.equal(kyivDate.format(browserTime), date);
    const businesses = {};
    const login = async (role, { identity = role, deniedActions = [] } = {}) => {
        const username = `freelance_qa_${identity}_${suffix}`;
        const password = randomUUID() + randomUUID();
        const { rows: [user] } = await db.query(
            `INSERT INTO users (username, password_hash, role, name, business_contexts, default_business_context)
             VALUES ($1, $2, $3, 'Synthetic Freelance QA', ARRAY['event_genix'], 'event_genix') RETURNING id`,
            [username, await bcrypt.hash(password, 10), role]
        );
        if (membership) {
            await db.query('INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1,$2,$3)',
                [businesses.event_genix.organization_id, user.id, role === 'creator' ? 'owner' : 'member']);
            for (const [context, business] of Object.entries(businesses)) {
                await db.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default, action_denylist)
                    VALUES ($1,$2,$3,$4,$5,$6)`, [business.id, business.organization_id, user.id, role,
                    context === 'event_genix', context === 'event_genix' ? deniedActions : []]);
            }
        }
        const response = await fetch(new URL('/api/auth/login', base), {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Business-Context': 'event_genix' },
            body: JSON.stringify({ username, password })
        });
        assert.equal(response.status, 200, `Synthetic ${role} login`);
        return response.json();
    };
    const request = async (auth, route, { method = 'GET', context = 'event_genix', scope = 'single' } = {}) => fetch(new URL(route, base), {
        method,
        headers: { Authorization: 'Bearer ' + (auth.accessToken || auth.token), 'X-Business-Context': context,
            'X-Business-Scope': scope }
    });
    let browser;
    let stage = 'fixture';
    try {
        if (membership) {
            const { rows: [organization] } = await db.query(`INSERT INTO organizations (slug, name)
                VALUES ('isolated-freelance-browser', 'Synthetic Freelance QA')
                ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
            for (const context of ['event_genix', 'dar']) {
                const { rows: [business] } = await db.query(`INSERT INTO businesses
                    (organization_id, context_key, label, short_label, access_mode)
                    VALUES ($1,$2,$2,$2,'membership') ON CONFLICT (context_key) DO NOTHING RETURNING id, organization_id`,
                [organization.id, context]);
                businesses[context] = business || (await db.query(`SELECT id, organization_id FROM businesses
                    WHERE organization_id = $1 AND context_key = $2 AND access_mode = 'membership'`, [organization.id, context])).rows[0];
                assert.ok(businesses[context], 'Use an isolated registry owned by this browser fixture');
            }
        }
        const auth = await login('creator');
        const viewer = await login('animator');
        if (membership) assert.equal(auth.user.membershipMode, 'membership');
        const endpoint = `/api/payroll/freelance/day?date=${date}`;
        assert.equal((await request(viewer, endpoint)).status, 403, 'Schedule user cannot read rates');
        const authorized = await request(auth, endpoint);
        assert.equal(authorized.status, 200, `Payroll read in ${auth.user.membershipMode || 'compatibility'} mode`);
        if (membership) {
            stage = 'membership boundaries';
            const pay = '/api/payroll/freelance/payments';
            assert.equal((await request(auth, '/api/payroll/payment-options')).status, 403);
            assert.equal((await request(auth, pay, { method: 'POST', context: 'dar' })).status, 403);
            assert.equal((await request(auth, pay, { method: 'POST', scope: 'all' })).status, 403);
            const [owner] = (await db.query('SELECT id FROM users WHERE username = $1', [`freelance_qa_creator_${suffix}`])).rows;
            const membershipParams = [businesses.event_genix.id, owner.id];
            try {
                for (const [action, route, method] of [
                    ['view_payroll', endpoint, 'GET'],
                    ['manage_payroll_rules', '/api/payroll/freelance/rates', 'GET'],
                    ['manage_payroll_accrual', '/api/payroll/freelance/attendance', 'POST'],
                    ['confirm_payroll_payment', pay, 'POST'],
                    ['reverse_payroll_payment', '/api/payroll/freelance/reversals', 'POST']
                ]) {
                    await db.query('UPDATE business_memberships SET action_denylist = ARRAY[$3] WHERE business_id = $1 AND user_id = $2',
                        [...membershipParams, action]);
                    assert.equal((await request(auth, route, { method })).status, 403, action);
                    if (action === 'confirm_payroll_payment') {
                        assert.equal((await request(auth, '/api/payroll/freelance/payment-options')).status, 200);
                    }
                }
                await db.query('UPDATE business_memberships SET is_active = false WHERE business_id = $1 AND user_id = $2', membershipParams);
                assert.equal((await request(auth, endpoint)).status, 403);
            } finally {
                await db.query("UPDATE business_memberships SET is_active = true, action_denylist = '{}' WHERE business_id = $1 AND user_id = $2",
                    membershipParams);
            }
        }
        const staffName = `Synthetic Freelance Oleksandra Verylongsyntheticdoublefamilyname ${suffix}`;
        const { rows: [staff] } = await db.query(
            `INSERT INTO staff (name, department, position, role_type, rate_unit, hourly_rate, is_active)
             VALUES ($1, 'animators', 'Synthetic QA', 'animator', 'hour', 120, true) RETURNING id`,
            [staffName]
        );
        await db.query(
            `INSERT INTO finance_categories (name, type, business_context)
             VALUES ($1, 'expense', 'event_genix'), ($2, 'income', 'event_genix')`,
            [`Freelance expense ${suffix}`, `Freelance reversal ${suffix}`]
        );
        await db.query(
            `INSERT INTO finance_accounts (name, business_context)
             VALUES ($1, 'event_genix')`, [`Freelance account ${suffix}`]
        );
        stage = 'launch';
        browser = await chromium.launch({ headless: true, executablePath: process.env.FREELANCE_CHROMIUM_PATH,
            args: ['--disable-dev-shm-usage'] });
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 }, locale: 'uk-UA', timezoneId: 'UTC', serviceWorkers: 'block'
        });
        const initializeBrowserSession = async (browserContext, auth) => {
            browserContext.setDefaultTimeout(15_000);
            await browserContext.addInitScript(auth => {
                localStorage.setItem('pzp_token', auth.accessToken || auth.token);
                localStorage.setItem('pzp_access_token', auth.accessToken || auth.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(auth.user));
                if (auth.refreshToken) localStorage.setItem('pzp_refresh_token', auth.refreshToken);
                localStorage.setItem('pzp_staff_schedule_expanded_groups', JSON.stringify(['animators']));
            }, auth);
        };
        await initializeBrowserSession(context, auth);
        const page = await context.newPage();
        await page.clock.setFixedTime(browserTime);
        const setWidth = width => page.setViewportSize({ width, height: width > 768 ? 1000 : 844 });
        const assertFits = async () => {
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
                'The schedule or finance page must fit the viewport');
        };
        const saveScreenshot = async name => {
            const width = page.viewportSize().width;
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.screenshot({
                path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled',
                clip: { x: 0, y: 0, width, height }
            });
        };
        const financeMenuSelector = '#sidebarPrimaryLinks > a[href="/finance"]';
        const menuFinance = page.locator(financeMenuSelector);
        const waitForFinanceMenu = () => page.waitForFunction(selector => {
            const link = document.querySelector(selector);
            if (!link) return false;
            const box = link.getBoundingClientRect();
            return box.width > 0 && box.left >= 0 && box.top >= 0 && box.bottom < 500;
        }, financeMenuSelector);

        const openSchedule = async () => {
            await page.goto(new URL('/staff', base).href, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
            await page.locator('#scheduleDateFrom').fill(date);
            await page.locator('#scheduleDateTo').fill(date);
            await page.locator('#applyScheduleRangeBtn').click();
            await page.locator('#deptFilter [data-dept="animators"]').click();
            const toggle = page.locator('[data-schedule-group-toggle="animators"]');
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            const cell = page.locator(`.sch-cell[data-staff="${staff.id}"][data-date="${date}"]`).first();
            await cell.waitFor();
            return cell;
        };
        stage = 'schedule save';
        let cell = await openSchedule();
        await cell.click();
        await page.locator('#schStatus').selectOption('working');
        const cards = page.locator('#schSegmentsList .sch-segment-card');
        await cards.first().locator('[data-segment-field="start"]').fill('09:00');
        await cards.first().locator('[data-segment-field="end"]').fill('13:00');
        await cards.first().locator('[data-segment-field="break"]').fill('0');
        await page.locator('#schAddSegmentBtn').click();
        await cards.nth(1).locator('[data-segment-field="start"]').fill('14:00');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('17:00');
        await cards.nth(1).locator('[data-segment-field="break"]').fill('0');
        await cards.nth(1).locator('[data-segment-field="work-mode"]').selectOption('freelance');
        const save = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/schedule'
            && response.request().method() === 'PUT');
        await page.locator('#schSaveBtn').click();
        const saved = await save;
        assert.equal(saved.status(), 200, 'Schedule API accepted mixed day');
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
        stage = 'schedule reload';
        cell = await openSchedule();
        await cell.locator('.sch-freelance-mark').waitFor();
        await page.locator('#scheduleWorkModeFilter').selectOption('freelance');
        await cell.click();
        assert.equal(await cards.nth(1).locator('[data-segment-field="work-mode"]').inputValue(), 'freelance');
        assert.equal(await cards.nth(1).locator('[data-day-pay-slot]').count(), 0);
        assert.match(await cards.first().locator('[data-day-pay-preview]').textContent(), /240 хв/);
        await page.screenshot({ path: path.join(out, 'schedule-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#schCancelBtn').click();
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
        await cell.click();
        assert.equal(await cards.nth(1).locator('[data-segment-field="work-mode"]').inputValue(), 'freelance');
        await cards.nth(1).locator('[data-segment-field="work-mode"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'schedule-mobile.png') });

        stage = 'attendance fixture';
        const { rows: [fact] } = await db.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context, total_worked_minutes)
             VALUES ($1,$2,($2::date + TIME '09:00') AT TIME ZONE 'Europe/Kyiv',
                 ($2::date + TIME '17:00') AT TIME ZONE 'Europe/Kyiv','present','event_genix',420) RETURNING id`,
            [staff.id, date]
        );
        assert.ok(fact.id);
        stage = 'finance terms and confirmation';
        await page.locator('#schCancelBtn').click();
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
        const freelanceLink = page.getByRole('link', { name: 'Фріланс-розрахунки' });

        stage = 'mobile schedule controls';
        const actions = page.locator('#staffScheduleActionsToggle');
        const copy = page.locator('#copyWeekBtn');
        for (const width of [390, 320]) {
            await setWidth(width);
            await page.evaluate(() => window.scrollTo(0, 0));
            await assertFits();
            await actions.focus();
            await actions.press('Enter');
            assert.equal(await actions.getAttribute('aria-expanded'), 'true');
            await copy.waitFor();
            await page.waitForFunction(width => {
                const ids = ['staffFreelanceFinanceLink', 'staffScheduleActionsToggle', 'copyWeekBtn', 'printBtn'];
                return ids.every(id => {
                    const box = document.getElementById(id)?.getBoundingClientRect();
                    return box && box.left >= -0.01 && box.right <= width + 0.01 && box.height >= 43.99;
                });
            }, width);
            await page.locator('.staff-schedule-command-bar').screenshot({
                path: path.join(out, `schedule-actions-${width}.png`), animations: 'disabled'
            });
            await page.keyboard.press('Tab');
            assert.equal(await copy.evaluate(node => document.activeElement === node), true);
            await copy.press('Escape');
            assert.equal(await actions.getAttribute('aria-expanded'), 'false');
            assert.equal(await actions.evaluate(node => document.activeElement === node), true);
        }
        await actions.click();
        await copy.click();
        await page.getByRole('button', { name: 'Зрозуміло' }).click();
        const exported = page.waitForResponse(response => response.url().endsWith('/api/staff/schedule/export-xlsx'));
        await page.locator('#exportExcelBtn').click();
        assert.equal((await exported).status(), 200);
        const printPopup = page.waitForEvent('popup');
        await page.locator('#printBtn').click();
        const printed = await printPopup;
        await printed.locator('table').first().waitFor();
        await printed.close();

        stage = 'finance navigation';
        await freelanceLink.click();
        await page.waitForURL('**/finance?mode=operations&tab=freelance');
        await page.locator('#freelanceFinanceTab').waitFor();
        assert.equal(await page.locator('#freelanceFinanceTab').getAttribute('aria-current'), 'page');
        await page.locator('#sidebarToggle').click();
        await waitForFinanceMenu();
        assert.equal(await menuFinance.getAttribute('aria-current'), 'page');
        await page.screenshot({ path: path.join(out, 'menu-mobile.png'), animations: 'disabled' });
        await menuFinance.click();
        await page.locator('[data-finance-group="overview"][aria-current="page"]').waitFor();
        await page.getByRole('button', { name: 'Результати й аналітика', exact: true }).click();
        await page.waitForURL('**/finance?mode=insights');
        await page.getByRole('button', { name: 'Зарплати й розрахунки' }).click();
        await page.waitForURL('**/finance?mode=operations&tab=salary');
        await page.locator('#freelanceFinanceTab').click();
        await page.waitForURL('**/finance?mode=operations&tab=freelance');
        await page.goBack();
        await page.locator('#tabSalary').waitFor();
        await page.goForward();
        await page.locator('#freelanceTitle').waitFor();
        await page.reload();
        await page.locator('#freelanceTitle').waitFor();
        await setWidth(1440);
        await waitForFinanceMenu();
        await saveScreenshot('menu-desktop');
        await setWidth(900);
        assert.equal(await menuFinance.getAttribute('aria-current'), 'page');
        assert.ok((await menuFinance.boundingBox()).width > 0);
        // The current shell disables the collapse control. Check the retained rail's accessible markup.
        const railFinance = page.locator('#sidebarMiniRail a[href="/finance"]');
        assert.equal(await railFinance.getAttribute('aria-label'), 'Фінанси та аналітика');
        assert.equal(await railFinance.getAttribute('aria-current'), 'page');
        await setWidth(1440);
        const content = page.locator('#freelancePayrollContent');
        await content.getByRole('heading', { name: 'Виходи за вибрану дату' }).waitFor();
        await content.getByRole('heading', { name: 'Розрахунки за вибрану дату' }).waitFor();
        const staffPanel = content.locator('.freelance-workday').filter({ hasText: staffName });
        await staffPanel.getByText('За графіком', { exact: false }).waitFor();
        await staffPanel.getByText('Фріланс', { exact: false }).waitFor();
        const terms = staffPanel.getByRole('button', { name: 'Погодити умови' });
        await terms.focus();
        await terms.press('Enter');
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(await terms.evaluate(node => document.activeElement === node), true);
        await terms.click();
        let dialog = page.getByRole('dialog');
        await dialog.locator('[name=rateUnit]').selectOption('fixed');
        await dialog.locator('[name=rate]').fill('480');
        await dialog.locator('[name=reason]').fill('Synthetic fixed rate');
        await dialog.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        await staffPanel.getByText('480.00 грн за вихід', { exact: false }).waitFor();
        await staffPanel.getByRole('button', { name: 'Підтвердити час' }).click();
        dialog = page.getByRole('dialog');
        const minuteInputs = dialog.locator('input[type=number]');
        await minuteInputs.nth(0).fill('240');
        await minuteInputs.nth(1).fill('180');
        await dialog.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        stage = 'finance payment';

        const paymentPanel = content.locator('.freelance-settlement').filter({ hasText: staffName });
        const pay = paymentPanel.getByRole('button', { name: 'Зафіксувати виплату' });
        await paymentPanel.getByText('До виплати', { exact: true }).waitFor();
        const payAmount = async (amount, expectedState) => {
            await pay.click();
            const paymentDialog = page.getByRole('dialog');
            assert.equal(await paymentDialog.locator('[name=paymentDate]').inputValue(), date);
            await paymentDialog.getByLabel('Сума, грн').fill(amount);
            await paymentDialog.locator('[name=accountId]').selectOption({ label: `Freelance account ${suffix}` });
            await paymentDialog.locator('[name=categoryId]').selectOption({ label: `Freelance expense ${suffix}` });
            await paymentDialog.locator('[name=reason]').fill('Synthetic registration only');
            const recorded = page.waitForResponse(response => response.url().includes('/api/payroll/freelance/payments')
                && response.request().method() === 'POST');
            await paymentDialog.getByRole('button', { name: 'Підтвердити', exact: true }).click();
            const result = await recorded;
            assert.equal(result.status(), 201, (await result.json()).error);
            await paymentPanel.getByText(expectedState, { exact: true }).waitFor();
        };
        await payAmount('123', 'Частково оплачено');
        assert.match(await paymentPanel.locator('.freelance-amounts').textContent(), /357/);
        await page.getByText('Виплату зафіксовано', { exact: true }).waitFor({ state: 'hidden' });
        await page.evaluate(() => {
            localStorage.setItem('pzp_dark_mode', 'false');
            window.initDarkMode();
            window.scrollTo(0, 0);
        });
        await saveScreenshot('finance-desktop');
        await setWidth(390);
        await assertFits();
        await saveScreenshot('finance-mobile');
        await setWidth(320);
        await assertFits();
        await page.evaluate(() => {
            localStorage.setItem('pzp_dark_mode', 'true');
            window.initDarkMode();
        });
        await saveScreenshot('finance-mobile-320-dark');
        await payAmount('357', 'Оплачено');
        assert.equal(await pay.count(), 0);

        stage = 'finance reversal';
        const reversePayment = async state => {
            await paymentPanel.locator('summary').click();
            await paymentPanel.getByRole('button', { name: 'Сторнувати' }).first().click();
            const reversalDialog = page.getByRole('dialog');
            assert.equal(await reversalDialog.getByRole('button', { name: 'Скасувати' }).evaluate(node => document.activeElement === node), true);
            assert.equal(await reversalDialog.locator('[name=paymentDate]').inputValue(), date);
            await reversalDialog.locator('[name=categoryId]').selectOption({ label: `Freelance reversal ${suffix}` });
            await reversalDialog.locator('[name=reason]').fill('Synthetic reversal only');
            const reversed = page.waitForResponse(response => response.url().includes('/api/payroll/freelance/reversals')
                && response.request().method() === 'POST');
            await reversalDialog.getByRole('button', { name: 'Сторнувати', exact: true }).click();
            assert.equal((await reversed).status(), 201);
            await paymentPanel.getByText(state, { exact: true }).waitFor();
        };
        await reversePayment('Частково оплачено');
        await reversePayment('До виплати');

        stage = 'previous balance, empty date and retry';
        const dateInput = page.getByLabel('Робоча дата');
        const tomorrow = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
        await dateInput.fill(tomorrow);
        await page.locator('[aria-labelledby="freelanceOverdueHeading"]').getByText(staffName, { exact: true }).waitFor();
        const yesterday = new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
        const dayRoute = '**/api/payroll/freelance/day?*';
        await page.route(dayRoute, route => route.fulfill({ status: 503, json: { error: 'Тестова помилка завантаження' } }), { times: 1 });
        await dateInput.fill(yesterday);
        const retry = page.getByRole('button', { name: 'Повторити', exact: true });
        await retry.click();
        await page.getByText('За вибрану дату даних немає.', { exact: true }).waitFor();
        assert.equal(await dateInput.inputValue(), yesterday);
        assert.equal(await retry.isVisible(), false);
        await page.evaluate(() => window.scrollTo(0, 0));
        await saveScreenshot('finance-empty-320-dark');

        stage = 'finance request race';
        let releasePreviousDay;
        const releasePreviousDayRequest = new Promise(resolve => { releasePreviousDay = resolve; });
        const previousDayRoute = url => url.pathname === '/api/payroll/freelance/settlement'
            && url.searchParams.get('date') === tomorrow;
        await page.route(previousDayRoute, async route => {
            await releasePreviousDayRequest;
            await route.continue();
        }, { times: 1 });
        const previousDayRequested = page.waitForRequest(request => previousDayRoute(new URL(request.url())));
        await dateInput.fill(tomorrow);
        await previousDayRequested;
        await dateInput.fill(yesterday);
        const empty = page.getByText('За вибрану дату даних немає.', { exact: true });
        await empty.waitFor();
        const previousDayResponse = page.waitForResponse(response => previousDayRoute(new URL(response.url())));
        releasePreviousDay();
        await (await previousDayResponse).finished();
        assert.equal(await empty.isVisible(), true);
        assert.equal(await content.getByText(staffName, { exact: true }).count(), 0);

        stage = 'finance and schedule access';
        const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await initializeBrowserSession(viewerContext, viewer);
        const viewerPage = await viewerContext.newPage();
        await viewerPage.goto(new URL('/profile', base).href, { waitUntil: 'domcontentloaded' });
        await viewerPage.locator('#sidebarToggle').click();
        await viewerPage.locator('#sidebarNav.open').waitFor();
        assert.equal(await viewerPage.locator('#sidebarPrimaryLinks a[href="/finance"]').count(), 0);
        await viewerContext.close();

        if (membership) {
            stage = 'read-only finance and schedule access';
            const reader = await login('creator', { identity: 'read_only', deniedActions: [
                'hr.schedule.manage', 'manage_payroll_rules', 'manage_payroll_accrual',
                'confirm_payroll_payment', 'reverse_payroll_payment'
            ] });
            const readerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
            await initializeBrowserSession(readerContext, reader);
            const readerPage = await readerContext.newPage();
            await readerPage.goto(new URL('/staff', base).href, { waitUntil: 'domcontentloaded' });
            await readerPage.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
            await readerPage.locator('#staffScheduleActionsToggle').click();
            assert.equal(await readerPage.locator('#copyWeekBtn').isVisible(), false);
            await readerPage.getByRole('link', { name: 'Фріланс-розрахунки' }).click();
            const readerRow = readerPage.locator('.freelance-settlement').filter({ hasText: staffName });
            await readerRow.getByText('До виплати', { exact: true }).waitFor();
            assert.equal(await readerPage.getByRole('button', { name: 'Типова ставка' }).count(), 0);
            assert.equal(await readerRow.getByRole('button', { name: 'Зафіксувати виплату' }).count(), 0);
            await readerRow.locator('summary').click();
            assert.equal(await readerRow.getByRole('button', { name: 'Сторнувати' }).count(), 0);
            await readerContext.close();
        }

        stage = 'embedded schedule';
        await page.goto(new URL('/hr#schedule', base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('#hrStaffScheduleShell').getByRole('link', { name: 'Фріланс-розрахунки' }).waitFor();
        await assertFits();
        await page.locator('#staffScheduleActionsToggle').click();
        await page.locator('#printBtn').waitFor();
        await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
        await page.locator('#scheduleStaffSearch').fill(staffName);
        // The isolated app can show a reconnect toast over the command bar.
        await page.locator('#hrStaffScheduleShell .staff-schedule-command-bar').screenshot({
            path: path.join(out, 'schedule-hr-320.png'), animations: 'disabled',
            style: '#toastContainer { visibility: hidden }'
        });
        console.log(`Freelance actual-app browser journey passed (${membership ? 'Park membership' : 'compatibility'})`);
    } catch (error) {
        throw new Error(`Freelance browser stage failed: ${stage}: ${error.message}`, { cause: error });
    } finally {
        await browser?.close();
        await db.end();
    }
}

run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
