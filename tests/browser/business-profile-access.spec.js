'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requirePlaywrightTest() {
    try { return require('@playwright/test'); } catch (error) {
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
const AUTH = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
const BUSINESSES = [
    { key: 'dar', businessId: 12, organizationId: 7, label: 'Fixture Dar' },
    { key: 'fixture_other', businessId: 21, organizationId: 8, label: 'Fixture Other' }
];

// Exercise actual bootstrap/gate functions and the entire API module. The shell
// and permissions endpoint remain synthetic boundaries, never live QA evidence.
function sourceFunction(name) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(AUTH);
    if (!match) throw new Error(`Missing auth function: ${name}`);
    let signatureDepth = 0;
    let index = AUTH.indexOf('(', match.index);
    for (; index < AUTH.length; index += 1) {
        if (AUTH[index] === '(') signatureDepth += 1;
        if (AUTH[index] === ')' && --signatureDepth === 0) break;
    }
    let depth = 0;
    for (index = AUTH.indexOf('{', index); index < AUTH.length; index += 1) {
        if (AUTH[index] === '{') depth += 1;
        if (AUTH[index] === '}' && --depth === 0) return AUTH.slice(match.index, index + 1);
    }
    throw new Error(`Unclosed auth function: ${name}`);
}

function fixtureUser(context = null, unavailable = false) {
    const active = BUSINESSES.find(item => item.key === context);
    const allowed = unavailable ? [] : BUSINESSES.map(item => item.key);
    return {
        id: 42, username: 'fixture_member', role: active ? 'animator' : null, roles: active ? ['animator'] : [],
        extraRoles: [], pageAllowlist: [], pageDenylist: [], actionAllowlist: [], actionDenylist: [],
        businessContexts: allowed, defaultBusinessContext: context, activeBusinessContext: context,
        organizationId: active?.organizationId || null,
        activeBusinessMembership: active ? { businessId: active.businessId, businessContext: context, organizationId: active.organizationId, role: 'animator' } : null,
        businessContextPolicy: { allowed, defaultContext: context, canSwitch: allowed.length > 1, forced: null },
        accessContext: { status: active ? 'ready' : unavailable ? 'unavailable' : 'selection_required',
            code: active ? null : unavailable ? 'business_context_unavailable' : 'business_context_required' }
    };
}

function fixtureProfile(user) {
    const active = user.activeBusinessContext;
    return { success: true, user, businessProfile: {
        organizations: [{ id: 7, name: 'Fixture Organization One', role: 'member' }, { id: 8, name: 'Fixture Organization Two', role: 'member' }],
        businesses: BUSINESSES.filter(item => user.businessContexts.includes(item.key)),
        activeBusinessId: active, activeBusinessContext: active, activeMembership: user.activeBusinessMembership,
        scope: { mode: 'single', activeContext: active, selectedContexts: active ? [active] : [],
            allowedContexts: user.businessContexts, invalid: !active, readOnly: !active, canWrite: Boolean(active), reason: user.accessContext.code }
    } };
}

