'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function runHrCrmExtendedAudit({ browser, pool, actors, login, target, output, runId }) {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.PLAYWRIGHT_CHROMIUM_FULL_EXECUTABLE_PATH, 'Full Chromium is required for native browser zoom');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-hr-native-zoom-'));
    const extension = path.join(temporary, 'extension');
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3,
        name: 'Local HR native zoom verification', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
    fs.writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    const context = await browser.browserType().launchPersistentContext(path.join(temporary, 'profile'), {
        headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_FULL_EXECUTABLE_PATH,
        viewport: { width: 1366, height: 768 }, serviceWorkers: 'allow',
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const directory = path.join(output, 'ux-matrix');
    fs.mkdirSync(directory, { recursive: true });
    const evidence = [];
    try {
        const actor = actors.find(row => row.role === 'creator');
        const session = await login(actor.username, actor.password);
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const cases = ['light', 'dark'].flatMap(theme => [
            { theme, mode: 'existing', width: 390, height: 844, zoom: 1, advanced: true },
            { theme, mode: 'existing', width: 1366, height: 768, zoom: 2 },
            { theme, mode: 'center', width: 1366, height: 768, zoom: 2 }
        ]);
        for (const scenario of cases) {
            const { width, height, theme, mode, zoom, advanced } = scenario;
            const key = `extended-${width}-${theme}-${mode}-${zoom}`;
            const name = `Назар Коваль (демо ${key})`;
            const username = `uxext_${runId}_${evidence.length}`;
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.setDefaultTimeout(20000);
            await page.setViewportSize({ width, height });
            await page.addInitScript(({ session, theme }) => {
                localStorage.setItem('pzp_token', session.accessToken || session.token);
                localStorage.setItem('pzp_access_token', session.accessToken || session.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
                localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                localStorage.setItem('pzp_dark_mode', theme === 'dark' ? 'true' : 'false');
            }, { session, theme });
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
            const record = { key, role: 'creator', mode, width, height, theme, zoom, screens: [], checks: [] };
            const viewportCapture = zoom > 1 ? await context.newCDPSession(page) : null;
            const credentialMask = '#accountOnboardingPassword[type="text"], #accountOnboardingReceipt .hr-account-credential code:nth-of-type(2)';
            const capture = async label => {
                const filename = `${key}-${label}.png`;
                const destination = path.join(directory, filename);
                if (viewportCapture) {
                    // Capture the browser surface without Playwright's document clip at native zoom.
                    const mask = await page.addStyleTag({ content: credentialMask + ' { visibility: hidden !important; }' });
                    try {
                        const { data } = await viewportCapture.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
                        fs.writeFileSync(destination, Buffer.from(data, 'base64'));
                    } finally {
                        await mask.evaluate(element => element.remove());
                    }
                } else {
                    await page.screenshot({ path: destination, mask: [page.locator(credentialMask)] });
                }
                record.screens.push(filename);
            };
            try {
                let staffId;
                {
                    const { rows: [person] } = await pool.query(`INSERT INTO staff (name, department, position, role_type, hourly_rate)
                        VALUES ($1, 'Анімація', 'Аніматор', 'animator', 123) RETURNING id`, [name]);
                    staffId = person.id;
                }
                await page.goto(new URL('/hr?tab=team', target).href);
                await page.locator('.hr-team-card').first().waitFor();
                await page.waitForFunction(() => canRunAccountOnboarding());
                const actualZoom = await worker.evaluate(async ({ origin, zoom }) => {
                    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin));
                    await chrome.tabs.setZoom(tab.id, zoom);
                    return chrome.tabs.getZoom(tab.id);
                }, { origin: new URL(target).origin, zoom });
                assert.equal(actualZoom, zoom);
                await page.waitForFunction(({ width, zoom }) => Math.abs(innerWidth - width / zoom) <= 1, { width, zoom });
                record.checks.push(`native browser zoom ${zoom * 100}%`);
                if (mode === 'existing') {
                    // First and last cards cover right/bottom clipping after page scrolling.
                    for (const edge of ['first', 'last']) {
                        const triggers = page.locator('.hr-team-overflow-trigger');
                        const trigger = edge === 'first' ? triggers.first() : triggers.last();
                        await trigger.click();
                        const menu = page.locator('[data-team-card-menu].is-open');
                        assert.equal(await menu.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
                        }), true);
                        await menu.locator('button').last().scrollIntoViewIfNeeded();
                        assert.equal(await menu.locator('button').last().evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return el.contains(document.elementFromPoint(rect.left + 8, rect.top + rect.height / 2));
                        }), true);
                        await capture(`menu-${edge}`);
                        await page.keyboard.press('Escape');
                        assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
                    }
                    await page.locator('#teamSearch').fill(name);
                    await page.locator(`.hr-team-card[data-staff-id="${staffId}"]`).getByRole('button', { name: /відкрити/i }).click();
                    if (advanced) {
                        for (const tab of ['main', 'work', 'training', 'payroll', 'resources', 'offboarding', 'history']) {
                            await page.evaluate(tab => activateStaffProfileTab(tab), tab);
                            assert.deepEqual(await page.evaluate(() => staffProfileDirtyScopes()), [], `Read-only ${tab} must not create a draft`);
                            await capture(`profile-${tab}`);
                        }
                        await page.evaluate(() => activateStaffProfileTab('main'));
                    }
                    await page.locator('#staffEditModal').getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).click();
                } else {
                    await page.evaluate(() => activateHrTab('accounts'));
                    await page.locator('#accountCreateBtn').click();
                }
                const overlay = page.locator('#accountOnboardingOverlay');
                await overlay.waitFor({ state: 'visible' });
                if (mode === 'center') await page.locator('#accountOnboardingStaffId').selectOption(String(staffId));
                await page.locator('#accountOnboardingUsername').fill(username);
                const payload = await page.evaluate(() => buildAccountOnboardingPayload());
                assert.equal(payload.deriveRoleFromStaff, true);
                assert.deepEqual(Object.keys(payload.access), ['activateMembership']);
                assert.equal(Object.hasOwn(payload, 'professions'), false);
                assert.equal(Object.hasOwn(payload, 'conditions'), false);
                const submit = page.locator('#accountOnboardingSubmit');
                assert.equal(await submit.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.bottom <= innerHeight && rect.right <= innerWidth && el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
                }), true);
                await capture('account');
                await submit.focus();
                await page.keyboard.press('Tab');
                assert.equal(await page.locator('#accountOnboardingClose').evaluate(el => el === document.activeElement), true);
                await page.keyboard.press('Shift+Tab');
                assert.equal(await submit.evaluate(el => el === document.activeElement), true);
                const [response] = await Promise.all([
                    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/users/onboarding'),
                    page.keyboard.press('Enter')
                ]);
                const result = await response.json();
                assert.equal(response.status(), 200, result.code);
                if (staffId) {
                    assert.equal(result.receipt.staff.id, staffId);
                    assert.equal((await pool.query('SELECT hourly_rate FROM staff WHERE id=$1', [staffId])).rows[0].hourly_rate, '123.00');
                }
                await page.locator('[data-account-onboarding-finish]').waitFor();
                await capture('result');
                await page.keyboard.press('Escape');
                await overlay.waitFor({ state: 'hidden' });
                assert.equal(await page.evaluate(() => document.activeElement !== document.body && document.activeElement.getClientRects().length > 0), true);
                assert.deepEqual(errors, []);
                record.checks.push('keyboard wrap/Enter/Escape/focus return', 'visible primary action');
                if (staffId) record.checks.push('edge menus', 'same staff/base rate');
                evidence.push(record);
                fs.writeFileSync(path.join(directory, 'extended-evidence.json'), JSON.stringify(evidence, null, 2));
                process.stdout.write(`[hr-ux-extended] ${key} passed\n`);
            } catch (error) {
                await capture('failure');
                throw error;
            } finally { await page.close(); }
        }
    } finally { await context.close(); }
    return evidence;
}

module.exports = { runHrCrmExtendedAudit };
