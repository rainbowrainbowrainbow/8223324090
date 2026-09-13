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
const ROOT = path.resolve(__dirname, '../..');
const { businessModuleCatalog } = require('../../services/businessModuleRegistry');
const moduleRegistry = businessModuleCatalog('custom_business');

async function fixture(page, options = {}) {
    const requests = [];
    let failWrite = options.failWrite;
    let pendingRead = null;
    const business = { id: 11, organizationId: 7, contextKey: 'event_genix', label: 'Тестовий парк', shortLabel: 'Парк', status: 'active', modules: ['timeline', 'catalogs'], moduleCatalog: businessModuleCatalog('event_genix').map(module => ({ ...module, enabled: module.canEnable && ['timeline', 'catalogs'].includes(module.key) })), canInitializeResources: true };
    const organizations = [
        { id: 7, name: 'Тестова організація A', role: options.admin ? 'admin' : 'owner', canCreateBusiness: !options.admin, canEditBusinesses: !options.admin, businesses: [business] },
        { id: 8, name: 'Тестова організація B', role: 'owner', canCreateBusiness: true, canEditBusinesses: true, businesses: [] }
    ];
    await page.route('https://cabinet.test/api/**', async route => {
        const req = route.request();
        const entry = { method: req.method(), path: new URL(req.url()).pathname, headers: req.headers(), body: req.postData() ? req.postDataJSON() : null };
        requests.push(entry);
        if (entry.method === 'GET') {
            if (options.holdRead && requests.length > 1) { pendingRead = route; return; }
            return route.fulfill({ json: { success: true, organizations, moduleRegistry } });
        }
        if (failWrite) { failWrite = false; return route.fulfill({ status: 503, json: { error: 'Synthetic failure' } }); }
        if (entry.path.endsWith('/initialize-resources')) return route.fulfill({ json: { success: true, initialization: { created: 0, resourceTypes: [{ type: 'cabinet', status: 'existing' }] } } });
        if (entry.path.endsWith('/configuration')) Object.assign(business, entry.body);
        else if (entry.path.endsWith('/businesses/11')) Object.assign(business, entry.body);
        else if (entry.method === 'POST') organizations.find(item => entry.path.includes(`/${item.id}/`)).businesses.push({ ...entry.body, id: 12, status: 'active', moduleCatalog: moduleRegistry });
        return route.fulfill({ json: { success: true, business } });
    });
    await page.setContent('<main class="profile-page profile-work-mode"><section id="cabinet"></section><section id="members"></section></main>');
    const html = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
    await page.addStyleTag({ content: ':root { --gray-200:#cbd5e1; --gray-500:#64748b; --gray-800:#1e293b; --white:#fff; --primary:#059669; } body {margin:0;padding:16px;font-family:sans-serif;} * {box-sizing:border-box;} ' + html.match(/<style>([\s\S]*?)<\/style>/)[1] });
    await page.addScriptTag({ path: path.join(ROOT, 'js/business-cabinet-manager.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'js/business-membership-manager.js') });
    await page.evaluate(({ organizations, admin }) => {
        window.AppState = { currentUser: { id: 1, businessProfile: { organizations: organizations.map(org => ({ ...org, role: admin ? 'admin' : org.role })) } } };
        window.getAuthHeaders = () => ({ 'X-Business-Context': 'dar', 'X-Business-Scope': 'all' });
        window.apiFetchWithAuthRetry = (url, request) => fetch('https://cabinet.test' + url, request);
        window.BusinessCabinetManager.mount(document.getElementById('cabinet'), window.AppState.currentUser);
        window.BusinessMembershipManager.mount(document.getElementById('members'), window.AppState.currentUser);
    }, { organizations, admin: options.admin });
    await page.locator('[data-cabinet-action="load"]').click();
    await expect(page.locator('[data-cabinet-organization]')).toBeVisible();
    return { requests, releaseRead: async () => { await pendingRead?.fulfill({ json: { success: true, organizations, moduleRegistry } }); } };
}

test('owner creates explicitly empty business in selected organization without operational context headers', async ({ page }) => {
    const { requests } = await fixture(page);
    await page.locator('[data-cabinet-organization]').selectOption('8');
    await page.locator('[data-cabinet-action="create"]').click();
    await expect(page.locator('[name="label"]')).toBeFocused();
    await page.locator('[name="label"]').fill('Другий бізнес');
    await page.locator('[name="shortLabel"]').fill('Другий');
    await page.locator('[name="contextKey"]').fill('fixture_business');
    await expect(page.locator('[data-cabinet-unavailable]')).not.toHaveAttribute('open', '');
    await page.locator('[data-cabinet-unavailable] summary').click();
    await expect(page.locator('[data-cabinet-module="graduation"]')).toBeVisible();
    await expect(page.locator('[data-cabinet-module="catalogs"]')).toBeDisabled();
    await expect(page.locator('[data-cabinet-module="graduation"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Зберегти бізнес' }).click();
    await expect(page.locator('[data-cabinet-status]')).toContainText('Зміни збережено');
    await expect(page.locator('[data-cabinet-status]')).toBeFocused();
    const write = requests.find(req => req.method === 'POST');
    expect(write.path).toBe('/api/organizations/8/businesses');
    expect(write.body).toEqual({ label: 'Другий бізнес', shortLabel: 'Другий', contextKey: 'fixture_business', modules: [] });
    expect(write.headers['x-business-context']).toBeUndefined();
    expect(write.headers['x-business-scope']).toBeUndefined();
});

test('configuration retry preserves draft and label-only patch retains historical blocked modules', async ({ page }) => {
    const { requests } = await fixture(page, { failWrite: true });
    await page.locator('[data-cabinet-action="edit"]').click();
    await expect(page.locator('[data-cabinet-module="catalogs"]')).toBeChecked();
    await expect(page.locator('[data-cabinet-module="catalogs"]')).toBeDisabled();
    await page.locator('[name="label"]').fill('Оновлений парк');
    await page.getByRole('button', { name: 'Зберегти бізнес' }).click();
    await expect(page.locator('[data-cabinet-status]')).toContainText('Спробуйте ще раз');
    await expect(page.locator('[name="label"]')).toHaveValue('Оновлений парк');
    await page.getByRole('button', { name: 'Зберегти бізнес' }).click();
    await expect(page.locator('[data-cabinet-status]')).toContainText('Зміни збережено');
    expect(requests.filter(req => req.method === 'PATCH').map(req => req.body)).toEqual([{ label: 'Оновлений парк', shortLabel: 'Парк' }, { label: 'Оновлений парк', shortLabel: 'Парк' }]);
});

test('dirty organization switch can be cancelled and native keyboard submit saves only chosen modules', async ({ page }) => {
    const { requests } = await fixture(page);
    await page.locator('[data-cabinet-action="edit"]').click();
    await page.locator('[name="label"]').fill('Незбережена назва');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('[data-cabinet-organization]').selectOption('8');
    await expect(page.locator('[data-cabinet-organization]')).toHaveValue('7');
    await expect(page.locator('[name="label"]')).toHaveValue('Незбережена назва');
    await page.locator('[data-cabinet-module="graduation"]').focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Зберегти бізнес' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-cabinet-status]')).toContainText('Зміни збережено');
    expect(requests.find(req => req.method === 'PATCH').body.modules).toEqual(['timeline', 'catalogs', 'graduation']);
});

test('owner initializes explicitly and deactivates exact business; admin cannot expose configuration controls', async ({ page }) => {
    const { requests } = await fixture(page);
    await page.locator('[data-cabinet-action="initialize"]').click();
    await expect(page.locator('[data-cabinet-status]')).toContainText('Нові ресурси не створені');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-cabinet-action="status"]').click();
    await expect(page.locator('[data-cabinet-status]')).toContainText('Зміни збережено');
    expect(requests.find(req => req.path.endsWith('/initialize-resources')).body).toEqual({});
    expect(requests.find(req => req.method === 'PATCH').body).toEqual({ status: 'inactive' });
    await fixture(page, { admin: true });
    await expect(page.locator('[data-cabinet-action="create"]')).toHaveCount(0);
    await expect(page.locator('[data-cabinet-action="edit"]')).toHaveCount(0);
    await expect(page.locator('[data-members-load]')).toBeVisible();
});

