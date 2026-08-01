'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function requirePlaywrightTest() {
    try {
        return require('@playwright/test');
    } catch (error) {
        const cliPath = process.argv.find(arg => /@playwright[\\/]test[\\/]cli\.js$/i.test(arg));
        if (cliPath) return require(path.dirname(cliPath));
        const candidates = [process.argv[1], require.main?.filename, module.parent?.filename].filter(Boolean);
        const marker = `${path.sep}node_modules${path.sep}playwright${path.sep}`;
        for (const candidate of candidates) {
            const index = String(candidate).toLowerCase().indexOf(marker.toLowerCase());
            if (index < 0) continue;
            const nodeModules = String(candidate).slice(0, index + `${path.sep}node_modules`.length);
            const packageDir = path.join(nodeModules, '@playwright', 'test');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

const { test, expect } = requirePlaywrightTest();
const ROOT = path.resolve(__dirname, '..', '..');

function editorInitial(overrides = {}) {
    return {
        role: 'admin',
        pageAllowlist: [],
        pageDenylist: [],
        actionAllowlist: [],
        actionDenylist: [],
        businessContexts: ['event_genix'],
        ...overrides
    };
}

async function openEditor(page, options = {}) {
    await page.evaluate((overrides) => {
        window.__saveAttempts = 0;
        window.__editorResult = null;
        window.__savedDraft = null;
        document.getElementById('open-editor').focus();
        window.AccountAccessEditor.open({
            opener: document.getElementById('open-editor'),
            user: { username: 'disposable.admin' },
            initial: {
                role: 'admin',
                pageAllowlist: [],
                pageDenylist: [],
                actionAllowlist: [],
                actionDenylist: [],
                businessContexts: ['event_genix'],
                ...(overrides.initial || {})
            },
            roles: [{ value: 'admin', label: 'Admin' }, { value: 'hr', label: 'HR' }],
            businesses: [{ key: 'event_genix', label: 'Event Genix' }],
            pages: [
                { key: '/reports', canonicalPath: '/reports', aliases: ['/reports.html'], label: 'Reports page', group: 'Sales', defaultRoles: ['admin'] },
                { key: '/customers', canonicalPath: '/customers', label: 'Customers page', group: 'Sales', defaultRoles: ['admin'] }
            ],
            actions: [
                { key: 'hr.schedule.view', label: 'Schedule', group: 'HR', defaultRoles: ['admin'], delegable: true },
                { key: 'hr.reports.view', label: 'Reports', group: 'HR', defaultRoles: ['hr'], delegable: true }
            ],
            async onSave(draft) {
                window.__saveAttempts += 1;
                window.__savedDraft = draft;
                if (overrides.failFirst && window.__saveAttempts === 1) throw new Error('Deterministic save failure');
                if (overrides.useTestBackend) {
                    const response = await fetch('https://access-editor.test/access', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(draft)
                    });
                    return response.json();
                }
                return { success: true };
            }
        }).then(result => { window.__editorResult = result; });
    }, options);
    await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.setContent('<button id="open-editor">Open</button><main id="background"><a href="#outside">Outside</a></main><div class="toast-container">Toast</div>');
    await page.addStyleTag({ path: path.join(ROOT, 'css', 'account-access-editor.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'js', 'account-access-editor.js') });
});

test('blocks accidental dismissal, traps/restores focus, and preserves page deny after failed save', async ({ page }) => {
    await openEditor(page, { failFirst: true });
    await page.waitForFunction(() => document.activeElement?.dataset?.tab === 'overview');
    expect(await page.evaluate(() => document.activeElement?.dataset?.tab)).toBe('overview');
    await expect(page.locator('#background')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('.aae-backdrop').evaluate(element => element.click());
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);

    await page.locator('[data-tab="modules"]').click();
    const reportsCard = page.locator('[data-capability="/reports"]');
    await reportsCard.locator('[data-mode="deny"]').click();
    await expect(reportsCard.locator('[data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement?.dataset?.mode)).toBe('deny');

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.locator('[data-action="continue-editing"]').click();
    await expect(page.locator('[data-capability="/reports"] [data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.aae-close').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.dataset?.action)).toBe('save');

    await page.locator('[data-action="save"]').click();
    await expect(page.getByText('Deterministic save failure')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.locator('[data-tab="modules"]').click();
    await expect(page.locator('[data-capability="/reports"] [data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('open-editor');
    expect(await page.evaluate(() => window.__editorResult?.saved)).toBe(true);
    expect(await page.evaluate(() => window.__savedDraft?.pageDenylist)).toEqual(['/reports']);
    await expect(page.locator('#background')).not.toHaveAttribute('aria-hidden', 'true');
});

test('supports page inherited to deny, deny to allow, allow to reset and previews group deny', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-tab="modules"]').click();
    const reportsCard = page.locator('[data-capability="/reports"]');
    const customersCard = page.locator('[data-capability="/customers"]');

    await expect(reportsCard.locator('[data-mode="inherited"]')).toHaveAttribute('aria-pressed', 'true');
    await reportsCard.locator('[data-mode="deny"]').click();
    await expect(reportsCard.locator('[data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');

    await reportsCard.locator('[data-mode="allow"]').click();
    await expect(reportsCard.locator('[data-mode="allow"]')).toHaveAttribute('aria-pressed', 'true');

    await reportsCard.locator('[data-mode="inherited"]').click();
    await expect(reportsCard.locator('[data-mode="inherited"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-group="Sales"] [data-group-mode="deny"]').click();
    await expect(page.locator('[data-group-preview]')).toBeVisible();
    await expect(page.locator('[data-group-preview]')).toContainText('effective');
    await expect(reportsCard.locator('[data-mode="inherited"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-action="apply-group-action"]').click();
    await expect(reportsCard.locator('[data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(customersCard.locator('[data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-tab="overview"]').click();
    await expect(page.locator('[data-effective-diff]')).toBeVisible();
    await expect(page.locator('[data-effective-diff]')).toContainText('Stored:');
    await expect(page.locator('[data-effective-diff]')).toContainText('Effective:');
    const effectiveDiffText = await page.locator('[data-effective-diff]').innerText();
    assert.ok(effectiveDiffText.includes(String.fromCodePoint(0x423, 0x441, 0x43f, 0x430, 0x434, 0x43a, 0x43e, 0x432, 0x430, 0x43d, 0x43e)));
    assert.equal(effectiveDiffText.includes(String.fromCodePoint(0x420, 0x408, 0x421)), false);
});

test('canonicalizes conflicting aliases and persists page deny across test-backend relogin', async ({ page }) => {
    const backend = { pageAllowlist: [], pageDenylist: [] };
    await page.route('https://access-editor.test/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS', 'access-control-allow-headers': 'content-type' };
        if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers });
            return;
        }
        if (url.pathname === '/access' && request.method() === 'PATCH') {
            const body = request.postDataJSON();
            backend.pageAllowlist = Array.isArray(body.pageAllowlist) ? body.pageAllowlist : [];
            backend.pageDenylist = Array.isArray(body.pageDenylist) ? body.pageDenylist : [];
            await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true }) });
            return;
        }
        if (url.pathname === '/login' && request.method() === 'POST') {
            await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ token: 'test-token', user: { pageAllowlist: backend.pageAllowlist, pageDenylist: backend.pageDenylist } }) });
            return;
        }
        if (url.pathname === '/permissions' && request.method() === 'GET') {
            const denied = backend.pageDenylist.includes('/reports');
            await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ capabilities: { 'page:/reports': { allowed: !denied, source: denied ? 'explicit_deny' : 'role_preset' } } }) });
            return;
        }
        await route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
    });

    await openEditor(page, {
        useTestBackend: true,
        initial: { ...editorInitial(), pageAllowlist: ['/reports.html'], pageDenylist: [] }
    });
    await page.locator('[data-tab="modules"]').click();
    const reportsCard = page.locator('[data-capability="/reports"]');
    await expect(reportsCard.locator('[data-mode="allow"]')).toHaveAttribute('aria-pressed', 'true');
    await reportsCard.locator('[data-mode="deny"]').click();
    await expect(reportsCard.locator('[data-mode="deny"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);

    const relogin = await page.evaluate(async () => {
        const login = await fetch('https://access-editor.test/login', { method: 'POST' }).then(response => response.json());
        const permissions = await fetch('https://access-editor.test/permissions').then(response => response.json());
        return { login, permissions };
    });
    assert.deepEqual(backend.pageAllowlist, []);
    assert.deepEqual(backend.pageDenylist, ['/reports']);
    assert.deepEqual(relogin.login.user.pageDenylist, ['/reports']);
    assert.equal(relogin.permissions.capabilities['page:/reports'].source, 'explicit_deny');
});

test('uses a fullscreen workspace on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    const box = await page.locator('.aae-sheet').boundingBox();
    assert.ok(box && box.width >= 388 && box.height >= 842, 'mobile sheet must fill viewport');
});
