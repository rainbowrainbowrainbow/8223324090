'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { chromium } = require('playwright');
const { assertSafeIsolatedTestUrl, assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

async function run() {
    assert.equal(process.env.RUN_FREELANCE_SHIFT_BROWSER, 'true');
    const base = assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    const out = path.resolve(__dirname, '../../output/playwright/freelance-shift');
    fs.mkdirSync(out, { recursive: true });
    const suffix = randomUUID().slice(0, 8);
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
    const login = async role => {
        const username = `freelance_qa_${role}_${suffix}`;
        const password = randomUUID() + randomUUID();
        await db.query(
            `INSERT INTO users (username, password_hash, role, name, business_contexts, default_business_context)
             VALUES ($1, $2, $3, 'Synthetic Freelance QA', ARRAY['event_genix'], 'event_genix')`,
            [username, await bcrypt.hash(password, 10), role]
        );
        const response = await fetch(new URL('/api/auth/login', base), {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Business-Context': 'event_genix' },
            body: JSON.stringify({ username, password })
        });
        assert.equal(response.status, 200, `Synthetic ${role} login`);
        return response.json();
    };
    const request = async (auth, route) => fetch(new URL(route, base), {
        headers: { Authorization: 'Bearer ' + (auth.accessToken || auth.token), 'X-Business-Context': 'event_genix' }
    });
    let browser;
    let stage = 'fixture';
    try {
        const auth = await login('creator');
        const viewer = await login('animator');
        const endpoint = `/api/payroll/freelance/day?date=${date}`;
        assert.equal((await request(viewer, endpoint)).status, 403, 'Schedule user cannot read rates');
        const authorized = await request(auth, endpoint);
        assert.equal(authorized.status, 200, `Payroll read in ${auth.user.membershipMode || 'compatibility'} mode`);
        const { rows: [staff] } = await db.query(
            `INSERT INTO staff (name, department, position, role_type, rate_unit, hourly_rate, is_active)
             VALUES ($1, 'animators', 'Synthetic QA', 'animator', 'hour', 120, true) RETURNING id`,
            [`Synthetic Freelance ${suffix}`]
        );
        await db.query(
            `INSERT INTO finance_categories (name, type, business_context)
             VALUES ($1, 'expense', 'event_genix')`, [`Freelance expense ${suffix}`]
        );
        await db.query(
            `INSERT INTO finance_accounts (name, business_context)
             VALUES ($1, 'event_genix')`, [`Freelance account ${suffix}`]
        );
        stage = 'launch';
        browser = await chromium.launch({ headless: true, executablePath: process.env.FREELANCE_CHROMIUM_PATH,
            args: ['--disable-dev-shm-usage'] });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        await context.addInitScript(auth => {
            localStorage.setItem('pzp_token', auth.accessToken || auth.token);
            localStorage.setItem('pzp_access_token', auth.accessToken || auth.token);
            localStorage.setItem('pzp_current_user', JSON.stringify(auth.user));
            if (auth.refreshToken) localStorage.setItem('pzp_refresh_token', auth.refreshToken);
            localStorage.setItem('pzp_staff_schedule_expanded_groups', JSON.stringify(['animators']));
        }, auth);
        const page = await context.newPage();
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
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(new URL('/finance?mode=operations&tab=salary', base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('#tabSalary').waitFor();
        await page.locator('#freelancePayrollPanel summary').click();
        const content = page.locator('#freelancePayrollContent');
        const staffPanel = content.locator('.salary-main-panel').filter({ hasText: `Synthetic Freelance ${suffix}` }).first();
        await staffPanel.getByRole('button', { name: 'Погодити умови' }).click();
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
        const paymentPanel = content.locator('.salary-main-panel')
            .filter({ hasText: `Synthetic Freelance ${suffix}` })
            .filter({ has: page.getByRole('button', { name: 'Зафіксувати виплату' }) });
        await paymentPanel.getByRole('button', { name: 'Зафіксувати виплату' }).click();
        dialog = page.getByRole('dialog');
        await dialog.locator('[name=accountId]').selectOption({ label: `Freelance account ${suffix}` });
        await dialog.locator('[name=categoryId]').selectOption({ label: `Freelance expense ${suffix}` });
        await dialog.locator('[name=reason]').fill('Synthetic registration only');
        await dialog.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        const paid = () => content.locator('.salary-main-panel').filter({ hasText: `Synthetic Freelance ${suffix}` })
            .getByText('Оплачено', { exact: false }).first();
        await paid().waitFor();
        await page.screenshot({ path: path.join(out, 'finance-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#freelancePayrollPanel summary').click();
        await page.locator('#freelancePayrollPanel summary').click();
        await paid().waitFor();
        await paid().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, 'finance-mobile.png') });
        console.log('Freelance actual-app browser journey passed');
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
