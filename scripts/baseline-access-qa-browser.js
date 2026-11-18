'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlaywright } = require('./trusted-qa-timeline-browser-matrix');

function requireBrowserRuntime() { return requirePlaywright(); }

// A production-safe browser perimeter: no background joins, recurring-event
// materialization, foreign origins, or writes outside these registered actors.
async function installGuard(context, origin, actor, actors, bookingId, fixture) {
    const ownedStaff = new Set(actors.map(row => Number(row.staffId)));
    await context.routeWebSocket('**/*', ws => ws.close());
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const endpoint = url.pathname;
        if (url.origin !== origin) return route.abort();
        const method = request.method();
        if (!['GET','HEAD'].includes(method)) {
            const ownWork = actor.role === 'admin' && method === 'PUT' && [
                `/api/hr/staff/${actor.staffId}`, `/api/hr/staff/${actor.staffId}/role-assignments`,
                `/api/staff/${actor.staffId}/shift-preferences`
            ].includes(endpoint);
            const login = method === 'POST' && endpoint === '/api/auth/login';
            if (login) {
                const body = request.postDataJSON();
                if (body?.username !== actor.username || body?.password !== actor.password) return route.abort();
            }
            if (!ownWork && !login && !(method === 'POST' && endpoint === '/api/work-access/check')) return route.abort();
            return route.continue();
        }
        if (endpoint.startsWith('/api/chat/')) return route.abort();
        if (/^\/api\/afisha\/\d{4}-\d{2}-\d{2}$/.test(endpoint)) return route.abort();
        if (endpoint === '/api/auth/profile') {
            url.searchParams.set('accessProbe', '1');
            return route.continue({ url: url.toString() });
        }
        const staffDetail = endpoint.match(/^\/api\/(?:hr\/)?staff\/(\d+)(?:\/|$)/);
        if (staffDetail && !ownedStaff.has(Number(staffDetail[1]))) return route.abort();
        if (endpoint.startsWith('/api/bookings/detail/') && decodeURIComponent(endpoint.slice(21)) !== bookingId) return route.abort();
        // Preserve the real endpoint, permission check, and expected record.
        // Reduce unrelated production records before they reach the browser.
        let filter;
        if (['/api/hr/staff','/api/staff'].includes(endpoint)) filter = row => ownedStaff.has(Number(row.id));
        if (endpoint === `/api/bookings/${fixture.date}`) filter = row => String(row.id) === bookingId;
        if (endpoint === '/api/afisha') filter = () => false;
        if (filter) {
            const response = await route.fetch({ maxRedirects: 0, timeout: 30000 });
            if (!response.ok()) return route.fulfill({ response });
            const value = await response.json();
            if (Array.isArray(value)) return route.fulfill({ response, json: value.filter(filter) });
            if (Array.isArray(value.data)) value.data = value.data.filter(filter);
            else if (Array.isArray(value.bookings)) value.bookings = value.bookings.filter(filter);
            else throw new Error('BASELINE_QA_BROWSER_RESPONSE_SHAPE');
            return route.fulfill({ response, json: value });
        }
        return route.continue();
    });
}

