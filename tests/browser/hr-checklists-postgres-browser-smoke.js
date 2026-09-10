#!/usr/bin/env node
'use strict';

// Run with cached Playwright and --isolated; the existing runner owns schema reset.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');
const OUT = path.resolve(__dirname, '../../output/playwright/hr-checklists/postgres');

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]\.bin$/i.test(normalized)) continue;
        const candidate = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(candidate)) return require(candidate);
    }
    throw new Error('Use npm exec --offline --package=playwright to provide the existing browser runtime');
}

async function run() {
    if (process.argv.includes('--isolated')) {
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true, 'Checklists QA requires loopback PostgreSQL');
        const lock = await acquireIsolatedDatabaseLock(target);
        try {
            await runSuite(target, 'tests/browser/hr-checklists-postgres-browser-smoke.js', 'hr-checklists');
        } finally { await lock.release(); }
        return;
    }
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    assert.ok(process.env.TEST_USER && process.env.TEST_PASS);
    const base = new URL(process.env.TEST_URL).origin;
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString(), max: 1, ssl: false });
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    const evidence = { target: 'disposable loopback Express/PostgreSQL', themes: {}, apiFailures: [], pageErrors: [] };
    fs.mkdirSync(OUT, { recursive: true });
    let token;
    let page;
    const api = async (route, body, method = body ? 'POST' : 'GET') => {
        const response = await fetch(`${base}${route}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30_000)
        });
        assert.ok(response.ok, `${method} ${route}: HTTP ${response.status}`);
        return response.json();
    };
    try {
        const session = await api('/api/auth/login', { username: process.env.TEST_USER, password: process.env.TEST_PASS });
        token = session.accessToken || session.token;
        assert.ok(token);
        const fixtures = {};
        for (const theme of ['light', 'dark']) {
            const key = `chk_qa_${theme}`;
            const endpoint = `/api/hr/professions/${key}/checklist`;
            await api('/api/hr/professions', { key, title: `QA Checklist ${theme}`, department: 'qa' });
            const staff = await api('/api/staff', { name: `QA Checklist Person ${theme}`, department: 'qa', position: 'QA Checklist', role_type: key });
            const staffId = Number(staff.data.id);
            await api(`/api/hr/staff/${staffId}/role-assignments`, {
                assignments: [{ profession_key: key, is_primary: true, status: 'active' }]
            }, 'PUT');
            const first = (await api(`${endpoint}/items`, { title: 'QA First item' })).data.item;
            const second = (await api(`${endpoint}/items`, { title: 'QA Second item' })).data.item;
            fixtures[theme] = { key, endpoint, staffId, first, second };
        }
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        await context.addInitScript(({ session, base }) => {
            if (location.origin !== base) return;
            localStorage.setItem('pzp_token', session.accessToken || session.token);
            localStorage.setItem('pzp_access_token', session.accessToken || session.token);
            localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
            if (session.refreshToken) localStorage.setItem('pzp_refresh_token', session.refreshToken);
            if (session.refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(session.refreshExpiresAt));
        }, { session, base });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
            return route.abort();
        });
        page = await context.newPage();
        page.setDefaultTimeout(30_000);
        page.on('pageerror', error => evidence.pageErrors.push(error.message));
        page.on('response', response => {
            const url = new URL(response.url());
            if (url.origin === base && url.pathname.startsWith('/api/hr/') && response.status() >= 400) {
                evidence.apiFailures.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
            }
        });
        const waitApi = (method, suffix) => page.waitForResponse(response =>
            response.request().method() === method && new URL(response.url()).pathname.endsWith(suffix));
        const mutate = async (method, suffix, action) => {
            const [response] = await Promise.all([waitApi(method, suffix), action()]);
            assert.ok(response.ok(), `${method} ${suffix}`);
            await page.waitForFunction(() => document.querySelector('#professionWorkspaceChecklistState')?.dataset.state === 'saved');
        };
        const close = async () => {
            await page.locator('#professionWorkspaceClose').click();
            await page.locator('#professionWorkspaceOverlay').waitFor({ state: 'hidden' });
        };
        for (const theme of ['light', 'dark']) {
            console.log(`[checklists-postgres] ${theme}: real template mutations and reload`);
            const { key, endpoint, staffId, first, second } = fixtures[theme];
            const checkTheme = () => page.waitForFunction(dark =>
                document.body.classList.contains('dark-mode') === dark
                && document.documentElement.dataset.theme === (dark ? 'dark' : 'light'), theme === 'dark');
            const open = async () => {
                await page.locator(`[data-checklist-open-profession="${key}"]`).first().click();
                await page.locator('[data-checklist-item-title]').first().waitFor();
            };
            await page.goto('about:blank');
            await page.goto(`${base}/hr.html#checklists`, { waitUntil: 'domcontentloaded' });
            await page.locator('#mainApp:not(.hidden)').waitFor();
            const [filtered] = await Promise.all([
                waitApi('GET', '/checklists/dashboard'),
                page.locator('#professionChecklistDashboardProfession').selectOption(key)
            ]);
            assert.ok(filtered.ok());
            await page.locator(`[data-checklist-open-profession="${key}"]`).first().waitFor();
            await page.evaluate(mode => applyCrmThemeMode(mode === 'dark', true), theme);
            await checkTheme();
            await page.screenshot({ path: path.join(OUT, `dashboard-${theme}.png`), animations: 'disabled' });
            await open();
            const title = page.locator(`[data-checklist-item-key="${first.itemKey}"] [data-checklist-item-title]`);
            await title.fill(`QA Renamed ${theme}`);
            await mutate('PUT', `/items/${first.itemKey}`, () => title.press('Enter'));
            await close();
            await open();
            assert.equal(await page.locator('#professionWorkspaceChecklistState').innerText(), '', 'saved status clears on same-profession reopen');
            assert.equal(await title.inputValue(), `QA Renamed ${theme}`, 'resetting UI status preserves persisted title');
            await title.fill('');
            await title.press('Enter');
            assert.equal(await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state'), 'error');
            await close();
            const otherKey = fixtures[theme === 'light' ? 'dark' : 'light'].key;
            await page.locator('#professionChecklistDashboardProfession').selectOption(otherKey);
            await page.locator(`[data-checklist-open-profession="${otherKey}"]`).first().click();
            await page.locator('#professionWorkspaceContent').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#professionWorkspaceChecklistState').innerText(), '', 'previous error does not leak into another profession');
            assert.equal(await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state'), '');
            await close();
            await page.locator('#professionChecklistDashboardProfession').selectOption(key);
            await open();
            assert.equal(await title.inputValue(), `QA Renamed ${theme}`, 'rejected empty title was not persisted');
            await page.locator('#professionWorkspaceChecklistNewTitle').fill('QA Added item');
            await mutate('POST', '/checklist/items', () => page.locator('#professionWorkspaceChecklistAddButton').click());
            await mutate('PUT', '/checklist/reorder', () => page.locator(`[data-checklist-item-key="${first.itemKey}"] [data-checklist-item-action="down"]`).click());
            await page.locator(`[data-checklist-item-key="${second.itemKey}"] [data-checklist-item-action="archive"]`).click();
            await page.locator('.confirm-cancel').click();
            assert.equal((await api(endpoint)).data.items.length, 3, 'cancel preserves all items');
            await page.locator(`[data-checklist-item-key="${second.itemKey}"] [data-checklist-item-action="archive"]`).click();
            await mutate('PUT', `/items/${second.itemKey}/archive`, () => page.locator('.confirm-ok').click());
            await close();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await open();
            await checkTheme();
            assert.equal(await title.inputValue(), `QA Renamed ${theme}`);
            assert.equal(await page.locator('[data-checklist-item-title]').count(), 2);
            await page.locator('#professionWorkspaceChecklistShowArchived').check();
            assert.equal(await page.locator('.hr-checklist-template-item.is-archived input').inputValue(), 'QA Second item');
            const persisted = await db.query(`SELECT item.item_key, item.title, item.is_active, item.sort_order
                FROM hr_profession_checklist_items item JOIN hr_professions profession ON profession.id = item.profession_id
                WHERE profession.key = $1 ORDER BY item.sort_order, item.id`, [key]);
            assert.equal(persisted.rows.length, 3);
            assert.equal(persisted.rows.find(row => row.item_key === first.itemKey).title, `QA Renamed ${theme}`);
            assert.equal(persisted.rows.find(row => row.item_key === second.itemKey).is_active, false);
            assert.ok(persisted.rows.find(row => row.item_key === second.itemKey).sort_order < persisted.rows.find(row => row.item_key === first.itemKey).sort_order);
            await page.screenshot({ path: path.join(OUT, `editor-reloaded-${theme}.png`), animations: 'disabled' });
            await close();
            console.log(`[checklists-postgres] ${theme}: staff completion UI and database read-back`);
            // Existing public dialog entry point; data still loads through real HR routes.
            await page.evaluate(async id => { await loadTeam(); openStaffTrainingReadiness(id); }, staffId);
            const completion = page.locator('#staffTrainingReadinessOverlay .hr-training-check-item').filter({ hasText: `QA Renamed ${theme}` });
            const toggled = waitApi('PUT', `/staff/${staffId}/profession-checklist`);
            await completion.click();
            assert.ok((await toggled).ok());
            await page.locator('#staffTrainingReadinessOverlay .hr-training-check-item.is-done').filter({ hasText: `QA Renamed ${theme}` }).waitFor();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.locator('#mainApp:not(.hidden)').waitFor();
            await checkTheme();
            await page.evaluate(async id => { await loadTeam(); openStaffTrainingReadiness(id); }, staffId);
            await page.locator('#staffTrainingReadinessOverlay .hr-training-check-item.is-done').filter({ hasText: `QA Renamed ${theme}` }).waitFor();
            const progress = await db.query('SELECT completed_at FROM hr_staff_profession_checklist_progress WHERE staff_id = $1 AND checklist_item_id = $2', [staffId, first.id]);
            assert.ok(progress.rows[0]?.completed_at, 'completion persists in PostgreSQL');
            await page.screenshot({ path: path.join(OUT, `completion-reloaded-${theme}.png`), animations: 'disabled' });
            await page.locator('#staffTrainingReadinessOverlay .candidate-detail-close').click();
            await page.locator('#staffTrainingReadinessOverlay').waitFor({ state: 'detached' });
            evidence.themes[theme] = { templateReload: 'PASS', cancel: 'PASS', renameAddReorderArchive: 'PASS', databaseReadBack: 'PASS', completionReload: 'PASS', statusResetSameAndOtherProfession: 'PASS' };
        }
        console.log('[checklists-postgres] security: real readonly UI and rejected mutations');
        const readerStaff = await api('/api/staff', {
            name: 'QA Checklist Reader', department: 'qa', position: 'QA Reader', role_type: 'security'
        });
        const readerCredentials = { username: `chk_reader_${Date.now()}`, password: crypto.randomBytes(24).toString('base64url') };
        await api('/api/users', { ...readerCredentials, name: 'QA Checklist Reader', role: 'security', staffId: Number(readerStaff.data.id) });
        const readerSession = await api('/api/auth/login', readerCredentials);
        const readerContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        try {
            await readerContext.addInitScript(({ session, base }) => {
                if (location.origin !== base) return;
                localStorage.setItem('pzp_token', session.accessToken || session.token);
                localStorage.setItem('pzp_access_token', session.accessToken || session.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                if (session.refreshToken) localStorage.setItem('pzp_refresh_token', session.refreshToken);
            }, { session: readerSession, base });
            await readerContext.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
            const readerPage = await readerContext.newPage();
            readerPage.setDefaultTimeout(30_000);
            readerPage.on('pageerror', error => evidence.pageErrors.push(error.message));
            const { key, endpoint, first, staffId } = fixtures.light;
            evidence.readonly = { role: 'security', themes: {}, rejectedMutations: [] };
            for (const theme of ['light', 'dark']) {
                await readerPage.goto('about:blank');
                await readerPage.goto(`${base}/hr.html#checklists`, { waitUntil: 'domcontentloaded' });
                await readerPage.locator('#mainApp:not(.hidden)').waitFor();
                await readerPage.locator(`[data-checklist-open-profession="${key}"]`).first().waitFor();
                assert.deepEqual(await readerPage.evaluate(() => ({ view: canAccess('hr.staff.view'), manage: canAccess('hr.staff.manage') })), { view: true, manage: false });
                await readerPage.evaluate(mode => applyCrmThemeMode(mode === 'dark', true), theme);
                await readerPage.locator(`[data-checklist-open-profession="${key}"]`).first().click();
                const input = readerPage.locator('[data-checklist-item-title]').first();
                await input.waitFor();
                assert.equal(await input.isEditable(), false);
                assert.equal(await readerPage.locator('[data-checklist-item-action]').count(), 0);
                assert.equal(await readerPage.locator('#professionWorkspaceChecklistAdd').isVisible(), false);
                await readerPage.locator('#professionWorkspaceChecklistShowArchived').check();
                assert.equal(await readerPage.locator('.hr-checklist-template-item.is-archived').count(), 1);
                await readerPage.screenshot({ path: path.join(OUT, `readonly-security-${theme}.png`), animations: 'disabled' });
                evidence.readonly.themes[theme] = 'PASS';
            }
            const snapshot = async () => ({
                template: (await api(`${endpoint}?include_archived=true`)).data,
                progress: (await db.query('SELECT * FROM hr_staff_profession_checklist_progress WHERE staff_id = $1 ORDER BY id', [staffId])).rows
            });
            const before = await snapshot();
            const activeKeys = before.template.items.filter(item => item.isActive).map(item => item.itemKey);
            const requests = [
                ['POST', `${endpoint}/items`, { title: 'QA Forbidden add' }],
                ['PUT', `${endpoint}/items/${first.itemKey}`, { title: 'QA Forbidden rename' }],
                ['PUT', `${endpoint}/reorder`, { itemKeys: activeKeys.reverse() }],
                ['PUT', `${endpoint}/items/${first.itemKey}/archive`, {}],
                ['PUT', `/api/hr/staff/${staffId}/profession-checklist`, { profession_key: key, checklist_key: first.itemKey, completed: false }]
            ];
            for (const [method, route, data] of requests) {
                const response = await readerContext.request.fetch(`${base}${route}`, {
                    method, data, headers: { Authorization: `Bearer ${readerSession.accessToken || readerSession.token}` }
                });
                assert.equal(response.status(), 403, `${method} ${route} denies readonly role`);
                evidence.readonly.rejectedMutations.push({ method, route, status: response.status() });
            }
            assert.deepEqual(await snapshot(), before, 'rejected writes preserve PostgreSQL template and completion');
            evidence.readonly.databaseUnchanged = 'PASS';
        } finally { await readerContext.close(); }
        assert.deepEqual(evidence.apiFailures, []);
        assert.deepEqual(evidence.pageErrors, []);
        evidence.status = 'PASS';
    } catch (error) {
        evidence.status = 'FAIL';
        evidence.failure = error.message;
        if (page) await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
        throw error;
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(evidence, null, 2));
        await browser.close();
        await db.end();
    }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
