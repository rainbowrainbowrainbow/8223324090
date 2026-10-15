'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { install, requirePlaywright } = require('./hr-checklists-async-browser-smoke');
(async () => {
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await install(page, false);
        await page.evaluate(() => {
            canManage = false;
            window.canAccess = key => key === 'hr.staff.view';
            window.qa.context = 'park';
            salaryAccessContext = () => qa.context;
            professionCatalogAccess = { partial: true, unsupportedFields: ['workspace'] };
            const original = hrFetch;
            qa.reads = [];
            hrFetch = async (path, options = {}) => {
                if (options.method && options.method !== 'GET') throw Error('Unexpected write');
                qa.reads.push(path);
                if (path.includes('/workspace/') || path.includes('/onboarding-processes')) {
                    const context = qa.context;
                    if (qa.delay) { qa.delay = false; await new Promise(resolve => qa.release = resolve); }
                    if (qa.failure === 'offline') throw Error('Offline');
                    if (qa.failure) return { success: false, status: qa.failure, error: 'Controlled read failure' };
                    if (path.includes('/workspace/')) return { success: true, data: {
                        profession: { key: 'qa_a', title: context + ' profession', isReadonly: true },
                        people: [{ id: 1, name: context + ' person', readiness: { total: 1, completed: 1 } }],
                        checklistTemplate: qa.template('qa_a'), access: { partial: true, readOnly: true }
                    } };
                    return { success: true, staff: { id: 1, name: context + ' person' }, assignments: [],
                        data: { general: null, professions: [], history: [] }, onboardingAccess: { readOnly: true } };
                }
                return original(path, options);
            };
        });
        await page.evaluate(() => qaOpen('qa_a'));
        assert.equal(await page.locator('#professionWorkspaceTitle').innerText(), 'park profession');
        assert.ok((await page.locator('#professionWorkspacePeople').innerText()).includes('park person'));
        assert.equal(await page.locator('#professionWorkspacePeople [data-condition-rate-mode]').count(), 0);
        assert.equal(await page.locator('#professionWorkspaceActions').isVisible(), false);
        for (const failure of [403, 500, 'offline']) {
            await page.evaluate(failure => { qa.failure = failure; return qaOpen('qa_a'); }, failure);
            assert.equal(await page.locator('#professionWorkspaceContent').isVisible(), false);
            await page.evaluate(() => qa.failure = null);
            await page.locator('#professionWorkspaceState button').click();
            await page.waitForFunction(() => professionWorkspaceState.loadState === 'ready');
        }
        for (const [from, to] of [['park', 'dar'], ['dar', 'park']]) {
            await page.evaluate(from => { qa.context = from; qa.delay = true; qa.pendingRequest = qaOpen('qa_a'); }, from);
            await page.waitForFunction(() => Boolean(qa.release));
            await page.evaluate(to => { qa.context = to; window.dispatchEvent(new Event('crmBusinessContextChanged')); }, to);
            await page.evaluate(async () => { qa.release(); qa.release = null; await qa.pendingRequest; });
            assert.equal(await page.locator('#professionWorkspaceOverlay').isVisible(), false);
            assert.equal(await page.evaluate(() => professionWorkspaceState.data), null);
        }
        await page.evaluate(() => { qa.context = 'park'; return openStaffOnboardingAssignment(1); });
        assert.equal(await page.locator('#staffOnboardingScopeBody').getAttribute('aria-busy'), 'false');
        for (const failure of [403, 500, 'offline']) {
            await page.evaluate(failure => { qa.failure = failure; return refreshStaffOnboardingDialog(1); }, failure);
            assert.equal(await page.locator('#staffOnboardingScopeBody [role="alert"]').count(), 1);
            assert.equal(await page.locator('#staffOnboardingScopeBody').getAttribute('aria-busy'), 'false');
            await page.evaluate(() => qa.failure = null);
            await page.locator('#staffOnboardingScopeBody button').click();
            await page.waitForFunction(() => Boolean(staffOnboardingDialogState));
            assert.equal(await page.locator('#staffOnboardingScopeBody [role="alert"]').count(), 0);
        }
        assert.equal(await page.evaluate(() => qa.reads.some(path => path.includes('/role-assignments'))), false);
        await page.evaluate(() => { qa.delay = true; qa.pendingRequest = refreshStaffOnboardingDialog(1); });
        await page.waitForFunction(() => Boolean(qa.release));
        await page.evaluate(() => { qa.context = 'dar'; window.dispatchEvent(new Event('crmBusinessContextChanged')); qa.release(); qa.release = null; });
        await page.evaluate(() => qa.pendingRequest);
        assert.equal(await page.locator('#staffOnboardingScopeOverlay').count(), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { qa.context = 'park'; return qaOpen('qa_a'); });
        await page.locator('[data-profession-workspace-tab="people"]').click();
        assert.ok((await page.locator('#professionWorkspacePeople').innerText()).includes('park person'));
        const output = path.resolve(__dirname, '../../output/playwright/park-profession-read');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'read-only-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('Park profession/onboarding read browser: PASS; GET only, restricted/retry and both context races.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
