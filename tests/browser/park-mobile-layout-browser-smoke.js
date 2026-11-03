'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');
const { waitForStableLayout } = require('../helpers/browser-smoke-sync');

const output = process.env.PARK_MOBILE_LAYOUT_OUTPUT || path.join(__dirname, '../../output/playwright/park-mobile-layout');
const date = '2026-10-25';

async function run() {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    let browser;
    const results = [];
    try {
        browser = await requirePlaywright().chromium.launch({ headless: true });
        for (const width of [320, 390, 1440]) {
            for (const view of ['animators', 'rooms']) {
                for (const dark of [true, false]) {
                    const label = `${width}-${view}-${dark ? 'dark' : 'light'}`;
                    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, serviceWorkers: 'block' });
                    const page = await context.newPage();
                    const errors = [];
                    page.on('pageerror', error => errors.push(error.message));
                    try {
                        await context.addInitScript(({ user, dark }) => {
                            localStorage.setItem('pzp_token', 'fixture');
                            localStorage.setItem('pzp_access_token', 'fixture');
                            localStorage.setItem('pzp_current_user', JSON.stringify(user));
                            localStorage.setItem('pzp_crm_business_context', 'event_genix');
                            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                            localStorage.setItem('pzp_dark_mode', String(dark));
                        }, { user: SMOKE_USER, dark });
                        await page.routeWebSocket('**/*', socket => socket.onMessage(raw => {
                            if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' }));
                        }));
                        await routeMockedApi(page);
                        await page.route(/\/api\/(?:business\/profile|auth\/business-profile)(?:\?|$)/, route => {
                            const profile = businessProfilePayload();
                            const timeline = profile.businessProfile.businesses[0].timeline;
                            timeline.defaultTimelineView = 'animators';
                            timeline.enabledModules.afisha = timeline.timelineFeatures.afisha = true;
                            return route.fulfill({ json: { ...profile, user: SMOKE_USER } });
                        });
                        await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [
                            { id: 501, title: 'Тестова акція вихідного дня', starts_on: date, ends_on: date, color_key: 'amber', version: 1 }
                        ] } }));
                        await page.route('**/api/afisha**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(date) ? [
                            { id: 601, title: 'Творча майстерня', date, time: '14:00', duration: 45, type: 'event' },
                            { id: 602, title: 'Свято іменинників', date, time: '16:00', duration: 30, type: 'event' }
                        ] : [] }));
                        const lines = ['Тестенко Марія', 'Аніматор 1', 'Кімната пригод'].map((name, index) => ({
                            id: `fixture-${index}`, resourceId: `fixture-${index}`, name,
                            resourceType: view === 'rooms' ? 'room' : 'animator', color: '#14b8a6'
                        }));
                        await page.route(/\/api\/lines\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => route.fulfill({ json: lines }));
                        await page.route(/\/api\/bookings\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => route.fulfill({ json: [] }));
                        await page.goto(`${baseUrl}/?timelineView=${view}&date=${date}`, { waitUntil: 'networkidle' });
                        await page.locator('#timelineLines[data-timeline-state="ready"]').waitFor();
                        const toggle = page.locator('[data-toggle-marketing]');
                        await toggle.click();
                        if (view === 'animators') await page.locator('.afisha-all-day-card').first().waitFor();
                        for (const period of ['day', 'week']) {
                            if (period === 'week') {
                                if (!await page.locator('#timelineViewPanel').isVisible()) await page.locator('#timelineViewPanelToggle').click();
                                await page.locator('#periodSelector [data-schedule-view-mode="week"]').click();
                                await page.locator('.mini-timeline-line').first().waitFor();
                                if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
                                await page.locator('#timelineViewPanelToggle').click();
                            }
                            await page.evaluate(() => {
                                document.getElementById('timelineScroll').scrollTo(0, 0);
                                document.querySelectorAll('.day-section-content').forEach(el => el.scrollTo(0, 0));
                            });
                            await waitForStableLayout(page, ['.timeline-promotions', '.line-header', '.mini-line-header', '#timelineScroll']);
                            await page.screenshot({ path: path.join(output, `${label}-${period}.png`) });
                            const geometry = await page.evaluate(period => {
                                const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width }; };
                                const header = document.querySelector(period === 'day' ? '.line-header' : '.mini-line-header');
                                const grid = header.nextElementSibling;
                                const panel = document.querySelector('.timeline-promotions');
                                const scroll = document.getElementById('timelineScroll');
                                return {
                                    header: box(header), grid: box(grid), panel: box(panel), scroll: box(scroll),
                                    names: [...document.querySelectorAll(period === 'day' ? '.line-name' : '.mini-line-header')].map(el => ({ text: el.textContent, width: el.clientWidth, font: parseFloat(getComputedStyle(el).fontSize) })),
                                    allDay: grid.querySelector('.afisha-all-day-card') ? box(grid.querySelector('.afisha-all-day-card')) : null,
                                    promotionSection: panel.querySelector('.timeline-promotion-section') ? box(panel.querySelector('.timeline-promotion-section')) : null,
                                    afishaSection: panel.querySelector('.timeline-afisha-summary') ? box(panel.querySelector('.timeline-afisha-summary')) : null,
                                    dayScaleHeight: document.getElementById('timeScale').getBoundingClientRect().height,
                                    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth
                                };
                            }, period);
                            results.push({ label, period, geometry });
                            fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
                            assert.ok(geometry.header.right <= geometry.grid.x + 1, `${label}/${period}: label overlaps time grid`);
                            if (geometry.allDay) assert.ok(geometry.allDay.x >= geometry.header.right, `${label}/${period}: all-day promotion covers the resource label`);
                            if (geometry.afishaSection) assert.ok(geometry.promotionSection.bottom <= geometry.afishaSection.y, `${label}/${period}: promotion section overlaps afisha`);
                            if (period === 'week') assert.equal(geometry.dayScaleHeight, 0, 'weekly view must not leave a blank daily scale');
                            assert.ok(geometry.panel.x <= geometry.scroll.x + (width < 768 ? 8 : 24), `${label}: marketing has a duplicate left inset`);
                            if (width < 768) {
                                assert.ok(geometry.header.width >= 96, `${label}: resource labels are too narrow`);
                                assert.ok(geometry.names.every(name => name.font >= 12), `${label}: resource labels are too small`);
                            }
                            assert.ok(geometry.pageWidth <= geometry.viewport, `${label}: page itself overflows`);
                            // The grid intentionally slides under the sticky label. Verify the label
                            // owns the painted hit area rather than merely comparing overlapping rects.
                            await page.locator(period === 'day' ? '.line-header' : '.mini-line-header').first().scrollIntoViewIfNeeded();
                            await page.evaluate(period => {
                                (period === 'day' ? document.getElementById('timelineScroll') : document.querySelector('.day-section-content')).scrollLeft = 240;
                            }, period);
                            await waitForStableLayout(page, ['.line-header', '.mini-line-header']);
                            const scrolled = await page.evaluate(period => {
                                const outer = document.getElementById('timelineScroll');
                                const el = period === 'day' ? outer : document.querySelector('.day-section-content');
                                return { left: el.scrollLeft, width: el.clientWidth, outerWidth: outer.clientWidth };
                            }, period);
                            assert.ok(scrolled.left > 0, `${label}/${period}: intended time scroller did not move`);
                            if (period === 'week') assert.ok(scrolled.width <= scrolled.outerWidth, `${label}: weekly viewport inherited daily content width`);
                            const pinned = await page.evaluate(period => {
                                const el = document.querySelector(period === 'day' ? '.line-header' : '.mini-line-header');
                                const r = el.getBoundingClientRect();
                                const style = getComputedStyle(el);
                                const alpha = style.backgroundColor.startsWith('rgba(') ? Number(style.backgroundColor.split(',').at(-1).replace(')', '')) : 1;
                                return r.x >= 0 && alpha === 1 && style.backgroundColor !== 'transparent'
                                    && el.contains(document.elementFromPoint(r.x + r.width - 8, r.y + r.height / 2));
                            }, period);
                            assert.ok(pinned, `${label}/${period}: resource label is lost or translucent over scrolled events`);
                            await page.screenshot({ path: path.join(output, `${label}-${period}-scrolled.png`) });
                        }
                        assert.deepEqual(errors, []);
                    } finally { await context.close(); }
                }
            }
        }
        console.log(`Park layout: ${results.length} day/week, phone/desktop, animator/room and light/dark cases passed.`);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
