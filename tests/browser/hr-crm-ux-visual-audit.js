'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Runs only inside the existing disposable PostgreSQL browser runner.
async function runHrCrmVisualAudit({ browser, pool, actors, login, target, output, runId }) {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const directory = path.join(output, 'ux-matrix');
    fs.mkdirSync(directory, { recursive: true });
    const evidence = [];
    const viewports = [[360, 800], [390, 844], [768, 1024], [1366, 768], [1920, 1080]];
    for (const actor of actors.filter(row => row.role === 'creator' || row.parkWorker)) {
        const session = await login(actor.username, actor.password);
        for (const [width, height] of viewports) for (const theme of ['light', 'dark']) {
            const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
            await context.addInitScript(({ session, theme }) => {
                localStorage.setItem('pzp_token', session.accessToken || session.token);
                localStorage.setItem('pzp_access_token', session.accessToken || session.token);
                localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
                localStorage.setItem('pzp_crm_business_context_user', String(session.user.id));
                localStorage.setItem('pzp_dark_mode', theme === 'dark' ? 'true' : 'false');
            }, { session, theme });
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
            try {
                for (const mode of ['existing', 'new']) {
                    const key = `${actor.label}-${width}-${theme}-${mode}`;
                    const name = `Олена Коваль (демо ${key})`;
                    const username = `ux_${runId}_${evidence.length}_${mode}`;
                    let existingId;
                    if (mode === 'existing') {
                        const { rows: [person] } = await pool.query(`INSERT INTO staff
                            (name, department, position, role_type, hourly_rate)
                            VALUES ($1, 'Анімація', 'Аніматор', 'animator', 123) RETURNING id`, [name]);
                        existingId = person.id;
                    }
                    await page.goto(new URL('/hr?tab=team', target).href);
                    await page.waitForFunction(() => document.getElementById('hrCreateStaffForm')?.dataset.bound === 'true');
                    await page.locator('.hr-team-card').first().waitFor({ state: 'visible' });
                    await page.waitForFunction(() => canRunAccountOnboarding());
                    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
                    const record = { key, role: actor.role, mode, width, height, theme, screens: [], checks: [] };
                    const capture = async label => {
                        const filename = `${key}-${label}.png`;
                        await page.screenshot({ path: path.join(directory, filename), fullPage: false,
                            mask: [page.locator('#accountOnboardingReceipt .hr-account-credential code:nth-of-type(2)')] });
                        record.screens.push(filename);
                    };
                    if (mode === 'existing') {
                        await page.locator('#teamSearch').fill(name);
                        const card = page.locator(`.hr-team-card[data-staff-id="${existingId}"]`);
                        await card.getByRole('button', { name: /відкрити/i }).click();
                        const profile = page.locator('#staffEditModal');
                        await profile.getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).waitFor();
                        await capture('profile');
                        await profile.getByRole('button', { name: 'Створити CRM-акаунт', exact: true }).click();
                    } else {
                        // The role's entry point is tested separately by runActor.
                        // This matrix exercises the canonical new-person wizard itself.
                        if (actor.role === 'creator') {
                            await page.evaluate(() => activateHrTab('accounts'));
                            await page.locator('#accountCreateBtn').click();
                        } else {
                            await page.evaluate(() => openAccountOnboardingWizard(null));
                        }
                    }
                    const overlay = page.locator('#accountOnboardingOverlay');
                    await overlay.waitFor({ state: 'visible' });
                    const next = page.locator('#accountOnboardingNext');
                    const assertLayout = async () => {
                        const result = await overlay.evaluate(root => {
                            const button = root.querySelector('#accountOnboardingSubmit:not(.hidden)') || root.querySelector('#accountOnboardingNext');
                            const rect = button.getBoundingClientRect();
                            const form = root.querySelector('#accountOnboardingForm');
                            return { horizontalOverflow: form.scrollWidth > form.clientWidth + 1,
                                actionInViewport: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
                                actionReachable: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
                                touchHeight: rect.height >= 44 };
                        });
                        assert.deepEqual(result, { horizontalOverflow: false, actionInViewport: true, actionReachable: true, touchHeight: true }, key);
                    };
                    const measureContrast = async selector => overlay.evaluate((root, selector) => {
                        const rgba = value => {
                            const numbers = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
                            return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
                        };
                        const luminance = color => color.slice(0, 3).map(value => {
                            const channel = value / 255;
                            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
                        }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
                        return [...root.querySelectorAll(selector)].filter(el => el.getClientRects().length).map(el => {
                            const ancestors = [];
                            for (let parent = el; parent; parent = parent.parentElement) ancestors.unshift(parent);
                            let background = [255, 255, 255];
                            for (const parent of ancestors) {
                                const color = rgba(getComputedStyle(parent).backgroundColor);
                                background = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
                            }
                            const color = rgba(getComputedStyle(el).color);
                            const foreground = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
                            const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
                            return { text: el.textContent.trim(), ratio: (values[1] + .05) / (values[0] + .05) };
                        });
                    }, selector);
                    if (mode === 'new') {
                        await next.click();
                        assert.match(await page.locator('#accountOnboardingStatus').textContent(), /ім’я/);
                        assert.equal(await page.locator('#accountOnboardingName').evaluate(el => el === document.activeElement), true);
                        await capture('validation');
                        await page.locator('#accountOnboardingName').fill(name);
                        await page.locator('#accountOnboardingPhone').fill(`+38000${String(evidence.length).padStart(7, '0')}`);
                        await page.locator('#accountOnboardingDepartment').fill('Анімація');
                        await page.locator('#accountOnboardingPosition').fill('Аніматор');
                        await page.locator('#accountOnboardingProfession-animator').check();
                        await page.locator('#accountOnboardingPrimaryProfession-animator').check();
                        await assertLayout();
                        record.contrast = await measureContrast('.hr-account-profession-copy strong, .hr-account-profession-copy small, .hr-account-primary-label');
                        assert.ok(record.contrast.every(item => item.ratio >= 4.5), JSON.stringify(record.contrast));
                        await capture('professions');
                        await page.locator('#accountOnboardingForm').evaluate(el => { el.scrollTop = 0; });
                        await capture('person');
                        await next.click();
                    }
                    await page.locator('#accountOnboardingUsername').fill(username);
                    await assertLayout();
                    await capture('account');
                    await next.click();
                    await page.locator('[data-account-onboarding-step="5"]').waitFor({ state: 'visible' });
                    const roleSelect = page.locator('#accountOnboardingRole');
                    if (!actor.parkWorker && width === 1366) {
                        await roleSelect.selectOption('director');
                        const businesses = page.locator('#accountOnboardingBusinesses');
                        assert.equal(await businesses.isVisible(), true);
                        await businesses.locator('input[value="dar"]').check();
                        await page.locator('#accountOnboardingDefaultBusiness').selectOption('dar');
                        const access = await page.evaluate(() => buildAccountOnboardingPayload().access);
                        assert.ok(access.businessContexts.includes('dar'));
                        assert.equal(access.defaultBusinessContext, 'dar');
                        await capture('multiple-businesses');
                    }
                    await roleSelect.selectOption('animator');
                    record.contrast = [...(record.contrast || []), ...await measureContrast('.hr-account-eyebrow, .hr-account-preset-grid button strong, .hr-account-preset-grid button small, [data-account-onboarding-step="5"] .hr-account-onboarding-panel-head p, #accountOnboardingBusinesses > label:not(.is-disabled)')];
                    assert.ok(record.contrast.every(item => item.ratio >= 4.5), JSON.stringify(record.contrast));
                    await assertLayout();
                    assert.equal(await page.locator('#accountOnboardingSingleBusiness').isVisible(), true);
                    assert.equal(await page.locator('#accountOnboardingBusinessChoices').isVisible(), false);
                    assert.equal(await page.locator('#accountOnboardingDefaultBusinessField').isVisible(), false);
                    assert.match(await page.locator('#accountOnboardingSingleBusiness').innerText(), /Парк/);
                    await capture('access');
                    await page.locator('#accountOnboardingBack').click();
                    assert.equal(await page.locator('#accountOnboardingUsername').inputValue(), username);
                    await next.click();
                    await next.click();
                    await assertLayout();
                    const review = await page.locator('#accountOnboardingReview').innerText();
                    assert.match(review, /Результат.*Парк/is);
                    assert.doesNotMatch(review, /event_genix|0 дод\. ролей|не змінювати наявні умови/);
                    await capture('review');
                    const [response] = await Promise.all([
                        page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/users/onboarding'),
                        page.locator('#accountOnboardingSubmit').click()
                    ]);
                    const result = await response.json();
                    assert.equal(response.status(), 200, `${key}: ${result.code || ''}`);
                    assert.equal(result.receipt.staff.created, mode === 'new');
                    if (existingId) {
                        assert.equal(result.receipt.staff.id, existingId);
                        assert.equal((await pool.query('SELECT hourly_rate FROM staff WHERE id=$1', [existingId])).rows[0].hourly_rate, '123.00');
                    }
                    assert.equal((await pool.query('SELECT id FROM staff WHERE name=$1', [name])).rowCount, 1);
                    assert.equal(result.accessState, actor.parkWorker ? 'active' : 'pending_membership');
                    await page.locator('[data-account-onboarding-finish]').waitFor({ state: 'visible' });
                    const copy = page.locator('[data-account-onboarding-copy]');
                    assert.ok(await copy.evaluate(button => {
                        const rect = button.getBoundingClientRect();
                        return rect.top >= 0 && rect.bottom <= innerHeight
                            && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
                    }), `${key}: credential action must be reachable without scrolling`);
                    await capture('result');
                    // Keyboard traversal must stay in the modal, including the receipt.
                    await page.locator('[data-account-onboarding-finish]').focus();
                    await page.keyboard.press('Tab');
                    assert.equal(await overlay.evaluate(root => root.contains(document.activeElement)), true);
                    await page.keyboard.press('Shift+Tab');
                    assert.equal(await overlay.evaluate(root => root.contains(document.activeElement)), true);
                    await page.locator('[data-account-onboarding-finish]').click();
                    record.checks = ['form geometry', 'primary action hit-test', '44px primary action', 'back retains login', 'API committed', 'one staff row', 'membership state', 'keyboard contained'];
                    if (mode === 'existing') record.checks.push('same staff ID', 'base rate unchanged');
                    evidence.push(record);
                    fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
                    process.stdout.write(`[hr-ux] ${key} passed\n`);
                }
                assert.deepEqual(errors, []);
            } catch (error) {
                await page.screenshot({ path: path.join(directory, `${actor.label}-${width}-${theme}-failure.png`),
                    mask: [page.locator('#accountOnboardingReceipt .hr-account-credential code:nth-of-type(2)')] });
                throw error;
            } finally { await context.close(); }
        }
    }
    return evidence;
}

module.exports = { runHrCrmVisualAudit };
