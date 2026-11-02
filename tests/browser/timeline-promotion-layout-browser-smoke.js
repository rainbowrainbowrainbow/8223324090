'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer, routeMockedApi, businessProfilePayload, SMOKE_USER, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const baseline = process.argv.includes('--baseline');
const output = process.env.TIMELINE_PROMOTION_LAYOUT_OUTPUT || path.join(__dirname, '../../output/playwright/promotion-layout');
const initialPromotions = [
    { id: 1, title: 'Коротка акція на краю тижня', starts_on: '2026-10-24', ends_on: '2026-10-25' },
    { id: 2, title: 'Одноденна акція з дуже довгою назвою для перевірки розміщення кнопок', starts_on: '2026-10-27', ends_on: '2026-10-27' },
    { id: 3, title: 'Акція в кінці тижня', starts_on: '2026-10-31', ends_on: '2026-11-01' },
    { id: 4, title: 'Акція на два дні', starts_on: '2026-10-28', ends_on: '2026-10-29' },
    { id: 5, title: 'Тижнева акція', starts_on: '2026-10-25', ends_on: '2026-10-31' }
].map(item => ({ ...item, color_key: 'amber', description: '', is_active: true, version: 1 }));
const events = [1, 2, 4].flatMap(id => [1, 2].map(index => ({ id: id * 10 + index,
    promotion_id: id, title: `Пов’язаний захід ${index} із довгою назвою`, date: id === 1 ? '2026-10-25' : id === 2 ? '2026-10-27' : '2026-10-28',
    time: index === 1 ? '14:00' : '17:00', duration: 30, type: 'event' })));

async function geometry(page) {
    return page.evaluate(() => {
        const issues = [];
        const rect = element => element.getBoundingClientRect();
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        for (const band of document.querySelectorAll('.timeline-promotion-band')) {
            const bounds = rect(band);
            const id = band.closest('[data-promotion-id]').dataset.promotionId;
            const controls = [...band.children].filter(element => element.tagName === 'BUTTON');
            const centers = controls.map(control => (rect(control).top + rect(control).bottom) / 2);
            if (Math.max(...centers) - Math.min(...centers) > 1) issues.push(`${id}: primary controls wrap onto different rows`);
            for (const control of controls) {
                const r = rect(control);
                if (r.left < bounds.left - 1 || r.right > bounds.right + 1) issues.push(`${id}: control outside band: ${control.className}`);
                const visibleText = [...control.querySelectorAll('em')].filter(element => rect(element).width > 0);
                if (visibleText.some(element => rect(element).left < r.left - 1 || rect(element).right > r.right + 1)) issues.push(`${id}: badge outside its button`);
            }
            for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
                if (overlap(rect(controls[i]), rect(controls[j]))) issues.push(`${id}: controls overlap`);
            }
            const links = band.querySelector('.promotion-afisha-links');
            if (links && controls.some(control => overlap(rect(links), rect(control)))) issues.push(`${id}: linked events overlap controls`);
        }
        return { issues, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            bands: document.querySelectorAll('.timeline-promotion-band').length };
    });
}

