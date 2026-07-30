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

async function openEditor(page, options = {}) {
    await page.evaluate((overrides) => {
        window.__saveAttempts = 0;
        window.__editorResult = null;
        document.getElementById('open-editor').focus();
        window.AccountAccessEditor.open({
            opener: document.getElementById('open-editor'),
            user: { username: 'disposable.admin' },
            initial: { role: 'admin', actionAllowlist: [], actionDenylist: [], businessContexts: ['event_genix'] },
            roles: [{ value: 'admin', label: 'Admin' }, { value: 'hr', label: 'HR' }],
            businesses: [{ key: 'event_genix', label: 'Event Genix' }],
            pages: [{ key: '/hr', label: 'HR', group: 'HR', defaultRoles: ['admin'] }],
            actions: [
                { key: 'hr.schedule.view', label: 'Schedule', group: 'HR', defaultRoles: ['admin'], delegable: true },
                { key: 'hr.reports.view', label: 'Reports', group: 'HR', defaultRoles: ['hr'], delegable: true }
            ],
            async onSave() {
                window.__saveAttempts += 1;
                if (overrides.failFirst && window.__saveAttempts === 1) throw new Error('Deterministic save failure');
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

test('blocks accidental dismissal, traps/restores focus, and preserves draft after failed save', async ({ page }) => {
    await openEditor(page, { failFirst: true });
    expect(await page.evaluate(() => document.activeElement?.dataset?.tab)).toBe('overview');
    await expect(page.locator('#background')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('.aae-backdrop').evaluate(element => element.click());
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);

    await page.locator('[data-tab="modules"]').click();
    const reportsCard = page.locator('[data-capability="hr.reports.view"]');
    await reportsCard.locator('[data-mode="allow"]').click();
    await expect(reportsCard.locator('[data-mode="allow"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.activeElement?.dataset?.mode)).toBe('allow');

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.locator('[data-action="continue-editing"]').click();
    await expect(page.locator('[data-capability="hr.reports.view"] [data-mode="allow"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.aae-close').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.dataset?.action)).toBe('save');

    await page.locator('[data-action="save"]').click();
    await expect(page.getByText('Deterministic save failure')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.locator('[data-tab="modules"]').click();
    await expect(page.locator('[data-capability="hr.reports.view"] [data-mode="allow"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#accountAccessEditorRoot')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('open-editor');
    expect(await page.evaluate(() => window.__editorResult?.saved)).toBe(true);
    await expect(page.locator('#background')).not.toHaveAttribute('aria-hidden', 'true');
});

test('uses a fullscreen workspace on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    const box = await page.locator('.aae-sheet').boundingBox();
    assert.ok(box && box.width >= 388 && box.height >= 842, `mobile sheet must fill viewport: ${JSON.stringify(box)}`);
});
