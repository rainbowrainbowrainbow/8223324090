'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlaywright, routeMockedApi, businessProfilePayload, createStaticServer, SMOKE_USER } =
    require('./timeline-room-summary-browser-smoke');

(async () => {
    const playwright = requirePlaywright();
    const browser = await playwright.chromium.launch({ headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
    const { server, baseUrl } = await createStaticServer();
    let context;
    try {
        context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        await context.addInitScript(user => {
            localStorage.setItem('pzp_token', 'fixture');
            localStorage.setItem('pzp_access_token', 'fixture');
            localStorage.setItem('pzp_current_user', JSON.stringify(user));
            localStorage.setItem('pzp_crm_business_context', 'event_genix');
            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
        }, SMOKE_USER);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await routeMockedApi(page);
        await page.route('**/api/business/profile**', route => {
            const profile = businessProfilePayload();
            const timeline = profile.businessProfile.businesses[0].timeline;
            timeline.defaultTimelineView = 'animators';
            timeline.enabledModules.afisha = true;
            timeline.timelineFeatures.afisha = true;
            return route.fulfill({ json: profile });
        });
        await page.route('**/api/lines/**', route => route.fulfill({ json: [
            { id: '1', name: 'Аніматор 1', color: '#6952ce' },
            { id: '2', name: 'Аніматор 2', color: '#4595d2' }
        ] }));
        await page.route('**/api/bookings/**', route => route.fulfill({ json: [] }));
        const events = [{ id: 1, date: '2026-10-19', time: '14:00', title: 'Космічна афіша', duration: 60,
            type: 'event', description: '', original_time: '14:00', line_id: '1', second_line_id: '2', promotion_id: 7 }];
        const promotion = { id: 7, title: 'Осіння акція', description: '', color_key: 'amber',
            starts_on: '2026-10-19', ends_on: '2026-10-25', version: 1 };
        await page.route('**/api/afisha/**', async route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (pathname === '/api/afisha/timeline' && request.method() === 'POST') {
                const input = request.postDataJSON();
                const item = { ...input, id: 2, original_time: input.time, line_id: input.lineIds[0] || null,
                    second_line_id: input.lineIds[1] || null, promotion_id: input.promotionId };
                events.push(item);
                return route.fulfill({ status: 201, json: { success: true, item } });
            }
            if (/^\/api\/afisha\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
                const date = pathname.split('/').pop();
                return route.fulfill({ json: events.filter(event => event.date === date) });
            }
            return route.fulfill({ json: { success: true } });
        });
        await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { context: 'event_genix', promotions: [promotion] } }));
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AppState && window.TimelineAfisha && window.__crmBusinessNavigationPending !== true
            && !document.getElementById('mainApp').classList.contains('hidden'));
        await page.evaluate(async () => {
            AppState.selectedDate = new Date('2026-10-19T12:00:00');
            AppState.multiDayMode = false;
            if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
            await renderTimeline();
        });
        await page.locator('[data-toggle-marketing]').click();
        await page.locator('.timeline-afisha-summary-event').waitFor();
        assert.equal(await page.locator('.line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="2"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('[data-linked-afisha="1"]').count(), 1);
        await page.locator('[data-add-afisha]').click();
        await page.locator('[data-create-form] input[name="title"]').fill('Нова афіша');
        await page.locator('[data-create-form] select[name="promotion"]').selectOption('7');
        await page.locator('[data-create-form] [data-lines] input').first().check();
        await page.locator('[data-create-form] [data-lines] input').last().check();
        await page.locator('[data-create-form] button[type="submit"]').click();
        await page.locator('.line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="2"]').waitFor();
        assert.equal(await page.locator('.line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="2"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        await page.locator('[data-toggle-marketing]').click();
        const output = path.join(__dirname, '../../output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.timeline-afisha-summary-event[data-afisha-id="2"]').click();
        const box = await page.locator('.timeline-marketing-dialog').boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'mobile dialog stays inside viewport');
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-mobile.png') });
        await page.locator('.timeline-marketing-dialog [data-close]').click();
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.evaluate(async () => {
            AppState.multiDayMode = true;
            AppState.daysToShow = 7;
            await renderTimeline();
        });
        await page.locator('.day-section[data-date="2026-10-19"] .mini-line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="2"]').waitFor();
        assert.equal(await page.locator('.day-section[data-date="2026-10-19"] .mini-line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        assert.equal(await page.locator('.day-section[data-date="2026-10-19"] .mini-line-grid[data-line-id="2"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-week.png') });
        assert.deepEqual(errors, []);
        console.log('Timeline Afisha dual browser smoke passed: day, week and mobile screenshots captured.');
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