async function exerciseInstructor(page, actor, plan, bookingId, api, screenshot) {
    const detail = (await api(actor, `/api/bookings/detail/${encodeURIComponent(bookingId)}?businessContext=event_genix`)).booking;
    assert.equal(String(detail.id), bookingId);
    assert.equal(detail.roomResourceId, plan.booking.roomResourceId);
    for (const field of ['price','customerName','customerPhone','notes','extraData']) assert.equal(Object.hasOwn(detail, field), false, field);
    const block = page.locator(`.booking-block[data-booking-id="${bookingId}"]`).first();
    await block.waitFor({ state: 'visible', timeout: 45000 });
    await block.press('Enter');
    const modal = page.locator('#bookingModal');
    await modal.waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(document.activeElement.closest('#bookingModal')));
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#bookingModal'))), true);
    assert.equal(await modal.locator('.btn-edit-booking,.booking-detail-advanced-actions').count(), 0);
    assert.ok((await modal.innerText()).includes(plan.booking.programName));
    const animatorRow = modal.getByText(/^Аніматор(?:и)?:$/).locator('..');
    assert.equal(await animatorRow.count(), 1);
    if (screenshot) await modal.locator('.booking-detail-modal-content').screenshot({ path: screenshot, mask: [animatorRow] });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await block.evaluate(element => element === document.activeElement), true);
    await block.click();
    await modal.waitFor({ state: 'visible' });
    await modal.getByRole('button', { name: 'Закрити деталі бронювання', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    return { canonicalBooking: 'passed', fields: 'passed', keyboard: 'passed', click: 'passed' };
}

async function exerciseAdmin(page, actor, screenshot) {
    await page.waitForFunction(() => typeof openStaffEdit === 'function' && AppState.authPermissions?.actions?.['hr.staff.manage'] === true);
    await page.waitForLoadState('networkidle');
    await page.evaluate(id => openStaffEdit(id, { focus: 'work' }), actor.staffId);
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.dataset.catalogState === 'ready');
    const modal = page.locator('#staffEditModal');
    assert.ok((await modal.innerText()).includes(actor.username.replace('account-2','staff-2')));
    await page.locator('#editRoleType').selectOption('host');
    await page.locator('#editSecondaryProfessionSearch').fill('Рецепція');
    await page.locator('[data-secondary-add="reception"]').click();
    await page.locator('[data-role-assignment="reception"] [data-role-field="admission_status"]').selectOption('approved');
    const roleWrite = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/hr/staff/${actor.staffId}/role-assignments`);
    await page.locator('#editRoleAssignmentsSave').click();
    const saved = await roleWrite;
    assert.equal(saved.status(), 200);
    assert.ok(saved.request().postDataJSON().assignments.every(row => !Object.hasOwn(row, 'hourly_rate')));
    await page.waitForFunction(() => !document.getElementById('editRoleAssignmentsSave').disabled);
    await page.locator('#editRoleType').selectOption('animator');
    const workWrite = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/hr/staff/${actor.staffId}`);
    const shiftWrite = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/staff/${actor.staffId}/shift-preferences`);
    await page.locator('#editSaveWork').click();
    const workSaved = await workWrite;
    assert.equal(workSaved.status(), 200);
    assert.equal(Object.hasOwn(workSaved.request().postDataJSON(), 'hourly_rate'), false);
    assert.equal((await shiftWrite).status(), 200);
    await page.waitForFunction(() => !document.getElementById('editSaveWork').disabled);
    assert.equal(await page.locator('#editRoleType').inputValue(), 'animator');
    assert.equal(await page.locator('[data-role-assignment="reception"] [data-role-field="admission_status"]').inputValue(), 'approved');
    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none'
        || Boolean(document.querySelector('.confirm-overlay .confirm-ok')?.getClientRects().length));
    const discard = page.getByRole('button', { name: 'Закрити без збереження', exact: true });
    if (await discard.isVisible()) await discard.click();
    await modal.waitFor({ state: 'hidden' });
    await page.evaluate(id => openStaffEdit(id, { focus: 'work' }), actor.staffId);
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.dataset.catalogState === 'ready');
    assert.equal(await page.locator('#editRoleType').inputValue(), 'animator');
    assert.equal(await page.locator('[data-role-assignment="reception"] [data-role-field="admission_status"]').inputValue(), 'approved');
    if (screenshot) await modal.locator('.hr-staff-profile-modal').screenshot({ path: screenshot });
    return { professionSave: 'passed', workSave: 'passed', shiftPreferences: 'passed' };
}

async function exerciseBaselineBrowser({ origin, actors, plan, bookingId, outputDirectory, api }) {
    if (outputDirectory) {
        assert.ok(path.isAbsolute(outputDirectory));
        fs.mkdirSync(outputDirectory, { recursive: true });
    }
    const browser = await requireBrowserRuntime().chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
    const results = [];
    try {
        for (const actor of actors) for (const width of [1280, 390]) {
            if (actor.role === 'admin') await api(actor, `/api/hr/staff/${actor.staffId}/role-assignments`, { method: 'PUT', body: {
                primary_role: 'animator', assignments: [{ profession_key: 'animator', is_primary: true,
                    status: 'active', admission_status: 'pending', internship_status: 'none' }] } });
            const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'uk-UA', serviceWorkers: 'block' });
            await installGuard(context, origin, actor, actors, bookingId, plan.booking);
            const page = await context.newPage();
            try {
                await page.goto(origin + '/?date=' + plan.booking.date + '&timelineView=rooms', { waitUntil: 'domcontentloaded' });
                await page.locator('#username').fill(actor.username);
                await page.locator('#password').fill(actor.password);
                await page.locator('#loginForm button[type="submit"]').click();
                await page.waitForFunction(() => typeof AppState !== 'undefined' && Boolean(AppState.currentUser));
                await page.goto(actor.role === 'admin' ? origin + '/hr?tab=team'
                    : origin + '/?date=' + plan.booking.date + '&timelineView=rooms', { waitUntil: 'domcontentloaded' });
                const screenshot = outputDirectory && path.join(outputDirectory, `${actor.role}-${width}.png`);
                const result = actor.role === 'instructor'
                    ? await exerciseInstructor(page, actor, plan, bookingId, api, screenshot)
                    : await exerciseAdmin(page, actor, screenshot);
                results.push({ role: actor.role, width, normalLogin: 'passed', ...result });
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
    if (outputDirectory) fs.writeFileSync(path.join(outputDirectory, 'report.json'), JSON.stringify(results, null, 2));
    return results;
}

module.exports = { requireBrowserRuntime, exerciseBaselineBrowser, installGuard };
