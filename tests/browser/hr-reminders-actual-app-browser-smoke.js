'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { requirePlaywright } = require('./hr-team-browser-smoke');

async function run() {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const origin = new URL(process.env.TEST_URL).origin;
    assertSafeIsolatedTestUrl(origin);
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST));
    assert.match(process.env.PGDATABASE, /(?:^|[_-])(?:test|disposable|ci)(?:[_-]|$)/);
    assert.equal(process.env.DATABASE_URL, '');
    const output = path.resolve(__dirname, '../../output/playwright/hr-reminders-actual');
    fs.mkdirSync(output, { recursive: true });
    const api = async (url, { token, body } = {}) => {
        const response = await fetch(origin + url, {
            method: body ? 'POST' : 'GET',
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        assert.ok(response.ok, `${url} returned HTTP ${response.status}`);
        return response.json();
    };
    const login = (username, password) => api('/api/auth/login', { body: { username, password } });
    const admin = await login(process.env.TEST_USER, process.env.TEST_PASS);
    const marker = crypto.randomBytes(6).toString('hex');
    const username = `hr_reminder_${marker}`;
    const password = `Safe-${crypto.randomBytes(18).toString('base64url')}`;
    await api('/api/users', { token: admin.token, body: {
        username, password, name: 'HR browser fixture', role: 'waiter',
        businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix'
    } });
    const session = await login(username, password);
    const db = new Client();
    await db.connect();
    let browser;
    try {
        const staff = (await db.query(`
            INSERT INTO staff (name, department, position) VALUES ('HR browser fixture', 'Fixture', 'Fixture') RETURNING id
        `)).rows[0];
        await db.query('INSERT INTO employee_profiles (user_id, staff_id, full_name) VALUES ($1,$2,$3)',
            [session.user.id, staff.id, 'HR browser fixture']);
        const title = `Тестове майно ${marker}`;
        const assignment = (await db.query(`
            INSERT INTO staff_resource_assignments (staff_id, title, due_return_at, business_context)
            VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Kyiv')::date - 1, 'event_genix')
            RETURNING id, due_return_at::text AS due_date`, [staff.id, title])).rows[0];
        browser = await requirePlaywright().chromium.launch();
        for (const [width, dark] of [[1366, false], [390, true]]) {
            const context = await browser.newContext({
                viewport: { width, height: 850 },
                serviceWorkers: 'block',
                storageState: { cookies: [], origins: [{ origin, localStorage: Object.entries({
                    pzp_token: session.token, pzp_access_token: session.token,
                    pzp_current_user: JSON.stringify(session.user),
                    pzp_crm_business_context: 'event_genix', pzp_dark_mode: String(dark)
                }).map(([name, value]) => ({ name, value })) }] }
            });
            try {
                await context.route('**/*', route => new URL(route.request().url()).origin === origin
                    ? route.continue() : route.fulfill({ status: 204, body: '' }));
                const page = await context.newPage();
                await page.goto(origin + '/staff', { waitUntil: 'commit', timeout: 60000 });
                await page.locator('#focusChipAlerts').waitFor({ state: 'attached', timeout: 60000 });
                if (width < 640 && !await page.locator('#focusChipAlerts').isVisible()) {
                    await page.locator('#sidebarToggle').click({ timeout: 30000 });
                }
                await page.locator('#focusChipAlerts').click({ timeout: 60000 });
                await page.locator('#alertsPanel.open .ap-item-main').filter({ hasText: title }).click({ timeout: 45000 });
                const reminder = page.locator('#hr-personal-reminders').filter({ hasText: title });
                await reminder.waitFor({ state: 'visible', timeout: 45000 });
                assert.equal(await reminder.locator('time').getAttribute('datetime'), assignment.due_date);
                assert.match(await reminder.innerText(), /Прострочено/);
                try {
                    await page.waitForFunction(() => {
                        const block = document.getElementById('hr-personal-reminders')?.getBoundingClientRect();
                        return block && block.top >= -1 && block.bottom <= innerHeight + 1
                            && block.left >= -1 && block.right <= innerWidth + 1;
                    }, null, { timeout: 10000 });
                } catch (error) {
                    await page.screenshot({ path: path.join(output, `viewport-failure-${width}.png`) });
                    throw error;
                }
                await page.screenshot({ path: path.join(output, `reminders-${width}-${dark ? 'dark' : 'light'}.png`) });
                if (dark) {
                    await db.query("UPDATE staff_resource_assignments SET status = 'returned' WHERE id = $1", [assignment.id]);
                    await page.reload({ waitUntil: 'commit', timeout: 60000 });
                    const cabinet = await api('/api/tasks/my-cabinet', { token: session.token });
                    assert.deepEqual(cabinet.hrReminders, []);
                    await page.locator('#cabinetMyDaySegmentPanel').waitFor({ state: 'visible', timeout: 45000 });
                    assert.equal(await page.locator('#hr-personal-reminders').count(), 0);
                }
            } finally {
                await context.close();
            }
        }
        console.log('HR reminders actual app browser passed (PostgreSQL, desktop light and mobile dark).');
    } finally {
        await browser?.close();
        await db.end();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
