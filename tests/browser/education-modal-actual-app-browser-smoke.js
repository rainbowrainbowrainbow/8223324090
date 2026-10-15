'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const playwright = require(process.env.EDU_QA_PLAYWRIGHT);
const engine = process.env.EDU_QA_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'Use a supported installed browser engine');
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

async function stableTabBounds(tab) {
    return tab.evaluate(el => new Promise((resolve, reject) => {
        const deadline = performance.now() + 5_000;
        let previous = '', stableSince = performance.now();
        const inspect = () => {
            const strip = el.closest('.education-schedule-tabs').getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            const bounds = { left: rect.left - strip.left, right: rect.right - strip.right };
            const signature = JSON.stringify(bounds);
            const now = performance.now();
            if (signature !== previous) stableSince = now;
            previous = signature;
            if (now - stableSince >= 200 && bounds.left >= -1 && bounds.right <= 1) return resolve(bounds);
            if (now >= deadline) return reject(new Error(`Active tab did not settle inside its strip: ${signature}`));
            requestAnimationFrame(inspect);
        };
        inspect();
    }));
}

async function waitRuntimeReads(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => {
        const timer = window.GlobalTaskTimer?.state;
        return timer?.hydrated && !timer.loading && !timer.pendingHydrate
            && !window.EducationScheduleWorkspace?.state.loading
            && (typeof bookingTimePreflightState !== 'function' || bookingTimePreflightState().status !== 'checking');
    });
    assert.equal(await page.evaluate(() => window.EducationScheduleWorkspace?.state.error?.message || null), null);
    await page.waitForLoadState('networkidle');
}

