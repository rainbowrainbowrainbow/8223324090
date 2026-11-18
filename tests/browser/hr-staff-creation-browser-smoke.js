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
const schedulePlacementOnly = process.env.EG_HR_STAFF_SCHEDULE_PLACEMENT_ONLY === '1';

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

async function verifyKitchenAccount(browser, managerPage, pool) {
    const { rows: [worker] } = await pool.query(
        "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'Кухня', 'Кухар піци', 'pizzaiolo') RETURNING id",
        ['QA Cook ' + runId]
    );
    await managerPage.evaluate(id => openAccountOnboardingWizard(null, { staffId: id }), worker.id);
    const summary = managerPage.locator('#accountOnboardingAccessSummary');
    await summary.waitFor({ state: 'visible' });
    assert.match(await summary.textContent(), /Кухар/i);
    assert.equal(await managerPage.locator('#accountOnboardingRole').count(), 0);
    const username = 'qa_hr_cook_' + runId;
    await managerPage.locator('#accountOnboardingUsername').fill(username);
    const password = await managerPage.locator('#accountOnboardingPassword').inputValue();
    const [created] = await Promise.all([
        waitForResponse(managerPage, 'POST', '/api/users/onboarding'),
        managerPage.locator('#accountOnboardingSubmit').click()
    ]);
    assert.equal(created.status(), 200);
    const result = await created.json();
    assert.equal(result.receipt.staff.id, worker.id);
    assert.equal(result.receipt.account.role, 'cook');
    assert.equal(result.businessAccessReady, true);
    await managerPage.locator('[data-account-onboarding-finish]').click();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
        const scheduleReads = [];
        page.on('response', response => {
            const pathname = new URL(response.url()).pathname;
            if (['/api/hr/professions', '/api/staff', '/api/staff/schedule'].includes(pathname)) {
                scheduleReads.push({ pathname, status: response.status() });
            }
        });
        await page.goto(new URL('/', target).href);
        await page.locator('#username').fill(username);
        await page.locator('#password').fill(password);
        const schedulePromise = waitForResponse(page, 'GET', '/api/staff/schedule').catch(() => null);
        const [signIn] = await Promise.all([
            waitForResponse(page, 'POST', '/api/auth/login'),
            page.locator('#loginForm button[type="submit"]').click()
        ]);
        assert.equal(signIn.status(), 200, 'kitchen account can sign in');
        await page.waitForURL(url => url.pathname === '/staff', { timeout: 10000 }).catch(() => {});
        assert.equal(new URL(page.url()).pathname, '/staff', 'kitchen login destination');
        const schedule = await schedulePromise;
        assert.ok(schedule, 'staff schedule should request data after login: ' + JSON.stringify(scheduleReads));
        assert.equal(schedule.status(), 200, 'the schedule starts with data for a kitchen account');
        assert.equal((await schedule.json()).success, true);
        await page.locator('#scheduleStaffSearch').waitFor({ state: 'visible' });
        await page.evaluate(async () => {
            const user = AppState.currentUser;
            if (user?.role !== 'cook' || !resolveCapability(user, 'hr.schedule.view', { type: 'action' }).allowed) {
                throw new Error('Expected signed-in cook with schedule view');
            }
            if (resolveCapability(user, 'hr.schedule.manage', { type: 'action' }).allowed) {
                throw new Error('A cook must not receive schedule management through onboarding');
            }
        });
        await page.screenshot({ path: path.join(output, 'mobile-cook-schedule.png') });
        process.stdout.write('[hr-staff] cook CRM issuance and mobile schedule landing confirmed\n');
    } finally {
        await context.close();
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
        await page.screenshot({ path: path.join(supplementDirectory, filename), mask: [page.locator('#accountOnboardingPassword[type="text"], #accountOnboardingReceipt .hr-account-credential code:nth-of-type(2)')] });
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
            await dialog.locator('[name="family_name"]').fill('Abandoned');
            await dialog.locator('[name="given_name"]').fill('draft');
            assert.equal(await page.evaluate(() => window.CrmBusinessContext.set('dar')), 'dar');
            await dialog.waitFor({ state: 'hidden' });
            await page.locator('#hrCreateStaffBtn').waitFor({ state: 'hidden' });
            assert.equal((await pool.query("SELECT 1 FROM staff WHERE name = 'Abandoned draft'")).rowCount, 0);
            assert.equal(await page.evaluate(() => window.CrmBusinessContext.set('event_genix')), 'event_genix');
            await page.locator('#hrCreateStaffBtn').click();
            await dialog.waitFor({ state: 'visible' });
            assert.equal(await dialog.locator('[name="family_name"]').inputValue(), '');
            assert.equal(await dialog.locator('[name="given_name"]').inputValue(), '');
        }
        const name = `QA Staff ${actor.label} ${runId}`;
        await dialog.locator('[name="family_name"]').fill('QA');
        await dialog.locator('[name="given_name"]').fill(name.slice(3));
        const department = dialog.locator('[name="department"]');
        const position = dialog.getByRole('combobox', { name: 'Посада *' });
        const schedulePlacement = dialog.locator('#hrCreateStaffSchedulePlacement');
        if (schedulePlacementOnly) {
            for (const [departmentLabel, professionKey, expectedPlacement] of [
                ['Продажі', 'manager', 'Рецепція → Менеджери'],
                ['Безпека', 'security', 'Технічний відділ → Охорона'],
                ['Кухня', 'cook', 'Кафе → Кухня']
            ]) {
                await department.selectOption({ label: departmentLabel });
                assert.equal(await schedulePlacement.innerText(), '');
                await position.selectOption(professionKey);
                assert.equal(await schedulePlacement.innerText(), `У графіку — ${expectedPlacement}`);
            }
            await dialog.screenshot({ path: path.join(output, `${actor.label}-schedule-placement.png`) });
        }
        await department.selectOption({ label: 'Аніматори' });
        await position.selectOption('animator');
        const placementText = await schedulePlacement.innerText();
        assert.equal(placementText, 'У графіку — Аніматори');
        assert.equal(await position.getAttribute('aria-describedby'), 'hrCreateStaffSchedulePlacement');
        await position.press('Tab');
        assert.equal(await dialog.locator('[name="hireDate"]').evaluate(el => el === document.activeElement), true);

        await dialog.screenshot({ path: path.join(output, `${actor.label}-create.png`) });
        await captureSupplement('hr-create');

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
        if (actor.role === 'creator') {
            const scheduleStaff = await page.evaluate(async () => window.crmApiFetch('/api/staff'));
            assert.ok(scheduleStaff.success);
            const scheduled = scheduleStaff.data.find(row => row.id === staff.id);
            assert.ok(scheduled, 'new staff card is available to the schedule');
            assert.deepEqual([scheduled.display_group_label, scheduled.display_subgroup_label], ['Аніматори', 'Аніматори']);
            assert.equal(placementText, `У графіку — ${scheduled.display_group_label}`);
        }
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
        if (schedulePlacementOnly) {
            const catalogDepartment = await page.evaluate(async () => {
                const catalog = await ensureProfessionsLoaded({ silent: true });
                return catalog.find(profession => profession.key === 'animator').department.trim();
            });
            const { rows } = await pool.query('SELECT department, role_type FROM staff WHERE id = $1', [staff.id]);
            assert.deepEqual(rows, [{ department: catalogDepartment, role_type: 'animator' }]);
            assert.deepEqual(pageErrors, []);
            console.log(`[hr-staff] ${actor.label}: schedule placement and staff creation confirmed`);
            return;
        }
        if (['desktop', 'mobile'].includes(actor.label)) {
            const picker = profile.locator('#editStaffPhotoFile');
            const upload = profile.locator('#editStaffPhotoUpload');
            if (actor.label === 'desktop') {
                await picker.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
                const [invalidPhoto] = await Promise.all([
                    waitForResponse(page, 'PUT', `/api/hr/staff/${staff.id}`), upload.click()
                ]);
                assert.equal(invalidPhoto.status(), 400);
                await page.waitForFunction(() => !document.getElementById('editStaffPhotoUpload').disabled);
            }
            const buffer = await require('sharp')({
                create: { width: 16, height: 16, channels: 3, background: '#117766' }
            }).png().toBuffer();
            await picker.setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer });
            const [uploadedPhoto] = await Promise.all([
                waitForResponse(page, 'PUT', `/api/hr/staff/${staff.id}`), upload.click()
            ]);
            assert.equal(uploadedPhoto.status(), 200);
            const uploaded = await uploadedPhoto.json();
            const photoUrl = uploaded.data.photo_url;
            assert.match(photoUrl, /^\/uploads\/profile-avatars\//);
            assert.equal((await pool.query('SELECT photo_url FROM staff WHERE id = $1', [staff.id])).rows[0].photo_url, photoUrl);
            const image = await page.request.get(new URL(photoUrl, page.url()).href);
            assert.equal(image.status(), 200);
            assert.equal(image.headers()['content-type'], 'image/jpeg');
            await page.waitForFunction(expected => document.getElementById('editPhotoUrl').value === expected, photoUrl);
            await upload.scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `${actor.label}-photo.png`) });
        }
        const updatedPosition = await profile.locator('#editStaffPosition option').last().getAttribute('value');
        await profile.locator('#editStaffPosition').selectOption(updatedPosition);
        const [edit] = await Promise.all([
            waitForResponse(page, 'PUT', `/api/hr/staff/${staff.id}`),
            profile.locator('#editSave').click()
        ]);
        assert.equal(edit.status(), 200, 'position updated');
        const { rows } = await pool.query('SELECT id, position, given_name, family_name FROM staff WHERE name = $1', [name]);
        assert.deepEqual(rows, [{ id: staff.id, position: updatedPosition, family_name: 'QA', given_name: name.slice(3) }]);
        await page.waitForFunction(() => document.getElementById('editSave').dataset.actionState === 'success');
        assert.equal(await profile.locator('#editStaffHeaderName').textContent(), name);
        await profile.screenshot({ path: path.join(output, `${actor.label}-edit.png`) });
        await captureSupplement('hr-edit');
        await page.locator('#editCloseTop').click();
        await profile.waitFor({ state: 'hidden' });
        const card = page.locator('.hr-team-card').filter({ hasText: name });
        await card.getByRole('button', { name: /відкрити/i }).click();
        await page.waitForFunction(expected => document.getElementById('editStaffPosition').value === expected, updatedPosition);
        assert.equal(await profile.locator('#editStaffFamilyName').inputValue(), 'QA');
        assert.equal(await profile.locator('#editStaffGivenName').inputValue(), name.slice(3));
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
            if (actor.parkWorker) await page.keyboard.press('Escape');
            else await page.locator('#accountOnboardingClose').click();
            const discardPrompt = page.getByRole('dialog').filter({ hasText: 'Є незбережені зміни' });
            await discardPrompt.getByRole('button', { name: 'Продовжити редагування' }).click();
            assert.equal(await page.locator('#accountOnboardingUsername').inputValue(), username);
            assert.equal(await wizard.isVisible(), true);
            const initialPassword = 'Browser-Initial-Password-827';
            const passwordInput = page.locator('#accountOnboardingPassword');
            assert.equal((await passwordInput.inputValue()).length, 16);
            await passwordInput.fill(initialPassword);
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await passwordInput.getAttribute('type'), 'text');
            assert.equal(await page.locator('#accountOnboardingPasswordToggle').getAttribute('aria-pressed'), 'true');
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await passwordInput.getAttribute('type'), 'password');
            assert.equal(await page.locator('#accountOnboardingPasswordGenerate').count(), 0);
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(staff.id));
            assert.equal(await page.locator('[name="accountOnboardingStaffMode"]').count(), 0);
            const workBefore = (await pool.query(`SELECT role_type, secondary_professions, company_structure_node_id, hourly_rate
                FROM staff WHERE id=$1`, [staff.id])).rows[0];
            const rolesBefore = (await pool.query(`SELECT profession_key, is_primary, hourly_rate FROM staff_role_assignments
                WHERE staff_id=$1 ORDER BY profession_key`, [staff.id])).rows;
            assert.match(await page.locator('#accountOnboardingSubmit').innerText(), /Створити акаунт і надати доступ/);
            assert.equal(await wizard.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
            if (actor.width <= 600) {
                assert.ok((await page.locator('#accountOnboardingSubmit').boundingBox()).height >= 48);
                assert.ok(parseFloat(await passwordInput.evaluate(el => getComputedStyle(el).fontSize)) >= 16);
            }
            await captureSupplement('crm-access-form');
            const usernameInput = page.locator('#accountOnboardingUsername');
            const form = page.locator('#accountOnboardingForm');
            const status = page.locator('#accountOnboardingStatus');
            const close = page.locator('#accountOnboardingClose');
            let unblockFailure;
            const failureGate = new Promise(resolve => { unblockFailure = resolve; });
            await page.route('**/api/users/onboarding', async route => {
                await failureGate;
                await route.fulfill({ status: 400, json: { success: false, error: 'Синтетична помилка видачі доступу.' } });
            }, { times: 1 });
            let issuancePosts = 0;
            const countIssuance = request => {
                if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/users/onboarding') issuancePosts++;
            };
            page.on('request', countIssuance);
            try {
                const dispatched = page.waitForRequest(request =>
                    request.method() === 'POST' && new URL(request.url()).pathname === '/api/users/onboarding');
                await usernameInput.press('Enter');
                await dispatched;
                assert.equal(await status.evaluate(el => el === document.activeElement), true);
                assert.equal(await form.evaluate(el => el.inert), true);
                assert.equal(await page.locator('#accountOnboardingSubmit').isDisabled(), true);
                await page.keyboard.press('Enter');
                await page.keyboard.press('Tab');
                assert.equal(await close.evaluate(el => el === document.activeElement), true);
                await page.keyboard.press('Shift+Tab');
                assert.equal(await close.evaluate(el => el === document.activeElement), true);
                await status.focus();
                await page.keyboard.press('Shift+Tab');
                assert.equal(await close.evaluate(el => el === document.activeElement), true);
                assert.equal(issuancePosts, 1);
                await status.focus();
                await captureSupplement('crm-access-submitting-focus');
            } finally {
                unblockFailure();
            }
            await status.getByText('Синтетична помилка видачі доступу.').waitFor();
            assert.equal(await usernameInput.evaluate(el => el === document.activeElement), true);
            assert.equal(await form.evaluate(el => el.inert), false);
            assert.equal(await page.locator('#accountOnboardingSubmit').isEnabled(), true);
            assert.equal(await usernameInput.inputValue(), username);
            assert.equal(await passwordInput.inputValue(), initialPassword);
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(staff.id));
            await captureSupplement('crm-access-error-focus');
            await page.keyboard.press('Tab');
            assert.equal(await passwordInput.evaluate(el => el === document.activeElement), true);
            await page.keyboard.press('Shift+Tab');
            assert.equal(await usernameInput.evaluate(el => el === document.activeElement), true);
            const [linked] = await Promise.all([
                waitForResponse(page, 'POST', '/api/users/onboarding'),
                page.keyboard.press('Enter')
            ]);
            page.off('request', countIssuance);
            assert.equal(issuancePosts, 2, 'one failed request and one retry');
            assert.equal(linked.status(), 200, 'CRM account created');
            const linkedResult = await linked.json();
            assert.ok(linkedResult.credential?.password === initialPassword, 'the submitted password was used');
            const { rows: [binding] } = await pool.query(
                'SELECT ep.staff_id FROM employee_profiles ep JOIN users u ON ep.user_id = u.id WHERE u.username = $1',
                [username]
            );
            assert.equal(binding.staff_id, staff.id);
            assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [name])).rowCount, 1);
            assert.deepEqual((await pool.query(`SELECT role_type, secondary_professions, company_structure_node_id, hourly_rate
                FROM staff WHERE id=$1`, [staff.id])).rows[0], workBefore);
            assert.deepEqual((await pool.query(`SELECT profession_key, is_primary, hourly_rate FROM staff_role_assignments
                WHERE staff_id=$1 ORDER BY profession_key`, [staff.id])).rows, rolesBefore);
            const createdSession = await login(username, initialPassword);
            assert.equal(createdSession.user.role, linkedResult.receipt.account.role);
            const membership = await pool.query(
                `SELECT bm.role, bm.is_active FROM business_memberships bm
                 JOIN businesses b ON b.id = bm.business_id JOIN users u ON u.id = bm.user_id
                 WHERE u.username = $1 AND b.context_key = 'event_genix'`, [username]
            );
            assert.equal(membership.rowCount, 1);
            assert.equal(membership.rows[0].is_active, true);
            assert.equal(membership.rows[0].role, createdSession.user.role);
            const receipt = page.locator('#accountOnboardingReceipt');
            await receipt.waitFor({ state: 'visible' });
            assert.equal(await receipt.evaluate(el => el === document.activeElement), true);
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
            await profile.locator('#editStaffGivenName').fill('Late Response');
            await expectDelayedStaffSaveIgnored(page, staff.id, () =>
                page.evaluate(async id => {
                    await closeHrEditableModal('staffEditModal', true);
                    await openStaffEdit(id);
                }, otherStaff.id));
            assert.equal(await profile.locator('#editStaffHeaderName').textContent(), otherStaff.name);
            assert.equal(await profile.locator('#editStaffName').inputValue(), otherStaff.name);
            assert.equal(await profile.locator('#editSave').isEnabled(), true);
            assert.deepEqual((await pool.query(
                'SELECT name, family_name, given_name FROM staff WHERE id = $1', [staff.id]
            )).rows, [{ name: 'QA Late Response', family_name: 'QA', given_name: 'Late Response' }]);
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

            const newName = `QA CRM Recovery ${runId}`;
            const newUsername = `qa_crm_recovery_${runId}`;
            await createButton.click();
            await dialog.locator('[name="family_name"]').fill('QA');
            await dialog.locator('[name="given_name"]').fill(newName.slice(3));
            await dialog.locator('[name="department"]').selectOption({ label: 'Аніматори' });
            await dialog.locator('[name="position"]').selectOption('animator');
            const [recoveryCard] = await Promise.all([
                waitForResponse(page, 'POST', '/api/staff'),
                dialog.getByRole('button', { name: 'Створити картку', exact: true }).click()
            ]);
            assert.equal(recoveryCard.status(), 200);
            const recoveryStaff = (await recoveryCard.json()).data;
            const { rows: [unsupportedStaff] } = await pool.query(
                "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'QA', 'QA Custom', 'qa_unmapped_role') RETURNING id",
                ['QA Unmapped ' + runId]
            );
            await profile.waitFor({ state: 'visible' });
            await page.goto(new URL('/hr?tab=accounts', target).href);
            const centerAction = page.getByRole('button', { name: /Надати CRM-доступ працівнику/ });
            await centerAction.waitFor({ state: 'visible' });
            await page.route('**/api/users/onboarding/options', route => route.fulfill({ status: 503, json: { success: false } }), { times: 1 });
            await centerAction.click();
            await page.locator('[data-account-onboarding-retry]').click();
            await page.locator('#accountOnboardingSubmit').click();
            assert.match(await page.locator('#accountOnboardingStatus').textContent(), /Оберіть картку/);
            assert.equal(await page.locator('#accountOnboardingStaffId').evaluate(el => el === document.activeElement), true);
            assert.equal(await page.locator('#accountOnboardingStaffId').getAttribute('aria-invalid'), 'true');
            await page.locator('#accountOnboardingStaffId').selectOption(String(recoveryStaff.id));
            assert.equal(await page.locator('#accountOnboardingStaffId').getAttribute('aria-invalid'), null);
            const staffPicker = page.locator('#accountOnboardingStaffId');
            const password = page.locator('#accountOnboardingPassword');
            await password.fill('QA-Browser-Only-Password');
            await page.locator('#accountOnboardingPasswordToggle').click();
            await staffPicker.selectOption(String(unsupportedStaff.id));
            assert.notEqual(await password.inputValue(), 'QA-Browser-Only-Password');
            assert.equal(await password.getAttribute('type'), 'password');
            assert.equal(await page.locator('#accountOnboardingPasswordToggle').getAttribute('aria-pressed'), 'false');
            const unsupportedRole = page.locator('#accountOnboardingAccessSummary');
            assert.match(await unsupportedRole.textContent(), /не визначено CRM-роль/);
            let invalidPosts = 0;
            const countPosts = req => {
                if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/users/onboarding') invalidPosts++;
            };
            page.on('request', countPosts);
            await page.locator('#accountOnboardingSubmit').click();
            assert.equal(await unsupportedRole.evaluate(el => el === document.activeElement), true);
            assert.equal(invalidPosts, 0);
            page.off('request', countPosts);
            await staffPicker.selectOption('');
            assert.equal(await password.inputValue(), '');
            await staffPicker.selectOption(String(recoveryStaff.id));
            assert.equal((await password.inputValue()).length, 16);
            await page.locator('#accountOnboardingUsername').fill(newUsername);
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(recoveryStaff.id));
            let recoveryKey;
            await page.route('**/api/users/onboarding', async route => {
                if (route.request().method() !== 'POST') return route.continue();
                recoveryKey = route.request().headers()['idempotency-key'];
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


            const { rows: [nextStaff] } = await pool.query(
                "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'animators', 'QA Animator', 'animator') RETURNING id, name",
                ['QA Clipboard ' + runId]
            );
            await page.evaluate(key => writeStaffCreationAttempt(staffCreationStorageKey('onboarding'), {
                key, fingerprint: 'synthetic-interrupted-previous-attempt'
            }), recoveryKey);
            await page.goto(new URL('/hr?employee=' + nextStaff.id, target).href);
            await profile.getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).click();
            await staffPicker.waitFor({ state: 'attached' });
            const onboardingForm = page.locator('#accountOnboardingForm');
            const accountName = page.locator('#accountOnboardingName');
            await onboardingForm.waitFor({ state: 'visible' });
            assert.equal(await staffPicker.inputValue(), String(nextStaff.id));
            await page.locator('#accountOnboardingUsername').fill('qa_clipboard_' + runId);
            let otherCardPosts = 0;
            const countOtherCardPosts = request => {
                if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/users/onboarding') otherCardPosts++;
            };
            page.on('request', countOtherCardPosts);
            await page.locator('#accountOnboardingSubmit').click();
            await page.waitForFunction(() => document.getElementById('accountOnboardingStatus')?.textContent.includes('Знайдено результат для іншої картки.'));
            page.off('request', countOtherCardPosts);
            assert.equal(otherCardPosts, 0);
            assert.equal(await receipt.isVisible(), false);
            assert.equal(await onboardingForm.evaluate(el => el.inert), false);
            assert.equal(await page.evaluate(() => readStaffCreationAttempt(staffCreationStorageKey('onboarding')).key), recoveryKey);

            await page.goto(new URL('/hr?tab=accounts', target).href);
            await centerAction.click();
            await receipt.getByText('Збережену операцію знайдено.', { exact: false }).waitFor();
            assert.match(await receipt.textContent(), new RegExp('#' + recoveryStaff.id));
            await page.locator('[data-account-onboarding-finish]').click();

            await centerAction.click();
            await staffPicker.selectOption(String(nextStaff.id));
            await page.locator('#accountOnboardingUsername').fill('qa_clipboard_' + runId);
            let unblock;
            let markDispatched;
            const requestGate = new Promise(resolve => { unblock = resolve; });
            const dispatched = new Promise(resolve => { markDispatched = resolve; });
            await page.route('**/api/users/onboarding', async route => {
                markDispatched();
                await requestGate;
                return route.continue();
            }, { times: 1 });
            const issuance = waitForResponse(page, 'POST', '/api/users/onboarding');
            try {
                await page.locator('#accountOnboardingSubmit').click();
                await dispatched;
                assert.equal(await onboardingForm.evaluate(el => el.inert), true);
                const closeControl = page.locator('#accountOnboardingClose');
                await closeControl.focus();
                await page.keyboard.press('Shift+Tab');
                assert.equal(await closeControl.evaluate(el => el === document.activeElement), true);
                // A late programmatic change must be ignored while the form is saving.
                await staffPicker.evaluate((el, staleId) => {
                    el.value = String(staleId);
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, unsupportedStaff.id);
                assert.equal(await accountName.inputValue(), nextStaff.name);
            } finally {
                unblock();
            }
            assert.equal((await issuance).status(), 200);
            const copy = receipt.locator('[data-account-onboarding-copy]');
            await copy.waitFor({ state: 'visible' });
            await page.evaluate(() => {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true, value: { writeText: async text => { window.qaCopiedAccount = text; } }
                });
                document.getElementById('accountOnboardingName').value = 'QA stale draft';
            });
            await copy.click();
            const copiedCorrectly = await page.evaluate(expected => {
                const value = window.qaCopiedAccount;
                delete window.qaCopiedAccount;
                delete navigator.clipboard;
                return value?.includes(expected) === true && !value.includes('QA stale draft');
            }, nextStaff.name);
            assert.equal(copiedCorrectly, true);
            await page.locator('[data-account-onboarding-finish]').click();

            const professionKey = 'qa_kitchen_' + runId;
            const { rows: [profession] } = await pool.query(
                "INSERT INTO hr_professions (key, title, department, is_active) VALUES ($1, 'QA Кухар', 'cafe', true) RETURNING id",
                [professionKey]
            );
            await page.evaluate(key => openProfessionWorkspace({ key, historyMode: 'none' }), professionKey);
            const departmentEditor = page.locator('#professionWorkspaceDepartment');
            await departmentEditor.waitFor({ state: 'visible' });
            assert.equal(await departmentEditor.inputValue(), 'Кафе');
            await departmentEditor.fill('Кухня');
            const [updatedProfession] = await Promise.all([
                waitForResponse(page, 'PATCH', `/api/hr/professions/${profession.id}/department`),
                page.locator('#professionWorkspaceSaveDepartment').click()
            ]);
            assert.equal(updatedProfession.status(), 200, 'Park can save the department override');
            assert.equal((await pool.query('SELECT department FROM hr_professions WHERE id = $1', [profession.id])).rows[0].department, 'cafe');
            assert.deepEqual((await pool.query('SELECT department FROM park_profession_departments WHERE profession_id = $1', [profession.id])).rows,
                [{ department: 'Кухня' }]);
            await page.getByText('Відділ у Парк збережено.', { exact: true }).waitFor();
            await page.screenshot({ path: path.join(output, 'desktop-profession-department.png') });
            await page.locator('#professionWorkspaceClose').click();
            await page.evaluate(() => ensureProfessionsLoaded({ force: true, silent: true }));
            await page.evaluate(() => activateHrTab('team', { updateHash: true }));
            await createButton.click();
            await dialog.locator('[name="department"]').selectOption({ label: 'Кухня' });
            await dialog.locator('[name="position"]').selectOption(professionKey);
            assert.equal(await schedulePlacement.innerText(), 'У графіку — Адміністрація',
                'placement uses the effective Park department for a custom profession');
            await dialog.locator('#hrCreateStaffCancel').click();
            await verifyKitchenAccount(browser, page, pool);

            await page.goto(new URL('/hr?tab=team', target).href);
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

