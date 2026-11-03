'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');
const { waitForStableLayout } = require('../helpers/browser-smoke-sync');

const target = process.env.TEST_URL;
const database = process.env.PARK_MANAGER_BROWSER_DATABASE_URL;
const runId = crypto.randomBytes(6).toString('hex');
const output = process.env.PARK_MANAGER_BROWSER_OUTPUT || path.join(__dirname, '../../output/playwright/park-manager');
const cases = [
    { width: 390, view: 'animators', date: '2099-10-20' },
    { width: 320, view: 'animators', date: '2099-10-21' },
    { width: 390, view: 'rooms', date: '2099-10-22' },
    { width: 320, view: 'rooms', date: '2099-10-23' }
];

async function api(route, { method = 'GET', body, token } = {}) {
    const response = await fetch(new URL(route, target), {
        method, signal: AbortSignal.timeout(30000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Business-Context': 'event_genix', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json();
    assert.ok(response.ok, `${method} ${new URL(route, target).pathname}: HTTP ${response.status} ${payload.code || payload.error || ''}`);
    return payload;
}

async function seed(pool) {
    const lineIds = Array.from({ length: 12 }, () => `manual_animator_${crypto.randomUUID()}`);
    const roomId = `room-mobile-${runId}`;
    const roomName = `Synthetic mobile room ${runId}`;
    const programId = `qa-mobile-${runId}`;
    const programName = `Synthetic mobile activity ${runId}`;
    const customerName = `Synthetic mobile client ${runId}`;
    await pool.query(`INSERT INTO timeline_resources (business_context,resource_id,type,name,is_active,color)
        VALUES ('event_genix',$1,'room',$2,true,'#2563eb')`, [roomId, roomName]);
    for (const { date } of cases) {
        for (const [index, lineId] of lineIds.entries()) await pool.query(`INSERT INTO lines_by_date (business_context,date,line_id,name,color,from_sheet)
            VALUES ('event_genix',$1,$2,$3,'#14b8a6',false)`, [date, lineId, `Synthetic animator ${index + 1}`]);
    }
    await pool.query(`INSERT INTO products (id,business_context,code,timeline_code,label,name,category,duration,price,hosts,is_active)
        VALUES ($1,'event_genix','QA-MOBILE','QA','QA Mobile',$2,'animation',60,1000,1,true)`, [programId, programName]);
    const customer = (await pool.query(`INSERT INTO customers (business_context,name,child_name)
        VALUES ('event_genix',$1,'Synthetic child') RETURNING id`, [customerName])).rows[0];
    await pool.query(`INSERT INTO timeline_promotions
        (business_context,title,description,starts_on,ends_on,created_by)
        VALUES ('event_genix',$1,'Synthetic mobile layout check','2099-10-20','2099-10-26','qa-mobile')`,
    [`Synthetic promotion ${runId}: ${'long title '.repeat(12)}`]);
    return { lineIds, lineId: lineIds.at(-1), roomId, roomName, programId, programName, customerName, customerId: customer.id };
}

async function waitForTimeline(page, date) {
    await page.waitForFunction(expected => document.getElementById('timelineDate')?.value === expected
        && document.getElementById('timelineLines')?.dataset.timelineState === 'ready', date);
    await waitForStableLayout(page);
}

async function switchView(page, view) {
    await page.locator('#sidebarToggle').click();
    await page.locator('#sidebarNav.open').waitFor({ state: 'visible' });
    await page.locator(`[data-sidebar-timeline-mode="${view}"]:visible`).first().click();
    await page.waitForURL(url => url.searchParams.get('timelineView') === view);
    await page.waitForFunction(expected => document.body.classList.contains(`timeline-view-${expected}`), view);
}

async function snapshot(page) {
    return page.evaluate(() => {
        const scroll = document.getElementById('timelineScroll');
        return { date: document.getElementById('timelineDate').value, mode: document.body.classList.contains('timeline-view-rooms') ? 'rooms' : 'animators',
            left: scroll.scrollLeft, top: scroll.scrollTop, pageX: scrollX, pageY: scrollY };
    });
}

async function run() {
    assert.equal(process.env.RUN_PARK_MANAGER_BROWSER_SMOKE, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(target);
    assertSafeTestDatabaseUrl(database, process.env);
    assert.notEqual(database, process.env.DATABASE_URL);
    fs.mkdirSync(output, { recursive: true });
    const pool = new Pool({ connectionString: database, ssl: false, max: 2 });
    let browser;
    const results = [];
    try {
        const fixture = await seed(pool);
        const session = await api('/api/auth/login', { method: 'POST', body: { username: process.env.TEST_USER, password: process.env.TEST_PASS } });
        const token = session.accessToken || session.token;
        assert.ok(token);
        browser = await requirePlaywright().chromium.launch({ headless: true });
        for (const row of cases) {
            const label = `${row.view}-${row.width}`;
            const context = await browser.newContext({ viewport: { width: row.width, height: 844 }, serviceWorkers: 'block' });
            const page = await context.newPage();
            page.setDefaultTimeout(15000);
            const errors = [];
            const apiFailures = [];
            const checkpoints = [];
            const checkpoint = async stage => {
                checkpoints.push({ stage, ...await page.evaluate(() => ({
                    program: document.getElementById('selectedProgram')?.value,
                    selectedCards: [...document.querySelectorAll('.program-icon.selected')].map(node => node.dataset.programId),
                    syncFixtureIds: getProductsSync().filter(product => String(product.id).startsWith('qa-mobile-')).map(product => product.id),
                    loadedFixtureIds: (AppState.products || []).filter(product => String(product.id).startsWith('qa-mobile-')).map(product => product.id),
                    loadedPriceDate: AppState.productsPriceDate,
                    currentPriceDate: getTimelineProductsPriceDate(),
                    loadedContext: AppState.productsBusinessContext,
                    currentContext: getTimelineProductsBusinessContext(),
                    room: document.getElementById('roomSelect')?.value,
                    customer: document.getElementById('selectedCustomerId')?.value
                })) });
                fs.writeFileSync(path.join(output, `${label}-checkpoints.json`), JSON.stringify(checkpoints, null, 2));
            };
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', response => {
                if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) apiFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
            });
            try {
                await context.addInitScript(({ token, session }) => {
                    localStorage.setItem('pzp_token', token);
                    localStorage.setItem('pzp_access_token', token);
                    localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                    localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                    localStorage.setItem('pzp_dark_mode', 'false');
                }, { token, session });
                // Only third-party browser resources are blocked. Business APIs,
                // booking creation, detail retrieval and the database are real.
                await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
                await page.goto(`${target}/?timelineView=animators&date=2099-10-19`, { waitUntil: 'domcontentloaded' });
                await waitForTimeline(page, '2099-10-19');
                await page.locator('#timelineDate').fill(row.date);
                await page.locator('#timelineDate').press('Tab');
                await waitForTimeline(page, row.date);
                if (row.view === 'animators') {
                    await page.locator('[data-toggle-marketing]').click();
                    const band = page.locator('.timeline-promotion-band').first();
                    await band.waitFor({ state: 'visible' });
                    const controls = await band.locator('button').evaluateAll(nodes => nodes.map(node => {
                        const rect = node.getBoundingClientRect();
                        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
                    }));
                    for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
                        const left = controls[a], right = controls[b];
                        assert.ok(Math.min(left.right, right.right) <= Math.max(left.x, right.x) + 1
                            || Math.min(left.bottom, right.bottom) <= Math.max(left.y, right.y) + 1,
                        'promotion title, add-event and handle buttons do not overlap');
                    }
                    await page.screenshot({ path: path.join(output, `${label}-promotion.png`) });
                    await band.locator('.promotion-add-afisha').click();
                    const marketingDialog = page.getByRole('dialog', { name: 'Додати афішний захід', exact: true });
                    await marketingDialog.waitFor({ state: 'visible' });
                    await marketingDialog.getByRole('button', { name: 'Закрити', exact: true }).click();
                    await marketingDialog.waitFor({ state: 'hidden' });
                    await page.locator('[data-toggle-marketing]').click();
                }
                await switchView(page, 'rooms');
                if (row.view === 'animators') await switchView(page, 'animators');
                await waitForTimeline(page, row.date);
                // The existing backdrop must remain reachable even at 320px.
                await page.locator('#sidebarToggle').click();
                await page.locator('#sidebarNav.open').waitFor({ state: 'visible' });
                const nav = await page.locator('#sidebarNav').boundingBox();
                assert.ok(nav.x + nav.width < row.width - 10, 'sidebar leaves a dismissible backdrop');
                await page.screenshot({ path: path.join(output, `${label}-sidebar.png`) });
                await page.locator('#sidebarOverlay').click({ position: { x: row.width - 10, y: 200 } });
                assert.equal(await page.locator('#sidebarNav').evaluate(node => node.classList.contains('open')), false);
                await page.locator('#timelineViewPanelToggle').click();
                await page.locator('.status-filter-btn[data-filter="confirmed"]').click();
                await page.locator('#timelineViewPanelToggle').click();
                const lineId = row.view === 'rooms' ? fixture.roomId : fixture.lineId;
                const cell = page.locator(`.grid-cell[data-line="${lineId}"][data-time="14:00"]`).first();
                await cell.scrollIntoViewIfNeeded();
                await cell.click();
                await page.locator('#bookingPanel:not(.hidden)').waitFor({ state: 'visible' });
                await waitForStableLayout(page, ['#bookingPanel']);
                assert.equal(await page.locator('#bookingPanelEdgeClose').isVisible(), false,
                    'the desktop edge close control does not cover mobile form fields');
                const closeRect = await page.locator('#closePanel').boundingBox();
                assert.ok(closeRect && closeRect.x >= 0 && closeRect.x + closeRect.width <= row.width
                    && closeRect.y >= 0 && closeRect.y + closeRect.height <= 844,
                'the canonical header close action remains reachable');
                const panelGeometry = async stage => {
                    const geometry = await page.evaluate(() => ['bookingPanel', 'bookingForm', 'closePanel', 'bookingPanelEdgeClose'].map(id => {
                        const node = document.getElementById(id);
                        const rect = node.getBoundingClientRect();
                        const style = getComputedStyle(node);
                        return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: style.position,
                            display: style.display, scrollTop: node.scrollTop, overflowY: style.overflowY };
                    }));
                    fs.writeFileSync(path.join(output, `${label}-panel-${stage}.json`), JSON.stringify(geometry, null, 2));
                };
                await panelGeometry('opened');
                if (row.view === 'animators') {
                    await page.locator('#programSearch').fill(fixture.programName);
                    await checkpoint('before program click');
                    await page.locator(`.program-icon[data-program-id="${fixture.programId}"]`).click();
                    await checkpoint('program selected');
                    assert.equal(await page.locator('#selectedProgram').inputValue(), fixture.programId,
                        'a visible current-date catalog card selects its real product');
                }
                const roomOption = page.locator('#roomSelect option').filter({ hasText: fixture.roomName });
                await roomOption.waitFor({ state: 'attached' });
                await page.locator('#roomSelect').selectOption(await roomOption.getAttribute('value'));
                await checkpoint('room selected');
                if (await page.locator('#bookingPrimaryAnimatorSelect').isVisible()) await page.locator('#bookingPrimaryAnimatorSelect').selectOption(fixture.lineId);
                await page.locator('#customerSearch').fill(fixture.customerName);
                await page.locator(`#customerSearchResults .customer-search-item[data-id="${fixture.customerId}"]`).click();
                await checkpoint('customer selected');
                if (await page.locator('#kidsCountInput').isVisible()) await page.locator('#kidsCountInput').fill('5');
                if (row.view === 'rooms') {
                    await page.locator('#banquetGuests').fill('5');
                    await page.locator('#banquetAdults').fill('2');
                    await page.waitForFunction(() => window.BookingForm.validate().valid);
                }
                const validation = await page.evaluate(() => window.BookingForm.validate());
                fs.writeFileSync(path.join(output, `${label}-validation.json`), JSON.stringify(validation, null, 2));
                assert.equal(validation.valid, true, `form readiness: ${JSON.stringify(validation)}`);
                await panelGeometry('filled');
                await page.screenshot({ path: path.join(output, `${label}-form.png`) });
                const [response] = await Promise.all([
                    page.waitForResponse(response => response.request().method() === 'POST'
                        && /^\/api\/bookings(?:\/full)?$/.test(new URL(response.url()).pathname)),
                    (async () => {
                        await page.locator('#bookingSubmitBtn').click();
                        if (row.view === 'rooms') {
                            const warning = page.getByRole('dialog').filter({ hasText: 'Є попередження перед збереженням' });
                            await warning.getByRole('button', { name: 'Зберегти бронювання', exact: true }).click();
                        }
                    })()
                ]);
                const created = await response.json();
                assert.ok(response.ok(), `booking creation: ${created.error || created.code || response.status()}`);
                const bookingId = created.booking?.id || created.bookingIds?.[0];
                assert.ok(bookingId, 'real creation response includes its booking ID');
                await page.locator('#bookingPanel').waitFor({ state: 'hidden' });
                const block = page.locator(`.booking-block[data-booking-id="${bookingId}"]:not(.status-hidden)`).first();
                await block.waitFor({ state: 'visible' });
                await block.scrollIntoViewIfNeeded();
                await waitForStableLayout(page);
                const before = await snapshot(page);
                assert.equal(before.date, row.date);
                assert.equal(before.mode, row.view);
                // Creation may already populate the canonical detail cache. Prove
                // the real endpoint independently without forcing a second read
                // or changing the application's established source priority.
                await api(`/api/bookings/detail/${bookingId}`, { token });
                await block.click();
                if (row.view === 'rooms') await page.locator('[data-banquet-inspector-details]').click();
                await page.locator('#bookingModal').waitFor({ state: 'visible' });
                await page.locator('#bookingDetails .booking-customer-info').getByText(fixture.customerName, { exact: true }).waitFor({ state: 'visible' });
                assert.match(await page.locator('#bookingDetails').innerText(), new RegExp(fixture.customerName));
                await page.screenshot({ path: path.join(output, `${label}-detail.png`) });
                await page.keyboard.press('Escape');
                await page.locator('#bookingModal').waitFor({ state: 'hidden' });
                await waitForStableLayout(page);
                const after = await snapshot(page);
                assert.equal(after.date, before.date);
                assert.equal(after.mode, before.mode);
                for (const field of ['left', 'top', 'pageX', 'pageY']) assert.ok(Math.abs(after[field] - before[field]) <= 2, `detail return preserves ${field}: ${before[field]}/${after[field]}`);
                assert.equal(new URL(page.url()).searchParams.get('date'), row.date);
                assert.equal(new URL(page.url()).searchParams.get('timelineView'), row.view);
                const saved = (await pool.query('SELECT id,date::text,line_id,room_resource_id,customer_id FROM bookings WHERE id=$1', [bookingId])).rows;
                assert.equal(saved.length, 1);
                assert.equal(saved[0].date, row.date);
                assert.equal(saved[0].line_id, row.view === 'rooms' ? 'banquet-service' : fixture.lineId);
                assert.equal(saved[0].room_resource_id, fixture.roomId);
                assert.equal(String(saved[0].customer_id), String(fixture.customerId));
                assert.deepEqual(errors, []);
                assert.deepEqual(apiFailures, []);
                await page.screenshot({ path: path.join(output, `${label}-returned.png`) });
                results.push({ ...row, status: 'passed', bookingId, before, after });
            } catch (error) {
                console.error(`${label}: ${error.message}`);
                await page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {});
                results.push({ ...row, status: 'failed', error: error.stack || error.message, errors, apiFailures });
                break;
            } finally { await context.close(); }
        }
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ results, productionWrites: 0, target: 'Owned loopback disposable database; real application APIs' }, null, 2));
        assert.equal(results.length, cases.length, 'every manager journey case must run');
        assert.deepEqual(results.filter(row => row.status !== 'passed'), []);
        console.log(`Park manager: ${results.length} real mobile create/detail/return journeys passed.`);
    } finally { await browser?.close(); await pool.end(); }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