async function expectModalKeyboard(page, opener) {
    const modal = page.locator('#bookingModal');
    await opener.click();
    await modal.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#bookingModal')?.contains(document.activeElement));
    const close = modal.getByRole('button', { name: 'Закрити деталі бронювання' });
    assert.equal(await close.count(), 1);
    const more = modal.locator('details.booking-detail-more-actions');
    const summary = more.locator(':scope > summary');
    assert.equal(await summary.count(), 1, 'canonical footer has a native summary');
    assert.equal(await more.evaluate(el => el.open), false, 'menu starts collapsed');
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await summary.evaluate(el => document.activeElement === el), true,
        'Shift+Tab wraps to native summary while its actions are collapsed');
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el => document.activeElement === el), true, 'Tab wraps to the close button');
    await summary.click();
    assert.equal(await more.evaluate(el => el.open), true);
    const lastAction = more.getByRole('button').last();
    await lastAction.focus();
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el => document.activeElement === el), true, 'expanded last action wraps to close');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await lastAction.evaluate(el => document.activeElement === el), true, 'expanded menu participates in reverse wrap');
    for (let index = 0; index < 24; index += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await modal.evaluate(el => el.contains(document.activeElement)), true, 'Tab stays inside the dialog');
    }
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
        const teacher = await api('POST', '/api/education/groups/teachers?businessContext=dar', token, {
            name: 'Synthetic modal teacher'
        });
        assert.equal(teacher.status, 201, JSON.stringify(teacher.body));
        const created = await api('POST', '/api/bookings?businessContext=dar', token, {
            date, time: '14:05', duration: 45, lineId: 'edu-cabinet-1', room: 'Кабінет 1',
            label: 'Заняття', programName: title, category: 'education', kidsCount: 2,
            skipNotification: true,
            extraData: { educationLesson: { mode: 'education_lesson', title,
                teacherId: String(teacher.body.teacher.id), teacherName: teacher.body.teacher.name } }
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const id = created.body.booking.id;

        browser = await playwright[engine].launch({ headless: true });
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        await context.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== new URL(base).origin) return route.abort();
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
                && !/^\/api\/auth\/(login|refresh|verify)$/.test(url.pathname)) return route.abort();
            return route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45_000 });
        await waitRuntimeReads(page);
        await page.goto(`${base}/?businessContext=dar&educationSchedule=today&date=${date}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.CrmBusinessContext?.profileFor?.('dar')?.timeline?.mode === 'education'
            && window.CrmBusinessContext?.current?.() === 'dar'
            && window.EducationScheduleWorkspace?.state?.activeView === 'today');
        await page.locator('.education-schedule-tab').first().waitFor({ state: 'visible', timeout: 20_000 });

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

        await initializeTimelineResources(pool, 'event_genix', { types: ['room'] });
        const parkLines = await api('GET', `/api/lines/${date}?businessContext=event_genix&timelineView=rooms`, token);
        assert.equal(parkLines.status, 200);
        assert.ok(Array.isArray(parkLines.body), 'lines endpoint returns the canonical array');
        const parkLine = parkLines.body.find(line => line.isActive !== false && !line.metadata?.quarantine);
        assert.ok(parkLine, 'Park has an active room for a synthetic booking');
        const parkId = 'EDU-MODAL-PARK';
        await pool.query(`INSERT INTO bookings
            (id, business_context, date, time, duration, line_id, room, room_resource_id, label,
             program_name, category, price, hosts, status, skip_notification, created_by)
            VALUES ($1, 'event_genix', $2, '16:00', 60, $3, $4, $5, 'QA Keyboard Park',
                    'Synthetic Park modal', 'animation', 0, 1, 'confirmed', true, $6)`,
        [parkId, date, parkLine.id, parkLine.name, parkLine.resourceId || parkLine.id, process.env.TEST_USER]);
        await waitRuntimeReads(page);
        await page.goto(`${base}/?businessContext=event_genix&date=${date}&view=rooms`, { waitUntil: 'domcontentloaded' });
        const parkCard = page.locator(`.booking-block[data-booking-id="${parkId}"]`).first();
        await parkCard.waitFor({ state: 'visible', timeout: 20_000 });
        await expectModalKeyboard(page, parkCard);

        await page.evaluate(() => {
            const modal = document.createElement('div');
            modal.id = 'qaEmptyModal';
            modal.className = 'modal hidden';
            modal.innerHTML = '<div class="modal-content"><p>Synthetic read-only dialog</p></div>';
            document.body.append(modal);
            openModal(modal, document.getElementById('timelineViewPanelToggle'));
        });
        const empty = page.locator('#qaEmptyModal');
        await page.waitForFunction(() => document.querySelector('#qaEmptyModal').contains(document.activeElement));
        for (const key of ['Tab', 'Shift+Tab']) {
            await page.keyboard.press(key);
            assert.equal(await empty.evaluate(el => el.contains(document.activeElement)), true, 'empty dialog retains focus');
        }
        await page.keyboard.press('Escape');
        await empty.waitFor({ state: 'hidden' });
        await waitRuntimeReads(page);
        assert.deepEqual(errors, [], 'canonical keyboard scenarios have no uncaught browser errors');
        console.log(engine + ': focused canonical Today/day/week/Park and empty-dialog keyboard: PASS');
        await waitRuntimeReads(page);
        await page.goto(base + '/?businessContext=dar&educationSchedule=today&date=' + date, { waitUntil: 'domcontentloaded' });
        await todayCard.waitFor({ state: 'visible', timeout: 20_000 });

        const output = path.join(process.cwd(), 'output', 'playwright', 'edu-focus-release-20261015', engine);
        fs.mkdirSync(output, { recursive: true });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            for (const dark of [false, true]) {
                const themeToggle = page.locator('#headerThemeToggle');
                if ((await themeToggle.getAttribute('aria-pressed') === 'true') !== dark) await themeToggle.click();
                await page.waitForFunction(enabled => document.body.classList.contains('dark-mode') === enabled
                    && document.documentElement.dataset.theme === (enabled ? 'dark' : 'light')
                    && document.documentElement.style.colorScheme === (enabled ? 'dark' : 'light'), dark);
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
                    documentWidth: document.documentElement.scrollWidth,
                    viewportWidth: innerWidth
                }));
                assert.ok(state.documentWidth <= state.viewportWidth + 1, `${width} document does not overflow`);
                assert.ok(state.outline !== 'none' || state.boxShadow !== 'none',
                    `${width} keyboard focus remains visible: ${JSON.stringify(state)}`);
                if (dark) assert.equal(state.color, 'rgb(248, 250, 252)', 'dark titles use semantic foreground');
                // EDU-CLOSE-03 intentionally contains mobile tabs in a compact
                // scroll strip. Native Tab/Enter must select every tab and
                // bring the active button fully into the visible strip.
                assert.equal(await tabs.count(), 5);
                for (let index = 0; index < 5; index += 1) {
                    const focused = tabs.nth(index);
                    assert.equal(await focused.evaluate(el => document.activeElement === el), true,
                        `${width}: native Tab reaches education tab ${index}`);
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(index => document.querySelectorAll('.education-schedule-tab')[index]
                        .getAttribute('aria-pressed') === 'true', index);
                    const bounds = await stableTabBounds(focused);
                    assert.ok(bounds.left >= -1 && bounds.right <= 1, `${width}: focused tab fits the strip: ${JSON.stringify(bounds)}`);
                    if (index < 4) await page.keyboard.press('Tab');
                }
                await first.press('Enter');
                await tabs.nth(1).hover();
                await page.screenshot({ path: path.join(output, `edu-fix-04-tabs-${width}-${dark ? 'dark' : 'light'}.png`) });
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        const finalThemeToggle = page.locator('#headerThemeToggle');
        if (await finalThemeToggle.getAttribute('aria-pressed') === 'true') await finalThemeToggle.click();

        await waitRuntimeReads(page);
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        console.log(`${engine}: canonical modal Today/day/week/Park, native collapsed/expanded summary, empty dialog, Escape/Tab/focus return, light/dark desktop/mobile: PASS`);
    } finally {
        await browser?.close();
        await pool.end();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
