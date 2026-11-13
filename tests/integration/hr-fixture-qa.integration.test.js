'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { createHrFixtureQaRun, finishHrFixtureQaRun } = require('../../services/hrFixtureQa');
const { sha256, cleanupTrustedQaRun } = require('../../services/trustedQaRuns');
const { installHrFixtureQaBrowserGuard } = require('../../scripts/hr-fixture-qa-browser-guard');
const { requirePlaywright } = require('../browser/timeline-room-summary-browser-smoke');

test('Park HR QA writes register exact fixtures, suppress chat and retire the run atomically', async t => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(database.isLocal, true);
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const db = new Pool({ connectionString: database.url.toString(), ssl: false });
    t.after(() => db.end());
    const runId = 'hrqa-' + randomUUID().replaceAll('-', '').slice(0, 12);
    const secret = randomUUID();
    const { rows: [org] } = await db.query('INSERT INTO organizations(slug,name) VALUES ($1,$1) RETURNING id', [runId]);
    const { rows: [park] } = await db.query(
        `INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode)
         VALUES($1,'event_genix','Park','Park','membership')
         ON CONFLICT(context_key) DO UPDATE SET organization_id=EXCLUDED.organization_id,
             access_mode='membership',status='active' RETURNING id`, [org.id]);

    async function api(path, { actor, method = 'GET', body, key, requestId, qaToken, revision, context = 'event_genix' } = {}) {
        const headers = { 'Content-Type': 'application/json', 'X-Business-Context': context };
        if (actor) headers.Authorization = 'Bearer ' + actor.token;
        if (qaToken) headers['X-QA-Run-Token'] = qaToken;
        if (key) headers['Idempotency-Key'] = key;
        if (requestId) headers['X-QA-Run-Request-Id'] = requestId;
        if (revision) headers['X-Staff-Profile-Revision'] = revision;
        const response = await fetch(new URL(path, process.env.TEST_URL), { method, headers, body: body && JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
    }

    async function operator(role, orgRole, allow = [], deny = []) {
        const username = `qa-operator-${role}-${runId}`;
        const { rows: [user] } = await db.query(
            'INSERT INTO users(username,name,password_hash,role) VALUES($1,$1,$2,$3) RETURNING id',
            [username, await bcrypt.hash(secret, 10), role]);
        await db.query('INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3)',
            [org.id, user.id, orgRole]);
        await db.query(
            `INSERT INTO business_memberships(business_id,organization_id,user_id,role,action_allowlist,action_denylist,page_allowlist,is_default)
             VALUES($1,$2,$3,$4,$5,$6,$7,true)`, [park.id, org.id, user.id, role, allow, deny, ['/hr']]);
        const login = await api('/api/auth/login', { method: 'POST', body: { username, password: secret } });
        assert.equal(login.status, 200);
        return { id: user.id, token: login.data.accessToken || login.data.token, session: login.data };
    }
    const owner = await operator('creator', 'owner');
    const delegate = await operator('animator', 'member',
        ['hr.staff.view', 'hr.staff.create', 'hr.staff.profile.edit'], ['hr.staff.manage']);
    const outsider = await operator('director', 'admin');
    const { rows: [channel] } = await db.query(
        'INSERT INTO chat_channels(slug,name,is_default) VALUES($1,$1,true) RETURNING id', [runId]);
    const { rows: [realStaff] } = await db.query(
        "INSERT INTO staff(name,department,position,role_type) VALUES('Unrelated synthetic control','animators','Control','animator') RETURNING id");

    async function transaction(fn, commit = true) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const value = await fn(client);
            await client.query(commit ? 'COMMIT' : 'ROLLBACK');
            return value;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    const plan = { runId, ownerId: owner.id, delegateId: delegate.id, releaseSha: 'a'.repeat(40), ttlMinutes: 15 };
    const planHash = sha256(JSON.stringify(plan));
    await assert.rejects(transaction(client => createHrFixtureQaRun(client, plan, 'wrong')), { code: 'HR_QA_PLAN_HASH_MISMATCH' });
    const { run, token } = await transaction(client => createHrFixtureQaRun(client, plan, planHash));
    await assert.rejects(transaction(client => createHrFixtureQaRun(client, plan, planHash)), { code: 'HR_QA_RUN_ALREADY_OPEN' });
    const staffName = slot => `${runId}-staff-${slot}`;
    const draft = { name: staffName(1), department: 'animators', position: 'QA Animator', role_type: 'animator' };
    const staffCreate = (actor, qaToken, body = draft, key = randomUUID()) =>
        api('/api/staff', { actor, method: 'POST', body, qaToken, key });
    assert.equal((await staffCreate(delegate)).status, 403);
    assert.equal((await staffCreate(delegate, 'wrong')).status, 403);
    assert.equal((await staffCreate(outsider, token)).status, 403);
    assert.equal((await staffCreate(delegate, token, { ...draft, name: 'No fixture marker' })).status, 403);
    await db.query('UPDATE trusted_qa_runs SET test_customer_marker=$2 WHERE id=$1', [run.id, `${runId}:hr:${'b'.repeat(40)}`]);
    assert.equal((await staffCreate(delegate, token)).status, 403);
    await db.query('UPDATE trusted_qa_runs SET test_customer_marker=$2 WHERE id=$1', [run.id, run.test_customer_marker]);
    assert.equal((await api('/api/staff', { actor: delegate, qaToken: token, key: randomUUID(), method: 'POST', body: draft, context: 'dar' })).status, 403);
    async function runBrowser(actor, width, runPage) {
        const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
        const browser = await requirePlaywright().chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
        try {
            const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
            await installHrFixtureQaBrowserGuard(context, process.env.TEST_URL, token);
            await context.addInitScript(session => {
                const access = session.accessToken || session.token;
                localStorage.setItem('pzp_token', access);
                localStorage.setItem('pzp_access_token', access);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
                localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
            }, actor.session);
            const page = await context.newPage();
            page.setDefaultTimeout(15000);
            await page.goto(new URL('/hr?tab=team', process.env.TEST_URL).href);
            return await runPage(page);
        } finally {
            await browser.close();
        }
    }

    async function clickSubmit(page, endpoint, button) {
        const [response] = await Promise.all([
            page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === endpoint),
            button.click()
        ]);
        return { status: response.status(), data: await response.json(),
            key: await response.request().headerValue('Idempotency-Key'),
            request: response.request().postDataJSON() };
    }

    const first = await runBrowser(delegate, 390, async page => {
        await page.locator('#hrCreateStaffBtn').click();
        await assert.rejects(page.evaluate(() => fetch('/api/users', { method: 'POST', body: '{}' })));
        const dialog = page.locator('#hrCreateStaffDialog');
        for (const field of ['name', 'department', 'position']) {
            await dialog.locator(`[name="${field}"]`).fill(draft[field]);
        }
        await dialog.locator('[name="role_type"]').selectOption('animator');
        const created = await clickSubmit(page, '/api/staff', dialog.locator('[type="submit"]'));
        await page.locator('#staffEditModal').waitFor({ state: 'visible' });
        return created;
    });
    assert.equal(first.status, 200, first.data.code);
    const firstId = first.data.data.id;
    assert.ok(first.key);
    assert.equal((await staffCreate(delegate, token, first.request, first.key)).data.data.id, firstId);

    async function edit(id, body) {
        const path = '/api/hr/staff/' + id;
        const before = await api(path, { actor: delegate });
        assert.equal(before.status, 200);
        return api(path, { actor: delegate, method: 'PUT', body, revision: before.data.data.profile_revision,
            qaToken: token, requestId: randomUUID() });
    }
    assert.equal((await edit(realStaff.id, { position: 'Must not save' })).status, 403);
    assert.equal((await edit(firstId, { name: 'Lost fixture marker' })).status, 403);
    assert.equal((await edit(firstId, { position: 'QA edited' })).status, 200);
    assert.equal((await api('/api/hr/staff/' + firstId, { actor: delegate })).data.data.position, 'QA edited');

    function onboarding(slot, id) {
        return {
            personal: { name: staffName(slot), username: `${runId}-account-${slot}` },
            staff: id ? { mode: 'existing', id } : { mode: 'new', department: 'animators', position: 'QA Animator' },
            professions: [{ key: 'animator', isPrimary: true }],
            access: { role: 'animator', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' }
        };
    }
    const onboard = (body, key) => api('/api/users/onboarding', { actor: owner, qaToken: token, key, method: 'POST', body });
    assert.equal((await onboard(onboarding(1, realStaff.id), randomUUID())).status, 403);
    const firstAccount = await onboard(onboarding(1, firstId), randomUUID());
    assert.equal(firstAccount.status, 200, firstAccount.data.code);
    assert.equal(firstAccount.data.receipt.staff.id, firstId);
    const second = await runBrowser(owner, 1440, async page => {
        await page.locator('#hrCreateStaffBtn').waitFor({ state: 'visible' });
        await page.waitForFunction(() => typeof canRunAccountOnboarding === 'function' && canRunAccountOnboarding());
        assert.equal(await page.evaluate(() => openAccountOnboardingWizard(null)), true);
        await page.locator('input[name="accountOnboardingStaffMode"][value="new"]').check();
        await page.locator('#accountOnboardingName').fill(staffName(2));
        await page.locator('#accountOnboardingDepartment').selectOption({ index: 1 });
        await page.locator('#accountOnboardingPosition').selectOption({ index: 1 });
        await page.locator('#accountOnboardingProfession-animator').check();
        await page.locator('#accountOnboardingPrimaryProfession-animator').check();
        const next = page.locator('#accountOnboardingNext');
        await next.click();
        await page.locator('#accountOnboardingUsername').fill(`${runId}-account-2`);
        await page.locator('#accountOnboardingRole').selectOption('animator');
        return clickSubmit(page, '/api/users/onboarding', page.locator('#accountOnboardingSubmit'));
    });
    assert.equal(second.status, 200, JSON.stringify({ code: second.data.code,
        access: second.request.access, staff: second.request.staff,
        professions: second.request.professions?.map(row => row.key), hasConditions: !!second.request.conditions,
        hasStructure: !!second.request.structureNodeId }));
    const secondId = second.data.receipt.staff.id;
    const accountId = second.data.receipt.account.id;
    assert.ok(second.key);
    const repeat = await onboard(second.request, second.key);
    assert.equal(repeat.status, 200, repeat.data.code);
    assert.equal(repeat.data.receipt.staff.id, secondId);
    assert.equal(repeat.data.receipt.account.id, accountId);
    assert.equal(repeat.data.credential, null);
    assert.equal(second.data.accessState, 'active');
    assert.equal(repeat.data.accessState, 'active');
    const accountIds = [firstAccount.data.receipt.account.id, accountId];
    assert.equal((await db.query('SELECT 1 FROM chat_channel_members WHERE user_id=ANY($1::int[])', [accountIds])).rowCount, 0);
    const explicitLink = await api(`/api/staff/${secondId}/link`, { actor: owner, qaToken: token, requestId: randomUUID(),
        method: 'POST', body: { userId: accountId } });
    assert.equal(explicitLink.status, 200);
    assert.equal(explicitLink.data.link.profile.staffId, secondId);
    assert.equal((await api(`/api/staff/${realStaff.id}/link`, { actor: owner, qaToken: token, requestId: randomUUID(),
        method: 'POST', body: { userId: accountId } })).status, 403);

    const membershipPath = `/api/organizations/${org.id}/members/`;
    const addMembership = userId => api(membershipPath + userId, { actor: owner, qaToken: token, requestId: randomUUID(), method: 'PUT',
        body: { businessId: park.id, role: 'animator', isDefault: true } });
    assert.equal((await addMembership(outsider.id)).status, 403);
    assert.equal((await addMembership(accountId)).status, 409);
    assert.equal((await addMembership(accountIds[0])).status, 409);
    const login = await api('/api/auth/login', { method: 'POST',
        body: { username: second.data.credential.username, password: second.data.credential.password } });
    assert.equal(login.status, 200);
    const newActor = { token: login.data.accessToken || login.data.token };
    assert.equal((await api('/api/auth/business-profile', { actor: newActor })).status, 200);
    assert.equal((await api(membershipPath + accountId + '/' + park.id, {
        actor: owner, qaToken: token, requestId: randomUUID(), method: 'DELETE'
    })).status, 200);
    assert.equal((await api('/api/auth/business-profile', { actor: newActor })).status, 403);

    const inventory = await db.query('SELECT entity_type FROM trusted_qa_run_entities WHERE run_id=$1 ORDER BY entity_type', [run.id]);
    assert.deepEqual(inventory.rows.map(row => row.entity_type),
        ['hr_account', 'hr_account', 'hr_membership', 'hr_profile', 'hr_profile', 'hr_staff', 'hr_staff']);
    const cleanup = client => cleanupTrustedQaRun(client, run.id, { forUpdate: true });
    await db.query('INSERT INTO chat_channel_members(channel_id,user_id) VALUES($1,$2)', [channel.id, accountId]);
    await assert.rejects(transaction(cleanup), { code: 'HR_QA_CLEANUP_DRIFT' });
    assert.equal((await db.query('SELECT is_active FROM staff WHERE id=$1', [firstId])).rows[0].is_active, true);
    await db.query('DELETE FROM chat_channel_members WHERE channel_id=$1 AND user_id=$2', [channel.id, accountId]);
    assert.equal((await transaction(cleanup, false)).status, 'cleaned');
    assert.equal((await db.query('SELECT state FROM trusted_qa_runs WHERE id=$1', [run.id])).rows[0].state, 'active');
    const finish = client => finishHrFixtureQaRun(client, plan, planHash);
    await assert.rejects(transaction(client => finishHrFixtureQaRun(client, plan, 'wrong')), { code: 'HR_QA_PLAN_HASH_MISMATCH' });
    await db.query("UPDATE trusted_qa_runs SET created_at=created_at-INTERVAL '20 minutes', expires_at=expires_at-INTERVAL '20 minutes' WHERE id=$1", [run.id]);
    assert.equal((await staffCreate(delegate, token, first.request, first.key)).status, 403);
    assert.equal((await transaction(finish)).status, 'cleaned');
    assert.equal((await transaction(finish)).idempotent, true);
    assert.equal((await api('/api/auth/verify', { actor: newActor })).status, 401);
    assert.equal((await db.query('SELECT position FROM staff WHERE id=$1', [realStaff.id])).rows[0].position, 'Control');
    assert.equal((await staffCreate(delegate, token, first.request, first.key)).status, 403);
});
