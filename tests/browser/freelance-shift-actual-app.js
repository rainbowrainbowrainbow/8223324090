'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const { recordAttendanceClockIn, recordAttendanceClockOut } = require('../../services/hrAttendance');
const { lockAttendanceWriteTarget } = require('../../services/attendanceWriteLock');
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
    const request = async (auth, route, { method = 'GET', context = 'event_genix', scope = 'single', body } = {}) => fetch(new URL(route, base), {
        method,
        ...(body && { body: JSON.stringify(body) }),
        headers: { Authorization: 'Bearer ' + (auth.accessToken || auth.token), 'X-Business-Context': context,
            'X-Business-Scope': scope, ...(body && { 'Content-Type': 'application/json' }) }
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
        const salesMenu = '#sidebarLinks [data-group-key="sales"]';
        const menuFinanceSelector = `${salesMenu} a[href="/finance"]`;
        const menuFinance = page.locator(menuFinanceSelector);
        const revealFinanceMenu = async () => {
            const salesToggle = page.locator(`${salesMenu} .sidebar-group-header`);
            await salesToggle.waitFor();
            if (await salesToggle.getAttribute('aria-expanded') !== 'true') await salesToggle.click();
            await page.locator(`${menuFinanceSelector}[aria-current="page"]`).waitFor({ state: 'visible' });
            await page.waitForFunction(selector => {
                const link = document.querySelector(selector);
                if (!link?.getClientRects().length) return false;
                link.scrollIntoView({ block: 'nearest' });
                return true;
            }, `${menuFinanceSelector}[aria-current="page"]`);
        };

        const openSchedule = async (workDate = date, route = '/staff') => {
            await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
            await page.locator('#scheduleWorkModeFilter').selectOption('all');
            await page.locator('#scheduleDateFrom').fill(workDate);
            await page.locator('#scheduleDateTo').fill(workDate);
            await page.locator('#applyScheduleRangeBtn').click();
            await page.locator('#deptFilter [data-dept="animators"]').click();
            const toggle = page.locator('[data-schedule-group-toggle="animators"]');
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            const cell = page.locator(`.sch-cell[data-staff="${staff.id}"][data-date="${workDate}"]`).first();
            await cell.waitFor().catch(async error => {
                const visibleDates = await page.locator(`.sch-cell[data-staff="${staff.id}"]`)
                    .evaluateAll(cells => cells.map(node => node.dataset.date));
                const shownRange = await Promise.all(['#scheduleDateFrom', '#scheduleDateTo']
                    .map(selector => page.locator(selector).inputValue()));
                throw new Error(`Schedule range ${shownRange.join('–')}, visible staff dates ${visibleDates.join(', ')}: ${error.message}`);
            });
            return cell;
        };
        const controlName = 'Synthetic 230-minute freelance ' + suffix;
        const { rows: [control] } = await db.query(
            `INSERT INTO staff (name, department, position, role_type, rate_unit, hourly_rate, is_active)
             VALUES ($1, 'animators', 'Synthetic QA', 'animator', 'hour', 120, true) RETURNING id`,
            [controlName]
        );
        const { rows: [reserve, blacklisted, trampolineReserve] } = await db.query(
            `INSERT INTO staff (name, department, position, role_type, secondary_professions, rate_unit, hourly_rate,
                                is_active, hr_pool_status, termination_date)
             VALUES ($1, 'animators', 'Synthetic QA', 'animator', '["waiter"]', 'hour', 120, false, 'reserve', $3::date - 1),
                    ($2, 'animators', 'Synthetic QA', 'animator', '[]', 'hour', 120, false, 'blacklisted', $3::date - 1),
                    ($4, 'trampoline', 'Synthetic QA', 'trampoline_instructor', '[]', 'hour', 120, false, 'reserve', $3::date - 1)
             RETURNING id, name`,
            ['Synthetic Reserve ' + suffix, 'Synthetic Blacklist ' + suffix, date, 'Synthetic Trampoline Reserve ' + suffix]
        );
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
        stage = 'freelance row creation';
        const toggle = page.locator('[data-freelance-toggle="animators"]');
        const row = page.locator('#scheduleFreelance-animators');
        const controlRecords = row.locator('[data-freelance-segment][data-freelance-staff="' + control.id + '"]');
        const savePlan = async () => {
            const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/schedule'
                && response.request().method() === 'PUT');
            await page.locator('#schSaveBtn').click();
            const result = await pending;
            assert.equal(result.status(), 200, await result.text());
            await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
            return result.request().postDataJSON();
        };
        const setTime = async (card, start, end) => {
            assert.equal(await card.locator('[data-segment-field="work-mode"]').inputValue(), 'freelance');
            await card.locator('[data-segment-field="start"]').fill(start);
            await card.locator('[data-segment-field="end"]').fill(end);
        };
        assert.equal(await page.locator('#scheduleBody .schedule-freelance-from-staff').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Додати фріланс', exact: true }).count(), 0);
        const controlCell = page.locator('.sch-cell[data-staff="' + control.id + '"][data-date="' + date + '"]').first();
        await controlCell.press('Enter');
        assert.match(await page.locator('#schModalTitle').textContent(), new RegExp(controlName + '.*' + date));
        const editorAdd = page.getByRole('button', { name: 'Додати фріланс', exact: true });
        assert.equal(await editorAdd.count(), 1);
        await editorAdd.press('Space');
        assert.equal(await cards.first().locator('[data-segment-field="start"]').evaluate(input => input === document.activeElement), true);
        await setTime(cards.first(), '12:00', '16:00');
        await savePlan();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.press('Space');
        await row.waitFor();
        await row.getByRole('button', { name: '+ Додати фріланс · ' + date }).click();
        const chooser = page.getByRole('dialog', { name: 'Додати фріланс' });
        await chooser.getByText('Аніматори · ' + date, { exact: true }).waitFor();
        await chooser.getByLabel('Співробітник').selectOption(String(control.id));
        await chooser.getByRole('button', { name: 'Відкрити план' }).click();
        await setTime(cards.nth(1), '15:59', '20:00');
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, 'Overlapping freelance plans cannot be saved');
        await setTime(cards.nth(1), '16:00', '20:00');
        const added = await savePlan();
        const replay = await Promise.all([0, 1].map(() => request(auth, '/api/staff/schedule', { method: 'PUT', body: added })));
        assert.deepEqual(replay.map(response => response.status), [409, 409]);
        assert.deepEqual(await controlRecords.locator('span').allTextContents(), ['12:00–16:00', '16:00–20:00']);
        stage = 'freelance reserve picker and server validation';
        await openSchedule(date, '/hr#schedule');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const addFreelance = row.getByRole('button', { name: '+ Додати фріланс · ' + date });
        const reserveOption = 'reserve:' + reserve.id + ':animator';
        const staffPicker = chooser.getByLabel('Співробітник');
        await addFreelance.click();
        await staffPicker.locator('option[value="' + reserveOption + '"]').waitFor({ state: 'attached' });
        assert.match(await staffPicker.locator('option[value="' + reserveOption + '"]').evaluate(option =>
            option.parentElement.label), /^Резерв · /);
        assert.equal(await staffPicker.locator('option[value="reserve:' + reserve.id + ':waiter"]').count(), 1);
        assert.equal(await staffPicker.locator('option').filter({ hasText: blacklisted.name }).count(), 0);
        assert.equal(await staffPicker.evaluate(select => select === document.activeElement), true);
        await chooser.screenshot({ path: path.join(out, 'freelance-reserve-picker-desktop.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await chooser.waitFor({ state: 'hidden' });
        assert.equal(await addFreelance.evaluate(button => button === document.activeElement), true);
        await setWidth(320);
        await addFreelance.click();
        await staffPicker.locator('option[value="' + reserveOption + '"]').waitFor({ state: 'attached' });
        assert.ok(await chooser.evaluate(dialog => {
            const rect = dialog.getBoundingClientRect();
            return rect.left >= 8 && rect.right <= innerWidth - 8
                && Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2;
        }), 'Picker must fit and center on a 320px viewport');
        await staffPicker.selectOption(reserveOption);
        await chooser.screenshot({ path: path.join(out, 'freelance-reserve-picker-320.png'), animations: 'disabled' });
        await chooser.getByRole('button', { name: 'Відкрити план' }).click();
        await setTime(cards.first(), '12:00', '14:00');
        const reservePlan = await savePlan();
        assert.equal(reservePlan.reserveFreelance, true);
        assert.equal(await page.locator('[data-schedule-staff-row="' + reserve.id + '"]').count(), 0);
        const reserveRecord = row.getByRole('button', { name: new RegExp(reserve.name) });
        await reserveRecord.waitFor();
        const workModeFilter = page.locator('#scheduleWorkModeFilter');
        await workModeFilter.selectOption('regular');
        await reserveRecord.waitFor({ state: 'hidden' });
        await workModeFilter.selectOption('freelance');
        await reserveRecord.waitFor();
        assert.match(await page.locator('#scheduleStaffFilterInfo').textContent(), /З резерву на фрілансі — 1/);
        await workModeFilter.selectOption('all');
        const plans = (await (await request(auth, '/api/staff/schedule?from=' + date + '&to=' + date
            + '&include_freelance_reserve=true')).json()).data;
        const reserveEntry = plans.find(plan => plan.staff_id === reserve.id);
        assert.equal(reserveEntry.hr_pool_status, 'reserve');
        const updateReserve = { ...reservePlan, expectedUpdatedAt: reserveEntry.planUpdatedAt, segments: reserveEntry.segments };
        const overlap = await request(auth, '/api/staff/schedule', { method: 'PUT', body: {
            ...updateReserve, segments: [...updateReserve.segments,
                { professionKey: 'animator', shiftStart: '13:00', shiftEnd: '15:00', workMode: 'freelance' }]
        } });
        assert.equal((await overlap.json()).code, 'HR_SHIFT_PLAN_SEGMENTS_OVERLAP');
        const regular = await request(auth, '/api/staff/schedule', { method: 'PUT', body: {
            ...updateReserve, segments: updateReserve.segments.map(segment => ({ ...segment, workMode: 'regular' }))
        } });
        assert.equal((await regular.json()).code, 'STAFF_RESERVE_FREELANCE_ONLY');
        const stale = await request(auth, '/api/staff/schedule', { method: 'PUT', body: reservePlan });
        assert.equal(stale.status, 409);
        await setWidth(1440);
        await openSchedule(date, '/hr#schedule');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await reserveRecord.click();
        await page.locator('#schStatus').selectOption('dayoff');
        await savePlan();
        await reserveRecord.waitFor({ state: 'hidden' });

        stage = 'empty freelance filter across all departments';
        const laterDate = offset => new Date(Date.parse(date + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
        const trampolineDate = laterDate(8);
        const rangeStart = laterDate(7);
        const readRange = async (from, to) => {
            await page.locator('#scheduleDateFrom').fill(from);
            await page.locator('#scheduleDateTo').fill(to);
            const [response] = await Promise.all([
                page.waitForResponse(response => {
                    const url = new URL(response.url());
                    return response.request().method() === 'GET' && url.pathname === '/api/staff/schedule'
                        && url.searchParams.get('from') === from && url.searchParams.get('to') === to;
                }),
                page.locator('#applyScheduleRangeBtn').click()
            ]);
            assert.equal(response.status(), 200);
            await page.locator('#scheduleDataRegion[data-schedule-state="ready"], #scheduleDataRegion[data-schedule-state="empty"]').waitFor();
            return (await response.json()).data;
        };
        await page.goto(new URL('/hr#schedule', base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
        const beforeFirstFreelance = await readRange(rangeStart, trampolineDate);
        assert.equal(beforeFirstFreelance.some(entry => entry.segments?.some(segment => segment.workMode === 'freelance')), false);
        await page.locator('#deptFilter [data-dept="all"]').click();
        const departments = await page.locator('#deptFilter [data-dept]:not([data-dept="all"])')
            .evaluateAll(chips => chips.map(chip => chip.dataset.dept));
        assert.ok(departments.includes('trampoline'));
        for (const mode of ['all', 'freelance']) {
            await workModeFilter.selectOption(mode);
            for (const department of departments) {
                await page.locator(`#scheduleBody button[data-freelance-toggle="${department}"]`).waitFor();
            }
        }
        const emptyAdd = page.getByRole('button', { name: 'Додати фріланс', exact: true });
        await emptyAdd.waitFor();
        await emptyAdd.press('Enter');
        await chooser.getByText('Усі відділи', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await chooser.waitFor({ state: 'hidden' });
        assert.equal(await emptyAdd.evaluate(button => button === document.activeElement), true);
        stage = 'first freelance assignment from an empty department';
        await page.locator('#deptFilter [data-dept="trampoline"]').click();
        assert.equal(await page.locator('#scheduleBody [data-schedule-staff-row]').count(), 0);
        const trampolineRow = page.locator('#scheduleFreelance-trampoline');
        await workModeFilter.selectOption('all');
        await page.locator('#scheduleStaffSearch').fill(trampolineReserve.name);
        assert.equal(await page.locator('#scheduleBody [data-schedule-staff-row]').count(), 0);
        await emptyAdd.waitFor();
        await workModeFilter.selectOption('regular');
        await page.locator('#scheduleStaffSearch').fill('Unmatched synthetic search');
        await setWidth(320);
        await assertFits();
        await emptyAdd.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'freelance-empty-320.png'), animations: 'disabled' });
        await emptyAdd.click();
        await chooser.getByText('Батутисти', { exact: true }).waitFor();
        const pickerDate = chooser.getByLabel('Дата виходу');
        assert.equal(await pickerDate.inputValue(), rangeStart);
        assert.equal(await pickerDate.evaluate(input => input === document.activeElement), true);
        const trampolineOption = 'reserve:' + trampolineReserve.id + ':trampoline_instructor';
        await staffPicker.locator(`option[value="${trampolineOption}"]`).waitFor({ state: 'attached' });
        await staffPicker.selectOption(trampolineOption);
        const openPlan = chooser.getByRole('button', { name: 'Відкрити план' });
        await pickerDate.fill(laterDate(45));
        assert.equal(await pickerDate.evaluate(input => input.validity.rangeOverflow), true);
        assert.match(await chooser.locator('#scheduleFreelanceDateHint').innerText(), /Дати графіка:/);
        assert.equal(await openPlan.isEnabled(), true);
        await openPlan.click();
        assert.equal(await chooser.isVisible(), true);
        assert.equal(await pickerDate.evaluate(input => input === document.activeElement), true);
        await pickerDate.fill(trampolineDate);
        await chooser.screenshot({ path: path.join(out, 'freelance-empty-picker-320.png'), animations: 'disabled' });
        await openPlan.click();
        await cards.first().waitFor();
        await setTime(cards.first(), '12:00', '14:00');
        const trampolinePlan = await savePlan();
        assert.equal(trampolinePlan.primaryProfessionKey, 'trampoline_instructor');
        assert.equal(trampolinePlan.reserveFreelance, true);
        assert.equal(trampolinePlan.date, trampolineDate);
        assert.equal(await workModeFilter.inputValue(), 'freelance');
        assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), '');
        const trampolineRecord = trampolineRow.getByRole('button', { name: new RegExp(trampolineReserve.name) });
        await trampolineRecord.waitFor();
        assert.match(await trampolineRecord.textContent(), /12:00–14:00/);
        await page.locator('#scheduleRangeState').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(out, 'freelance-trampoline-320.png'), animations: 'disabled' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
        const afterReload = await readRange(trampolineDate, trampolineDate);
        assert.equal(afterReload.some(entry => entry.staff_id === trampolineReserve.id), true);
        await page.locator('#deptFilter [data-dept="trampoline"]').click();
        await workModeFilter.selectOption('freelance');
        const trampolineToggle = page.locator('[data-freelance-toggle="trampoline"]');
        await trampolineToggle.press('Enter');
        assert.equal(await trampolineToggle.evaluate(button => button === document.activeElement), true);
        await trampolineRecord.waitFor();
        assert.match(await trampolineRecord.textContent(), /12:00–14:00/);
        await setWidth(1440);
        await workModeFilter.selectOption('all');

        stage = 'freelance across adjacent dates';
        const writePlan = (staffId, workDate, segments, extra = {}) => request(auth, '/api/staff/schedule', {
            method: 'PUT', body: { staffId, date: workDate, status: 'working', primaryProfessionKey: segments[0]?.professionKey, segments, ...extra }
        });
        const firstDate = laterDate(20);
        const nextDate = laterDate(21);
        const nextRegular = { professionKey: 'animator', workMode: 'regular', shiftStart: '02:00', shiftEnd: '04:00' };
        const regularSaved = await writePlan(control.id, nextDate, [nextRegular]);
        assert.equal(regularSaved.status, 200, await regularSaved.clone().text());
        const regularEntry = (await regularSaved.json()).data;
        const overnight = { professionKey: 'animator', workMode: 'freelance', shiftStart: '22:00', shiftEnd: '03:00',
            startDayOffset: 0, endDayOffset: 1 };
        const conflictWithNext = await writePlan(control.id, firstDate, [overnight]);
        assert.equal(conflictWithNext.status, 409, await conflictWithNext.clone().text());
        const nextConflict = await conflictWithNext.json();
        assert.equal(nextConflict.code, 'HR_SHIFT_PLAN_ADJACENT_DATE_OVERLAP');
        assert.equal(nextConflict.details.conflictDate, nextDate);
        const adjacent = await writePlan(control.id, firstDate, [{ ...overnight, shiftEnd: '02:00' }]);
        assert.equal(adjacent.status, 200, await adjacent.text());
        const conflictWithPrevious = await writePlan(control.id, nextDate, [{
            ...nextRegular, id: regularEntry.segments[0].id, shiftStart: '01:59'
        }], { expectedUpdatedAt: regularEntry.planUpdatedAt });
        assert.equal(conflictWithPrevious.status, 409);
        assert.equal((await conflictWithPrevious.json()).details.conflictDate, firstDate);
        const concurrentPlans = await Promise.all([
            writePlan(reserve.id, firstDate, [overnight], { reserveFreelance: true }),
            writePlan(reserve.id, nextDate, [{ ...nextRegular, workMode: 'freelance' }], { reserveFreelance: true })
        ]);
        assert.deepEqual(concurrentPlans.map(result => result.status).sort(), [200, 409]);
        const rejectedPlan = concurrentPlans.find(result => result.status === 409);
        assert.equal((await rejectedPlan.json()).code, 'HR_SHIFT_PLAN_ADJACENT_DATE_OVERLAP');
        await db.query(
            `INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
             VALUES ($1, $2, 'working', '22:00', '02:00')`,
            [control.id, laterDate(25)]
        );
        const legacyConflict = await writePlan(control.id, laterDate(26), [{
            ...nextRegular, workMode: 'freelance', shiftStart: '01:00'
        }]);
        assert.equal(legacyConflict.status, 409);
        assert.equal((await legacyConflict.json()).code, 'HR_SHIFT_PLAN_ADJACENT_DATE_OVERLAP');

        stage = 'cross-department placement and agreed cancellation';
        const { rows: [dual] } = await db.query(
            `INSERT INTO staff (name, department, position, role_type, secondary_professions, is_active)
             VALUES ('Synthetic Dual Role', 'animators', 'Synthetic QA', 'animator', '["trampoline_instructor"]', true) RETURNING id`
        );
        const future = laterDate(7);
        const dualPlan = [
            { professionKey: 'animator', workMode: 'regular', shiftStart: '09:00', shiftEnd: '11:00', breakMinutes: 0 },
            { professionKey: 'trampoline_instructor', workMode: 'freelance', shiftStart: '12:00', shiftEnd: '16:00', breakMinutes: 0 }
        ];
        const dualSaved = await writePlan(dual.id, future, dualPlan);
        assert.equal(dualSaved.status, 200, await dualSaved.clone().text());
        const dualEntry = (await dualSaved.json()).data;
        const target = dualEntry.segments[1];
        const agree = async (staffId, date, segmentId) => request(auth, '/api/payroll/freelance/terms', {
            method: 'POST', body: { staffId, date, segmentId, rateUnit: 'hour', rate: '120', reason: 'Synthetic QA' }
        });
        assert.equal((await agree(dual.id, future, target.id)).status, 201);
        const reserveSingle = await writePlan(reserve.id, future, [{ ...dualPlan[0], workMode: 'freelance' }], { reserveFreelance: true });
        assert.equal(reserveSingle.status, 200, await reserveSingle.clone().text());
        const reserveFuture = (await reserveSingle.json()).data;
        assert.equal((await agree(reserve.id, future, reserveFuture.segments[0].id)).status, 201);
        const reserveCancelOptions = { status: 'dayoff', primaryProfessionKey: null, reserveFreelance: true,
            expectedUpdatedAt: reserveFuture.planUpdatedAt, cancelFreelanceSegmentIds: [reserveFuture.segments[0].id] };
        const attendanceWriter = await db.connect();
        try {
            await attendanceWriter.query('BEGIN');
            await lockAttendanceWriteTarget(attendanceWriter, { staffId: reserve.id, date: future });
            const busy = await writePlan(reserve.id, future, [], reserveCancelOptions);
            assert.equal(busy.status, 409);
            assert.equal((await busy.json()).code, 'FREELANCE_CANCELLATION_ATTENDANCE_BUSY');
        } finally {
            await attendanceWriter.query('ROLLBACK');
            attendanceWriter.release();
        }
        const cancelledReserve = await writePlan(reserve.id, future, [], reserveCancelOptions);
        assert.equal(cancelledReserve.status, 200, await cancelledReserve.clone().text());
        const reserveReplay = await writePlan(reserve.id, future, [], reserveCancelOptions);
        assert.equal(reserveReplay.status, 409);
        assert.equal((await reserveReplay.json()).code, 'HR_SHIFT_PLAN_STALE');
        const implicit = await writePlan(dual.id, future, [], { status: 'dayoff', primaryProfessionKey: null, expectedUpdatedAt: dualEntry.planUpdatedAt });
        assert.equal(implicit.status, 409);
        assert.equal((await implicit.json()).code, 'FREELANCE_EXPLICIT_CANCELLATION_REQUIRED');
        const dualBlock = page.locator(`[data-freelance-segment="${target.id}"]`);
        for (const [route, width] of [['/staff', 1440], ['/staff', 320], ['/hr#schedule', 1440], ['/hr#schedule', 320]]) {
            await setWidth(width);
            await openSchedule(future, route);
            assert.equal(await page.locator('#scheduleBody .schedule-freelance-from-staff').count(), 0);
            await page.locator('#deptFilter [data-dept="all"]').click();
            if (await trampolineToggle.getAttribute('aria-expanded') !== 'true') await trampolineToggle.press('Space');
            assert.equal(await dualBlock.count(), 1);
            assert.equal(await dualBlock.evaluate(button => button.closest('tr').id), 'scheduleFreelance-trampoline');
            await dualBlock.press('Enter');
            assert.equal(await page.locator('#schSegmentsList .is-active').getAttribute('data-segment-id'), String(target.id));
            await assertFits();
            if (width === 320) await page.screenshot({ path: path.join(out, route === '/staff' ? 'freelance-staff-editor-320.png' : 'freelance-hr-editor-320.png') });
            await page.waitForFunction(() => document.querySelector('#schModalOverlay')?.contains(document.activeElement));
            await page.keyboard.press('Escape');
            await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
            await page.waitForFunction(id => document.activeElement?.dataset.freelanceSegment === String(id), target.id);
            await page.locator('#deptFilter [data-dept="trampoline"]').click();
            assert.equal(await dualBlock.count(), 1);
        }
        await workModeFilter.selectOption('freelance');
        assert.equal(await dualBlock.count(), 1);
        await workModeFilter.selectOption('regular');
        assert.equal(await dualBlock.count(), 0);
        await page.locator('#deptFilter [data-dept="animators"]').click();
        const dualCell = page.locator(`.sch-cell[data-staff="${dual.id}"][data-date="${future}"]`).first();
        await dualCell.press('Enter');
        await editorAdd.click();
        await setTime(cards.nth(2), '16:00', '19:00');
        await savePlan();
        await page.getByText(/Фріланс збережено.*скиньте фільтри.*Аніматори/).waitFor();
        const staleCancellation = await writePlan(dual.id, future, [dualEntry.segments[0]], {
            expectedUpdatedAt: dualEntry.planUpdatedAt, cancelFreelanceSegmentIds: [target.id]
        });
        assert.equal(staleCancellation.status, 409);
        assert.equal((await staleCancellation.json()).code, 'HR_SHIFT_PLAN_STALE');
        await workModeFilter.selectOption('all');
        await page.locator('#deptFilter [data-dept="all"]').click();
        const addedDualBlock = page.locator(`#scheduleFreelance-animators [data-freelance-staff="${dual.id}"]`);
        assert.equal(await addedDualBlock.count(), 1);
        const addedDualId = await addedDualBlock.getAttribute('data-freelance-segment');
        assert.notEqual(addedDualId, String(target.id));
        assert.equal(await page.locator(`[data-freelance-segment="${addedDualId}"]`).count(), 1);
        await addedDualBlock.press('Enter');
        assert.equal(await page.locator('#schSegmentsList .is-active').getAttribute('data-segment-id'), addedDualId);
        await page.waitForFunction(() => document.querySelector('#schModalOverlay')?.contains(document.activeElement));
        await page.keyboard.press('Escape');
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
        await dualBlock.click();
        const cancelButton = cards.nth(1).getByRole('button', { name: 'Скасувати фріланс · блок 2' });
        await cancelButton.press('Enter');
        const confirmCancel = page.locator('.confirm-overlay[data-confirm-kind="confirm"]');
        const returnButton = confirmCancel.getByRole('button', { name: 'Повернутись' });
        await returnButton.waitFor();
        await page.waitForFunction(button => button === document.activeElement, await returnButton.elementHandle());
        await page.keyboard.press('Escape');
        await confirmCancel.waitFor({ state: 'hidden' });
        await page.waitForFunction(button => button === document.activeElement, await cancelButton.elementHandle());
        await cancelButton.press('Enter');
        await confirmCancel.getByRole('button', { name: 'Скасувати фріланс' }).click();
        const cancellation = await savePlan();
        assert.deepEqual(cancellation.cancelFreelanceSegmentIds, [String(target.id)]);
        await dualBlock.waitFor({ state: 'detached' });
        const listed = (await (await request(auth, '/api/staff/schedule?from=' + future + '&to=' + future)).json()).data
            .find(plan => plan.staff_id === dual.id);
        assert.deepEqual(listed.segments.map(block => block.shiftStart), ['09:00', '16:00']);
        assert.equal(String(listed.segments[0].id), String(dualEntry.segments[0].id));
        assert.equal(String(listed.segments[1].id), addedDualId);
        const { rows: [archived] } = await db.query(
            `SELECT segment.id, segment.hr_shift_id, segment.cancelled_staff_id, segment.cancelled_shift_date::text,
                    segment.cancelled_by, segment.cancelled_at, terms.rate::text
             FROM hr_shift_segments segment JOIN hr_freelance_segment_terms terms ON terms.segment_id = segment.id
             WHERE segment.id = $1`, [target.id]
        );
        assert.equal(archived.id, String(target.id));
        assert.equal(archived.hr_shift_id, null);
        assert.equal(archived.cancelled_staff_id, dual.id);
        assert.equal(archived.cancelled_shift_date, future);
        assert.match(archived.cancelled_by, /^freelance_qa_creator_/);
        assert.ok(archived.cancelled_at instanceof Date);
        assert.equal(archived.rate, '120.00');
        const replayCancel = await request(auth, '/api/staff/schedule', { method: 'PUT', body: cancellation });
        assert.equal(replayCancel.status, 409);
        assert.equal((await replayCancel.json()).code, 'HR_SHIFT_PLAN_STALE');
        assert.equal((await request(viewer, '/api/staff/schedule', { method: 'PUT', body: cancellation })).status, 403);
        const noLongerActive = (await (await request(auth, `/api/payroll/freelance/day?date=${future}&staffId=${dual.id}`)).json()).data;
        assert.ok(noLongerActive.every(day => day.segments.every(block => String(block.id) !== String(target.id))));
        const reassigned = await writePlan(dual.id, future, [...listed.segments, dualPlan[1]], { expectedUpdatedAt: listed.planUpdatedAt });
        assert.equal(reassigned.status, 200, await reassigned.clone().text());
        const assignment = (await reassigned.json()).data.segments.find(block => block.professionKey === 'trampoline_instructor');
        assert.notEqual(String(assignment.id), String(target.id));
        console.log('Cancellation and department proof', JSON.stringify({ repeatedCellButtons: 0, editorsAt320: 2,
            overviewDepartment: 'trampoline', scopedDepartment: 'trampoline', archivedRate: archived.rate,
            cancelledId: target.id, reassignedId: assignment.id, preservedBlocks: listed.segments.length, replayStatus: replayCancel.status }));

        stage = 'freelance row edits';
        await openSchedule();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const mixedRecord = row.locator('[data-freelance-segment][data-freelance-staff="' + staff.id + '"]');
        await mixedRecord.click();
        await setTime(cards.nth(1), '16:00', '20:00');
        await savePlan();
        const matchingTimes = row.getByText('16:00–20:00', { exact: true });
        assert.equal(await matchingTimes.count(), 2);
        await mixedRecord.getByText('16:00–20:00', { exact: true }).click();
        assert.ok((await page.locator('#schModalTitle').textContent()).includes(staffName));
        await setTime(cards.nth(1), '14:00', '17:00');
        await savePlan();
        const selectedSegmentId = await controlRecords.nth(1).getAttribute('data-freelance-segment');
        await controlRecords.nth(1).click();
        assert.equal(await cards.nth(1).getAttribute('data-segment-id'), selectedSegmentId);
        await page.locator('#schCancelBtn').click();
        await page.locator('[data-schedule-freelance-ref="' + selectedSegmentId + '"]').click();
        assert.ok((await page.locator('#schModalTitle').textContent()).includes(controlName));
        assert.equal(await cards.nth(1).getAttribute('data-segment-id'), selectedSegmentId);
        await page.locator('#schCancelBtn').click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByText('Зміну збережено', { exact: true }).first().waitFor({ state: 'hidden' });
        await row.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await assertFits();
        await page.screenshot({ path: path.join(out, 'freelance-row-two-intervals-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 900 });
        await toggle.click();
        await row.waitFor({ state: 'hidden' });
        stage = 'schedule reload';
        cell = await openSchedule();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.press('Enter');
        await controlRecords.nth(0).press('Enter');
        assert.match(await page.locator('#schModalTitle').textContent(), /12:00–16:00/);
        await page.locator('#schCancelBtn').click();
        await controlRecords.nth(1).click();
        assert.match(await page.locator('#schModalTitle').textContent(), /16:00–20:00/);
        await page.locator('#schCancelBtn').click();
        const controlPlanAtReload = (await (await request(auth, '/api/staff/schedule?from=' + date + '&to=' + date)).json())
            .data.find(plan => plan.staff_id === control.id);
        const removeUnagreedFixture = await writePlan(control.id, date, [controlPlanAtReload.segments[0]],
            { expectedUpdatedAt: controlPlanAtReload.planUpdatedAt });
        assert.equal(removeUnagreedFixture.status, 200, await removeUnagreedFixture.text());
        await openSchedule();
        await toggle.press('Enter');
        await controlRecords.nth(1).waitFor({ state: 'detached' });
        await controlRecords.first().click();
        await setTime(cards.first(), '23:00', '01:00');
        await savePlan();
        await controlRecords.first().getByText('23:00–01:00', { exact: true }).click();
        await setTime(cards.first(), '12:00', '16:00');
        await savePlan();
        await page.setViewportSize({ width: 390, height: 844 });
        await controlRecords.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'freelance-row-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 900 });
        const attendanceClient = await db.connect();
        try {
            await attendanceClient.query('BEGIN');
            const work = { staffId: control.id, recordDate: date, businessContext: 'event_genix', performedBy: 'qa' };
            const { rows: [times] } = await attendanceClient.query(
                "SELECT ($1::date + TIME '12:10') AT TIME ZONE 'Europe/Kyiv' AS arrival, ($1::date + TIME '16:00') AT TIME ZONE 'Europe/Kyiv' AS departure",
                [date]
            );
            await recordAttendanceClockIn(attendanceClient, { ...work, actualTime: times.arrival });
            await recordAttendanceClockOut(attendanceClient, { ...work, actualTime: times.departure });
            await attendanceClient.query('COMMIT');
        } finally {
            attendanceClient.release();
        }
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
        await revealFinanceMenu();
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
        await revealFinanceMenu();
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
        const controlPanel = content.locator('.freelance-workday').filter({ hasText: controlName });
        await controlPanel.getByText(/План 12:00–16:00/).waitFor();
        await controlPanel.getByText(/Факт\s+12:10–16:00 · 3 год 50 хв\s+· До розрахунку 0 хв/).waitFor();
        let [controlDay] = (await (await request(auth, endpoint + '&staffId=' + control.id)).json()).data;
        const correctionPath = '/api/hr/records/' + controlDay.attendance_id + '/correct';
        await db.query("UPDATE hr_time_records SET auto_closed = TRUE, status = 'auto_closed', clock_out = NULL WHERE id = $1",
            [controlDay.attendance_id]);
        [controlDay] = (await (await request(auth, endpoint + '&staffId=' + control.id)).json()).data;
        assert.equal(controlDay.attendanceState, 'review');
        const correction = { record_version: controlDay.record_version, clock_out_time: '16:00', notes: 'Synthetic HR review' };
        const corrected = await request(auth, correctionPath, { method: 'PUT', body: correction });
        assert.equal(corrected.status, 200);
        [controlDay] = (await (await request(auth, endpoint + '&staffId=' + control.id)).json()).data;
        assert.equal(controlDay.actualMinutes, 230);
        const [controlSegment] = controlDay.segments;
        assert.equal(controlSegment.confirmedMinutes, null);
        const controlSchedule = (await (await request(auth, '/api/staff/schedule?from=' + date + '&to=' + date)).json())
            .data.find(plan => plan.staff_id === control.id);
        const lockedCancellation = () => writePlan(control.id, date, [], { status: 'dayoff', primaryProfessionKey: null,
            expectedUpdatedAt: controlSchedule.planUpdatedAt, cancelFreelanceSegmentIds: [controlSegment.id] });
        const startedCancel = await lockedCancellation();
        assert.equal(startedCancel.status, 409);
        assert.equal((await startedCancel.json()).code, 'FREELANCE_CANCELLATION_AFTER_START');
        assert.equal((await request(auth, '/api/payroll/freelance/terms', {
            method: 'POST', body: { staffId: control.id, date, segmentId: controlSegment.id, rateUnit: 'hour', rate: '120', reason: 'Synthetic control' }
        })).status, 201);
        const confirmation = { staffId: control.id, date, attendanceId: controlDay.attendance_id,
            allocations: [{ segmentId: controlSegment.id, minutes: 230 }] };
        await page.reload();
        await controlPanel.getByRole('button', { name: 'Підтвердити час' }).click();
        const controlDialog = page.getByRole('dialog');
        assert.equal(await controlDialog.locator('input[type=number]').inputValue(), '230');
        const confirmed = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/payroll/freelance/attendance');
        await controlDialog.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        assert.equal((await confirmed).status(), 201);
        const confirmedCancel = await lockedCancellation();
        assert.equal(confirmedCancel.status, 409);
        assert.equal((await confirmedCancel.json()).code, 'FREELANCE_CANCELLATION_CONFIRMED');
        const locked = await request(auth, correctionPath, { method: 'PUT', body: { ...correction, clock_out_time: '16:05' } });
        assert.equal(locked.status, 409);
        assert.equal((await locked.json()).code, 'FREELANCE_ATTENDANCE_LOCKED');
        assert.equal((await request(auth, '/api/payroll/freelance/attendance', { method: 'POST', body: confirmation })).status, 409);
        await page.reload();
        await controlPanel.getByText(/До розрахунку 3 год 50 хв/).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await controlPanel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'freelance-confirmed-230-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 900 });
        assert.equal(await content.locator('.freelance-settlement').filter({ hasText: controlName }).count(), 1);
        const exportedPayroll = await request(auth, '/api/payroll/export-xlsx?month=' + date.slice(0, 7));
        assert.equal(exportedPayroll.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await exportedPayroll.arrayBuffer());
        const freelanceSheet = workbook.getWorksheet('Фріланс');
        const controlRows = freelanceSheet.getRows(2, freelanceSheet.rowCount - 1)
            .filter(sheetRow => sheetRow.getCell(2).value === controlName);
        assert.equal(controlRows.length, 1);
        assert.deepEqual(controlRows[0].values.slice(4), ['12:00', '16:00', 240, '12:10', '16:00', 230, 'Підтверджено', 230]);
        const scheduleLink = controlPanel.getByRole('link', { name: 'Відкрити в графіку' });
        const linkedPage = await page.context().newPage();
        await linkedPage.goto(new URL(await scheduleLink.getAttribute('href'), base).href);
        await linkedPage.locator('#schModalOverlay').waitFor();
        assert.match(await linkedPage.locator('#schModalTitle').textContent(), /12:00–16:00/);
        await linkedPage.close();
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
        const [paidDay] = (await (await request(auth, endpoint + '&staffId=' + staff.id)).json()).data;
        const paidCorrection = await request(auth, '/api/hr/records/' + paidDay.attendance_id + '/correct', {
            method: 'PUT', body: { record_version: paidDay.record_version, clock_out_time: '17:05', notes: 'Synthetic paid correction attempt' }
        });
        assert.equal(paidCorrection.status, 409);
        assert.equal((await paidCorrection.json()).code, 'FREELANCE_ATTENDANCE_LOCKED');
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
        await viewerPage.locator('#sidebarLinks.rendered').waitFor({ state: 'attached' });
        assert.equal(await viewerPage.locator('#sidebarLinks a[href="/finance"]').count(), 0);
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
            await readerPage.locator('#scheduleWorkModeFilter').selectOption('freelance');
            await readerPage.locator('#scheduleStaffSearch').fill('No matching synthetic employees');
            assert.equal(await readerPage.locator('#scheduleAddFreelanceBtn').isVisible(), false);
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
        stage = 'mobile night schedule';
        const nightDate = kyivDate.format(new Date(browserTime.getTime() + 2 * 86400000));
        await page.setViewportSize({ width: 390, height: 844 });
        cell = await openSchedule(nightDate);
        await cell.click();
        await page.locator('#schStatus').selectOption('working');
        for (const [index, start, end, day] of [[0, '22:00', '01:00', '01'], [1, '01:00', '03:00', '11']]) {
            if (index === 1) await page.locator('#schAddSegmentBtn').click();
            const card = cards.nth(index);
            await card.locator('[data-segment-field="start"]').fill(start);
            await card.locator('[data-segment-field="end"]').fill(end);
            await card.locator('[data-segment-field="break"]').fill('0');
            await card.getByLabel('День часового блоку').selectOption(day);
            if (index === 1) await card.locator('[data-segment-field="work-mode"]').selectOption('freelance');
        }
        for (const width of [390, 360, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await cards.nth(1).getByLabel('День часового блоку').scrollIntoViewIfNeeded();
            await assertFits();
            await page.locator('#schModalOverlay').screenshot({
                path: path.join(out, `schedule-night-${width}.png`), animations: 'disabled',
                style: '#toastContainer { visibility: hidden }'
            });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        const nightSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/schedule'
            && response.request().method() === 'PUT');
        await page.locator('#schSaveBtn').click();
        const savedNight = await nightSave;
        assert.equal(savedNight.status(), 200);
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });
        cell = await openSchedule(nightDate);
        await cell.click();
        assert.equal(await cards.first().getByLabel('День часового блоку').inputValue(), '01');
        assert.equal(await cards.nth(1).getByLabel('День часового блоку').inputValue(), '11');
        assert.equal(await cards.nth(1).locator('[data-segment-field="work-mode"]').inputValue(), 'freelance');
        await page.locator('#schCancelBtn').click();
        await toggle.press('Enter');
        const nightRecord = row.getByRole('button', { name: /01:00 \(\+1 день\)–03:00 \(\+1 день\)/ });
        await setWidth(320);
        await nightRecord.scrollIntoViewIfNeeded();
        await assertFits();
        await page.screenshot({ path: path.join(out, 'schedule-freelance-overnight-320.png') });
        const nightBounds = await nightRecord.evaluate(button => {
            const viewport = document.getElementById('scheduleWrapper').getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return { left: box.left, right: box.right, viewportLeft: viewport.left, viewportRight: viewport.right };
        });
        assert.ok(nightBounds.left >= nightBounds.viewportLeft - 1 && nightBounds.right <= nightBounds.viewportRight + 1,
            'The overnight interval and day offset must fit the visible schedule: ' + JSON.stringify(nightBounds));
        await nightRecord.press('Enter');
        assert.equal(await cards.nth(1).getByLabel('День часового блоку').inputValue(), '11');
        await page.locator('#schCancelBtn').click();
        await setWidth(390);

        stage = 'mobile factual breaks';
        const { rows: [breakStaff] } = await db.query(`INSERT INTO staff
            (name, department, position, role_type, rate_unit, hourly_rate, is_active)
            VALUES ('Synthetic break operator', 'animators', 'Synthetic QA', 'animator', 'hour', 120, true)
            RETURNING id`);
        const { rows: [breakRecord] } = await db.query(`INSERT INTO hr_time_records
            (staff_id, record_date, clock_in, status, business_context)
            VALUES ($1, $2, clock_timestamp() - INTERVAL '1 hour', 'present', 'event_genix') RETURNING id`,
            [breakStaff.id, date]);
        await page.goto(new URL('/hr#today', base).href, { waitUntil: 'domcontentloaded' });
        const breakRow = page.locator(`#todayList [data-staff-id="${breakStaff.id}"]`);
        await breakRow.waitFor();
        await page.locator('#todaySearch').fill('Synthetic break operator');
        const breakRequest = async label => {
            const control = breakRow.getByRole('button', { name: label, exact: true });
            try {
                const [response] = await Promise.all([
                    page.waitForResponse(item => new URL(item.url()).pathname ===
                        `/api/hr/records/${breakRecord.id}/correct` && item.request().method() === 'PUT'),
                    control.click()
                ]);
                assert.equal(response.status(), 200, (await response.json()).error);
            } catch (error) {
                const state = await page.evaluate(staffId => {
                    const record = todayData?.data?.find(item => Number(item.staff_id) === staffId)?.record;
                    return { hasRecord: Boolean(record), hasVersion: Boolean(record?.record_version),
                        managed: canManageHrSchedule(), readOnly: isTodayRecoveryReadOnly(),
                        pending: todayClockPending.has(staffId), breakCount: record?.break_intervals?.length };
                }, breakStaff.id);
                throw new Error(`${label} (${JSON.stringify(state)}): ${error.message}`);
            }
        };
        await breakRequest('Почати перерву');
        await breakRow.getByText(/Перерва триває/).waitFor();
        assert.doesNotMatch(await breakRow.innerText(), /Фактичні перерви/);
        await page.mouse.move(0, 0);
        await page.getByText('Перерву почато', { exact: true }).waitFor({ state: 'hidden' });
        await breakRequest('Завершити перерву');
        await breakRow.getByText(/Фактичні перерви/).waitFor();
        for (const width of [360, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await assertFits();
            await breakRow.screenshot({ path: path.join(out, `attendance-breaks-${width}.png`), animations: 'disabled',
                style: '#toastContainer { visibility: hidden }' });
        }

        stage = 'manual confirmation of a break after departure';
        const { rows: [reviewStaff] } = await db.query(`INSERT INTO staff
            (name, department, position, role_type, rate_unit, hourly_rate, is_active)
            VALUES ('Synthetic break review', 'animators', 'Synthetic QA', 'animator', 'hour', 120, true)
            RETURNING id`);
        const { rows: [reviewBreak] } = await db.query(`INSERT INTO hr_time_records
            (staff_id, record_date, clock_in, clock_out, status, business_context, break_intervals)
            VALUES ($1, $2, clock_timestamp() - INTERVAL '1 hour', clock_timestamp() - INTERVAL '2 minutes',
                'present', 'event_genix', jsonb_build_array(jsonb_build_object(
                    'startedAt', to_char((clock_timestamp() - INTERVAL '20 minutes') AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'endedAt', NULL)))
            RETURNING id, to_char((clock_timestamp() - INTERVAL '10 minutes') AT TIME ZONE 'Europe/Kyiv',
                'YYYY-MM-DD"T"HH24:MI') AS end_local`, [reviewStaff.id, date]);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const reviewRow = page.locator(`#todayList [data-staff-id="${reviewStaff.id}"]`);
        await page.locator('#todaySearch').fill('');
        await reviewRow.waitFor();
        await page.locator('#todaySearch').fill('Synthetic break review');
        const reviewTrigger = reviewRow.getByRole('button', { name: 'Підтвердити завершення перерви' });
        const reviewDialog = page.getByRole('dialog', { name: 'Підтвердити завершення перерви' });
        await reviewTrigger.press('Enter');
        await reviewDialog.waitFor();
        await page.keyboard.press('Escape');
        await reviewDialog.waitFor({ state: 'hidden' });
        assert.equal(await reviewTrigger.evaluate(button => button === document.activeElement), true);
        await reviewTrigger.click();
        await reviewDialog.getByLabel('Дата й час за Києвом').fill(reviewBreak.end_local);
        await reviewDialog.getByLabel('Причина').fill('Синтетичне підтвердження часу');
        await page.setViewportSize({ width: 360, height: 844 });
        await assertFits();
        await reviewDialog.screenshot({ path: path.join(out, 'attendance-break-review-360.png'), animations: 'disabled',
            style: '#toastContainer { visibility: hidden }' });
        const [reviewed] = await Promise.all([
            page.waitForResponse(response => new URL(response.url()).pathname ===
                `/api/hr/records/${reviewBreak.id}/correct` && response.request().method() === 'PUT'),
            reviewDialog.getByRole('button', { name: 'Зберегти час перерви' }).click()
        ]);
        assert.equal(reviewed.status(), 200, (await reviewed.json()).error);
        await reviewRow.getByText(/Фактичні перерви/).waitFor();

        stage = 'reserve freelance attendance through HR Today';
        const todayPath = '/api/hr/today';
        const beforeReserve = await (await request(auth, todayPath)).json();
        assert.ok(!beforeReserve.data.some(item => item.staff_id === reserve.id), 'Future plans do not put reserve on today’s roster');
        const noPlan = await request(auth, '/api/hr/clock-in', { method: 'POST', body: { staff_id: reserve.id, date } });
        assert.equal(noPlan.status, 409);
        assert.equal((await noPlan.json()).code, 'ATTENDANCE_RESERVE_FREELANCE_NOT_SCHEDULED');
        const plannedReserve = await writePlan(reserve.id, date, [{
            professionKey: 'animator', shiftStart: '00:00', shiftEnd: '00:01', workMode: 'freelance'
        }], { reserveFreelance: true });
        assert.equal(plannedReserve.status, 200, await plannedReserve.text());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#todaySearch').fill(reserve.name);
        const todayReserve = page.locator(`#todayList [data-staff-id="${reserve.id}"]`);
        await todayReserve.getByText(/Резерв · фріланс/).waitFor();
        await todayReserve.screenshot({ path: path.join(out, 'freelance-reserve-today-360.png'), animations: 'disabled' });
        const markReserve = async (action, time) => {
            await todayReserve.getByRole('button', { name: new RegExp('Обрати час ' + (action === 'in' ? 'приходу' : 'виходу')) }).click();
            const dialog = page.locator('#hrTodayClockDialog');
            await dialog.locator('#hrTodayClockTime').fill(time);
            const [result] = await Promise.all([
                page.waitForResponse(response => new URL(response.url()).pathname === '/api/hr/clock-' + action),
                dialog.locator('button[type="submit"]').click()
            ]);
            assert.equal(result.status(), 200, await result.text());
            await dialog.waitFor({ state: 'hidden' });
        };
        await markReserve('in', '00:00');
        await markReserve('out', '00:01');
        const [reserveDay] = (await (await request(auth, endpoint + '&staffId=' + reserve.id)).json()).data;
        assert.equal(reserveDay.attendanceState, 'ready');
        const [reserveBlock] = reserveDay.segments;
        if (!Number(reserveBlock.rate)) {
            const terms = await request(auth, '/api/payroll/freelance/terms', { method: 'POST',
                body: { staffId: reserve.id, date, segmentId: reserveBlock.id, rateUnit: 'hour', rate: '120', reason: 'Synthetic reserve' } });
            assert.equal(terms.status, 201);
        }
        const confirmReserve = await request(auth, '/api/payroll/freelance/attendance', { method: 'POST',
            body: { staffId: reserve.id, date, attendanceId: reserveDay.attendance_id,
                allocations: [{ segmentId: reserveBlock.id, minutes: reserveDay.actualMinutes }] } });
        assert.equal(confirmReserve.status, 201, await confirmReserve.text());

        stage = 'Today navigation to a historical freelance block';
        const reviewDate = laterDate(-3);
        const historicalPlan = await writePlan(trampolineReserve.id, reviewDate, [
            { professionKey: 'trampoline_instructor', workMode: 'freelance', shiftStart: '09:00', shiftEnd: '10:00' },
            { professionKey: 'trampoline_instructor', workMode: 'freelance', shiftStart: '12:00', shiftEnd: '13:00' }
        ], { reserveFreelance: true });
        assert.equal(historicalPlan.status, 200, await historicalPlan.clone().text());
        const historicalEntry = (await historicalPlan.json()).data;
        await db.query(`UPDATE staff SET secondary_professions = '["reception"]' WHERE id = $1`, [staff.id]);
        const regularPlan = await writePlan(staff.id, reviewDate, [{
            professionKey: 'animator', workMode: 'regular', shiftStart: '10:00', shiftEnd: '11:00'
        }]);
        assert.equal(regularPlan.status, 200, await regularPlan.text());
        await db.query(`INSERT INTO hr_time_records (staff_id, record_date, status, business_context)
            VALUES ($1, $2, 'manual_review', 'event_genix')`, [trampolineReserve.id, reviewDate]);
        const todayTab = page.locator('#hrNav [data-tab="today"]');
        await page.goto(new URL('/hr#schedule', base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
        await readRange(reviewDate, reviewDate);
        await page.locator('#deptFilter [data-dept="animators"]').click();
        await workModeFilter.selectOption('all');
        const animators = page.locator('[data-schedule-group-toggle="animators"]');
        if (await animators.getAttribute('aria-expanded') !== 'true') await animators.click();
        await page.locator(`.sch-cell[data-staff="${staff.id}"][data-date="${reviewDate}"]`).first().click();
        await cards.first().locator('.sch-paid-role-editor > summary').click();
        await cards.first().locator('[data-segment-field="paid-profession"]').selectOption('reception');
        await page.locator('#schPlanExtra > summary').click();
        const draftNote = 'Synthetic pending draft for a regular employee';
        await page.locator('#schNote').fill(draftNote);
        await cards.first().locator('[data-schedule-pay-conditions]').click();
        await page.waitForURL(url => url.hash === '#team' && url.searchParams.has('scheduleDraft'));
        const readDraft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('pzp_schedule_hr_draft_v1')));
        const draft = await readDraft();
        assert.equal(draft.pending, true);
        assert.equal(draft.staffId, staff.id);
        const historicalLink = page.getByRole('link', { name: 'Відкрити графік: ' + trampolineReserve.name });
        const prepareToday = async () => {
            await page.locator('#todayReviewOnly').check();
            await page.locator('#todaySearch').fill(trampolineReserve.name);
            await page.locator('#todayReviewDate').fill(reviewDate);
            await historicalLink.waitFor();
        };
        await page.goto(new URL('/hr', base).href, { waitUntil: 'domcontentloaded' });
        await prepareToday();
        const href = await historicalLink.getAttribute('href');
        assert.equal(new URL(href, base).searchParams.get('scheduleDate'), reviewDate);
        await historicalLink.press('Enter');
        const firstBlock = trampolineRow.getByRole('button', { name: /09:00.*10:00/ });
        await firstBlock.waitFor();
        await page.waitForFunction(() => document.activeElement?.dataset.freelanceStaff);
        assert.equal(await firstBlock.evaluate(button => button === document.activeElement), true);
        assert.equal((await readDraft()).pending, true);

        await page.locator('#deptFilter [data-dept="animators"]').click();
        await workModeFilter.selectOption('regular');
        await page.locator('#scheduleStaffSearch').fill(staffName);
        await todayTab.click();
        await prepareToday();
        await historicalLink.press('Enter');
        await page.waitForFunction(() => document.activeElement?.dataset.freelanceStaff
            && document.activeElement.textContent.includes('09:00–10:00'));
        assert.equal(await firstBlock.evaluate(button => button === document.activeElement), true);
        assert.equal(await firstBlock.getAttribute('data-freelance-date'), reviewDate);
        assert.equal(await page.locator('[data-schedule-group-toggle="trampoline"]').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('[data-freelance-toggle="trampoline"]').getAttribute('aria-expanded'), 'true');
        assert.equal(await workModeFilter.inputValue(), 'freelance');
        await assertFits();
        await page.screenshot({ path: path.join(out, 'freelance-today-focus-360.png'), animations: 'disabled' });
        await page.goto(new URL(href, base).href, { waitUntil: 'domcontentloaded' });
        await firstBlock.waitFor();
        await page.waitForFunction(() => document.activeElement?.dataset.freelanceStaff);
        assert.equal(await firstBlock.evaluate(button => button === document.activeElement), true);
        assert.deepEqual(await readDraft(), draft, 'the direct link leaves the pending draft intact');
        await page.goto(new URL(draft.returnUrl, base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('#schModalOverlay.visible').waitFor();
        assert.match(await page.locator('#schModalTitle').innerText(), new RegExp(staffName));
        assert.equal(await page.locator('#schNote').inputValue(), draftNote);
        await page.locator('#schCancelBtn').click();
        await page.getByRole('button', { name: 'Закрити без збереження' }).click();
        await page.locator('#schModalOverlay').waitFor({ state: 'hidden' });

        stage = 'Today navigation to a removed shift and to a regular employee';
        await page.locator('#hrNav [data-tab="today"]').click();
        await page.locator('#todayReviewOnly').check();
        await page.locator('#todayReviewDate').fill(reviewDate);
        await historicalLink.waitFor();
        const removed = await request(auth, '/api/staff/schedule', { method: 'PUT', body: {
            staffId: trampolineReserve.id, date: reviewDate, status: 'dayoff', reserveFreelance: true,
            expectedUpdatedAt: historicalEntry.planUpdatedAt, segments: []
        } });
        assert.equal(removed.status, 200, await removed.text());
        await historicalLink.click();
        await page.getByText('Фріланс-вихід на цю дату більше недоступний або його видалено.').waitFor();
        await page.locator('#scheduleStaffSearch').fill('');
        await workModeFilter.selectOption('all');
        await page.locator('#hrNav [data-tab="today"]').click();
        await page.locator('#todayReviewOnly').uncheck();
        await page.locator('#todaySearch').fill(staffName);
        await page.getByRole('link', { name: 'Відкрити графік: ' + staffName }).click();
        const regularRow = page.locator(`[data-schedule-staff-row="${staff.id}"]`);
        await regularRow.locator('[data-hr-profile]:focus').waitFor();
        assert.equal(await regularRow.getAttribute('class').then(value => value.includes('is-schedule-focus')), true);
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