async function openAccessGate(page, options = {}) {
    const requests = [];
    const errors = [];
    let selected = null;
    let failedSwitch = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://business-access.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/css/')) {
            const file = path.join(ROOT, 'css', path.basename(url.pathname));
            await route.fulfill({ contentType: 'text/css', body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' });
            return;
        }
        if (!url.pathname.startsWith('/api/')) {
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/layout.css"><link rel="stylesheet" href="/css/pages-shell.css"><link rel="stylesheet" href="/css/controls.css"><link rel="stylesheet" href="/css/dark-mode.css"><link rel="stylesheet" href="/css/responsive.css"></head><body><main id="fixture-shell"><button id="background-button">Fixture background</button></main></body></html>' });
            return;
        }
        const requested = url.searchParams.get('businessContext');
        requests.push({ pathname: url.pathname, context: requested, headers: route.request().headers() });
        if (url.pathname === '/api/auth/verify') {
            await route.fulfill({ json: { success: true, user: fixtureUser(selected, options.unavailable) } });
        } else if (url.pathname === '/api/auth/business-profile') {
            if (requested && options.failSwitchFirst && !failedSwitch) {
                failedSwitch = true;
                await route.fulfill({ status: 403, json: { success: false, error: 'Fixture business temporarily unavailable' } });
                return;
            }
            if (!options.unavailable && BUSINESSES.some(item => item.key === requested)) selected = requested;
            const user = fixtureUser(selected, options.unavailable);
            await route.fulfill({ status: selected ? 200 : 403, json: fixtureProfile(user) });
        } else if (url.pathname === '/api/auth/permissions') {
            await route.fulfill({ json: { capabilities: { 'page:/tasks': { allowed: true } } } });
        } else if (url.pathname === '/api/tasks') {
            await route.fulfill({ json: { tasks: [] } });
        } else {
            errors.push(`Unexpected fixture request: ${url.pathname}`);
            await route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
        }
    });
    await page.goto('https://business-access.test/tasks');
    await page.evaluate(({ user, dark }) => {
        window.CONFIG = { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } };
        window.AppState = { currentUser: user, authPermissions: { stale: true } };
        user.permissions = { stale: true };
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_token', 'synthetic-access-token');
        localStorage.setItem('pzp_access_token', 'synthetic-access-token');
        if (dark) document.body.classList.add('dark-mode');
    }, { user: fixtureUser(null, options.unavailable), dark: options.dark });
    await page.addScriptTag({ path: path.join(ROOT, 'js/api.js') });
    const functions = ['_escHtml', 'resetAuthenticatedRuntimeReady', 'clearRuntimePermissionCatalog',
        'ensureAuthSessionRecoverySurface', 'clearAuthSessionBootstrapError', 'renderBusinessAccessSelection',
        'readAuthBootstrapStoredUser', 'authBootstrapUsersShareIdentity', 'captureAuthBootstrapSession',
        'isAuthBootstrapSessionCurrent', 'authBootstrapSessionChangedError', 'hydrateBusinessOperatingProfile',
        'checkSession', 'checkSessionAttempt'].map(sourceFunction).join('\n');
    await page.addScriptTag({ content: `
        const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
        const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
        const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';
        let authenticatedRuntimeReady = true;
        let PAGE_ACCESS = { '/finance': ['creator'] }, ACTION_PERMISSIONS = { stale: ['creator'] };
        let PAGE_CAPABILITY_ALIASES = {}, ACTION_CAPABILITY_ALIASES = {}, ACTION_LEGACY_KEYS = {}, ACTION_LEGACY_DENY_KEYS = {};
        let EXPLICIT_ALLOW_DISABLED_PAGES = new Set(), EXPLICIT_ALLOW_DISABLED_ACTIONS = new Set(), NON_DELEGABLE_ACTIONS = new Set();
        window.__mainCalls = 0;
        window.__logoutCalls = 0;
        function recordRedirectDiagnostic() {}
        function hasStoredRefreshSession() { return false; }
        function applyAuthReturnRouteAfterLogin() { return false; }
        function showAuthenticatedPageShell() {}
        function renderAuthSessionBootstrapError() { throw new Error('Unexpected fixture bootstrap failure'); }
        function renderPermissionBootstrapError() { throw new Error('Unexpected fixture permissions failure'); }
        function clearAuthStorage() { throw new Error('Unexpected fixture session cleanup'); }
        function clearPrivateClientCaches() {}
        function showLoginScreen() { throw new Error('Unexpected fixture login screen'); }
        function logout() { window.__logoutCalls += 1; }
        async function hydrateActionPermissions(user) {
            const response = await apiFetchWithAuthRetry('/api/auth/permissions');
            const permissions = await response.json();
            AppState.authPermissions = permissions;
            user.permissions = permissions;
            return permissions;
        }
        function showMainApp() {
            window.__mainCalls += 1;
            authenticatedRuntimeReady = true;
            void apiFetchWithAuthRetry('/api/tasks');
        }
        ${functions}
        window.__accessState = () => ({
            ready: authenticatedRuntimeReady, active: CrmBusinessContext.current(),
            user: AppState.currentUser, permissions: AppState.authPermissions,
            pageAccess: PAGE_ACCESS, actions: ACTION_PERMISSIONS, mainCalls: window.__mainCalls
        });
    ` });
    expect(await page.evaluate(() => checkSession())).toBe(false);
    await expect(page.locator('#authSessionRecovery')).toBeVisible();
    return { requests, errors, revoke() { selected = null; options.unavailable = true; } };
}

