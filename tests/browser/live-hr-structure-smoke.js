#!/usr/bin/env node
'use strict';

/**
 * Read-only live/staging browser smoke for HR -> Структура -> Дерево.
 *
 * Read-only guarantee:
 * - Uses POST only for authentication when token auth is not provided.
 * - Never clicks Save and never submits HR structure forms.
 * - Blocks and fails on non-GET /api/hr/company-structure requests.
 *
 * Usage:
 *   npm run smoke:hr-structure -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_USER=... LIVE_SMOKE_PASS=... npm run smoke:hr-structure
 *   LIVE_SMOKE_TOKEN=<jwt> npm run smoke:hr-structure -- https://example.up.railway.app
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_HR_STRUCTURE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const BUSINESS_CONTEXT = readEnv('LIVE_HR_STRUCTURE_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const HEADLESS = readEnv('LIVE_HR_STRUCTURE_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const TIMEOUT_MS = Number(readEnv('LIVE_HR_STRUCTURE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const RUN_ID = `hr-structure-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const VIEWPORT_WIDTHS = [1920, 1280, 901, 900, 821, 820, 390];

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function fail(message) {
    console.error(`Live HR Structure smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`provide a valid URL argument or LIVE_HR_STRUCTURE_URL/LIVE_SMOKE_URL/TEST_URL`);
    }
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

function responseDetail(body) {
    return body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || '';
}

async function fetchJson(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        throw new Error(`${routePath} returned ${res.status}${responseDetail(body) ? `: ${responseDetail(body)}` : ''}`);
    }
    return body;
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base) {
    const token = readEnv('LIVE_HR_STRUCTURE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const candidates = [
        {
            source: 'hr-structure',
            username: readEnv('LIVE_HR_STRUCTURE_USER'),
            password: readEnv('LIVE_HR_STRUCTURE_PASS', 'LIVE_HR_STRUCTURE_PASSWORD')
        },
        {
            source: 'smoke',
            username: readEnv('LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER'),
            password: readEnv('LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD')
        },
        {
            source: 'creator-fallback',
            username: readEnv('LIVE_CREATOR_USER'),
            password: readEnv('LIVE_CREATOR_PASS')
        }
    ].filter(item => item.username && item.password);

    if (!candidates.length) {
        throw new Error('provide LIVE_HR_STRUCTURE_TOKEN or LIVE_HR_STRUCTURE_USER/LIVE_HR_STRUCTURE_PASS or LIVE_SMOKE_USER/LIVE_SMOKE_PASS');
    }

    let lastError = null;
    for (const candidate of candidates) {
        try {
            const body = await fetchJson(base, '/api/auth/login', {
                method: 'POST',
                body: { username: candidate.username, password: candidate.password }
            });
            const accessToken = extractToken(body);
            if (!accessToken) throw new Error('/api/auth/login did not return an access token');
            return {
                token: accessToken,
                refreshToken: body.refreshToken || '',
                refreshExpiresAt: body.refreshExpiresAt || '',
                user: body.user || null,
                source: candidate.source
            };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('login failed');
}

function hrStructureUrl(base) {
    const url = new URL('/hr', base);
    url.searchParams.set('tab', 'structure');
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

function colorContrastHelpers() {
    function parseColor(value) {
        const match = String(value || '').match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(',').map(part => Number(part.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
    function composite(foreground, background) {
        const alpha = foreground.a ?? 1;
        return {
            r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
            g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
            b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
            a: 1
        };
    }
    function backgroundFor(element) {
        let cursor = element;
        const layers = [];
        let color = { r: 255, g: 255, b: 255, a: 1 };
        while (cursor) {
            const parsed = parseColor(getComputedStyle(cursor).backgroundColor);
            if (parsed && parsed.a > 0) layers.push(parsed);
            cursor = cursor.parentElement;
        }
        layers.reverse().forEach(layer => {
            color = composite(layer, color);
        });
        return color;
    }
    function luminance(color) {
        const values = [color.r, color.g, color.b].map(value => {
            const channel = value / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    }
    function ratio(foreground, background) {
        const fg = luminance(foreground);
        const bg = luminance(background);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }
    return { parseColor, backgroundFor, ratio };
}

function isForbiddenHrStructureMutation(method, pathname) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) return false;
    return pathname === '/api/hr/company-structure';
}

async function openAuthenticatedContext(browser, session) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block'
    });
    const blockedMutations = [];
    const consoleErrors = [];
    const networkErrors = [];

    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user, businessContext }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_crm_business_context', businessContext);
    }, {
        token: session.token,
        refreshToken: session.refreshToken || '',
        refreshExpiresAt: session.refreshExpiresAt || '',
        user: session.user || null,
        businessContext: BUSINESS_CONTEXT
    });

    await context.route('**/*', route => {
        const req = route.request();
        let pathname = '';
        try {
            pathname = new URL(req.url()).pathname;
        } catch {}
        if (isForbiddenHrStructureMutation(req.method(), pathname)) {
            blockedMutations.push(`${req.method().toUpperCase()} ${pathname}`);
            return route.fulfill({
                status: 499,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'blocked by read-only HR structure smoke' })
            });
        }
        return route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    page.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (/favicon|ResizeObserver loop/i.test(text)) return;
        consoleErrors.push(text.slice(0, 240));
    });
    page.on('response', response => {
        if (response.status() < 500) return;
        let pathname = '';
        try {
            pathname = new URL(response.url()).pathname;
        } catch {
            pathname = response.url();
        }
        networkErrors.push(`${response.status()} ${response.request().method().toUpperCase()} ${pathname}`);
    });

    return { context, page, blockedMutations, consoleErrors, networkErrors };
}

