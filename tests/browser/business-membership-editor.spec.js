'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requirePlaywrightTest() {
    try { return require('@playwright/test'); } catch (error) {
        const cliPath = process.argv.find(arg => /@playwright[\\/]test[\\/]cli\.js$/i.test(arg));
        if (cliPath) return require(path.dirname(cliPath));
        const marker = `${path.sep}node_modules${path.sep}playwright${path.sep}`;
        for (const candidate of [process.argv[1], require.main?.filename, module.parent?.filename].filter(Boolean)) {
            const index = String(candidate).toLowerCase().indexOf(marker.toLowerCase());
            if (index < 0) continue;
            const packageDir = path.join(String(candidate).slice(0, index + `${path.sep}node_modules`.length), '@playwright', 'test');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

const { test, expect } = requirePlaywrightTest();
const ROOT = path.resolve(__dirname, '..', '..');

function profile() {
    const membership = { role: 'manager', extraRoles: [], pageAllowlist: [], pageDenylist: [],
        actionAllowlist: [], actionDenylist: [], isDefault: true, isActive: true, organizationRole: 'member' };
    return { userId: 42, canEditAccount: false, membershipContextKeys: ['event_genix', 'dar'], organizations: [
        { id: 7, name: 'Fixture Organization', slug: 'fixture', role: 'owner', businesses: [
            { id: 11, contextKey: 'event_genix', label: 'Fixture Park', status: 'active', accessMode: 'membership', membership,
                canEdit: true, canDeactivate: true, canManageOrganizationRole: true },
            { id: 12, contextKey: 'dar', label: 'Fixture Dar', status: 'active', accessMode: 'membership',
                membership: { ...membership, role: 'animator', isDefault: false },
                canEdit: true, canDeactivate: true, canManageOrganizationRole: true }
        ] }
    ] };
}

async function openEditor(page, options = {}) {
    const accessProfile = options.profile || profile();
    const requests = [];
    let writeAttempts = 0;
    let readAttempts = 0;
    await page.route('https://membership-editor.test/api/**', async route => {
        const request = route.request();
        const entry = { method: request.method(), url: new URL(request.url()).pathname,
            body: request.postData() ? request.postDataJSON() : null, headers: request.headers() };
        requests.push(entry);
        if (entry.method === 'GET') {
            readAttempts += 1;
            if (options.failReadFirst && readAttempts === 1) {
                await route.fulfill({ status: 503, json: { success: false, error: 'Fixture profile unavailable' } });
            } else await route.fulfill({ json: { success: true, accessProfile } });
            return;
        }
        writeAttempts += 1;
        if (options.failWriteFirst && writeAttempts === 1) {
            await route.fulfill({ status: 403, json: { success: false, error: 'Fixture membership denied' } });
        } else await route.fulfill({ json: { success: true } });
    });
    await page.setContent('<button id="open-editor">Open fixture</button><main id="background"><a href="#outside">Outside</a></main>');
    await page.addStyleTag({ path: path.join(ROOT, 'css/account-access-editor.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'js/account-access-editor.js') });
    await page.evaluate(({ accessProfile, dynamicProfile }) => {
        window.__editorResult = null;
        window.__globalSaves = [];
        window.getAuthHeaders = () => ({ 'Content-Type': 'application/json', 'X-Business-Context': 'dar', 'X-Business-Scope': 'all' });
        window.apiFetchWithAuthRetry = (url, request) => fetch('https://membership-editor.test' + url, request);
        const opener = document.getElementById('open-editor');
        opener.focus();
        window.AccountAccessEditor.open({
            opener, user: { id: 42, username: 'fixture_member' },
            canEditAccount: accessProfile.canEditAccount,
            ...(dynamicProfile ? {} : { accessProfile }),
            initial: { role: 'creator', extraRoles: [], pageAllowlist: ['/finance'], businessContexts: ['event_genix', 'maysternya_doli'], defaultBusinessContext: 'event_genix' },
            roles: ['creator', 'director', 'manager', 'animator', 'reception'].map(value => ({ value, label: value })),
            businesses: ['event_genix', 'dar', 'maysternya_doli', 'crm'].map(key => ({ key, label: key })),
            pages: [{ key: '/reports', label: 'Reports', defaultRoles: ['manager'] }],
            actions: [{ key: 'edit_booking', label: 'Edit booking', defaultRoles: ['manager'], delegable: true }],
            async onSave(state) { window.__globalSaves.push(state); return { success: true }; }
        }).then(result => { window.__editorResult = result; });
    }, { accessProfile, dynamicProfile: options.dynamicProfile === true });
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    return requests;
}

test('business draft switch, failed save and retry preserve role isolation and never patch global account', async ({ page }) => {
    const requests = await openEditor(page, { failWriteFirst: true });
    const scope = page.locator('[data-access-scope]');
    await expect(scope).toHaveValue('business:7:11');
    await expect(scope.locator('option[value="account"]')).toHaveCount(0);
    await page.locator('[data-tab="roles"]').click();
    await expect(page.locator('[data-field="role"]')).toHaveValue('manager');
    await expect(page.locator('[data-field="role"] option[value="creator"]')).toHaveCount(0);
    await page.locator('[data-field="role"]').selectOption('reception');
    await scope.selectOption('business:7:12');
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.locator('[data-action="continue-editing"]').click();
    await expect(scope).toHaveValue('business:7:11');
    await expect(page.locator('[data-field="role"]')).toHaveValue('reception');
    await scope.selectOption('business:7:12');
    await page.locator('[data-action="discard"]').click();
    await expect(scope).toBeFocused();
    await expect(page.locator('[data-field="role"]')).toHaveValue('animator');
    await page.locator('[data-tab="modules"]').click();
    await page.locator('[data-capability="/reports"] [data-mode="deny"]').click();
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('.aae-save-state')).toContainText('Fixture membership denied');
    await expect(page.locator('[data-capability="/reports"] [data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(requests.map(row => row.method)).toEqual(['PUT', 'PUT']);
    expect(requests[1].url).toBe('/api/organizations/7/members/42');
    expect(requests[1].body.businessId).toBe(12);
    expect(requests[1].body.role).toBeUndefined();
    expect(requests[1].body.pageDenylist).toEqual(['/reports']);
    expect(requests[1].headers['x-business-context']).toBeUndefined();
    expect(await page.evaluate(() => window.__globalSaves)).toEqual([]);
    expect(await page.evaluate(() => window.__editorResult.scope)).toBe('business');
    await expect(page.locator('#open-editor')).toBeFocused();
});

test('new membership requires explicit activation and role then stores its own default', async ({ page }) => {
    const accessProfile = profile();
    accessProfile.organizations[0].businesses[1].membership = null;
    accessProfile.organizations[0].businesses[1].canDeactivate = false;
    const requests = await openEditor(page, { profile: accessProfile });
    await page.locator('[data-access-scope]').selectOption('business:7:12');
    await page.locator('[data-tab="businesses"]').click();
    await page.locator('[data-membership-active]').check();
    await page.locator('[data-membership-active]').uncheck();
    await page.locator('[data-membership-active]').check();
    await page.locator('[data-membership-default]').check();
    await page.locator('[data-tab="roles"]').click();
    await expect(page.locator('[data-field="role"]')).toHaveValue('');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('.aae-save-state')).toContainText('Оберіть бізнес-роль');
    expect(requests).toEqual([]);
    await page.locator('[data-field="role"]').selectOption('animator');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(requests[0].body).toMatchObject({ businessId: 12, role: 'animator', isDefault: true, pageAllowlist: [], actionAllowlist: [] });
});

test('deactivation uses only selected membership DELETE', async ({ page }) => {
    const requests = await openEditor(page);
    await page.locator('[data-tab="businesses"]').click();
    await page.locator('[data-membership-active]').uncheck();
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'DELETE', url: '/api/organizations/7/members/42/11', body: null });
    expect(await page.evaluate(() => window.__globalSaves)).toEqual([]);
});

test('global mode keeps migrated grants readonly and saves compatibility controls through existing callback', async ({ page }) => {
    const accessProfile = profile();
    accessProfile.canEditAccount = true;
    const requests = await openEditor(page, { profile: accessProfile });
    await expect(page.locator('[data-access-scope]')).toHaveValue('account');
    await page.locator('[data-tab="businesses"]').click();
    await expect(page.locator('[data-business][value="event_genix"]')).toBeDisabled();
    await expect(page.locator('[data-business][value="dar"]')).toBeDisabled();
    await expect(page.locator('[data-default-business][value="dar"]')).toBeDisabled();
    await page.locator('[data-business][value="crm"]').check();
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => window.__globalSaves[0].businessContexts.slice().sort())).toEqual(['crm', 'event_genix', 'maysternya_doli']);
});

test('dynamic profile loading fails closed for owner and can recover with retry', async ({ page }) => {
    const requests = await openEditor(page, { dynamicProfile: true, failReadFirst: true });
    await expect(page.locator('[data-action="retry-profile"]')).toBeVisible();
    await page.locator('[data-tab="roles"]').click();
    await expect(page.locator('[data-field="role"]')).toBeDisabled();
    await expect(page.locator('[data-action="save"]')).toBeDisabled();
    await page.locator('[data-action="retry-profile"]').click();
    await expect(page.locator('[data-access-scope]')).toHaveValue('business:7:11');
    await expect(page.locator('[data-field="role"]')).toHaveValue('manager');
    expect(requests.map(row => row.method)).toEqual(['GET', 'GET']);
});

for (const width of [390, 768, 1440]) {
    test(`membership scope and save controls remain accessible at width ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openEditor(page);
        await page.locator('[data-tab="businesses"]').click();
        await page.locator('.aae-sheet').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
        const dimensions = await page.locator('[role="dialog"]').evaluate(element => ({
            width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right,
            viewport: innerWidth
        }));
        expect(dimensions.width).toBeLessThanOrEqual(width);
        expect(dimensions.right).toBeLessThanOrEqual(width);
        await expect(page.locator('[data-access-scope]')).toBeInViewport();
        await expect(page.locator('[data-membership-active]')).toBeInViewport();
        await expect(page.locator('[data-action="save"]')).toBeInViewport();
        if (width === 390) {
            const output = path.join(ROOT, 'output/playwright/business-membership-editor-390.png');
            fs.mkdirSync(path.dirname(output), { recursive: true });
            await page.screenshot({ path: output });
        }
    });
}
