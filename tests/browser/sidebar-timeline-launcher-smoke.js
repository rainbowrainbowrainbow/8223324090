#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || process.env.SIDEBAR_TIMELINE_SMOKE_URL
    || process.env.TEST_URL
    || process.env.LIVE_SMOKE_URL;
const ALLOW_NON_LOCAL = process.env.SIDEBAR_TIMELINE_SMOKE_ALLOW_PRODUCTION === 'true';
const TEST_ACCOUNT_CONFIRMED = process.env.SIDEBAR_TIMELINE_SMOKE_TEST_ACCOUNT === 'true';
const SKIP_SINGLE_CONTEXT = process.env.SIDEBAR_TIMELINE_SMOKE_SKIP_SINGLE_CONTEXT === 'true';
const HEADLESS = process.env.SIDEBAR_TIMELINE_SMOKE_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.SIDEBAR_TIMELINE_SMOKE_TIMEOUT_MS || 25000);
const PARK_CONTEXT = 'event_genix';

function fail(message) {
    console.error(`Sidebar timeline launcher smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(value) {
    try {
        return new URL(value).origin;
    } catch {
        fail(`invalid URL "${value || ''}"`);
    }
}

function isLocalBase(base) {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname);
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            try {
                return require(packageDir);
            } catch {
                // Keep looking for the npx-provided package.
            }
        }
        throw error;
    }
}

async function fetchJson(base, pathname, options = {}) {
    const response = await fetch(`${base}${pathname}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${pathname} -> ${response.status}: ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body)}`);
    }
    return body;
}

async function login(base) {
    const envToken = process.env.SIDEBAR_TIMELINE_SMOKE_TOKEN
        || process.env.TIMELINE_BROWSER_SMOKE_TOKEN
        || process.env.LIVE_SMOKE_TOKEN;
    if (envToken) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: envToken });
        return { token: envToken, user: verified.user || verified };
    }
    const username = process.env.SIDEBAR_TIMELINE_SMOKE_USER
        || process.env.TIMELINE_BROWSER_SMOKE_USER
        || process.env.LIVE_SMOKE_USER
        || process.env.TEST_USER;
    const password = process.env.SIDEBAR_TIMELINE_SMOKE_PASS
        || process.env.TIMELINE_BROWSER_SMOKE_PASS
        || process.env.LIVE_SMOKE_PASS
        || process.env.TEST_PASS;
    if (!username || !password) {
        fail('set SIDEBAR_TIMELINE_SMOKE_TOKEN or SIDEBAR_TIMELINE_SMOKE_USER/SIDEBAR_TIMELINE_SMOKE_PASS');
    }
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    if (!token) throw new Error('/api/auth/login did not return an access token');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null
    };
}

function availableBusinessContexts(user) {
    const values = [
        ...(Array.isArray(user?.businessContexts) ? user.businessContexts : []),
        ...(Array.isArray(user?.business_contexts) ? user.business_contexts : []),
        user?.defaultBusinessContext,
        user?.default_business_context
    ];
    return new Set(values.filter(Boolean).map(value => String(value).trim()));
}

function singleModeContextFor(user) {
    const requested = String(process.env.SIDEBAR_TIMELINE_SMOKE_SINGLE_CONTEXT || '').trim();
    if (requested) return requested;
    const contexts = availableBusinessContexts(user);
    return ['dar', 'maysternya_doli'].find(context => contexts.has(context)) || '';
}

function timelineRouteForContext(context, view = '') {
    const pathname = context === 'maysternya_doli' ? '/maysternya-doli' : '/';
    const url = new URL(pathname, 'http://local');
    if (context && context !== 'maysternya_doli') url.searchParams.set('businessContext', context);
    if (view) url.searchParams.set('timelineView', view);
    return `${url.pathname}${url.search}`;
}

async function waitForSidebar(page) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    try {
        await page.waitForFunction(() => {
            const sidebar = document.getElementById('sidebarNav');
            return Boolean(
                sidebar
                && document.body.classList.contains('shell-ready')
                && window.CrmBusinessContext
            );
        });
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            bodyClass: document.body.className,
            hasSidebar: Boolean(document.getElementById('sidebarNav')),
            hasBusinessContextApi: Boolean(window.CrmBusinessContext),
            currentContext: window.CrmBusinessContext?.current?.() || '',
            hasStoredToken: Boolean(localStorage.getItem('pzp_token')),
            hasStoredUser: Boolean(localStorage.getItem('pzp_current_user'))
        })).catch(() => null);
        throw new Error(`sidebar did not become ready: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
}