async function openStructureTree(page, base) {
    await page.goto(hrStructureUrl(base), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#hrOrgViewTree');
    if (!(await page.locator('#tab-structure.active').count())) {
        await page.locator('[data-tab="structure"]').first().click();
    }
    await page.locator('#hrOrgViewTree').click();
    await page.waitForFunction(() => {
        const tree = document.getElementById('companyOrgTree');
        const recovery = document.getElementById('companyStructureRecovery');
        return tree
            && !tree.classList.contains('hidden')
            && document.querySelectorAll('#companyOrgTree [data-org-tree-select]').length > 0
            && (!recovery || recovery.classList.contains('hidden'));
    });
    await page.locator('#companyOrgTree [data-org-tree-select]').first().click();
    await page.waitForSelector('#hrOrgDetailTitle');
}

async function selectCurrentNodeProgrammatically(page) {
    const nodeId = await page.evaluate(() => {
        return document.querySelector('#companyOrgTree [aria-selected="true"]')?.dataset.orgTreeSelect
            || document.querySelector('#companyOrgTree [data-org-tree-select]')?.dataset.orgTreeSelect
            || '';
    });
    assert.ok(nodeId, 'tree has a selected/selectable node');
    await page.evaluate(id => {
        if (typeof window.selectCompanyOrgNodeById === 'function') {
            window.selectCompanyOrgNodeById(id, { openInspector: true });
        } else {
            document.querySelector(`[data-org-tree-select="${CSS.escape(id)}"]`)?.click();
        }
    }, nodeId);
    await page.waitForFunction(() => {
        const title = document.getElementById('hrOrgDetailTitle');
        const inspector = document.getElementById('hrOrgInspector');
        return title
            && inspector
            && title.getBoundingClientRect().width > 0
            && inspector.getBoundingClientRect().width > 0;
    });
    return nodeId;
}

async function assertTreeModeControls(page) {
    assert.equal(await page.locator('#hrOrgZoomOut').evaluate(node => node.hidden), true, 'tree hides zoom out');
    assert.equal(await page.locator('#hrOrgZoomIn').evaluate(node => node.hidden), true, 'tree hides zoom in');
    assert.equal(await page.locator('#hrOrgZoomValue').evaluate(node => node.hidden), true, 'tree hides zoom value');
}

async function assertCollapseIsReadOnly(page) {
    const toggle = page.locator('#companyOrgTree [data-org-tree-toggle]:not([disabled])').first();
    if (!(await toggle.count())) return;
    const before = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    await page.waitForTimeout(120);
    const after = await toggle.getAttribute('aria-expanded');
    assert.notEqual(after, before, 'collapse/expand toggles aria-expanded');
    assert.equal(await page.locator('#btnSaveCompanyStructure').evaluate(el => el.disabled), true, 'collapse/expand does not enable Save');
    await toggle.click();
}

async function assertSearch(page) {
    const firstTitle = await page.locator('#companyOrgTree [data-org-tree-select] strong').first().innerText();
    const term = firstTitle.trim().split(/\s+/).find(part => part.length >= 3) || firstTitle.trim().slice(0, 6);
    await page.locator('#hrOrgSearch').fill(term);
    await page.waitForTimeout(450);
    assert.ok(
        await page.evaluate(() => {
            return document.querySelectorAll('#companyOrgTree .is-search-match').length > 0
                || Boolean(document.querySelector('#companyOrgTree [aria-selected="true"]'));
        }),
        'search keeps visible result/selection'
    );

    await page.locator('#hrOrgSearch').fill('__no_such_hr_tree_node_qa__');
    await page.waitForTimeout(450);
    assert.equal(
        await page.evaluate(() => /нічого|немає|не знайден|no results|0/i.test(document.getElementById('companyOrgTree')?.textContent || '')),
        true,
        'search exposes understandable empty state'
    );

    await page.locator('#hrOrgSearch').fill('');
    await page.waitForTimeout(250);
}

async function assertArchiveFilter(page) {
    const filter = page.locator('#hrOrgArchiveFilter');
    await filter.selectOption('all');
    await page.waitForTimeout(180);
    assert.ok(await page.locator('#companyOrgTree [data-org-tree-select]').count() > 0, 'all filter keeps tree visible');
    await filter.selectOption('active');
    await page.waitForTimeout(180);
}

async function assertQuickActions(page) {
    const addButton = page.locator('#companyOrgTree [data-org-tree-add]').first();
    if (await addButton.count()) {
        await addButton.click();
        await page.waitForSelector('.form-modal-overlay', { state: 'visible' });
        await page.locator('.form-modal-overlay .confirm-cancel').click();
        await page.waitForSelector('.form-modal-overlay', { state: 'detached' });
        assert.equal(await page.locator('#btnSaveCompanyStructure').evaluate(el => el.disabled), true, 'cancelled quick add does not enable Save');
    }

    const moreButton = page.locator('#companyOrgTree [data-org-tree-more]').first();
    if (await moreButton.count()) {
        await moreButton.click();
        await page.waitForFunction(() => Boolean(document.querySelector('#companyOrgTree [role="menu"]:not(.hidden)')));
        assert.equal(await moreButton.getAttribute('aria-expanded'), 'true', 'more menu opens');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
    }
}

async function assertKeyboardNavigation(page) {
    await page.locator('#companyOrgTree [data-org-tree-select]').first().focus();
    for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space']) {
        await page.keyboard.press(key);
    }
    assert.ok(await page.evaluate(() => document.querySelector('#companyOrgTree [aria-selected="true"]')), 'keyboard keeps selected tree item');
    assert.ok(await page.evaluate(() => document.activeElement?.matches?.('[data-org-tree-select]')), 'keyboard focus stays in tree');
}

