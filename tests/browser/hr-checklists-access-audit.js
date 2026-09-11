'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

// Called by the disposable PostgreSQL runner; no standalone target or credentials.
module.exports = async function auditChecklistAccess({ api, browser, base, db, evidence, fixture }) {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(base);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
    const out = path.resolve(__dirname, '../../output/hr-checklists-quality/access');
    fs.mkdirSync(out, { recursive: true });
    const { key, endpoint, first, staffId } = fixture;
    const snapshot = async () => ({
        template: (await api(`${endpoint}?include_archived=true`)).data,
        progress: (await db.query('SELECT * FROM hr_staff_profession_checklist_progress WHERE staff_id = $1 ORDER BY id', [staffId])).rows
    });
    const initial = await snapshot();
    const item = initial.template.items.find(row => row.itemKey === first.itemKey);
    assert.ok(item && item.isActive, 'the caller provides an active disposable checklist item');
    const activeKeys = initial.template.items.filter(row => row.isActive).map(row => row.itemKey);
    const definitions = [
        { id: 'admin', role: 'admin', page: true, view: true, manage: true },
        { id: 'waiter', role: 'waiter', page: false, view: false, manage: false },
        { id: 'security-denied', role: 'security', page: true, view: false, manage: false, actionDenylist: ['hr.staff.view', 'hr.staff.manage'] },
        { id: 'security', role: 'security', page: true, view: true, manage: false }
    ];
    evidence.accessMatrix = [];
    for (const definition of definitions) {
        const accountStaff = await api('/api/staff', {
            name: `QA Checklist Access ${definition.id}`, department: 'qa', position: 'QA Access', role_type: definition.role
        });
        const credentials = {
            username: `chk_access_${definition.id}_${crypto.randomBytes(5).toString('hex')}`,
            password: crypto.randomBytes(24).toString('base64url')
        };
        await api('/api/users', {
            ...credentials, name: `QA Checklist Access ${definition.id}`, role: definition.role,
            staffId: Number(accountStaff.data.id), extraRoles: [], pageAllowlist: [], pageDenylist: [],
            actionAllowlist: [], actionDenylist: definition.actionDenylist || [],
            businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix'
        });
        const session = await api('/api/auth/login', credentials);
        const token = session.accessToken || session.token;
        assert.ok(token, `${definition.id}: real login token`);
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        const row = { id: definition.id, role: definition.role, page: definition.page, view: definition.view, manage: definition.manage, reads: [], rejectedMutations: [], themes: {} };
        evidence.accessMatrix.push(row);
        try {
            await context.addInitScript(({ session, origin }) => {
                if (location.origin !== origin) return;
                localStorage.setItem('pzp_token', session.accessToken || session.token);
                localStorage.setItem('pzp_access_token', session.accessToken || session.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                if (session.refreshToken) localStorage.setItem('pzp_refresh_token', session.refreshToken);
            }, { session, origin: base });
            await context.route('**/*', route => {
                const url = new URL(route.request().url());
                return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
            });
            const request = (method, route, data) => context.request.fetch(`${base}${route}`, {
                method, ...(data ? { data } : {}), headers: { Authorization: `Bearer ${token}` }
            });
            const permissionsResponse = await request('GET', '/api/auth/permissions');
            assert.equal(permissionsResponse.status(), 200);
            const permissions = await permissionsResponse.json();
            assert.equal(permissions.pages['/hr'], definition.page, `${definition.id}: page permission snapshot`);
            assert.equal(permissions.capabilities['action:hr.staff.view'].allowed, definition.view);
            assert.equal(permissions.capabilities['action:hr.staff.manage'].allowed, definition.manage);
            for (const route of ['/api/hr/checklists/dashboard', endpoint, `/api/hr/professions/${key}/staff/${staffId}/checklist`]) {
                const response = await request('GET', route);
                assert.equal(response.status(), definition.view ? 200 : 403, `${definition.id}: GET ${route}`);
                row.reads.push({ route, status: response.status() });
            }
            if (definition.manage) {
                const response = await request('PUT', `${endpoint}/items/${first.itemKey}`, { title: item.title });
                assert.equal(response.status(), 200, 'non-creator admin can save the existing QA title');
                assert.equal((await snapshot()).template.items.find(entry => entry.itemKey === first.itemKey).title, item.title);
                row.sameTitleRename = 'PASS';
            } else {
                const before = await snapshot();
                for (const [method, route, data] of [
                    ['POST', `${endpoint}/items`, { title: 'QA Forbidden add' }],
                    ['PUT', `${endpoint}/items/${first.itemKey}`, { title: 'QA Forbidden rename' }],
                    ['PUT', `${endpoint}/reorder`, { itemKeys: [...activeKeys].reverse() }],
                    ['PUT', `${endpoint}/items/${first.itemKey}/archive`, {}],
                    ['PUT', `/api/hr/staff/${staffId}/profession-checklist`, { profession_key: key, checklist_key: first.itemKey, completed: false }],
                    ['PUT', `/api/hr/professions/${key}/staff/${staffId}/checklist/${first.itemKey}`, { completed: false }]
                ]) {
                    const response = await request(method, route, data);
                    assert.equal(response.status(), 403, `${definition.id}: ${method} ${route}`);
                    row.rejectedMutations.push({ method, route, status: response.status() });
                }
                assert.deepEqual(await snapshot(), before, `${definition.id}: denied mutations leave the database unchanged`);
                row.databaseUnchanged = 'PASS';
            }
            const page = await context.newPage();
            page.setDefaultTimeout(30_000);
            page.on('pageerror', error => evidence.pageErrors.push(`${definition.id}: ${error.message}`));
            for (const theme of ['light', 'dark']) {
                await page.goto('about:blank');
                await page.goto(`${base}/hr.html#checklists`, { waitUntil: 'domcontentloaded' });
                if (!definition.page) {
                    await page.waitForURL(url => !/^\/hr(?:\.html)?$/.test(url.pathname));
                    row.themes[theme] = { directPageDenied: 'PASS', destination: new URL(page.url()).pathname };
                    continue;
                }
                await page.waitForFunction(() => typeof getPermissionLifecycle === 'function' && getPermissionLifecycle().status === 'ready');
                await page.locator('#mainApp:not(.hidden)').waitFor();
                await page.evaluate(mode => applyCrmThemeMode(mode === 'dark', true), theme);
                assert.deepEqual(await page.evaluate(() => ({ view: canAccess('hr.staff.view'), manage: canAccess('hr.staff.manage') })), { view: definition.view, manage: definition.manage });
                if (!definition.view) {
                    await page.waitForFunction(() => document.querySelector('.hr-tab-content.active')?.id && document.querySelector('.hr-tab-content.active').id !== 'tab-checklists');
                    assert.equal(await page.locator('#hrNav [data-tab="checklists"]').count(), 0);
                    row.themes[theme] = { checklistTabDenied: 'PASS', activeTab: await page.locator('.hr-tab-content.active').getAttribute('id') };
                } else {
                    await page.locator(`[data-checklist-open-profession="${key}"]`).first().click();
                    const titleInput = page.locator('[data-checklist-item-title]').first();
                    await titleInput.waitFor();
                    assert.equal(await titleInput.isEditable(), definition.manage);
                    row.themes[theme] = { templateEditorPermission: 'PASS' };
                    await page.locator('#professionWorkspaceClose').click();
                    if (definition.id === 'security') {
                        const before = await snapshot();
                        await page.evaluate(async id => { await loadTeam(); openStaffTrainingReadiness(id); }, staffId);
                        const completion = page.locator('#staffTrainingReadinessOverlay .hr-training-check-item').filter({ hasText: item.title }).first();
                        await completion.waitFor();
                        const enabled = await completion.isEnabled();
                        row.themes[theme].completionEnabled = enabled;
                        if (enabled) {
                            const responsePromise = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/hr/staff/${staffId}/profession-checklist`);
                            await completion.click();
                            const response = await responsePromise;
                            assert.equal(response.status(), 403, 'readonly completion is rejected by the real server');
                            evidence.findings.push({ id: 'CHK-Q-READONLY-COMPLETION', theme, role: 'security', expected: 'disabled completion controls and no attempted write', actual: 'enabled completion button attempts PUT; server returns 403', source: 'js/hr-page.js:7099,7175' });
                            row.themes[theme].completionRejectedStatus = response.status();
                        }
                        assert.deepEqual(await snapshot(), before, 'readonly completion cannot change stored progress');
                    }
                }
                await page.screenshot({ path: path.join(out, `access-${definition.id}-${theme}.png`), animations: 'disabled' });
            }
        } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(out, 'runtime-matrix.json'), JSON.stringify(evidence.accessMatrix, null, 2) + '\n');
};