test('late directory response after role/context change cannot restore previous organization data', async ({ page }) => {
    const { requests, releaseRead } = await fixture(page, { holdRead: true });
    await page.locator('[data-cabinet-action="load"]').click();
    await expect.poll(() => requests.length).toBe(2);
    await page.evaluate(() => {
        window.AppState.currentUser.businessProfile.organizations = [{ id: 7, role: 'member' }];
        dispatchEvent(new CustomEvent('crmBusinessProfileChanged'));
    });
    await releaseRead();
    await expect(page.locator('#cabinet')).toBeHidden();
    await expect(page.locator('[data-cabinet-organization]')).toHaveCount(0);
    await expect(page.locator('#members')).toBeHidden();
});

test('exact existing-account launcher uses the canonical editor for explicit role, activation and default business', async ({ page }) => {
    await fixture(page);
    const writes = [];
    await page.addStyleTag({ path: path.join(ROOT, 'css/account-access-editor.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'js/account-access-editor.js') });
    await page.route('https://cabinet.test/api/organizations/members/52/access-profile', route => route.fulfill({ json: {
        success: true,
        accessProfile: {
            userId: 52, canEditAccount: false, membershipContextKeys: ['event_genix'],
            organizations: [{ id: 7, role: 'owner', name: 'Тестова організація A', businesses: [{
                id: 11, contextKey: 'event_genix', label: 'Тестовий парк', status: 'active', accessMode: 'membership',
                membership: null, canEdit: true, canDeactivate: false, canManageOrganizationRole: true
            }] }],
            permissionCatalog: { roles: ['animator', 'manager'], pages: [], actions: [] }
        }
    } }));
    await page.route('https://cabinet.test/api/organizations/7/members/52', route => {
        writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
        return route.fulfill({ json: { success: true } });
    });
    await page.locator('[data-members-account-id]').fill('52');
    await page.locator('[data-members-add]').click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.locator('[data-tab="businesses"]').click();
    await page.locator('[data-membership-active]').check();
    await page.locator('[data-membership-default]').check();
    await page.locator('[data-tab="roles"]').click();
    await page.locator('[data-field="role"]').selectOption('animator');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-members-add]')).toBeFocused();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { businessId: 11, role: 'animator', isDefault: true } });
    await expect(page.locator('[data-members-status]')).toContainText('оновлено');
});

for (const width of [390, 768, 1440]) {
    test(`cabinet form and existing worker controls remain reachable at ${width} in light/dark`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await fixture(page);
        await page.locator('[data-cabinet-action="create"]').click();
        for (const dark of [false, true]) {
            await page.evaluate(value => document.body.classList.toggle('dark-mode', value), dark);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            const save = page.getByRole('button', { name: 'Зберегти бізнес' });
            await save.scrollIntoViewIfNeeded();
            await expect(save).toBeInViewport();
            await page.locator('[data-members-add]').scrollIntoViewIfNeeded();
            await expect(page.locator('[data-members-add]')).toBeInViewport();
            await page.locator('[data-cabinet-organization]').scrollIntoViewIfNeeded();
            await expect(page.locator('[data-cabinet-organization]')).toBeInViewport();
            const output = path.join(ROOT, `output/playwright/business-cabinet-${width}-${dark ? 'dark' : 'light'}.png`);
            fs.mkdirSync(path.dirname(output), { recursive: true });
            await page.screenshot({ path: output, fullPage: true });
        }
    });
}
