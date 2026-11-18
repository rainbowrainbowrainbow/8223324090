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
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
    const output = path.resolve(__dirname, '../../output/baseline-access-actual-browser');
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    const date = '2026-11-18';
    try {
        const creatorToken = await getToken();
        const rootSession = await request('GET', '/api/auth/verify', null, creatorToken);
        const rootId = rootSession.data.user.id;
        const { rows: [organization] } = await db.query(`INSERT INTO organizations (slug, name)
            VALUES ($1, 'Synthetic baseline access QA') RETURNING id`, ['baseline-access-' + crypto.randomUUID()]);
        const modules = ['timeline', 'hr', 'tasks', 'afisha', 'dashboard', 'programs', 'catalogs', 'chat', 'training'];
        const { rows: [business] } = await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules)
            VALUES ($1, 'event_genix', 'Synthetic Park QA', 'Park QA', 'membership', $2::jsonb) RETURNING id`,
        [organization.id, JSON.stringify(modules)]);
        await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role)
            VALUES ($1, $2, 'owner')`, [organization.id, rootId]);
        await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true)`, [organization.id, business.id, rootId]);

        for (const role of ['instructor', 'reception', 'animator', 'hr', 'accountant', 'waiter']) {
            const username = `baseline.${role}.${crypto.randomBytes(4).toString('hex')}`;
            const password = crypto.randomBytes(24).toString('base64url');
            const createdStaff = await request('POST', '/api/staff', {
                name: `Synthetic QA ${role}`, department: 'admin', position: 'Synthetic QA',
                role_type: role === 'instructor' ? 'trampoline_instructor' : role
            }, creatorToken);
            assert.equal(createdStaff.status, 200, `${role}: synthetic staff creation`);
            const created = await request('POST', '/api/users', {
                username, password, name: `Synthetic QA ${role}`, role, staffId: createdStaff.data.data.id,
                businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix', activateMembership: true
            }, creatorToken);
            assert.equal(created.status, 200, `${role}: synthetic account creation`);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200, `${role}: synthetic login`);
            const session = login.data;
            const reads = [];
            for (const [section, endpoint] of [
                ['tasks', '/api/tasks/my-cabinet?planningView=my-day'],
                ['staff', `/api/staff/schedule?from=${date}&to=${date}`],
                ['chat', '/api/chat/channels'], ['afisha', `/api/afisha/${date}`],
                ['training', '/api/training/courses']
            ]) {
                const response = await request('GET', endpoint, null, session.token);
                reads.push({ section, status: response.status, passed: response.status === 200,
                    code: response.data?.code || null });
            }
            for (const width of [1280, 390]) {
                const context = await browser.newContext({ viewport: { width, height: 900 },
                    serviceWorkers: 'block', locale: 'uk-UA', timezoneId: 'Europe/Kyiv' });
                const page = await context.newPage();
                const pageErrors = [];
                page.on('pageerror', error => pageErrors.push(error.name));
                await context.route('https://**/*', route => route.abort());
                await context.addInitScript(session => {
                    localStorage.setItem('pzp_token', session.token);
                    localStorage.setItem('pzp_access_token', session.token);
                    localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                    localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                    localStorage.setItem('eg_sidebar_extra_menu_items_v3', '[]');
                    localStorage.setItem('eg_sidebar_favorites_productivity_merged_v1', 'true');
                }, { token: session.token, user: session.user });
                let uiPassed = false;
                let phase = 'permissions';
                let uiFailure = null;
                try {
                    await page.goto(origin + '/profile', { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => typeof AppState !== 'undefined' && AppState.authPermissions?.pages?.['/staff'] === true);
                    phase = 'own_access_check';
                    await page.locator('#profileWorkAccess summary').click();
                    await page.locator('#profileWorkAccessCheck').focus();
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(() => document.getElementById('profileWorkAccessStatus')?.textContent.includes('підтверджено на час'));
                    assert.equal(await page.locator('#profileWorkAccessResults li').count(), 7);
                    assert.equal(await page.locator('#profileWorkAccessCheck').isEnabled(), true);
                    if (role === 'waiter') await page.locator('#profileWorkAccess').screenshot({ path: path.join(output, `readiness-${width}.png`) });
                    phase = 'schedule_navigation';
                    if (width < 768) await page.locator('#sidebarToggle').click();
                    const schedule = page.locator('#sidebarNav a[href="/staff"]').filter({ visible: true }).first();
                    await schedule.click();
                    await page.waitForURL(url => url.pathname === '/staff');
                    phase = 'schedule_loading';
                    await page.locator('#scheduleWrapper').waitFor({ state: 'visible' });
                    if (width < 768) await page.locator('#sidebarToggle').click();
                    await page.waitForFunction(() => document.getElementById('sidebarNav').getBoundingClientRect().x >= -1);
                    await page.locator('#sidebarNav').evaluate(async element => {
                        await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
                        await document.fonts.ready;
                    });
                    await page.locator('#sidebarNav').screenshot({ path: path.join(output, `${role}-${width}.png`) });
                    uiPassed = true;
                } catch (error) {
                    uiFailure = { phase, error: error.name };
                    if (await page.locator('#sidebarNav').isVisible()) {
                        await page.locator('#sidebarNav').screenshot({ path: path.join(output, `${role}-${width}-blocked.png`) }).catch(() => {});
                    }
                }
                results.push({ role, width, uiPassed, uiFailure, pageErrors, reads });
                fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ isolated: true, results }, null, 2));
                console.log(`${role}-${width}: UI ${uiPassed ? 'passed' : 'blocked at ' + phase}; ${reads.map(read => read.section + ':' + read.status).join(', ')}`);
                await context.close();
            }
        }
        const unmet = results.filter(result => !result.uiPassed || result.reads.some(read => !read.passed));
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ isolated: true, results, unmet: unmet.length }, null, 2));
        assert.equal(unmet.length, 0, `${unmet.length} role/viewport checks have blocked work sections; see sanitized report.`);
        console.log(`Actual-app baseline access passed: ${results.length} role/viewport checks.`);
    } finally {
        await browser.close();
        await db.end();
    }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