async function setTheme(page, theme) {
    await page.evaluate(nextTheme => {
        const dark = nextTheme === 'dark';
        if (typeof window.applyCrmThemeMode === 'function') window.applyCrmThemeMode(dark, true);
        document.body.classList.toggle('dark-mode', dark);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        localStorage.setItem('pzp_dark_mode', String(dark));
    }, theme);
    await page.waitForTimeout(100);
}

async function assertThemeContrast(page, theme) {
    await setTheme(page, theme);
    const lowContrast = await page.evaluate(fnText => {
        const { parseColor, backgroundFor, ratio } = eval(`(${fnText})`)();
        return ['#hrOrgDetailTitle', '#hrOrgDetailText', '#hrOrgDetailMeta dd', '#companyOrgTree [data-org-tree-select] strong']
            .map(selector => {
                const element = document.querySelector(selector);
                const color = parseColor(getComputedStyle(element).color);
                const background = backgroundFor(element);
                return { selector, ratio: ratio(color, background) };
            })
            .filter(item => item.ratio < 4.5);
    }, colorContrastHelpers.toString());
    assert.deepEqual(lowContrast, [], `${theme} text contrast is at least 4.5:1`);

    if (theme !== 'dark') return;
    const whiteSurfaces = await page.evaluate(() => {
        return ['#companyOrgTree', '#hrOrgInspector', '#companyOrgCanvas', '#hrOrgSearch', '#hrOrgArchiveFilter']
            .map(selector => {
                const element = document.querySelector(selector);
                return { selector, background: element ? getComputedStyle(element).backgroundColor : '' };
            })
            .filter(item => /rgb\(255,\s*255,\s*255\)/.test(item.background));
    });
    assert.deepEqual(whiteSurfaces, [], 'dark mode has no white HR structure surfaces');
}

