'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const output = process.env.PARK_TIMELINE_NAVIGATION_OUTPUT || path.join(__dirname, '../../output/playwright/park-timeline-navigation');
const selectedDate = '2026-10-25';

async function routeNavigationApi(page) {
    await routeMockedApi(page);
    await page.route(/\/api\/(?:business\/profile|auth\/business-profile)(?:\?|$)/, route => {
        const profile = businessProfilePayload();
        profile.businessProfile.businesses[0].timeline.defaultTimelineView = 'animators';
        return route.fulfill({ json: { ...profile, user: SMOKE_USER } });
    });
    await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [] } }));
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    let browser;
    const results = [];
    try {
        browser = await requirePlaywright().chromium.launch({ headless: true,
            ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
        for (const timezoneId of ['Europe/Kyiv', 'America/Los_Angeles']) {
            for (const width of [1254, 390]) {
                const label = `${timezoneId.replace('/', '-')}-${width}`;
                const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId, serviceWorkers: 'block' });
                const page = await context.newPage();
                const errors = [];
                const requests = [];
                const writes = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('request', request => {
                    const url = new URL(request.url());
                    if (!url.pathname.startsWith('/api/')) return;
                    requests.push(url.pathname);
                    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
                });
                try {
                    await context.addInitScript(user => {
                        localStorage.setItem('pzp_token', 'fixture');
                        localStorage.setItem('pzp_access_token', 'fixture');
                        localStorage.setItem('pzp_current_user', JSON.stringify(user));
                        localStorage.setItem('pzp_crm_business_context', 'event_genix');
                        localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                        localStorage.setItem('pzp_dark_mode', 'true');
                    }, SMOKE_USER);
                    await page.routeWebSocket('**/*', socket => {
                        socket.onMessage(raw => { if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' })); });
                    });
                    await routeNavigationApi(page);
                    await page.goto(`${baseUrl}/?timelineView=animators&date=${selectedDate}`, { waitUntil: 'networkidle' });
                    const input = page.locator('#timelineDate');
                    await page.waitForFunction(() => Boolean(document.getElementById('timelineDate')?.value));
                    await input.waitFor({ state: 'visible' });
                    assert.equal(await input.inputValue(), selectedDate, `${label}: deep link date`);

                    // Clearing a native date input must retain the last usable schedule.
                    const requestOffset = requests.length;
                    await input.fill('');
                    await input.press('Tab');
                    await page.waitForFunction(date => document.getElementById('timelineDate').value === date, selectedDate, { timeout: 3000 });
                    assert.equal(new URL(page.url()).searchParams.get('date'), selectedDate);
                    assert.equal(requests.slice(requestOffset).some(url => /NaN|Invalid|undefined/.test(url)), false, `${label}: no invalid API date`);

                    // Date-only values are calendar days, independent of the browser's UTC offset.
                    await input.fill('2026-10-27');
                    await input.press('Tab');
                    await page.waitForURL(url => url.searchParams.get('date') === '2026-10-27');
                    assert.equal(await input.inputValue(), '2026-10-27');
                    await page.locator('#prevDay').click();
                    await page.waitForFunction(() => document.getElementById('timelineDate').value === '2026-10-26');
                    await page.locator('#nextDay').click();
                    await page.waitForFunction(() => document.getElementById('timelineDate').value === '2026-10-27');

                    // Ordinary mode switches and copied/new-tab links keep the selected day.
                    const modeLinks = page.locator('[data-sidebar-timeline-mode]');
                    await modeLinks.first().waitFor({ state: 'attached' });
                    await page.waitForFunction(() => [...document.querySelectorAll('[data-sidebar-timeline-mode]')].every(link => new URL(link.href).searchParams.get('date') === '2026-10-27'));
                    const roomHref = await page.locator('[data-sidebar-timeline-mode="rooms"]').first().getAttribute('href');
                    const roomUrl = new URL(roomHref, baseUrl);
                    assert.equal(roomUrl.searchParams.get('timelineView'), 'rooms');
                    const copiedLink = await context.newPage();
                    await routeNavigationApi(copiedLink);
                    await copiedLink.goto(roomUrl.toString(), { waitUntil: 'networkidle' });
                    await copiedLink.waitForFunction(() => Boolean(document.getElementById('timelineDate')?.value));
                    assert.equal(await copiedLink.locator('#timelineDate').inputValue(), '2026-10-27');
                    assert.equal(await copiedLink.locator('body').getAttribute('data-current-schedule-view-mode'), 'day');
                    assert.equal(await copiedLink.locator('body').evaluate(body => body.classList.contains('timeline-view-rooms')), true);
                    await copiedLink.close();
                    if (width > 600) {
                        await page.locator('[data-sidebar-timeline-mode="rooms"]').first().click();
                        await page.waitForURL(url => url.searchParams.get('timelineView') === 'rooms');
                        assert.equal(await input.inputValue(), '2026-10-27');
                        await page.locator('[data-sidebar-timeline-mode="animators"]').first().click();
                    }
                    await page.screenshot({ path: path.join(output, `${label}-selected.png`) });

                    // Invalid URL days must not silently open a different calendar day.
                    await page.goto(`${baseUrl}/?timelineView=animators&date=2026-02-31`, { waitUntil: 'networkidle' });
                    await page.waitForFunction(() => Boolean(document.getElementById('timelineDate')?.value));
                    const today = await page.evaluate(() => {
                        const date = new Date();
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    });
                    assert.equal(await input.inputValue(), today, `${label}: invalid deep link falls back to today`);
                    assert.equal(new URL(page.url()).searchParams.get('date'), today, `${label}: URL agrees with the displayed fallback`);
                    await page.screenshot({ path: path.join(output, `${label}.png`) });
                    assert.deepEqual(errors, [], `${label}: no browser errors`);
                    assert.deepEqual(writes, [], `${label}: navigation never writes business data`);
                    results.push({ timezoneId, width, status: 'passed' });
                } catch (error) {
                    await page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {});
                    results.push({ timezoneId, width, status: 'failed', error: error.stack || error.message });
                } finally { await context.close(); }
            }
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        const failures = results.filter(result => result.status === 'failed');
        assert.deepEqual(failures, [], 'Park timeline date navigation regressions');
        console.log(`Park timeline navigation: ${results.length} timezone/viewport cases passed.`);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
