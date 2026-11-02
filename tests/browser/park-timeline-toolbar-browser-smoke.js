'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const output = process.env.PARK_TIMELINE_TOOLBAR_OUTPUT || path.join(__dirname, '../../output/playwright/park-timeline-toolbar');

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
    const results = [];
    try {
        for (const width of [1440, 768, 390, 320]) {
            for (const dark of [false, true]) {
                for (const view of ['animators', 'rooms']) {
                const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' });
                try {
                    await context.addInitScript(({ user, dark }) => {
                        localStorage.setItem('pzp_token', 'fixture');
                        localStorage.setItem('pzp_access_token', 'fixture');
                        localStorage.setItem('pzp_current_user', JSON.stringify(user));
                        localStorage.setItem('pzp_crm_business_context', 'event_genix');
                        localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                        localStorage.setItem('pzp_dark_mode', String(dark));
                    }, { user: SMOKE_USER, dark });
                    const page = await context.newPage();
                    const writes = [];
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('request', request => {
                        if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
                    });
                    await page.routeWebSocket('**/*', socket => {
                        socket.onMessage(raw => { if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' })); });
                    });
                    await routeMockedApi(page);
                    await page.route('**/api/business/profile**', route => {
                        const profile = businessProfilePayload();
                        profile.businessProfile.businesses[0].timeline.defaultTimelineView = 'animators';
                        return route.fulfill({ json: profile });
                    });
                    await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [] } }));
                    await page.goto(`${baseUrl}/?timelineView=${view}`, { waitUntil: 'domcontentloaded' });
                    await page.locator('[data-toggle-marketing]').waitFor();
                    const label = `${view}-${width}-${dark ? 'dark' : 'light'}`;
                    const geometry = await page.evaluate(() => {
                        const viewport = document.documentElement.clientWidth;
                        const ids = ['prevDay', 'timelineDate', 'nextDay', 'todayBtn', 'timelineViewPanelToggle'];
                        return { overflow: document.documentElement.scrollWidth - viewport,
                            hidden: ids.filter(id => {
                                const rect = document.getElementById(id).getBoundingClientRect();
                                return rect.width < 1 || rect.height < 1 || rect.left < 0 || rect.right > viewport + 1;
                            }),
                            emptyMarketingHeight: document.querySelector('.timeline-marketing-overview').getBoundingClientRect().height };
                    });
                    assert.deepEqual(geometry.hidden, [], `${label}: date controls must be reachable without sideways scrolling`);
                    assert.ok(geometry.overflow <= 1, `${label}: page must fit its viewport`);
                    assert.ok(geometry.emptyMarketingHeight <= 48, `${label}: empty marketing stays compact`);
                    assert.equal(await page.locator('#exportPdfBtn').isVisible(), false);
                    await page.locator('#timelineViewPanelToggle').click();
                    assert.equal(await page.locator('#exportPdfBtn').isVisible(), true);
                    assert.equal(await page.locator('#exportTimelineBtn').isVisible(), true);
                    await page.locator('[data-filter="preliminary"]').click();
                    assert.equal(await page.locator('[data-filter="preliminary"]').getAttribute('aria-pressed'), 'true');
                    await page.locator('[data-filter="all"]').click();
                    await page.locator('.zoom-btn[data-zoom="30"]').click();
                    assert.equal(await page.locator('.zoom-btn[data-zoom="30"]').getAttribute('aria-pressed'), 'true');
                    await page.locator('.zoom-btn[data-zoom="15"]').click();
                    await page.keyboard.press('Escape');
                    assert.equal(await page.locator('#timelineViewPanelToggle').getAttribute('aria-expanded'), 'false');
                    assert.equal(await page.evaluate(() => document.activeElement.id), 'timelineViewPanelToggle');
                    await page.locator('[data-toggle-marketing]').click();
                    assert.equal(await page.locator('[data-add]').isVisible(), true, 'empty state keeps the create action available');
                    await page.locator('[data-toggle-marketing]').click();
                    const dateBefore = await page.locator('#timelineDate').inputValue();
                    await page.locator('#prevDay').click();
                    await page.waitForFunction(date => document.getElementById('timelineDate').value !== date, dateBefore);
                    await page.locator('#todayBtn').click();
                    await page.waitForFunction(date => document.getElementById('timelineDate').value === date, dateBefore);
                    await page.screenshot({ path: path.join(output, `${label}.png`) });
                    assert.deepEqual(errors, [], `${label}: no browser runtime errors`);
                    assert.deepEqual(writes, [], `${label}: viewing controls never mutate API data`);
                    results.push({ view, viewport: width, theme: dark ? 'dark' : 'light', ...geometry });
                } finally { await context.close(); }
                }
            }
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        console.log(`Park timeline toolbar: ${results.length} viewport/theme cases passed.`);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