async function dismissDialog(page) {
    await page.waitForFunction(() => Boolean(document.activeElement.closest('.timeline-marketing-modal')));
    await page.keyboard.press('Escape');
    await page.locator('.timeline-marketing-modal').waitFor({ state: 'detached' });
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
    const cases = baseline ? [{ width: 1254, dark: true, touch: false }] : [
        ...[1254, 1440, 768, 390, 320].flatMap(width => [false, true].map(dark => ({ width, dark, touch: width < 600 }))),
        { width: 768, dark: true, touch: true }, { width: 1254, dark: true, touch: true }
    ];
    const results = [];
    try {
        for (const { width, dark, touch } of cases) {
            const context = await browser.newContext({ viewport: { width, height: 839 }, hasTouch: touch, serviceWorkers: 'block' });
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
                const errors = [];
                const writes = [];
                const promotions = structuredClone(initialPromotions);
                page.on('pageerror', error => errors.push(error.message));
                await page.routeWebSocket('**/*', socket => socket.onMessage(raw => {
                    if (String(raw).includes('ping')) socket.send(JSON.stringify({ type: 'pong' }));
                }));
                await routeMockedApi(page);
                await page.route('**/api/business/profile**', route => {
                    const body = businessProfilePayload();
                    const timeline = body.businessProfile.businesses[0].timeline;
                    timeline.defaultTimelineView = 'animators';
                    timeline.enabledModules.afisha = true;
                    timeline.timelineFeatures.afisha = true;
                    return route.fulfill({ json: body });
                });
                await page.route('**/api/lines/**', route => route.fulfill({ json: [
                    { id: '1', name: 'Демонстраційний аніматор', color: '#6952ce' }
                ] }));
                await page.route('**/api/bookings/**', route => route.fulfill({ json: [] }));
                await page.route('**/api/afisha/**', route => {
                    const date = new URL(route.request().url()).pathname.split('/').pop();
                    return route.fulfill({ json: events.filter(event => event.date === date) });
                });
                await page.route('**/api/timeline/promotions**', route => {
                    const request = route.request();
                    if (request.method() === 'PATCH') {
                        const id = Number(new URL(request.url()).pathname.split('/').pop());
                        const values = request.postDataJSON();
                        writes.push({ id, values });
                        const item = promotions.find(item => item.id === id);
                        Object.assign(item, values, { version: item.version + 1 });
                        return route.fulfill({ json: { promotion: item } });
                    }
                    const url = new URL(request.url());
                    const from = url.searchParams.get('from');
                    const to = url.searchParams.get('to');
                    return route.fulfill({ json: { promotions: promotions.filter(item => !from || !to || item.starts_on <= to && item.ends_on >= from) } });
                });
                await page.goto(`${baseUrl}/?timelineView=animators&date=2026-10-25`, { waitUntil: 'domcontentloaded' });
                await page.locator('[data-toggle-marketing]').waitFor();
                await page.locator('#timelineViewPanelToggle').click();
                await page.locator('[data-schedule-view-mode="week"]').click();
                await page.locator('.day-section').nth(6).waitFor();
                await page.locator('[data-toggle-marketing]').click();
                await page.locator('[data-more]').click();
                await page.locator('.timeline-promotion-row').nth(4).waitFor();
                const name = `${baseline ? 'before' : 'after'}-${width}-${dark ? 'dark' : 'light'}${touch ? '-touch' : ''}`;
                const measured = await geometry(page);
                await page.locator('.timeline-promotions').screenshot({ path: path.join(output, `${name}.png`) });
                results.push({ width, dark, touch, ...measured });
                if (baseline) {
                    assert.ok(measured.issues.length, 'baseline must reproduce the annotation');
                    continue;
                }
                assert.deepEqual(measured.issues, [], `${name}: no overlapping or escaping controls`);
                assert.ok(measured.pageOverflow <= 1, `${name}: page has no horizontal overflow`);
                assert.equal(measured.bands, 5);
                const row = page.locator('[data-promotion-id="2"]');
                await row.locator('[data-add-linked-afisha]').click();
                assert.equal(await page.locator('[data-create-form] select[name="promotion"]').inputValue(), '2');
                await dismissDialog(page);
                assert.equal(await row.locator('[data-add-linked-afisha]').evaluate(element => element === document.activeElement), true);
                await row.locator('.promotion-label').click();
                assert.equal(await page.locator('.timeline-marketing-modal input[name="title"]').inputValue(), initialPromotions[1].title);
                await dismissDialog(page);
                await row.locator('[data-linked-afisha="21"]').click();
                await page.locator('.timeline-marketing-modal').waitFor();
                await dismissDialog(page);
                assert.equal(writes.length, 0, 'opening links and dialogs must not change data');
                if (width === 1254 && dark) {
                    await row.locator('[data-edge="end"]').focus();
                    await page.keyboard.press('ArrowRight');
                    await page.waitForFunction(() => document.querySelector('[data-promotion-id="2"] .promotion-label')?.getAttribute('aria-label').includes('2026-10-28'));
                    assert.equal(writes.length, 1, 'resize keyboard handler still sends one update');
                    const box = await row.locator('.promotion-label').boundingBox();
                    const step = (await page.locator('.timeline-promotion-dates').boundingBox()).width / 7;
                    await page.mouse.move(box.x + 20, box.y + box.height / 2);
                    await page.mouse.down();
                    await page.mouse.move(box.x + 20 + step, box.y + box.height / 2, { steps: 5 });
                    await page.mouse.up();
                    await page.waitForFunction(() => document.querySelector('[data-promotion-id="2"] .promotion-label')?.getAttribute('aria-label').includes('2026-10-29'));
                    assert.equal(writes.length, 2, 'drag handler still sends one update');
                    assert.equal(await page.locator('.timeline-marketing-modal').count(), 0, 'drag must not open an editor');
                }
                assert.deepEqual(errors, [], `${name}: no runtime errors`);
                await page.locator('#timelineViewPanelToggle').click();
                await page.locator('[data-schedule-view-mode="day"]').click();
                await page.locator('.afisha-line-grid').waitFor();
                await page.waitForFunction(() => document.querySelector('.timeline-promotions')?.dataset.visibleFrom === document.querySelector('.timeline-promotions')?.dataset.visibleTo);
                const dayGeometry = await geometry(page);
                assert.deepEqual(dayGeometry.issues, [], `${name}: day controls fit as well`);
                assert.ok(dayGeometry.pageOverflow <= 1, `${name}: day layout fits page`);
                await page.locator('.timeline-promotions').screenshot({ path: path.join(output, `${name}-day.png`) });
                console.log(`${name}: passed`);
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(output, baseline ? 'before.json' : 'results.json'), JSON.stringify(results, null, 2));
        console.log(`Promotion layout: ${results.length} cases checked.`);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