test('two organizations require explicit keyboard selection and never manufacture a Park context', async ({ page }) => {
    const fixture = await openAccessGate(page);
    const select = page.locator('#businessAccessSelection');
    await expect(select).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('[data-business-access-logout]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await expect(select.locator('option')).toHaveText([
        'Fixture Organization One — Fixture Dar', 'Fixture Organization Two — Fixture Other'
    ]);
    expect(await page.evaluate(() => window.__accessState().active)).toBeNull();
    expect(fixture.requests.map(item => item.pathname)).toEqual(['/api/auth/verify', '/api/auth/business-profile']);
    await select.press('End');
    await select.press('Tab');
    await expect(page.locator('[data-business-access-select]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__mainCalls)).toBe(1);
    const state = await page.evaluate(() => window.__accessState());
    expect(state.active).toBe('fixture_other');
    expect(state.user.role).toBe('animator');
    expect(state.user.organizationId).toBe(8);
    await expect.poll(() => fixture.requests.filter(item => item.pathname === '/api/tasks').length).toBe(1);
    expect(fixture.requests.find(item => item.pathname === '/api/tasks').headers['x-business-context']).toBe('fixture_other');
    expect(fixture.requests.some(item => item.context === 'event_genix')).toBe(false);
    expect(fixture.requests.find(item => item.context === 'fixture_other')?.pathname).toBe('/api/auth/business-profile');
    expect(fixture.errors).toEqual([]);
});

test('revoked access clears permission caches and never initializes operational reads', async ({ page }) => {
    const fixture = await openAccessGate(page, { unavailable: true });
    await expect(page.getByRole('heading', { name: 'Немає активного доступу до бізнесу' })).toBeVisible();
    await expect(page.locator('#businessAccessSelection')).toHaveCount(0);
    await expect(page.locator('[data-business-access-retry]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('[data-business-access-logout]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-business-access-retry]')).toBeFocused();
    const state = await page.evaluate(() => window.__accessState());
    expect(state).toMatchObject({ ready: false, active: null, permissions: null, pageAccess: {}, actions: {}, mainCalls: 0 });
    expect(state.user.permissions).toBeUndefined();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pzp_current_user')).permissions)).toBeUndefined();
    expect(state.user.roles).toEqual([]);
    await page.keyboard.press('Enter');
    await expect.poll(() => fixture.requests.filter(item => item.pathname === '/api/auth/business-profile').length).toBe(2);
    expect(fixture.requests.every(item => ['/api/auth/verify', '/api/auth/business-profile'].includes(item.pathname))).toBe(true);
    await page.locator('[data-business-access-logout]').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__logoutCalls)).toBe(1);
    expect(fixture.errors).toEqual([]);
});

