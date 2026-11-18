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
    const origin = assertSafeIsolatedTestUrl(process.env.TEST_URL).origin;
    const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const browser = await requirePlaywright().chromium.launch({ headless: true, channel: 'chrome' });
    const output = path.resolve(__dirname, '../../output/staff-professions-browser');
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    try {
        const token = await getToken();
        const rootUser = (await request('GET', '/api/auth/verify', null, token)).data.user;
        const rootId = rootUser.id;
        const { rows: [org] } = await db.query("INSERT INTO organizations (slug, name) VALUES ($1, 'Synthetic HR QA') RETURNING id", ['profession-qa-' + crypto.randomUUID()]);
        const { rows: [business] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'event_genix', 'Synthetic HR QA', 'HR QA', 'membership', '["hr","tasks","dashboard"]') RETURNING id`, [org.id]);
        await db.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [org.id, rootId]);
        await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true)`, [org.id, business.id, rootId]);
        for (const role of ['admin', 'creator']) {
            let session = { token, user: rootUser };
            if (role === 'admin') {
                const username = 'profession.qa.' + crypto.randomBytes(6).toString('hex');
                const password = crypto.randomBytes(24).toString('base64url');
                const linked = await request('POST', '/api/staff', { name: 'Synthetic HR actor ' + role, department: 'admin', position: 'QA', role_type: 'admin' }, token);
                assert.equal(linked.status, 200);
                const created = await request('POST', '/api/users', { username, password, role, name: 'Synthetic HR actor', staffId: linked.data.data.id,
                    businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix', activateMembership: true }, token);
                assert.equal(created.status, 200, JSON.stringify(created.data));
                const login = await request('POST', '/api/auth/login', { username, password });
                assert.equal(login.status, 200);
                session = login.data;
            }
            for (const width of [1280, 390]) {
                const { rows: [person] } = await db.query(`INSERT INTO staff (name, department, position, role_type, hourly_rate)
                    VALUES ('Synthetic profession UI', 'admin', 'QA', 'animator', 321) RETURNING id`);
                const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'uk-UA' });
                await context.route('https://**/*', route => route.abort());
                await context.addInitScript(session => {
                    localStorage.setItem('pzp_token', session.token);
                    localStorage.setItem('pzp_access_token', session.token);
                    localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                    localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                }, session);
                const page = await context.newPage();
                const writes = [];
                page.on('response', response => {
                    const pathname = new URL(response.url()).pathname;
                    if (response.request().method() === 'PUT' && [
                        `/api/hr/staff/${person.id}`, `/api/hr/staff/${person.id}/role-assignments`,
                        `/api/staff/${person.id}/shift-preferences`
                    ].includes(pathname)) writes.push({ pathname, status: response.status() });
                });
                try {
                    await page.goto(origin + '/hr?tab=team', { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => typeof openStaffEdit === 'function' && typeof AppState.authPermissions?.actions?.['hr.staff.manage'] === 'boolean');
                    await page.waitForLoadState('networkidle');
                    await page.evaluate(id => openStaffEdit(id, { focus: 'work' }), person.id);
                    const modal = page.locator('#staffEditModal');
                    await page.waitForFunction(() => document.getElementById('staffEditModal')?.dataset.catalogState === 'ready');
                    await page.locator('#editRoleType').selectOption('host');
                    await page.locator('#editSecondaryProfessionSearch').fill('Рецепція');
                    await page.locator('[data-secondary-add="reception"]').click();
                    const admission = page.locator('[data-role-assignment="reception"] [data-role-field="admission_status"]');
                    await admission.selectOption('approved');
                    const save = page.locator('#editRoleAssignmentsSave');
                    const response = page.waitForResponse(response => response.request().method() === 'PUT'
                        && new URL(response.url()).pathname === `/api/hr/staff/${person.id}/role-assignments`);
                    await save.click();
                    const written = await response;
                    assert.equal(written.status(), 200, await written.text());
                    const body = written.request().postDataJSON();
                    assert.ok(body.assignments.every(row => !Object.hasOwn(row, 'hourly_rate')));
                    await page.waitForFunction(() => !document.getElementById('editRoleAssignmentsSave').disabled);
                    assert.equal(await admission.inputValue(), 'approved');
                    assert.equal(await page.locator('#editRoleType').inputValue(), 'host');
                    const persisted = (await db.query('SELECT role_type, secondary_professions, hourly_rate FROM staff WHERE id = $1', [person.id])).rows[0];
                    assert.equal(persisted.role_type, 'host');
                    assert.ok(persisted.secondary_professions.includes('reception'));
                    assert.equal(Number(persisted.hourly_rate), 321);
                    // Also exercise the work-section footer after the roles
                    // transaction: its revision must be fresh, with no 403/409.
                    await page.locator('#editRoleType').selectOption('animator');
                    const workResponse = page.waitForResponse(response => response.request().method() === 'PUT'
                        && new URL(response.url()).pathname === `/api/hr/staff/${person.id}`);
                    await page.locator('#editSaveWork').click();
                    const workWritten = await workResponse;
                    assert.equal(workWritten.status(), 200, await workWritten.text());
                    await page.waitForFunction(() => !document.getElementById('editSaveWork').disabled);
                    const workPersisted = (await db.query('SELECT role_type, secondary_professions, hourly_rate FROM staff WHERE id = $1', [person.id])).rows[0];
                    assert.equal(workPersisted.role_type, 'animator');
                    assert.ok(workPersisted.secondary_professions.includes('reception'));
                    assert.equal(Number(workPersisted.hourly_rate), 321);
                    assert.equal((await db.query("SELECT admission_status FROM staff_role_assignments WHERE staff_id = $1 AND profession_key = 'reception'", [person.id])).rows[0].admission_status, 'approved');
                    const preferences = writes.find(row => row.pathname.endsWith('/shift-preferences'));
                    assert.equal(preferences?.status, 200, JSON.stringify(writes));
                    assert.ok(writes.every(row => row.status === 200), JSON.stringify(writes));
                    await save.focus();
                    await page.screenshot({ path: path.join(output, `${role}-${width}.png`) });
                    assert.equal(await modal.isVisible(), true);
                    results.push({ role, width, status: written.status(), workSaveStatus: workWritten.status(), shiftPreferencesStatus: preferences.status, ratePreserved: true, admission: 'approved' });
                } catch (error) {
                    await page.screenshot({ path: path.join(output, `${role}-${width}-failure.png`) });
                    console.error('HR drawer diagnostic', await page.evaluate(() => ({
                        state: document.getElementById('staffEditModal')?.dataset,
                        card: document.getElementById('staffEditModal')?.innerText.slice(0, 1600)
                    })));
                    throw error;
                } finally { await context.close(); }
            }
        }
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
        console.log('Staff professions actual browser: PASS ' + results.length + '/4');
    } finally { await browser.close(); await db.end(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
