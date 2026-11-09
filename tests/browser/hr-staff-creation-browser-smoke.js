'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const target = process.env.TEST_URL;
const output = path.resolve(__dirname, '../../output/playwright/hr-staff-creation');
const runId = crypto.randomBytes(4).toString('hex');

async function login(username, password) {
    const response = await fetch(new URL('/api/auth/login', target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Business-Context': 'event_genix' },
        body: JSON.stringify({ username, password })
    });
    assert.equal(response.status, 200, 'fixture login');
    return response.json();
}

async function seed(pool) {
    const creator = await login(process.env.TEST_USER, process.env.TEST_PASS);
    const { rows: [organization] } = await pool.query(
        "INSERT INTO organizations (slug, name, status) VALUES ('hr-browser-park-fixture', 'HR Browser Park', 'active') RETURNING id"
    );
    const { rows: [business] } = await pool.query(
        `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
         VALUES ($1, 'event_genix', 'Fixture Park', 'Park', 'membership', '[]', 'active')
         ON CONFLICT (context_key) DO UPDATE SET organization_id = EXCLUDED.organization_id,
             access_mode = 'membership', status = 'active' RETURNING id`, [organization.id]
    );
    const password = crypto.randomBytes(24).toString('base64url');
    const username = `qa_staff_delegate_${runId}`;
    const { rows: [delegate] } = await pool.query(
        "INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, 'QA Delegate', 'admin') RETURNING id",
        [username, await bcrypt.hash(password, 10)]
    );
    const actors = [
        { label: 'desktop', width: 1440, username: process.env.TEST_USER, password: process.env.TEST_PASS, id: creator.user.id, role: 'creator', allow: [], deny: [] },
        { label: 'mobile', width: 390, username, password, id: delegate.id, role: 'admin',
            allow: ['hr.staff.view', 'hr.staff.create', 'hr.staff.profile.edit'], deny: ['hr.staff.manage'] }
    ];
    for (const actor of actors) {
        await pool.query(
            "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'member', true) ON CONFLICT DO NOTHING",
            [organization.id, actor.id]
        );
        await pool.query(
            `INSERT INTO business_memberships
                (business_id, organization_id, user_id, role, action_allowlist, action_denylist, is_default, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
            [business.id, organization.id, actor.id, actor.role, actor.allow, actor.deny]
        );
    }
    const { rows: [secondBusiness] } = await pool.query(
        `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
         VALUES ($1, 'dar', 'Fixture Second Business', 'Second', 'membership', '[]', 'active')
         ON CONFLICT (context_key) DO UPDATE SET organization_id = EXCLUDED.organization_id,
             access_mode = 'membership', status = 'active' RETURNING id`, [organization.id]
    );
    await pool.query(
        `INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default, is_active)
         VALUES ($1, $2, $3, 'creator', false, true)`, [secondBusiness.id, organization.id, creator.user.id]
    );
    return actors;
}

function waitForResponse(page, method, pathname) {
    return page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname);
}

async function runActor(browser, pool, actor) {
    const session = await login(actor.username, actor.password);
    const context = await browser.newContext({ viewport: { width: actor.width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(session => {
        const token = session.accessToken || session.token;
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
        localStorage.setItem('pzp_crm_business_context', 'event_genix');
        localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
    }, session);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
    try {
        await page.goto(new URL('/hr?tab=team', target).href);
        await page.waitForFunction(() => document.getElementById('hrCreateStaffForm')?.dataset.bound === 'true');
        await page.locator('#hrCreateStaffBtn').click();
        const dialog = page.locator('#hrCreateStaffDialog');
        await dialog.waitFor({ state: 'visible' });
        if (actor.role === 'creator') {
            await dialog.locator('[name="name"]').fill('Abandoned draft');
            assert.equal(await page.evaluate(() => window.CrmBusinessContext.set('dar')), 'dar');
            await dialog.waitFor({ state: 'hidden' });
            await page.locator('#hrCreateStaffBtn').waitFor({ state: 'hidden' });
            assert.equal((await pool.query("SELECT 1 FROM staff WHERE name = 'Abandoned draft'")).rowCount, 0);
            assert.equal(await page.evaluate(() => window.CrmBusinessContext.set('event_genix')), 'event_genix');
            await page.locator('#hrCreateStaffBtn').click();
            await dialog.waitFor({ state: 'visible' });
            assert.equal(await dialog.locator('[name="name"]').inputValue(), '');
        }
        const name = `QA Staff ${actor.label} ${runId}`;
        await dialog.locator('[name="name"]').fill(name);
        await dialog.locator('[name="department"]').fill('animators');
        await dialog.locator('[name="position"]').fill('QA Animator');
        await dialog.locator('[name="role_type"]').selectOption('animator');
        await dialog.screenshot({ path: path.join(output, `${actor.label}-create.png`) });
        const [creation] = await Promise.all([
            waitForResponse(page, 'POST', '/api/staff'),
            dialog.locator('[type="submit"]').click()
        ]);
        assert.equal(creation.status(), 200, 'staff created');
        const { data: staff } = await creation.json();
        const profile = page.locator('#staffEditModal');
        await profile.waitFor({ state: 'visible' });
        await page.waitForFunction(id => Number(document.getElementById('editStaffId').value) === id, staff.id);
        await profile.locator('#editStaffPosition').fill('QA Updated Position');
        const [edit] = await Promise.all([
            waitForResponse(page, 'PUT', `/api/hr/staff/${staff.id}`),
            profile.locator('#editSave').click()
        ]);
        assert.equal(edit.status(), 200, 'position updated');
        const { rows } = await pool.query('SELECT id, position FROM staff WHERE name = $1', [name]);
        assert.deepEqual(rows, [{ id: staff.id, position: 'QA Updated Position' }]);
        await profile.screenshot({ path: path.join(output, `${actor.label}-edit.png`) });
        await page.locator('#editCloseTop').click();
        await profile.waitFor({ state: 'hidden' });
        const card = page.locator('.hr-team-card').filter({ hasText: name });
        await card.getByRole('button', { name: /відкрити/i }).click();
        await page.waitForFunction(() => document.getElementById('editStaffPosition').value === 'QA Updated Position');
        await page.locator('#editCloseTop').click();
        await profile.waitFor({ state: 'hidden' });
        if (actor.role === 'creator') {
            await card.getByRole('button', { name: /дії:/i }).click();
            await card.getByRole('menuitem', { name: 'Створити CRM' }).click();
            const wizard = page.locator('#accountOnboardingOverlay');
            await wizard.waitFor({ state: 'visible' });
            await page.locator('#accountOnboardingUsername').fill(`qa_staff_link_${runId}`);
            await page.locator('#accountOnboardingNext').click();
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(staff.id));
            for (let step = 2; step <= 6; step++) {
                await page.locator(`[data-account-onboarding-step="${step}"]`).waitFor({ state: 'visible' });
                await page.locator('#accountOnboardingNext').click();
            }
            const [linked] = await Promise.all([
                waitForResponse(page, 'POST', '/api/users/onboarding'),
                page.locator('#accountOnboardingSubmit').click()
            ]);
            assert.equal(linked.status(), 200, 'CRM account created');
            const { rows: [binding] } = await pool.query(
                'SELECT ep.staff_id FROM employee_profiles ep JOIN users u ON ep.user_id = u.id WHERE u.username = $1',
                [`qa_staff_link_${runId}`]
            );
            assert.equal(binding.staff_id, staff.id);
            assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [name])).rowCount, 1);
        } else {
            assert.equal(await card.getByRole('menuitem', { name: 'Створити CRM' }).count(), 0);
        }
        process.stdout.write(`[hr-staff] ${actor.label}: create, edit and reopen confirmed${actor.role === 'creator' ? ', same staff ID linked to CRM' : ''}\n`);
    } catch (error) {
        if (pageErrors.length) process.stderr.write(`Browser errors: ${pageErrors.join(' | ')}\n`);
        throw error;
    } finally {
        await context.close();
    }
}

async function main() {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(target);
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(database.isLocal, true);
    fs.mkdirSync(output, { recursive: true });
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false });
    let browser;
    try {
        const actors = await seed(pool);
        browser = await requirePlaywright().chromium.launch({ headless: true });
        for (const actor of actors) await runActor(browser, pool, actor);
    } finally {
        await browser?.close();
        await pool.end();
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
});
