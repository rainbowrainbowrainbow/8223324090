'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

async function runMobileTimelineOverview({ browser, baseUrl, output }) {
    fs.mkdirSync(output, { recursive: true });
    const full = process.env.MOBILE_TIMELINE_FULL === 'true', results = [];
    for (const role of full ? ['creator', 'admin', 'animator'] : ['creator', 'animator']) {
        for (const dark of full ? [false, true] : [true]) {
            const context = await browser.newContext({ ...requirePlaywright().devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
            const user = { ...SMOKE_USER, role, roles: [role] }, page = await context.newPage();
            const writes = [], errors = [], timelineReads = [];
            const lines = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, name: `Аніматор ${i + 1}`, color: '#14b8a6' }));
            const bookings = lines.map((line, i) => ({ id: `phone-overview-${i}`, lineId: line.id, date: '2026-11-06', time: '12:00', duration: 90,
                category: i === 1 ? 'quest' : 'animation', status: i === 1 ? 'preliminary' : 'confirmed', label: 'PIR', programName: 'Піратські пригоди',
                customerName: 'Синтетичне свято', businessContext: 'event_genix' }));
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                const p = new URL(request.url()).pathname;
                if (/\/api\/(?:bookings|lines)\/\d{4}-\d{2}-\d{2}$/.test(p)) timelineReads.push(p);
                if (p.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + p);
            });
            try {
                await context.addInitScript(({ user, dark }) => {
                    for (const key of ['pzp_token', 'pzp_access_token']) localStorage.setItem(key, 'synthetic-phone-overview');
                    localStorage.setItem('pzp_current_user', JSON.stringify(user));
                    localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                    localStorage.setItem('pzp_dark_mode', String(dark));
                }, { user, dark });
                await page.routeWebSocket('**/*', socket => socket.onMessage(raw => { if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' })); }));
                await routeMockedApi(page);
                await page.route(/\/api\/(?:business\/profile|auth\/business-profile)(?:\?|$)/, route => {
                    const profile = businessProfilePayload(); profile.businessProfile.businesses[0].timeline.defaultTimelineView = 'animators';
                    return route.fulfill({ json: { ...profile, user } });
                });
                await page.route(/\/api\/auth\/verify(?:\?|$)/, route => route.fulfill({ json: { user } }));
                const snapshot = buildCapabilitySnapshot(user);
                await page.route(/\/api\/auth\/permissions(?:\?|$)/, route => route.fulfill({ json: { pages: snapshot.pages, actions: snapshot.actions, capabilities: snapshot.decisions, capabilityCatalog: snapshot.catalog } }));
                await page.route(/\/api\/lines\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => route.fulfill({ json: lines }));
                await page.route(/\/api\/bookings\/\d{4}-\d{2}-\d{2}(?:\?|$)/, route => route.fulfill({ json: bookings }));
                await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { promotions: [] } }));
                // Never permit an accidental gesture to write, even to fixture routes.
                await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.fallback() : route.abort());
                await page.goto(baseUrl + '/?timelineView=animators&date=2026-11-06', { waitUntil: 'networkidle' });
                await page.locator('#timelineLines[data-timeline-state="ready"] .booking-block').first().waitFor();
                await page.waitForFunction(() => document.body.classList.contains('timeline-phone-layout'));
                assert.equal(await page.locator('.booking-block[data-phone-compact="false"] .timeline-phone-booking-status').first().isVisible(), true);
                await page.evaluate(() => {
                    window.__phoneLoadingEvents = [];
                    new MutationObserver(() => { if (document.getElementById('timelineLines').dataset.timelineState === 'loading') window.__phoneLoadingEvents.push(performance.now()); })
                        .observe(document.getElementById('timelineLines'), { attributes: true, attributeFilter: ['data-timeline-state'] });
                });
                const touch = await context.newCDPSession(page);
                async function swipe(x, y, dx, dy) {
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
                    for (let i = 1; i <= 10; i++) { await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] }); await page.waitForTimeout(18); }
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                }
                async function settleScroll() {
                    await page.evaluate(() => new Promise(resolve => {
                        const scroll = document.getElementById('timelineScroll'); let timer;
                        const quiet = () => { clearTimeout(timer); timer = setTimeout(() => { scroll.removeEventListener('scroll', quiet); resolve(); }, 100); };
                        scroll.addEventListener('scroll', quiet, { passive: true }); quiet();
                    }));
                }
                for (const [orientation, width, height] of [['portrait', 390, 844], ['landscape', 844, 390], ['return-portrait', 390, 844]]) {
                    console.log(`Checking phone overview: ${role}/${dark}/${width}x${height}`);
                    const readsBefore = timelineReads.length;
                    await page.evaluate(() => { window.__phoneAnchor = document.querySelector('.booking-block'); });
                    await page.setViewportSize({ width, height });
                    await page.waitForTimeout(250); // Existing resize coalescing is 120 ms.
                    assert.equal(timelineReads.length, readsBefore, 'Rotation must not refetch lines or bookings');
                    assert.equal(await page.evaluate(() => document.querySelector('.booking-block') === window.__phoneAnchor), true, 'Rotation preserves existing booking nodes');
                    assert.deepEqual(await page.evaluate(() => window.__phoneLoadingEvents), [], 'Rotation must not replace data with a loading state');
                    await page.evaluate(() => {
                        const scroll = document.getElementById('timelineScroll'); scroll.scrollTop = 0;
                        scroll.scrollLeft = 0; scroll.scrollIntoView({ block: 'start' });
                    });
                    const geometry = await page.evaluate(() => {
                        const scroll = document.getElementById('timelineScroll'), box = scroll.getBoundingClientRect();
                        const block = [...scroll.querySelectorAll('.booking-block')].find(el => { const r = el.getBoundingClientRect(); return r.y > box.y + 40 && r.bottom < Math.min(innerHeight, box.bottom) - 4; });
                        if (!block) throw new Error('No visible fixture booking for a native swipe');
                        const r = block.getBoundingClientRect(), header = block.closest('.timeline-line').querySelector('.line-header').getBoundingClientRect();
                        const x = Math.min(r.right - 12, Math.max(r.x + 32, header.right + 20)), y = r.y + r.height / 2;
                        return { x, y, hit: document.elementFromPoint(x, y)?.closest('.booking-block')?.dataset.bookingId,
                            scrollHeight: scroll.scrollHeight, height: scroll.clientHeight, left: box.left, right: box.right, width: innerWidth };
                    });
                    assert(geometry.hit, 'Swipe must start on an actual booking, not a sticky label');
                    assert(geometry.scrollHeight > geometry.height + 100, 'Fixture exercises vertical scrolling');
                    assert(geometry.left < 20 && geometry.right <= width + 1, 'Landscape phone must not reserve a desktop sidebar');
                    await swipe(geometry.x, geometry.y, 0, -60);
                    await page.waitForFunction(() => document.getElementById('timelineScroll').scrollTop > 20);
                    await settleScroll();
                    assert.equal(await page.locator('#bookingModal').isVisible(), false, 'A swipe must not open details');
                    await page.evaluate(() => document.getElementById('timelineScroll').scrollTop = 0);
                    await page.waitForTimeout(100);
                    await swipe(geometry.x, geometry.y, -60, 0);
                    await page.waitForFunction(() => document.getElementById('timelineScroll').scrollLeft > 20);
                    await settleScroll();
                    const pinned = await page.evaluate(() => {
                        const scroll = document.getElementById('timelineScroll').getBoundingClientRect();
                        const label = document.querySelector('.line-header').getBoundingClientRect();
                        return { scrollLeft: scroll.left, labelLeft: label.left, left: getComputedStyle(document.querySelector('.line-header')).left };
                    });
                    assert.ok(Math.abs(pinned.scrollLeft - pinned.labelLeft) < 2, 'Resource label stays pinned while the time axis pans: ' + JSON.stringify(pinned));
                    await page.evaluate(() => document.getElementById('timelineScroll').scrollLeft = 0);
                    await page.waitForTimeout(100);
                    // A tap uses the existing canonical details implementation and modal.
                    await page.touchscreen.tap(geometry.x, geometry.y);
                    await page.locator('#bookingModal').waitFor({ state: 'visible' });
                    assert.match(await page.locator('#bookingDetails').textContent(), /Піратські пригоди/);
                    await page.keyboard.press('Escape');
                    await page.locator('#bookingModal').waitFor({ state: 'hidden' });
                    await page.locator('#sidebarToggle').tap();
                    await page.waitForFunction(() => document.getElementById('sidebarNav').classList.contains('open'));
                    await page.locator('#sidebarOverlay').tap({ position: { x: width - 8, y: Math.min(height - 20, 220) } });
                    await page.waitForFunction(() => !document.getElementById('sidebarNav').classList.contains('open'));
                    const visibleCanvas = await page.locator('#timelineScroll').boundingBox();
                    assert(visibleCanvas.y < height * 0.55, 'Normal phone view must expose the timeline below the toolbar');
                    const label = `${role}-${dark ? 'dark' : 'light'}-${orientation}`;
                    await page.screenshot({ path: path.join(output, label + '.png'), animations: 'disabled' });
                    results.push({ label, status: 'passed', rotationReads: 0, canonicalDetailOpened: true, nativeVerticalSwipe: true, nativeHorizontalSwipe: true, pinnedResourceLabel: true });
                }
                assert.deepEqual(errors, []); assert.deepEqual(writes, []);
            } catch (error) { await page.screenshot({ path: path.join(output, `${role}-${dark}-failure.png`) }).catch(() => {}); throw error; }
            finally { await context.close(); }
        }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ full, physicalPhone: false, results }, null, 2));
    console.log(`Mobile timeline overview: ${results.length} phone/theme/role cases passed.`);
}

if (require.main === module) (async () => {
    const { server, baseUrl } = await createStaticServer(); let browser;
    try { browser = await requirePlaywright().chromium.launch({ headless: true, ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
        await runMobileTimelineOverview({ browser, baseUrl, output: process.env.MOBILE_TIMELINE_OUTPUT || path.join(__dirname, '../../output/playwright/mobile-timeline-overview') });
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { runMobileTimelineOverview };