async function geometryAt(page, width) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(220);
    await page.locator('#hrOrgViewTree').click().catch(() => {});
    await selectCurrentNodeProgrammatically(page);
    await page.evaluate(() => {
        const details = document.getElementById('hrOrgSystemInfo');
        if (details) details.open = true;
    });
    return page.evaluate(currentWidth => {
        const rect = selector => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? { width: box.width, left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
        };
        const tree = document.getElementById('companyOrgTree');
        const inspector = document.getElementById('hrOrgInspector');
        return {
            width: currentWidth,
            viewportWidth: window.innerWidth,
            title: rect('#hrOrgDetailTitle'),
            body: rect('#hrOrgDetailText'),
            meta: rect('#hrOrgDetailMeta'),
            inspector: rect('#hrOrgInspector'),
            inspectorRole: inspector?.getAttribute('role') || '',
            ariaModal: inspector?.getAttribute('aria-modal') || '',
            ariaHidden: inspector?.getAttribute('aria-hidden') || '',
            bodyLocked: document.body.classList.contains('hr-org-inspector-lock'),
            documentScrollWidth: document.documentElement.scrollWidth,
            treeClientWidth: tree?.clientWidth || 0,
            treeScrollWidth: tree?.scrollWidth || 0
        };
    }, width);
}

function assertGeometry(geometry) {
    for (const key of ['title', 'body', 'meta']) {
        assert.ok(geometry[key]?.width > 0, `${key} width > 0 at ${geometry.width}`);
    }
    assert.ok(geometry.inspector.left >= -1, `inspector does not escape left at ${geometry.width}`);
    assert.ok(
        geometry.inspector.right <= geometry.viewportWidth + 1,
        `inspector does not escape right at ${geometry.width}: ${JSON.stringify(geometry.inspector)}`
    );
    assert.ok(
        geometry.documentScrollWidth <= geometry.viewportWidth + 6,
        `document has no critical horizontal clipping at ${geometry.width}: ${geometry.documentScrollWidth}/${geometry.viewportWidth}`
    );
    assert.ok(geometry.treeScrollWidth >= geometry.treeClientWidth, `tree remains horizontally reachable at ${geometry.width}`);
    if (geometry.width <= 820) {
        assert.equal(geometry.inspectorRole, 'dialog', `mobile inspector has dialog role at ${geometry.width}`);
        assert.equal(geometry.ariaModal, 'true', `mobile inspector has aria-modal at ${geometry.width}`);
        assert.equal(geometry.ariaHidden, 'false', `mobile inspector is visible at ${geometry.width}`);
        assert.equal(geometry.bodyLocked, true, `mobile inspector locks background scroll at ${geometry.width}`);
    }
}

async function assertGeometryAcrossBreakpoints(page) {
    const geometries = [];
    for (const width of VIEWPORT_WIDTHS) {
        const geometry = await geometryAt(page, width);
        assertGeometry(geometry);
        geometries.push({
            width,
            inspector: geometry.inspector,
            documentScrollWidth: geometry.documentScrollWidth
        });
    }
    return geometries;
}

async function run() {
    const base = normalizeBase(TARGET_URL);
    const session = await login(base);
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: HEADLESS });
    const live = await openAuthenticatedContext(browser, session);

    try {
        await openStructureTree(live.page, base);
        await assertTreeModeControls(live.page);
        await assertCollapseIsReadOnly(live.page);
        await assertSearch(live.page);
        await assertArchiveFilter(live.page);
        await assertQuickActions(live.page);
        await assertKeyboardNavigation(live.page);
        await assertThemeContrast(live.page, 'light');
        await assertThemeContrast(live.page, 'dark');
        const geometries = await assertGeometryAcrossBreakpoints(live.page);

        assert.deepEqual(live.blockedMutations, [], 'no HR structure mutation requests were attempted');
        assert.deepEqual(live.networkErrors, [], 'no 5xx network errors during smoke');
        assert.deepEqual(live.consoleErrors, [], 'no console errors during smoke');

        const summary = await live.page.evaluate(() => ({
            treeItems: document.querySelectorAll('#companyOrgTree [data-org-tree-select]').length,
            quickActions: document.querySelectorAll('#companyOrgTree [data-org-tree-add], #companyOrgTree [data-org-tree-more]').length,
            selectedTitle: document.getElementById('hrOrgDetailTitle')?.textContent?.trim() || '',
            hrAsset: Array.from(document.scripts).map(script => script.src).find(src => /js\/hr-page\.js/.test(src)) || ''
        }));

        console.log(JSON.stringify({
            ok: true,
            base,
            authSource: session.source,
            summary,
            geometries,
            blockedMutations: live.blockedMutations
        }, null, 2));
    } finally {
        await live.context.close();
        await browser.close();
    }
}

run().catch(error => fail(error.stack || error.message));
