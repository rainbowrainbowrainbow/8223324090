'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const { initializeTimelineResources } = require('../../services/timelineResources');

assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL;

async function api(method, route, token, body) {
    const response = await fetch(`${base}${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function expectModalKeyboard(page, opener) {
    const modal = page.locator('#bookingModal');
    await opener.click();
    await modal.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#bookingModal')?.contains(document.activeElement));
    const close = modal.getByRole('button', { name: 'Закрити деталі бронювання' });
    assert.equal(await close.count(), 1);
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    const wrapState = await modal.evaluate(el => {
        const focusable = [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(control => control.offsetParent !== null && !control.closest('details:not([open])'));
        return { wrapped: document.activeElement === focusable.at(-1),
            active: document.activeElement?.outerHTML?.slice(0, 150),
            first: focusable[0]?.outerHTML?.slice(0, 150),
            last: focusable.at(-1)?.outerHTML?.slice(0, 150) };
    });
    assert.equal(wrapState.wrapped, true, `Shift+Tab wraps to the last modal control: ${JSON.stringify(wrapState)}`);
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el => document.activeElement === el), true, 'Tab wraps to the close button');
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate(el => document.activeElement === el), true, 'Escape returns focus to the source card');
    await opener.click();
    await modal.waitFor({ state: 'visible' });
    await close.click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate(el => document.activeElement === el), true, 'close button returns focus');
}

(async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
    let browser;
    try {
        await pool.query("INSERT INTO settings (key, value) VALUES ('timeline_display:dar', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify({ mode: 'education' })]);
        await initializeTimelineResources(pool, 'dar', { types: ['cabinet'] });
        const login = await api('POST', '/api/auth/login', '', { username: process.env.TEST_USER, password: process.env.TEST_PASS });
        assert.equal(login.status, 200);
        const token = login.body.accessToken || login.body.token;
        const cabinet = await api('PUT', '/api/business/cabinet?businessContext=dar', token, {
            businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet'
        });
        assert.equal(cabinet.status, 200);
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
        const title = 'Synthetic EDU modal smoke';
        const created = await api('POST', '/api/bookings?businessContext=dar', token, {
            date, time: '14:05', duration: 45, lineId: 'edu-cabinet-1', room: 'Кабінет 1',
            label: 'Заняття', programName: title, category: 'education', kidsCount: 2,
            skipNotification: true,
            extraData: { educationLesson: { mode: 'education_lesson', title,
                teacherId: 'synthetic-modal-teacher', teacherName: 'Synthetic teacher' } }
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const id = created.body.booking.id;

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45_000 });
        await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${date}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.CrmBusinessContext?.profileFor?.('dar')?.timeline?.mode === 'education'
            && window.CrmBusinessContext?.current?.() === 'dar'
            && window.EducationScheduleWorkspace?.state?.activeView === 'today');
        await page.locator('.education-schedule-tab').first().waitFor({ state: 'visible', timeout: 20_000 });

        const output = path.join(process.cwd(), 'output');
        fs.mkdirSync(output, { recursive: true });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            for (const dark of [false, true]) {
                await page.evaluate(enabled => {
                    document.body.classList.toggle('dark-mode', enabled);
                    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
                }, dark);
                const tabs = page.locator('.education-schedule-tab');
                const first = tabs.first();
                await page.keyboard.press('Tab');
                await first.focus();
                const state = await first.evaluate(el => ({
                    color: getComputedStyle(el).color,
                    background: getComputedStyle(el).backgroundColor,
                    outline: getComputedStyle(el).outlineStyle,
                    boxShadow: getComputedStyle(el).boxShadow,
                    focusVisible: el.matches(':focus-visible'),
                    active: document.activeElement === el,
                    overflow: el.closest('.education-schedule-tabs').scrollWidth > el.closest('.education-schedule-tabs').clientWidth + 1
                }));
                assert.equal(state.overflow, false, `${width} tabs do not overflow`);
                assert.ok(state.outline !== 'none' || state.boxShadow !== 'none',
                    `${width} keyboard focus remains visible: ${JSON.stringify(state)}`);
                if (dark) assert.equal(state.color, 'rgb(248, 250, 252)', 'dark titles use semantic foreground');
                await tabs.nth(1).hover();
                await page.screenshot({ path: path.join(output, `edu-fix-04-tabs-${width}-${dark ? 'dark' : 'light'}.png`) });
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => {
            document.body.classList.remove('dark-mode');
            document.documentElement.dataset.theme = 'light';
        });
        const todayCard = page.locator(`[data-education-booking-id="${id}"]`);
        await todayCard.waitFor({ state: 'visible', timeout: 20_000 });
        await expectModalKeyboard(page, todayCard);

        await page.locator('[data-education-schedule-tab="schedule"]').click();
        await page.locator('#timelineViewPanelToggle').click();
        await page.locator('[data-schedule-view-mode="day"]').click();
        const dayCard = page.locator(`.booking-block[data-booking-id="${id}"]`).first();
        await dayCard.waitFor({ state: 'visible', timeout: 20_000 });
        await expectModalKeyboard(page, dayCard);
        await page.locator('#timelineViewPanelToggle').click();
        await page.locator('[data-schedule-view-mode="week"]').click();
        const weekCard = page.locator(`.mini-booking-block[data-booking-id="${id}"]`).first();
        await weekCard.waitFor({ state: 'visible', timeout: 20_000 });
        await expectModalKeyboard(page, weekCard);
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        console.log('Education canonical modal Today/day/week, keyboard/focus, light/dark desktop/mobile: PASS');
    } finally {
        await browser?.close();
        await pool.end();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
