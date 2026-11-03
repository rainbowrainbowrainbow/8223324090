'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const output = process.env.PARK_TIMELINE_LOAD_STATES_OUTPUT || path.join(__dirname, '../../output/playwright/park-timeline-load-states');
const selectedDate = '2026-10-25';

async function openFilters(page) {
    if (!await page.locator('#timelineViewPanel').isVisible()) await page.locator('#timelineViewPanelToggle').click();
}

async function waitForState(page, state, period) {
    await page.waitForFunction(({ state, period }) => {
        const latest = window.__timelineLoadStates?.at(-1);
        return document.getElementById('timelineLines')?.dataset.timelineState === state
            && latest?.status === state && latest?.viewMode === period;
    }, { state, period });
}

async function run() {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    const results = [];
    let browser;
    try {
        browser = await requirePlaywright().chromium.launch({ headless: true });
        for (const view of ['animators', 'rooms']) {
            for (const period of ['day', 'week']) {
                for (const source of ['resources', 'bookings']) {
                    const width = view === 'rooms' ? 320 : 390;
                    const label = `${view}-${period}-${source}-${width}`;
                    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
                    const page = await context.newPage();
                    const errors = [];
                    const writes = [];
                    const reads = { resources: 0, bookings: 0 };
                    let mode = 'failure';
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('request', request => {
                        if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method());
                    });
                    try {
                        await context.addInitScript(user => {
                            window.__timelineLoadStates = [];
                            window.addEventListener('timeline:summary-changed', event => window.__timelineLoadStates.push(event.detail));
                            localStorage.setItem('pzp_token', 'fixture');
                            localStorage.setItem('pzp_access_token', 'fixture');
                            localStorage.setItem('pzp_current_user', JSON.stringify(user));
                            localStorage.setItem('pzp_crm_business_context', 'event_genix');
                            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                            localStorage.setItem('pzp_dark_mode', 'true');
                        }, SMOKE_USER);
                        await page.routeWebSocket('**/*', socket => socket.onMessage(raw => {
                            if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' }));
                        }));
                        await routeMockedApi(page);
                        await page.route(/\/api\/(?:business\/profile|auth\/business-profile)(?:\?|$)/, route => {
                            const profile = businessProfilePayload();
                            profile.businessProfile.businesses[0].timeline.defaultTimelineView = 'animators';
                            return route.fulfill({ json: { ...profile, user: SMOKE_USER } });
                        });
                        await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [] } }));
                        const line = { id: 'fixture-resource', resourceId: 'fixture-resource', resourceType: view === 'rooms' ? 'room' : 'animator', name: 'Synthetic resource', color: '#14b8a6' };
                        await page.route(/\/api\/lines\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => {
                            reads.resources++;
                            if (mode === 'failure' && source === 'resources') return route.fulfill({ status: 503, json: { error: 'Synthetic resource unavailable', requestId: 'synthetic-request' } });
                            return route.fulfill({ json: mode === 'no-resources' ? [] : [line] });
                        });
                        await page.route(/\/api\/bookings\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => {
                            reads.bookings++;
                            if (mode === 'failure' && source === 'bookings') return route.fulfill({ status: 503, json: { error: 'Synthetic bookings unavailable', requestId: 'synthetic-request' } });
                            const date = new URL(route.request().url()).pathname.split('/').at(-1);
                            const booking = { id: 'synthetic-booking', lineId: line.id, resourceId: line.id, resourceType: line.resourceType, date, time: '14:00', duration: 60, status: 'confirmed', category: 'animation', programName: 'Synthetic booking', label: 'Synthetic', room: line.name, businessContext: 'event_genix' };
                            return route.fulfill({ json: mode !== 'no-resources' && date === selectedDate ? [booking] : [] });
                        });
                        await page.goto(`${baseUrl}/?timelineView=${view}&date=${selectedDate}`, { waitUntil: 'networkidle' });
                        await waitForState(page, 'error', 'day');
                        if (period === 'week') {
                            await openFilters(page);
                            await page.locator('#periodSelector [data-schedule-view-mode="week"]').click();
                            await waitForState(page, 'error', 'week');
                        }
                        const container = page.locator('#timelineLines');
                        const retry = container.locator('.timeline-data-error__retry');
                        assert.match(await container.innerText(), /HTTP 503/);
                        assert.match(await container.innerText(), /synthetic-request/);
                        const box = await retry.boundingBox();
                        assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 44, 'retry is a reachable touch target');
                        assert.equal(await page.locator('#addLineBtn').isVisible(), false);
                        await page.screenshot({ path: path.join(output, `${label}-error.png`) });
                        const before = { ...reads };
                        mode = 'ready';
                        await retry.click();
                        await waitForState(page, 'ready', period);
                        assert.ok(reads.resources > before.resources && reads.bookings > before.bookings, 'retry reads both sources');
                        assert.equal(await container.locator('.timeline-data-error').count(), 0);
                        assert.ok(await container.locator('[data-booking-id="synthetic-booking"]').count());
                        await openFilters(page);
                        await page.locator('.status-filter-btn[data-filter="preliminary"]').click();
                        const filtered = container.locator('.timeline-empty-state[data-empty-state="filtered"]');
                        await filtered.first().waitFor({ state: 'visible' });
                        await filtered.first().getByRole('button', { name: 'Показати всі' }).click();
                        assert.equal(await container.locator('.timeline-empty-state[data-empty-state="filtered"]').count(), 0);
                        assert.ok(await container.locator('[data-booking-id="synthetic-booking"]:not(.status-hidden)').count());
                        mode = 'no-resources';
                        await page.locator('#timelineDate').fill('2026-11-05');
                        await page.locator('#timelineDate').press('Tab');
                        await page.waitForFunction(() => window.__timelineLoadStates?.at(-1)?.date === '2026-11-05' && window.__timelineLoadStates.at(-1).status === 'ready');
                        const empty = container.locator('.timeline-empty-state[data-empty-state="resources"]');
                        await empty.first().waitFor({ state: 'visible' });
                        assert.match(await empty.first().innerText(), view === 'rooms' ? /немає кімнат/ : /немає аніматорів/);
                        assert.equal(await container.locator('.timeline-data-error').count(), 0);
                        await page.screenshot({ path: path.join(output, `${label}-empty.png`) });
                        assert.deepEqual(errors, []);
                        assert.deepEqual(writes, []);
                        results.push({ label, status: 'passed', reads });
                    } catch (error) {
                        await page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {});
                        results.push({ label, status: 'failed', error: error.stack || error.message });
                    } finally { await context.close(); }
                }
            }
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        assert.deepEqual(results.filter(row => row.status !== 'passed'), [], 'Timeline loading/error/empty/filter browser matrix');
        console.log(`Timeline load states: ${results.length} mobile day/week, animator/room and source-retry cases passed.`);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