async function verifyScheduleAccountForms(browser, pool, actor) {
    const session = await login(actor.username, actor.password);
    const directory = path.join(output, 'ux-matrix');
    const cases = [{ width: 1366, height: 768, theme: 'light' }, { width: 390, height: 844, theme: 'dark' }];
    const evidence = [];
    for (const { width, height, theme } of cases) {
        const dark = theme === 'dark';
        const key = `supplement-schedule-${width}-${theme}`;
        const username = `qa_schedule_${width}_${runId}`;
        const name = `QA Schedule ${width} ${runId}`;
        const { rows: [staff] } = await pool.query(
            "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'animators', 'Animator', 'animator') RETURNING id",
            [name]
        );
        const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
        try {
            await context.addInitScript(({ session, dark }) => {
                localStorage.setItem('pzp_token', session.accessToken || session.token);
                localStorage.setItem('pzp_access_token', session.accessToken || session.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
                localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                localStorage.setItem('pzp_dark_mode', String(dark));
            }, { session, dark });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.setDefaultTimeout(20000);
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
            const wizard = page.locator('#accountOnboardingOverlay');
            const input = page.locator('#accountOnboardingUsername');
            const open = page.locator('#linkCreateAccountBtn');
            const linkDialog = page.locator('#linkModalOverlay');
            const submit = page.locator('#accountOnboardingSubmit');
            const role = page.locator('#accountOnboardingManualRole');
            const checks = [];
            const screens = [];
            const capture = async label => {
                const filename = `${key}-${label}.png`;
                await page.screenshot({ path: path.join(directory, filename),
                    mask: [page.locator('#accountOnboardingPassword[type="text"], .hr-account-credential code:nth-of-type(2)')] });
                screens.push(filename);
            };
            await page.goto(new URL('/staff', target).href);
            const search = page.locator('#scheduleStaffSearch[data-schedule-search-bound="true"]');
            const waitForRoster = () => page.waitForFunction(() => window.StaffSchedulePage?.isInitialized());
            await waitForRoster();
            const staffRow = page.locator(`[data-hr-profile="${staff.id}"]`);
            await search.fill(name);
            await staffRow.click();
            await page.getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).click();
            await input.waitFor({ state: 'visible' });
            assert.equal(await role.isVisible(), false);
            assert.equal(await page.locator('#accountOnboardingStaffId').inputValue(), String(staff.id));
            await capture('schedule-hr');
            await page.locator('#accountOnboardingClose').click();
            await wizard.waitFor({ state: 'hidden' });
            checks.push('normal schedule row → HR profile → canonical form');

            // Give the retained mode a trigger in the isolated shell. The app binds
            // it through the same view-switch handler and loads the real APIs.
            await page.route(url => url.pathname === '/staff', async route => {
                const response = await route.fetch();
                const body = (await response.text()).replace('</body>',
                    '<button type="button" style="position:fixed;top:8px;left:50%;z-index:9999" data-schedule-view="accounts">Тестовий режим акаунтів</button></body>');
                await route.fulfill({ response, body });
            });
            await page.goto(new URL('/staff', target).href);
            await waitForRoster();
            await search.fill(name);
            await staffRow.waitFor({ state: 'visible' });
            const manualMode = page.getByRole('button', { name: 'Тестовий режим акаунтів' });
            await manualMode.click();
            await manualMode.evaluate(el => { el.hidden = true; });
            // The compact schedule hides position badges; open the retained link modal at its desktop entry.
            if (dark) await page.setViewportSize({ width: 1366, height });
            await page.locator(`[data-link-staff="${staff.id}"]`).click();
            if (dark) await page.setViewportSize({ width, height });
            await open.click();
            await submit.waitFor({ state: 'visible' });
            assert.equal(await linkDialog.isVisible(), false, 'the linking dialog must not cover the account form');
            await page.locator('#accountOnboardingClose').focus();
            await page.keyboard.press('Shift+Tab');
            assert.equal(await submit.evaluate(el => el === document.activeElement), true);
            await page.keyboard.press('Tab');
            await page.keyboard.press('Escape');
            await wizard.waitFor({ state: 'hidden' });
            assert.equal(await linkDialog.isVisible(), true);
            assert.equal(await open.evaluate(el => el === document.activeElement), true);
            await open.click();
            await input.fill(username);
            await role.selectOption('waiter');
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await page.locator('#accountOnboardingPassword').getAttribute('type'), 'text');
            await page.locator('#accountOnboardingPasswordToggle').click();
            assert.equal(await page.locator('#accountOnboardingPassword').getAttribute('type'), 'password');
            assert.ok(await wizard.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            assert.ok(await submit.evaluate(el => {
                const bounds = el.getBoundingClientRect();
                return bounds.height >= (innerWidth < 600 ? 48 : 44)
                    && el.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
            }));
            await capture('account');
            const requestKeys = [];
            await page.route('**/api/users', async route => {
                if (route.request().method() !== 'POST') return route.continue();
                requestKeys.push(route.request().headers()['idempotency-key']);
                if (dark && requestKeys.length === 1) {
                    const completed = await route.fetch();
                    assert.equal(completed.status(), 200);
                    return route.abort('connectionreset');
                }
                return route.continue();
            });
            const result = waitForResponse(page, 'POST', '/api/users');
            // Two submit events during the same click sequence must not start another operation.
            await submit.evaluate(el => {
                el.click();
                el.form.requestSubmit();
            });
            assert.equal((await result).status(), 200);
            await page.locator('[data-account-onboarding-finish]').waitFor();
            assert.equal(requestKeys.length, dark ? 2 : 1);
            assert.equal(new Set(requestKeys).size, 1);
            assert.equal(await page.locator('[data-account-onboarding-copy]').count(), dark ? 0 : 1);
            assert.match(await page.locator('#accountOnboardingReceipt').innerText(), /CRM-доступ активний/);
            const { rows } = await pool.query(
                'SELECT u.role, ep.staff_id FROM users u JOIN employee_profiles ep ON ep.user_id=u.id WHERE u.username=$1',
                [username]
            );
            assert.deepEqual(rows, [{ role: 'waiter', staff_id: staff.id }]);
            await capture('result');
            await page.getByRole('button', { name: 'Готово', exact: true }).click();
            await wizard.waitFor({ state: 'hidden' });
            assert.equal(await linkDialog.isVisible(), false);
            await page.locator('.link-badge.linked').filter({ hasText: username }).waitFor({ state: 'attached' });
            assert.equal(await staffRow.evaluate(el => el === document.activeElement), true);
            assert.deepEqual(errors, []);
            checks.push('manual role, focus return, keyboard wrap, reachable primary action, one linked account');
            if (dark) checks.push('lost response replays the same operation without the password');
            evidence.push({ key, role: 'creator', mode: 'existing', width, height, theme, screens, checks });
            console.log(`[hr-staff] schedule account form ${width}px (${theme}) passed`);
        } finally {
            await context.close();
        }
    }
    fs.writeFileSync(path.join(directory, 'supplement-schedule-evidence.json'), JSON.stringify(evidence, null, 2));
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
        if (!schedulePlacementOnly) {
            await verifyScheduleAccountForms(browser, pool, actors.find(actor => actor.role === 'creator'));
        }
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
