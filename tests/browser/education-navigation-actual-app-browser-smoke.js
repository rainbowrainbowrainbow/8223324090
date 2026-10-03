'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);

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

(async () => {
    const login = await api('POST', '/api/auth/login', '', {
        username: process.env.TEST_USER, password: process.env.TEST_PASS
    });
    assert.equal(login.status, 200);
    const token = login.body.accessToken || login.body.token;
    const cabinet = await api('PUT', '/api/business/cabinet?businessContext=dar', token, {
        businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet'
    });
    assert.equal(cabinet.status, 200);

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        await context.route('**/*', route => {
            const requestUrl = new URL(route.request().url());
            return requestUrl.origin === new URL(base).origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45_000 });

        async function expectDarTab(tab) {
            await page.waitForFunction(expected => window.CrmBusinessContext?.profileFor?.('dar')?.timeline?.mode === 'education'
                && window.CrmBusinessContext?.current?.() === 'dar'
                && window.EducationScheduleWorkspace?.state?.activeView === expected, tab);
            assert.equal(new URL(page.url()).searchParams.get('educationSchedule'), tab);
            const entry = page.locator('#sidebarDesignExtras a.sidebar-design-extra-link').filter({ hasText: 'Заняття' });
            await entry.waitFor({ state: 'visible', timeout: 10_000 });
            assert.equal(await entry.count(), 1, `${tab}: education menu entry`);
            assert.equal(await entry.getAttribute('href'), '/?businessContext=dar&educationSchedule=today');
            assert.match(await entry.getAttribute('class'), /active/);
            assert.equal(await page.locator(`[data-education-schedule-tab="${tab}"]`).getAttribute('aria-pressed'), 'true');
        }

        await page.evaluate(() => localStorage.removeItem('eg_sidebar_extra_menu_items_v3'));
        for (const tab of ['today', 'schedule', 'groups', 'attendance', 'reports']) {
            await page.goto(`${base}/?businessContext=dar&educationSchedule=${tab}`, { waitUntil: 'domcontentloaded' });
            await expectDarTab(tab);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expectDarTab(tab);
            await page.goto(`${base}/?businessContext=event_genix`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.CrmBusinessContext?.current?.() === 'event_genix');
            assert.equal(await page.locator('#sidebarDesignExtras a[href*="educationSchedule"]').count(), 0, 'Park hides education entry');
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await expectDarTab(tab);
        }

        await page.evaluate(() => localStorage.setItem('eg_sidebar_extra_menu_items_v3', JSON.stringify([
            { href: '/chat', label: 'Чат', description: 'Контакт', icon: 'chat' }
        ])));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expectDarTab('reports');
        assert.match(await page.evaluate(() => localStorage.getItem('eg_sidebar_extra_menu_items_v3')), /\/chat/);
        await page.evaluate(() => window.CrmBusinessContext.switchTo('event_genix', { navigate: false, updateUrl: true }));
        await page.waitForFunction(() => window.CrmBusinessContext?.current?.() === 'event_genix');
        assert.equal(await page.locator('#sidebarDesignExtras a[href*="educationSchedule"]').count(), 0, 'switch to Park hides education entry');
        await page.evaluate(() => window.CrmBusinessContext.switchTo('dar', { navigate: false, updateUrl: true }));
        await expectDarTab('reports');
        await page.locator('#sidebarDesignExtras a.sidebar-design-extra-link').filter({ hasText: 'Заняття' }).click();
        await expectDarTab('today');

        const output = path.join(process.cwd(), 'output');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'edu-fix-02-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#sidebarToggle').click();
        await page.locator('#sidebarDesignExtras a.sidebar-design-extra-link').filter({ hasText: 'Заняття' }).waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, 'edu-fix-02-mobile.png') });
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        console.log('Education navigation actual-app direct/reload/back, default/custom, desktop/mobile: PASS');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