test('later verification revocation clears an already open business without changing the stored session', async ({ page }) => {
    const fixture = await openAccessGate(page);
    await page.locator('[data-business-access-select]').click();
    await expect.poll(() => page.evaluate(() => window.__mainCalls)).toBe(1);
    await expect.poll(() => fixture.requests.filter(item => item.pathname === '/api/tasks').length).toBe(1);
    expect(await page.evaluate(() => window.__accessState().active)).toBe('dar');
    fixture.revoke();
    expect(await page.evaluate(() => checkSession())).toBe(false);
    await expect(page.getByRole('heading', { name: 'Немає активного доступу до бізнесу' })).toBeVisible();
    const state = await page.evaluate(() => window.__accessState());
    expect(state).toMatchObject({ ready: false, active: null, permissions: null, mainCalls: 1 });
    expect(state.user.roles).toEqual([]);
    expect(state.user.permissions).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('pzp_token'))).toBe('synthetic-access-token');
    expect(fixture.requests.filter(item => item.pathname === '/api/tasks')).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
});

test('real cross-tab storage event converges the other tab route before its reload', async ({ page, context }) => {
    const firstFixture = await openAccessGate(page);
    await page.locator('[data-business-access-select]').click();
    await expect.poll(() => page.evaluate(() => window.__mainCalls)).toBe(1);
    const otherPage = await context.newPage();
    const secondFixture = await openAccessGate(otherPage);
    await otherPage.locator('[data-business-access-select]').click();
    await expect.poll(() => otherPage.evaluate(() => window.__mainCalls)).toBe(1);
    await expect(otherPage).toHaveURL(/businessContext=dar/);
    await otherPage.addScriptTag({ content: `
        let crossTabSessionSyncInProgress = false;
        let crossTabLogoutInProgress = false;
        ${sourceFunction('synchronizeSharedBusinessRoute')}
        ${sourceFunction('handleCrossTabAuthStorageChange')}
        window.addEventListener('storage', handleCrossTabAuthStorageChange);
    ` });
    const reloadRequests = [];
    otherPage.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === otherPage.mainFrame()) reloadRequests.push(request.url());
    });
    await page.evaluate(() => CrmBusinessContext.switchTo('fixture_other', { user: AppState.currentUser, navigate: false }));
    await expect(otherPage).toHaveURL(/businessContext=fixture_other/);
    await expect.poll(() => reloadRequests.length).toBe(1);
    expect(reloadRequests[0]).toContain('businessContext=fixture_other');
    expect(reloadRequests[0]).not.toContain('businessContext=dar');
    expect(await otherPage.evaluate(() => JSON.parse(localStorage.getItem('pzp_current_user')).activeBusinessContext)).toBe('fixture_other');
    expect(firstFixture.errors).toEqual([]);
    expect(secondFixture.errors).toEqual([]);
    await otherPage.close();
});

for (const dark of [false, true]) {
    test(`failed switch stays keyboard usable at 390px in ${dark ? 'dark' : 'light'} mode`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const fixture = await openAccessGate(page, { failSwitchFirst: true, dark });
        const select = page.locator('#businessAccessSelection');
        await select.press('End');
        await select.press('Tab');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-business-access-error]')).toHaveText('Fixture business temporarily unavailable');
        if (!dark) {
            const screenshot = path.join(ROOT, 'output/playwright/business-profile-access-390.png');
            fs.mkdirSync(path.dirname(screenshot), { recursive: true });
            await page.screenshot({ path: screenshot });
        }
        await expect(select).toBeEnabled();
        await expect(page.locator('[data-business-access-select]')).toBeEnabled();
        await expect(page.locator('[data-business-access-select]')).toBeFocused();
        expect(await page.evaluate(() => window.__accessState().active)).toBeNull();
        expect(fixture.requests.some(item => ['/api/auth/permissions', '/api/tasks'].includes(item.pathname))).toBe(false);
        for (const control of [select, page.locator('[data-business-access-select]'), page.locator('[data-business-access-retry]'), page.locator('[data-business-access-logout]')]) {
            const box = await control.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(390);
            expect(box.y + box.height).toBeLessThanOrEqual(844);
        }
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__mainCalls)).toBe(1);
        expect(await page.evaluate(() => window.__accessState().active)).toBe('fixture_other');
        expect(fixture.errors).toEqual([]);
    });
}
