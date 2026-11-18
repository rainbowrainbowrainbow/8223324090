'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { getToken, request } = require('../helpers');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

async function run() {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    const origin = assertSafeIsolatedTestUrl(process.env.TEST_URL).origin;
    const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const browser = await requirePlaywright().chromium.launch({ headless: true, channel: 'chrome' });
    const output = path.resolve(__dirname, '../../output/game-zone-actual-browser');
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    const date = '2026-11-18';
    try {
        const creatorToken = await getToken();
        const rootId = (await request('GET', '/api/auth/verify', null, creatorToken)).data.user.id;
        const { rows: [organization] } = await db.query(`INSERT INTO organizations (slug, name)
            VALUES ($1, 'Synthetic zone QA') RETURNING id`, ['zone-qa-' + crypto.randomUUID()]);
        const { rows: [business] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'event_genix', 'Synthetic Zone QA', 'Zone QA', 'membership', '["timeline","hr","tasks","afisha","dashboard"]') RETURNING id`, [organization.id]);
        await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner');`, [organization.id, rootId]);
        await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true)`, [organization.id, business.id, rootId]);
        await db.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name, metadata, is_active) VALUES
            ('event_genix', 'room-zone-qa', 'room', 'Синтетична ігрова зона', '{"workArea":"game_zone"}', true),
            ('event_genix', 'room-unclassified-qa', 'room', 'Синтетична звичайна кімната', '{}', true)
            ON CONFLICT (business_context, resource_id) DO UPDATE SET metadata = EXCLUDED.metadata, is_active = EXCLUDED.is_active;
            INSERT INTO settings (key, value) VALUES ('timeline_display:event_genix', '{"mode":"park","roomTimelineEnabled":true,"defaultTimelineView":"rooms"}')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
            INSERT INTO bookings (id, business_context, date, time, line_id, room_resource_id, room, label, program_name,
                category, duration, price, hosts, status, notes, extra_data) VALUES
            ('zone-qa-visible', 'event_genix', '${date}', '13:00', '999999', 'room-zone-qa', 'Синтетична ігрова зона',
                'Синтетична гра', 'Синтетична гра', 'quest', 60, 1500, 1, 'confirmed', 'SYNTHETIC_PRIVATE_NOTE', '{"customerPhone":"SYNTHETIC_PRIVATE_CONTACT"}'),
            ('zone-qa-hidden', 'event_genix', '${date}', '13:00', '999999', 'room-unclassified-qa', 'Синтетична звичайна кімната',
                'SYNTHETIC_HIDDEN_EVENT', 'Hidden', 'quest', 60, 0, 1, 'confirmed', NULL, '{}');`);

        for (const role of ['instructor', 'senior_instructor', 'reception', 'accountant']) {
            const zoneOnly = ['instructor', 'senior_instructor'].includes(role);
            const canEdit = role === 'reception';
            const canSeeContacts = role === 'reception';
            const canSeeRevenue = role === 'accountant';
            const username = 'zone.' + role + '.' + crypto.randomBytes(3).toString('hex');
            const password = crypto.randomBytes(24).toString('base64url');
            const staff = await request('POST', '/api/staff', { name: 'Synthetic zone ' + role,
                department: 'admin', position: 'Synthetic QA', role_type: zoneOnly ? 'trampoline_instructor' : role }, creatorToken);
            assert.equal(staff.status, 200);
            const created = await request('POST', '/api/users', { username, password, role, name: 'Synthetic zone ' + role,
                staffId: staff.data.data.id, businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix', activateMembership: true }, creatorToken);
            assert.equal(created.status, 200);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200);
            const session = login.data;
            for (const width of [1280, 390]) {
                const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'uk-UA' });
                await context.route('https://**/*', route => route.abort());
                await context.addInitScript(session => {
                    localStorage.setItem('pzp_token', session.token);
                    localStorage.setItem('pzp_access_token', session.token);
                    localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                    localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                }, { token: session.token, user: session.user });
                const page = await context.newPage();
                const errors = [];
                const detailStatuses = [];
                page.on('pageerror', error => errors.push(error.name));
                page.on('response', response => {
                    if (new URL(response.url()).pathname === '/api/bookings/detail/zone-qa-visible') detailStatuses.push(response.status());
                });
                try {
                    await page.goto(origin + '/?date=' + date, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => typeof showBookingDetails === 'function'
                        && typeof AppState.authPermissions?.actions?.edit_booking === 'boolean');
                    await page.waitForLoadState('networkidle');
                    const block = page.locator('.booking-block[data-booking-id="zone-qa-visible"]').first();
                    await block.waitFor({ state: 'visible', timeout: 30000 });
                    assert.equal(await page.locator('.booking-block[data-booking-id="zone-qa-hidden"]').count() > 0, !zoneOnly,
                        'independent broader roles retain their existing record scope');
                    // The canonical modal prefers its current-date cache. Probe
                    // the detail endpoint independently; do not alter that source priority.
                    const detailResponse = await context.request.get(origin + '/api/bookings/detail/zone-qa-visible?businessContext=event_genix', {
                        headers: { Authorization: 'Bearer ' + session.token }
                    });
                    detailStatuses.push(detailResponse.status());
                    assert.equal(detailResponse.status(), 200);
                    const detail = await detailResponse.json();
                    assert.equal(detail.booking.id, 'zone-qa-visible');
                    assert.equal(detail.booking.roomResourceId, 'room-zone-qa');
                    assert.equal(detail.booking.price !== undefined, canSeeRevenue);
                    assert.equal(detail.booking.notes !== undefined, canSeeContacts);
                    assert.equal(detail.booking.extraData !== undefined, canSeeContacts);
                    await block.press('Enter');
                    const modal = page.locator('#bookingModal');
                    await modal.waitFor({ state: 'visible' });
                    await page.waitForFunction(() => Boolean(document.activeElement.closest('#bookingModal')));
                    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#bookingModal'))), true);
                    await page.keyboard.press('Tab');
                    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#bookingModal'))), true);
                    if (!canSeeContacts) assert.doesNotMatch(await modal.innerText(), /SYNTHETIC_PRIVATE|SYNTHETIC_HIDDEN/);
                    assert.equal(await modal.locator('.btn-edit-booking').count() > 0, canEdit,
                        'mutation controls must match the effective booking capability');
                    assert.equal(await modal.locator('.booking-detail-advanced-actions').count() > 0, canEdit);
                    await modal.locator('img').evaluateAll(images => Promise.all(images.map(img => img.complete
                        ? Promise.resolve() : img.decode().catch(() => {}))));
                    await page.screenshot({ path: path.join(output, `${role}-${width}-details.png`), timeout: 10000 });
                    await page.keyboard.press('Escape');
                    await modal.waitFor({ state: 'hidden' });
                    assert.equal(await block.evaluate(element => element === document.activeElement), true, 'canonical modal restores trigger focus');
                    await block.click();
                    await modal.waitFor({ state: 'visible' });
                    await modal.getByRole('button', { name: 'Закрити деталі бронювання', exact: true }).click();
                    await modal.waitFor({ state: 'hidden' });
                    assert.deepEqual(errors, []);
                    results.push({ role, width, canonicalDetailApi: 'passed', keyboard: 'passed', click: 'passed', fieldBoundary: 'passed' });
                    console.log(`${role}-${width}: canonical zone detail, fields, keyboard and click passed`);
                } catch (error) {
                    const state = await page.evaluate(() => ({
                        focusedTag: document.activeElement?.tagName, focusedClass: document.activeElement?.className,
                        modalVisible: !document.getElementById('bookingModal')?.classList.contains('hidden'),
                        view: window.TimelineView?.current?.(), bookingBlocks: document.querySelectorAll('.booking-block').length
                    }));
                    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ role, width, detailStatuses, errors, state }, null, 2));
                    await page.screenshot({ path: path.join(output, `${role}-${width}-failed.png`), timeout: 10000 }).catch(() => {});
                    throw error;
                } finally { await context.close(); }
            }
        }
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ isolated: true, results }, null, 2));
    } finally { await browser.close(); await db.end(); }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