async function gotoContext(page, base, context, view = '') {
    try {
        await page.goto(`${base}${timelineRouteForContext(context, view)}`, { waitUntil: 'domcontentloaded' });
    } catch (error) {
        if (!/net::ERR_ABORTED|interrupted by another navigation|frame was detached/i.test(String(error?.message || error))) throw error;
    }
    await waitForSidebar(page);
    if (view) {
        await page.waitForFunction(expectedView => window.TimelineView?.current?.() === expectedView, view);
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function traverseSidebarHistory(page, direction, expected = {}) {
    const traverse = direction === 'back' ? page.goBack.bind(page) : page.goForward.bind(page);
    try {
        await traverse({ waitUntil: 'domcontentloaded' });
    } catch (error) {
        if (!/net::ERR_ABORTED|frame was detached/i.test(String(error?.message || error))) throw error;
    }
    await waitForSidebar(page);
    try {
        await page.waitForFunction(({ pathname, view }) => (
            (!pathname || location.pathname === pathname)
            && (!view || window.TimelineView?.current?.() === view)
        ), expected);
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            currentView: window.TimelineView?.current?.() || '',
            historyLength: history.length
        })).catch(() => null);
        throw new Error(`history ${direction} did not restore ${JSON.stringify(expected)}: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
}

async function readLauncher(page) {
    return page.evaluate(() => {
        const launcher = document.querySelector('[data-sidebar-timeline-launcher]');
        if (!launcher) return null;
        const directLinks = Array.from(launcher.children).filter(child => child.matches('a[href]'));
        const modes = directLinks
            .filter(link => link.matches('[data-sidebar-timeline-mode]'))
            .map(link => {
                const url = new URL(link.href, location.origin);
                return {
                    key: link.dataset.sidebarTimelineMode,
                    label: link.textContent.trim(),
                    pathname: url.pathname,
                    timelineView: url.searchParams.get('timelineView'),
                    ariaPressed: link.getAttribute('aria-pressed'),
                    ariaCurrent: link.getAttribute('aria-current')
                };
            });
        const main = launcher.querySelector(':scope > .sidebar-design-timeline-main');
        const mainUrl = main ? new URL(main.href, location.origin) : null;
        return {
            modeCount: Number(launcher.dataset.sidebarTimelineModeCount),
            activeMode: launcher.dataset.sidebarTimelineActiveMode || '',
            directLinkCount: directLinks.length,
            nestedInteractiveCount: launcher.querySelectorAll('a a, a button, button a, button button').length,
            mainPathname: mainUrl?.pathname || '',
            mainSearch: mainUrl?.search || '',
            modes
        };
    });
}

async function assertParkLauncher(page, base) {
    await gotoContext(page, base, PARK_CONTEXT, 'rooms');
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');

    const launcher = await readLauncher(page);
    assert.ok(launcher, 'Park renders the timeline launcher');
    assert.equal(launcher.modeCount, 2);
    assert.equal(launcher.directLinkCount, 3, 'main link and two mode links are direct siblings');
    assert.equal(launcher.nestedInteractiveCount, 0, 'launcher has no nested interactive elements');
    assert.equal(launcher.mainPathname, '/');
    assert.equal(launcher.mainSearch, '', 'main Park link keeps the system/last-view URL');
    assert.deepEqual(
        launcher.modes.map(mode => [mode.key, mode.label, mode.timelineView]),
        [
            ['animators', 'Свята', 'animators'],
            ['rooms', 'Кімнати', 'rooms']
        ]
    );

    const topSwitch = await page.evaluate(() => Array.from(
        document.querySelectorAll('[data-timeline-type-selector] [data-timeline-view]')
    ).map(button => ({
        key: button.dataset.timelineView,
        label: button.textContent.trim(),
        ariaLabel: button.getAttribute('aria-label')
    })));
    assert.deepEqual(topSwitch, [
        { key: 'rooms', label: 'Кімнати', ariaLabel: 'Кімнати' },
        { key: 'animators', label: 'Свята', ariaLabel: 'Свята' }
    ]);

    const timeOrigin = await page.evaluate(() => {
        window.__sidebarTimelineViewChangedCount = 0;
        window.addEventListener('timeline:view-changed', () => {
            window.__sidebarTimelineViewChangedCount += 1;
        });
        return performance.timeOrigin;
    });

    await page.locator('[data-sidebar-timeline-mode="animators"]').press('Space');
    await page.waitForFunction(() => (
        window.TimelineView?.current?.() === 'animators'
        && document.querySelector('[data-sidebar-timeline-mode="animators"]')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-sidebar-timeline-mode="animators"]')?.getAttribute('aria-current') === 'page'
    ));
    await page.waitForFunction(() => window.__sidebarTimelineViewChangedCount >= 1);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'Space switch does not reload the page');
    assert.ok(await page.evaluate(() => window.__sidebarTimelineViewChangedCount) >= 1, 'runtime dispatches timeline:view-changed');

    await page.locator('[data-sidebar-timeline-mode="rooms"]').press('Enter');
    await page.waitForFunction(() => (
        window.TimelineView?.current?.() === 'rooms'
        && document.querySelector('[data-sidebar-timeline-mode="rooms"]')?.getAttribute('aria-pressed') === 'true'
    ));
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'Enter switch does not reload the page');

    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('#sidebarToggle').click();
    await page.waitForFunction(() => (
        document.getElementById('sidebarNav')?.classList.contains('open')
        && document.body.classList.contains('sidebar-mobile-open')
    ));
    await page.locator('[data-sidebar-timeline-mode="animators"]').click();
    await page.waitForFunction(() => (
        window.TimelineView?.current?.() === 'animators'
        && !document.getElementById('sidebarNav')?.classList.contains('open')
        && !document.body.classList.contains('sidebar-mobile-open')
    ));
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'mobile switch does not reload the page');

    await page.locator('#sidebarToggle').click();
    await page.waitForFunction(() => document.getElementById('sidebarNav')?.classList.contains('open'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('sidebarNav')?.classList.contains('open'));
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.goto(`${base}/leads?businessContext=${PARK_CONTEXT}`, { waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    const crossPageLauncher = await page.evaluate(() => {
        const profile = window.CrmBusinessContext?.profileFor?.('event_genix') || null;
        return {
            present: Boolean(document.querySelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]')),
            url: location.href,
            context: window.CrmBusinessContext?.current?.() || '',
            extraLinks: Array.from(document.querySelectorAll('.sidebar-design-extra-link[href]')).map(link => link.getAttribute('href')),
            timelineMode: profile?.timeline?.mode || '',
            roomTimelineEnabled: profile?.timeline?.roomTimelineEnabled
        };
    });
    assert.equal(crossPageLauncher.present, true, `Park launcher remains available from another CRM page: ${JSON.stringify(crossPageLauncher)}`);

    await page.locator('[data-sidebar-timeline-mode="rooms"]').click();
    await waitForSidebar(page);
    try {
        await page.waitForFunction(() => (
            location.pathname === '/'
            && new URL(location.href).searchParams.get('timelineView') === 'rooms'
            && window.TimelineView?.current?.() === 'rooms'
        ));
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            currentView: window.TimelineView?.current?.() || '',
            context: window.CrmBusinessContext?.current?.() || ''
        }));
        throw new Error(`Rooms deep link did not settle: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
    await traverseSidebarHistory(page, 'back', { pathname: '/leads' });
    await traverseSidebarHistory(page, 'forward', { pathname: '/', view: 'rooms' });
    await traverseSidebarHistory(page, 'back', { pathname: '/leads' });

    await page.locator('[data-sidebar-timeline-mode="animators"]').click();
    await waitForSidebar(page);
    await page.waitForFunction(() => (
        location.pathname === '/'
        && new URL(location.href).searchParams.get('timelineView') === 'animators'
        && window.TimelineView?.current?.() === 'animators'
    ));
}

async function assertSingleModeCard(page, base, context) {
    await gotoContext(page, base, context);
    await page.waitForFunction(expectedContext => (
        window.CrmBusinessContext?.current?.() === expectedContext
        && !document.querySelector('[data-sidebar-timeline-launcher]')
        && Array.from(document.querySelectorAll('.sidebar-design-extra-link[href]')).some(link => {
            const url = new URL(link.href, location.origin);
            return url.searchParams.get('timelineView') === 'animators';
        })
    ), context);
    const card = await page.evaluate(expectedContext => {
        const launcherCount = document.querySelectorAll('[data-sidebar-timeline-launcher]').length;
        const segmentCount = document.querySelectorAll('[data-sidebar-timeline-mode]').length;
        const link = Array.from(document.querySelectorAll('.sidebar-design-extra-link[href]')).find(candidate => {
            const url = new URL(candidate.href, location.origin);
            return url.searchParams.get('timelineView') === 'animators';
        });
        const url = link ? new URL(link.href, location.origin) : null;
        return {
            launcherCount,
            segmentCount,
            pathname: url?.pathname || '',
            businessContext: url?.searchParams.get('businessContext') || '',
            timelineView: url?.searchParams.get('timelineView') || '',
            currentContext: window.CrmBusinessContext?.current?.() || ''
        };
    }, context);
    assert.equal(card.currentContext, context);
    assert.equal(card.launcherCount, 0, 'single-mode context has no launcher wrapper');
    assert.equal(card.segmentCount, 0, 'single-mode context has no segmented controls');
    assert.equal(card.timelineView, 'animators', 'single-mode card deep-links to its only mode');
    if (context === 'maysternya_doli') {
        assert.equal(card.pathname, '/maysternya-doli');
    } else {
        assert.equal(card.pathname, '/');
        assert.equal(card.businessContext, context);
    }
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or SIDEBAR_TIMELINE_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    if (!isLocalBase(base) && (!ALLOW_NON_LOCAL || !TEST_ACCOUNT_CONFIRMED)) {
        fail('non-local QA requires SIDEBAR_TIMELINE_SMOKE_ALLOW_PRODUCTION=true and SIDEBAR_TIMELINE_SMOKE_TEST_ACCOUNT=true');
    }

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail(`Playwright is not available. Run through: npx --yes --package playwright node tests/browser/sidebar-timeline-launcher-smoke.js ${base}`);
    }

    const session = await login(base);
    const singleContext = singleModeContextFor(session.user);
    if (!singleContext && !SKIP_SINGLE_CONTEXT) {
        fail('test account has no Dar/Maysternya one-mode context; set SIDEBAR_TIMELINE_SMOKE_SINGLE_CONTEXT');
    }

    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const blockedMutations = [];
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        serviceWorkers: 'block'
    });
    await context.route('**/api/**', async route => {
        const request = route.request();
        const method = request.method().toUpperCase();
        const pathname = new URL(request.url()).pathname;
        if (['GET', 'HEAD', 'OPTIONS'].includes(method) || pathname === '/api/auth/refresh') {
            await route.continue();
            return;
        }
        blockedMutations.push(`${method} ${pathname}`);
        await route.abort('blockedbyclient');
    });
    await context.addInitScript(({ token, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    try {
        await assertParkLauncher(page, base);
        if (singleContext) await assertSingleModeCard(page, base, singleContext);
        console.log(`Sidebar timeline launcher smoke OK: ${base}`);
        console.log(`  OK Park two-mode launcher, local switching, mobile close, keyboard, direct URLs and Back/Forward`);
        if (singleContext) console.log(`  OK ${singleContext} one-mode direct card`);
        else console.log('  SKIP one-mode direct card: test account has no Dar/Maysternya context');
        if (blockedMutations.length) {
            console.log(`  Safety gate blocked ${blockedMutations.length} non-read API request(s)`);
        } else {
            console.log('  Safety gate observed no non-read API requests');
        }
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

run().catch(error => fail(error?.stack || error?.message || String(error)));
