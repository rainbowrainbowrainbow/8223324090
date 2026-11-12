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
    const adminUsername = `qa_staff_admin_${runId}`;
    const { rows: [admin] } = await pool.query(
        "INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, 'QA Park Admin', 'admin') RETURNING id",
        [adminUsername, await bcrypt.hash(password, 10)]
    );
    const actors = [
        { label: 'desktop', width: 1440, username: process.env.TEST_USER, password: process.env.TEST_PASS, id: creator.user.id, role: 'creator', allow: [], deny: [] },
        { label: 'mobile', width: 390, username, password, id: delegate.id, role: 'admin',
            allow: ['hr.staff.view', 'hr.staff.create', 'hr.staff.profile.edit'], deny: ['hr.staff.manage'] },
        { label: 'park-admin', width: 390, username: adminUsername, password, id: admin.id, role: 'admin',
            allow: [], deny: [], parkWorker: true }
    ];
    for (const actor of actors) {
        await pool.query(
            'INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING',
            [organization.id, actor.id, actor.role === 'creator' ? 'owner' : 'member']
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

async function expectDelayedStaffSaveIgnored(page, staffId, switchContext) {
    let releaseResponse;
    let resolveCommitted;
    const held = new Promise(resolve => { releaseResponse = resolve; });
    const committed = new Promise(resolve => { resolveCommitted = resolve; });
    const saveRoute = `**/api/hr/staff/${staffId}`;
    await page.route(saveRoute, async route => {
        if (route.request().method() !== 'PUT') return route.continue();
        const response = await route.fetch();
        resolveCommitted(response.status());
        await held;
        await route.fulfill({ response });
    });
    try {
        await page.evaluate(() => { window.qaStaffSave = saveStaffEdit(); });
        assert.equal(await committed, 200);
        await switchContext();
        releaseResponse();
        assert.equal((await page.evaluate(() => window.qaStaffSave)).stale, true);
    } finally {
        releaseResponse();
        await page.unroute(saveRoute);
    }
}

async function runActor(browser, pool, actor, existingAccountId) {
    const session = await login(actor.username, actor.password);
    const context = await browser.newContext({ viewport: { width: actor.width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(session => {
        const token = session.accessToken || session.token;
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
        localStorage.setItem('pzp_crm_business_context', 'event_genix');
        localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
        localStorage.setItem('pzp_dark_mode', 'false');
    }, session);
    const page = await context.newPage();
    const supplementDirectory = path.join(output, 'ux-matrix');
    fs.mkdirSync(supplementDirectory, { recursive: true });
    const supplement = { key: `supplement-${actor.label}`, role: actor.label === 'mobile' ? 'delegate' : actor.role, mode: 'existing', width: actor.width, height: 900, theme: 'light', screens: [], checks: [] };
    const captureSupplement = async label => {
        const filename = `${supplement.key}-${label}.png`;
        await page.screenshot({ path: path.join(supplementDirectory, filename), mask: [page.locator('#accountOnboardingReceipt .hr-account-credential code:nth-of-type(2)')] });
        supplement.screens.push(filename);
    };
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
    try {
        await page.goto(new URL('/hr?tab=team', target).href);
        await page.waitForFunction(() => document.getElementById('hrCreateStaffForm')?.dataset.bound === 'true');
        const createButton = page.locator('#hrCreateStaffBtn');
        await createButton.waitFor({ state: 'visible' });
        const toolbar = await page.locator('.hr-team-filter-row').boundingBox();
        const search = await page.locator('#teamSearch').boundingBox();
        const button = await createButton.boundingBox();
        await createButton.click();
        const dialog = page.locator('#hrCreateStaffDialog');
        await dialog.waitFor({ state: 'visible' });
        if (actor.label === 'mobile') await page.setViewportSize({ width: actor.width, height: 640 });
        const geometry = await dialog.evaluate(element => {
            const { left, right, top, bottom } = element.getBoundingClientRect();
            return {
                centered: Math.abs(left + right - innerWidth) <= 2 && Math.abs(top + bottom - innerHeight) <= 2,
                inset: Math.min(left, top, innerWidth - right, innerHeight - bottom) >= 10
            };
        });
        assert.deepEqual({
            compactButton: button.width <= toolbar.width - 32,
            desktopSameRow: actor.width < 600 || Math.abs(button.y + button.height / 2 - search.y - search.height / 2) <= 2,
            ...geometry
        }, { compactButton: true, desktopSameRow: true, centered: true, inset: true });
        if (actor.label === 'mobile') await page.setViewportSize({ width: actor.width, height: 900 });
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
        await dialog.locator('#hrCreateStaffProfessionPicker summary').click();
        await dialog.locator('[name="secondary_professions"][value="waiter"]').check();
        assert.match(await dialog.locator('#hrCreateStaffProfessionSummary').textContent(), /Офіціант/);
        assert.equal(await dialog.locator('[name="secondary_professions"][value="animator"]').isDisabled(), true);
        await dialog.screenshot({ path: path.join(output, `${actor.label}-create.png`) });
        await captureSupplement('hr-create');
        await dialog.locator('#hrCreateStaffProfessionPicker summary').click();
        const createCardSubmit = dialog.getByRole('button', { name: 'Створити картку', exact: true });
        await createCardSubmit.scrollIntoViewIfNeeded();
        await captureSupplement('hr-submit');
        const loseResponse = actor.label === 'mobile';
        if (loseResponse) {
            await page.route('**/api/staff', async route => {
                if (route.request().method() !== 'POST') return route.continue();
                const committed = await route.fetch();
                assert.equal(committed.status(), 200);
                await route.abort('failed');
            });
        }
        const [creation] = await Promise.all([
            loseResponse
                ? page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/staff/creation-operations/'))
                : waitForResponse(page, 'POST', '/api/staff'),
            createCardSubmit.click()
        ]);
        if (loseResponse) await page.unroute('**/api/staff');
        assert.equal(creation.status(), 200, loseResponse ? 'committed staff operation recovered' : 'staff created');
        const { data: staff } = await creation.json();
        const profile = page.locator('#staffEditModal');
        await profile.waitFor({ state: 'visible' });
        await page.waitForFunction(id => Number(document.getElementById('editStaffId').value) === id, staff.id);
        const feedback = profile.locator('#staffCreationResult');
        await feedback.waitFor({ state: 'visible' });
        assert.match(await feedback.innerText(), new RegExp(`Картку #${staff.id}`));
        if (actor.label === 'mobile') {
            assert.equal(await profile.getByRole('button', { name: 'Створити CRM-акаунт' }).count(), 0);
        }
        await captureSupplement('hr-created');
        await profile.locator('#editStaffPosition').fill('QA Updated Position');
        const [edit] = await Promise.all([
            waitForResponse(page, 'PUT', `/api/hr/staff/${staff.id}`),
            profile.locator('#editSave').click()
        ]);
        assert.equal(edit.status(), 200, 'position updated');
        const { rows } = await pool.query('SELECT id, position FROM staff WHERE name = $1', [name]);
        assert.deepEqual(rows, [{ id: staff.id, position: 'QA Updated Position' }]);
        await page.waitForFunction(() => document.getElementById('editSave').dataset.actionState === 'success');
        assert.equal(await profile.locator('#editStaffHeaderName').textContent(), name);
        await profile.screenshot({ path: path.join(output, `${actor.label}-edit.png`) });
        await captureSupplement('hr-edit');
        await page.locator('#editCloseTop').click();
        await profile.waitFor({ state: 'hidden' });
        const card = page.locator('.hr-team-card').filter({ hasText: name });
        await card.getByRole('button', { name: /відкрити/i }).click();
        await page.waitForFunction(() => document.getElementById('editStaffPosition').value === 'QA Updated Position');
        await page.locator('#editCloseTop').click();
        await profile.waitFor({ state: 'hidden' });
        if (actor.role === 'creator' || actor.parkWorker) {
            await card.getByRole('button', { name: /дії:/i }).click();
            const menu = card.locator('[data-team-card-menu]');
            const visibleMenu = await menu.evaluate(el => {
                const rect = el.getBoundingClientRect();
                const last = el.querySelector('button:last-child');
                const item = last.getBoundingClientRect();
                return { inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
                    unobscured: last.contains(document.elementFromPoint(item.left + 8, item.top + item.height / 2)) };
            });
            assert.deepEqual(visibleMenu, { inViewport: true, unobscured: true });
            await page.keyboard.press('End');
            await page.keyboard.press('Escape');
            assert.equal(await menu.isVisible(), false);
            assert.equal(await card.getByRole('button', { name: /дії:/i }).evaluate(el => el === document.activeElement), true);
            await card.getByRole('button', { name: /відкрити/i }).click();
            await profile.getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).click();
            const wizard = page.locator('#accountOnboardingOverlay');
            await wizard.waitFor({ state: 'visible' });
            const username = `qa_staff_link_${actor.label}_${runId}`;
            await page.locator('#accountOnboardingUsername').fill(username);
            const initialPassword = 'Browser-Initial-Password-827';
            const passwordInput = page.locator('#accountOnboardingPassword');
            assert.equal((await passwordInput.inputValue()).length, 16);
            await passwordInput.fill(initialPassword);
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await passwordInput.getAttribute('type'), 'text');
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await passwordInput.getAttribute('type'), 'password');
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(staff.id));
            assert.equal(await page.locator('#accountOnboardingNext').isVisible(), false);
            assert.match(await page.locator('#accountOnboardingSubmit').innerText(), /Створити акаунт і надати доступ/);
            assert.equal(await wizard.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            await captureSupplement('crm-access-form');
            const [linked] = await Promise.all([
                waitForResponse(page, 'POST', '/api/users/onboarding'),
                page.locator('#accountOnboardingSubmit').click()
            ]);
            assert.equal(linked.status(), 200, 'CRM account created');
            const linkedResult = await linked.json();
            assert.ok(linkedResult.credential?.password === initialPassword, 'the submitted password was used');
            const { rows: [binding] } = await pool.query(
                'SELECT ep.staff_id FROM employee_profiles ep JOIN users u ON ep.user_id = u.id WHERE u.username = $1',
                [username]
            );
            assert.equal(binding.staff_id, staff.id);
            assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [name])).rowCount, 1);
            const receipt = page.locator('#accountOnboardingReceipt');
            if (actor.parkWorker) {
                await receipt.getByText('Доступ до вибраного бізнесу активний.', { exact: false }).waitFor();
                await captureSupplement('crm-access-active');
                process.stdout.write('[hr-staff] Park admin linked the same staff ID and activated Park access at a mobile viewport\n');
                return;
            }
            await receipt.getByText('Доступ до вибраного бізнесу активний.', { exact: false }).waitFor();
            assert.equal(linkedResult.businessAccessReady, true);
            await page.locator('[data-account-onboarding-finish]').click();
            assert.equal(await page.evaluate(id => openAccountOnboardingWizard(null, { staffId: id }), staff.id), false);
            assert.match(await page.locator('#accountOnboardingLoading').textContent(), new RegExp(`#${staff.id}.*уже прив’язана`));
            await page.keyboard.press('Escape');

            const { rows: [otherStaff] } = await pool.query(
                "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'animators', 'QA Animator', 'animator') RETURNING id, name",
                [`QA Other ${runId}`]
            );
            await card.getByRole('button', { name: /відкрити/i }).click();
            await page.waitForFunction(id => Number(document.getElementById('editStaffId').value) === id, staff.id);
            await profile.locator('#editStaffName').fill('QA Late Response');
            await expectDelayedStaffSaveIgnored(page, staff.id, () =>
                page.evaluate(async id => {
                    await closeHrEditableModal('staffEditModal', true);
                    await openStaffEdit(id);
                }, otherStaff.id));
            assert.equal(await profile.locator('#editStaffHeaderName').textContent(), otherStaff.name);
            assert.equal(await profile.locator('#editStaffName').inputValue(), otherStaff.name);
            assert.equal(await profile.locator('#editSave').isEnabled(), true);
            const currentRevision = await page.evaluate(async id => (await hrFetch(`/staff/${id}`)).data.profile_revision, otherStaff.id);
            const firstEditor = await page.evaluate(({ id, revision }) => hrFetch(`/staff/${id}`, {
                method: 'PUT', headers: { 'X-Staff-Profile-Revision': revision }, body: { phone: '+380001112233' }
            }), { id: otherStaff.id, revision: currentRevision });
            assert.equal(firstEditor.success, true);
            await profile.locator('#editPhone').fill('+380009998877');
            await profile.locator('#editSave').click();
            const conflict = page.getByRole('dialog').filter({ hasText: 'Картку змінив інший оператор' });
            await conflict.waitFor();
            await captureSupplement('edit-conflict');
            await conflict.getByRole('button', { name: 'Залишити чернетку' }).click();
            assert.equal(await profile.locator('#editPhone').inputValue(), '+380009998877');
            assert.equal((await pool.query('SELECT phone FROM staff WHERE id = $1', [otherStaff.id])).rows[0].phone, '+380001112233');
            await profile.locator('#editSave').click();
            await conflict.getByRole('button', { name: 'Застосувати мої зміни' }).click();
            await page.waitForFunction(() => document.getElementById('editSave').dataset.actionState === 'success');
            assert.equal((await pool.query('SELECT phone FROM staff WHERE id = $1', [otherStaff.id])).rows[0].phone, '+380009998877');
            await page.locator('#editCloseTop').click();

            const otherCard = page.locator('.hr-team-card').filter({ hasText: otherStaff.name });
            await otherCard.getByRole('button', { name: /дії:/i }).click();
            await otherCard.getByRole('menuitem', { name: /прив.язати crm/i }).click();
            await page.locator('.account-link-modal select').selectOption(String(existingAccountId));
            await captureSupplement('link-existing');
            const [existingLink] = await Promise.all([
                waitForResponse(page, 'POST', `/api/staff/${otherStaff.id}/link`),
                page.locator('.account-link-modal').getByRole('button', { name: /прив.язати/i }).click()
            ]);
            assert.equal(existingLink.status(), 200);
            const { rows: existingBindings } = await pool.query(
                'SELECT staff_id FROM employee_profiles WHERE user_id = $1', [existingAccountId]
            );
            assert.deepEqual(existingBindings, [{ staff_id: otherStaff.id }]);

            await page.evaluate(() => openAccountOnboardingWizard(null));
            const newName = `QA CRM Recovery ${runId}`;
            const newUsername = `qa_crm_recovery_${runId}`;
            await page.locator('#accountOnboardingName').fill(newName);
            await page.locator('input[name="accountOnboardingStaffMode"][value="new"]').check();
            await page.locator('#accountOnboardingDepartment').fill('animators');
            await page.locator('#accountOnboardingPosition').fill('QA Animator');
            await page.locator('#accountOnboardingProfession-animator').check();
            await page.locator('#accountOnboardingPrimaryProfession-animator').check();
            await page.locator('#accountOnboardingNext').click();
            await page.locator('#accountOnboardingUsername').fill(newUsername);
            assert.equal(await page.locator('#accountOnboardingNext').isVisible(), false);
            await page.route('**/api/users/onboarding', async route => {
                if (route.request().method() !== 'POST') return route.continue();
                const committed = await route.fetch();
                assert.equal(committed.status(), 200);
                await route.abort('failed');
            });
            const [recovered] = await Promise.all([
                page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/users/onboarding/operations/')),
                page.locator('#accountOnboardingSubmit').click()
            ]);
            await page.unroute('**/api/users/onboarding');
            assert.equal(recovered.status(), 200);
            const recovery = await recovered.json();
            assert.equal(recovery.credential, null);
            await receipt.getByText('Збережену операцію знайдено.', { exact: false }).waitFor();
            await captureSupplement('recovery');
            assert.match(await receipt.textContent(), new RegExp(`#${recovery.receipt.staff.id}`));
            const { rows: recoveredStaff } = await pool.query('SELECT id FROM staff WHERE name = $1', [newName]);
            assert.deepEqual(recoveredStaff, [{ id: recovery.receipt.staff.id }]);
            await page.locator('[data-account-onboarding-finish]').click();

            await otherCard.getByRole('button', { name: /відкрити/i }).click();
            await profile.locator('#editPhone').fill('+380009998899');
            await expectDelayedStaffSaveIgnored(page, otherStaff.id, async () => {
                assert.equal(await page.evaluate(() => setCrmBusinessContext('dar')), 'dar');
                await profile.waitFor({ state: 'hidden' });
            });
            await profile.waitFor({ state: 'hidden' });

            assert.equal(await page.evaluate(() => setCrmBusinessContext('event_genix')), 'event_genix');
            await otherCard.getByRole('button', { name: /відкрити/i }).click();
            await profile.locator('#editPhone').fill('+380009998898');
            await expectDelayedStaffSaveIgnored(page, otherStaff.id, () => page.evaluate(() => {
                localStorage.setItem('pzp_auth_session_generation', 'qa-session-replaced');
                window.dispatchEvent(new Event('crm:auth-cleared'));
            }));
            await profile.waitFor({ state: 'hidden' });
        } else {
            assert.equal(await card.getByRole('menuitem', { name: 'Створити CRM' }).count(), 0);
        }
        fs.writeFileSync(path.join(supplementDirectory, `${supplement.key}-evidence.json`), JSON.stringify(supplement, null, 2));
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
        browser = await requirePlaywright().chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        for (const actor of actors) await runActor(browser, pool, actor, actors.find(item => item.label === 'mobile').id);
        if (process.env.EG_HR_UX_VISUAL_AUDIT === '1') {
            await require('./hr-crm-ux-visual-audit').runHrCrmVisualAudit({ browser, pool, actors, login, target, output, runId });
        }
        if (process.env.EG_HR_UX_EXTENDED_AUDIT === '1') {
            await require('./hr-crm-ux-extended-audit').runHrCrmExtendedAudit({ browser, pool, actors, login, target, output, runId });
        }
    } finally {
        await browser?.close();
        await pool.end();
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
});
