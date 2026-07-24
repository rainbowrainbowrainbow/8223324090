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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATA_DATE = normalizeOptionalDate('SIDEBAR_TIMELINE_SMOKE_DATA_DATE', process.env.SIDEBAR_TIMELINE_SMOKE_DATA_DATE);
const EMPTY_DATE = normalizeOptionalDate('SIDEBAR_TIMELINE_SMOKE_EMPTY_DATE', process.env.SIDEBAR_TIMELINE_SMOKE_EMPTY_DATE);

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

function normalizeOptionalDate(name, value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!DATE_PATTERN.test(normalized)) fail(`${name} must use YYYY-MM-DD`);
    return normalized;
}

function createDeferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function isBookingsSummaryPath(pathname) {
    return /^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(pathname);
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
    fail('set SIDEBAR_TIMELINE_SMOKE_TOKEN, TIMELINE_BROWSER_SMOKE_TOKEN, or LIVE_SMOKE_TOKEN; this smoke is read-only and does not call /api/auth/login');
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

function timelineRouteForContext(context, view = '', options = {}) {
    const pathname = context === 'maysternya_doli' ? '/maysternya-doli' : '/';
    const url = new URL(pathname, 'http://local');
    if (context && context !== 'maysternya_doli') url.searchParams.set('businessContext', context);
    if (options.date) url.searchParams.set('date', options.date);
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
        const inset = launcher.querySelector(':scope > .sidebar-design-timeline-inset');
        const main = launcher.querySelector(':scope > .sidebar-design-timeline-main');
        const modeLinks = inset ? Array.from(inset.children).filter(child => child.matches('a[href][data-sidebar-timeline-mode]')) : [];
        const launcherRect = launcher.getBoundingClientRect();
        const rectFor = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
                left: Number(rect.left.toFixed(2)),
                top: Number(rect.top.toFixed(2)),
                width: Number(rect.width.toFixed(2)),
                height: Number(rect.height.toFixed(2)),
                relLeft: Number((rect.left - launcherRect.left).toFixed(2)),
                relTop: Number((rect.top - launcherRect.top).toFixed(2))
            };
        };
        const modes = modeLinks
            .map(link => {
                const url = new URL(link.href, location.origin);
                const labelEl = link.querySelector('.sidebar-design-timeline-segment-label');
                const countEl = link.querySelector('[data-sidebar-timeline-count-mode]');
                const countRect = countEl?.getBoundingClientRect?.();
                return {
                    key: link.dataset.sidebarTimelineMode,
                    label: labelEl?.textContent?.trim() || link.textContent.trim(),
                    count: countEl?.textContent?.trim() || '',
                    countStatus: countEl?.dataset.sidebarTimelineCountStatus || '',
                    countVisible: Boolean(countEl && countRect && countRect.width > 0 && countRect.height > 0),
                    pathname: url.pathname,
                    timelineView: url.searchParams.get('timelineView'),
                    ariaPressed: link.getAttribute('aria-pressed'),
                    ariaCurrent: link.getAttribute('aria-current'),
                    ariaLabel: link.getAttribute('aria-label') || '',
                    rect: rectFor(link),
                    labelRect: rectFor(labelEl),
                    countRect: rectFor(countEl)
                };
            });
        const mainUrl = main ? new URL(main.href, location.origin) : null;
        return {
            url: location.href,
            pathname: location.pathname,
            theme: document.documentElement.getAttribute('data-theme') || (document.body.classList.contains('dark-mode') ? 'dark' : 'light'),
            darkMode: document.body.classList.contains('dark-mode'),
            sidebarOpen: document.getElementById('sidebarNav')?.classList.contains('open') || false,
            sidebarCollapsed: document.getElementById('sidebarNav')?.classList.contains('collapsed') || false,
            modeCount: Number(launcher.dataset.sidebarTimelineModeCount),
            activeMode: launcher.dataset.sidebarTimelineActiveMode || '',
            directLinkCount: directLinks.length,
            insetModeLinkCount: modeLinks.length,
            modeLinksShareInset: Boolean(inset) && modeLinks.every(link => link.parentElement === inset),
            nestedInteractiveCount: launcher.querySelectorAll('a a, a button, button a, button button').length,
            mainPathname: mainUrl?.pathname || '',
            mainSearch: mainUrl?.search || '',
            summaryCount: launcher.querySelectorAll('[data-sidebar-timeline-summary]').length,
            checkCount: launcher.querySelectorAll('.sidebar-design-timeline-segment-check').length,
            countElementCount: launcher.querySelectorAll('[data-sidebar-timeline-count-mode]').length,
            rects: {
                launcher: rectFor(launcher),
                main: rectFor(main),
                icon: rectFor(launcher.querySelector(':scope > .sidebar-design-timeline-main .sidebar-design-extra-icon')),
                copy: rectFor(launcher.querySelector(':scope > .sidebar-design-timeline-main .sidebar-design-extra-copy')),
                inset: rectFor(inset)
            },
            modes
        };
    });
}

function assertLauncherCountContract(launcher, label = 'launcher') {
    assert.ok(launcher, `${label}: launcher exists`);
    assert.equal(launcher.summaryCount, 0, `${label}: old visible timeline summary is not rendered`);
    assert.equal(launcher.checkCount, 0, `${label}: old checkmark elements are not rendered`);
    assert.equal(launcher.countElementCount, 2, `${label}: both mode counts are rendered`);
    assert.equal(launcher.modes.length, 2, `${label}: two mode links are present`);
    launcher.modes.forEach(mode => {
        assert.equal(mode.countVisible, true, `${label}: ${mode.key} count is visible`);
        assert.match(mode.count, /^(?:\d+|–)$/, `${label}: ${mode.key} count is numeric or a stable placeholder`);
        assert.match(mode.ariaLabel, /Відкрити таймлайн «.+»/, `${label}: ${mode.key} has accessible label`);
    });
}

function assertLauncherCountsReady(launcher, label = 'launcher') {
    launcher.modes.forEach(mode => {
        assert.equal(mode.countStatus, 'ready', `${label}: ${mode.key} count reached ready status`);
        assert.match(mode.count, /^\d+$/, `${label}: ${mode.key} count is numeric`);
    });
}

function modeCountNumber(launcher, key) {
    const mode = launcher.modes.find(item => item.key === key);
    assert.ok(mode, `launcher has ${key} mode`);
    assert.match(mode.count, /^\d+$/, `${key} count is numeric`);
    return Number(mode.count);
}

function assertWithinPx(actual, expected, label, tolerance = 1) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected} by more than ${tolerance}px`);
}

function assertRectParity(actual, expected, label, tolerance = 1) {
    ['width', 'height', 'relLeft', 'relTop'].forEach(key => {
        assertWithinPx(actual[key], expected[key], `${label}.${key}`, tolerance);
    });
}

function assertLauncherGeometryParity(actual, expected, label) {
    ['launcher', 'main', 'icon', 'copy', 'inset'].forEach(key => {
        assertRectParity(actual.rects[key], expected.rects[key], `${label}.${key}`);
    });
    assert.equal(actual.modes.length, expected.modes.length, `${label}: mode count changed`);
    actual.modes.forEach((mode, index) => {
        assert.equal(mode.key, expected.modes[index].key, `${label}: mode order changed at ${index}`);
        assertRectParity(mode.rect, expected.modes[index].rect, `${label}.segment.${mode.key}`);
    });
}

function assertCompactLauncherGeometry(launcher, label, options = {}) {
    assert.ok(launcher?.rects?.launcher, `${label}: launcher geometry is available`);
    const mobile = options.mobile === true;
    const launcherMax = mobile ? 104 : 96;
    const mainMin = mobile ? 38 : 36;
    const mainMax = mobile ? 44 : 42;
    const segmentMin = mobile ? 36 : 32;
    const segmentMax = mobile ? 42 : 36;
    assert.ok(launcher.rects.launcher.height <= launcherMax, `${label}: launcher height ${launcher.rects.launcher.height}px is compact`);
    assert.ok(launcher.rects.main.height >= mainMin && launcher.rects.main.height <= mainMax, `${label}: main height ${launcher.rects.main.height}px stays compact and tappable`);
    assert.ok(launcher.rects.icon.height >= 26 && launcher.rects.icon.height <= 32, `${label}: icon height ${launcher.rects.icon.height}px matches Favorites density`);
    assert.ok(launcher.rects.icon.width >= 26 && launcher.rects.icon.width <= 32, `${label}: icon width ${launcher.rects.icon.width}px matches Favorites density`);
    launcher.modes.forEach(mode => {
        assert.ok(mode.rect.height >= segmentMin && mode.rect.height <= segmentMax, `${label}: ${mode.key} segment height ${mode.rect.height}px stays compact and tappable`);
        assert.ok(mode.countRect?.height >= 14 && mode.countRect.height <= 18, `${label}: ${mode.key} count badge height ${mode.countRect?.height}px is compact`);
        assert.ok(mode.countRect?.width >= 14, `${label}: ${mode.key} count badge keeps visible width`);
        assert.ok(mode.labelRect && mode.labelRect.right <= mode.countRect.left - 1, `${label}: ${mode.key} label and count do not overlap`);
    });
}
async function waitForLauncherCounts(page) {
    await page.waitForFunction(() => {
        const launcher = document.querySelector('[data-sidebar-timeline-launcher]');
        const counts = Array.from(launcher?.querySelectorAll('[data-sidebar-timeline-count-mode]') || []);
        return counts.length === 2 && counts.every(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && /^\d+$/.test(el.textContent.trim()) && el.dataset.sidebarTimelineCountStatus === 'ready';
        });
    });
}

async function assertLauncherCountsForDate(page, base, date, kind) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => {
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.setItem('pzp_sidebar_collapsed', 'false');
        localStorage.setItem('pzp_timeline_view', 'rooms');
        localStorage.removeItem('eg_sidebar_extra_menu_items_v3');
    });
    const view = kind === 'data' ? 'rooms' : '';
    await page.goto(`${base}${timelineRouteForContext(PARK_CONTEXT, view, { date })}`, { waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
    await waitForLauncherCounts(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const launcher = await readLauncher(page);
    assertLauncherCountContract(launcher, `${kind} date ${date}`);
    assertLauncherCountsReady(launcher, `${kind} date ${date}`);
    assert.equal(launcher.modes.every(mode => mode.countVisible), true, `${kind} date ${date}: active and inactive counts are visible`);

    const animators = modeCountNumber(launcher, 'animators');
    const rooms = modeCountNumber(launcher, 'rooms');
    if (kind === 'data') {
        assert.ok(animators > 0 || rooms > 0, `data date ${date}: at least one timeline mode has visible records`);
    } else {
        const currentUrl = new URL(launcher.url);
        assert.equal(currentUrl.pathname, '/', `empty date ${date}: timeline route is /`);
        assert.equal(currentUrl.searchParams.get('businessContext'), PARK_CONTEXT, `empty date ${date}: Park context is preserved`);
        assert.equal(currentUrl.searchParams.get('date'), date, `empty date ${date}: URL date is preserved`);
        assert.equal(currentUrl.searchParams.get('timelineView'), null, `empty date ${date}: URL keeps the explicit no-view route`);
        assert.equal(animators, 0, `empty date ${date}: animators count is 0`);
        assert.equal(rooms, 0, `empty date ${date}: rooms count is 0`);
    }
}

async function assertLoadingLayoutStability(page, base, requestControl) {
    const delayedBookings = {
        release: createDeferred(),
        hitCount: 0
    };
    requestControl.delayedBookings = delayedBookings;
    try {
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.evaluate(() => {
            localStorage.setItem('pzp_dark_mode', 'true');
            localStorage.setItem('pzp_sidebar_collapsed', 'false');
            localStorage.setItem('pzp_timeline_view', 'rooms');
            localStorage.removeItem('eg_sidebar_extra_menu_items_v3');
        });
        await page.goto(`${base}/dashboard?businessContext=${PARK_CONTEXT}`, { waitUntil: 'domcontentloaded' });
        await waitForSidebar(page);
        await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
        await page.waitForFunction(() => {
            const counts = Array.from(document.querySelectorAll('[data-sidebar-timeline-count-mode]'));
            return counts.length === 2 && counts.every(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }) && counts.some(el => el.dataset.sidebarTimelineCountStatus === 'loading');
        });
        assert.ok(delayedBookings.hitCount > 0, 'loading stability check delayed at least one bookings summary request');

        const loading = await readLauncher(page);
        assertLauncherCountContract(loading, 'loading layout');
        assert.ok(loading.modes.some(mode => mode.countStatus === 'loading'), 'loading layout: at least one count is loading');

        delayedBookings.release.resolve();
        await waitForLauncherCounts(page);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        const ready = await readLauncher(page);
        assertLauncherCountContract(ready, 'ready layout');
        assertLauncherCountsReady(ready, 'ready layout');
        assertLauncherGeometryParity(ready, loading, 'loading vs ready launcher geometry');
    } finally {
        delayedBookings.release.resolve();
        if (requestControl.delayedBookings === delayedBookings) requestControl.delayedBookings = null;
    }
}

async function openMobileSidebar(page) {
    await page.waitForFunction(() => Boolean(document.getElementById('sidebarToggle') && document.getElementById('sidebarNav')));
    const isOpen = await page.evaluate(() => document.getElementById('sidebarNav')?.classList.contains('open'));
    if (!isOpen) await page.locator('#sidebarToggle').click();
    await page.waitForFunction(() => (
        document.getElementById('sidebarNav')?.classList.contains('open')
        && document.body.classList.contains('sidebar-mobile-open')
    ));
}

async function captureParkLauncherSurface(page, base, pathname, viewport) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    if (viewport.width <= 768) await openMobileSidebar(page);
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
    await waitForLauncherCounts(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const launcher = await readLauncher(page);
    assertLauncherCountContract(launcher, pathname);
    assertLauncherCountsReady(launcher, pathname);
    assert.equal(launcher.theme, 'dark', `${pathname}: dark theme is pinned for parity smoke`);
    assert.equal(launcher.darkMode, true, `${pathname}: body has dark-mode class`);
    if (viewport.width <= 768) assert.equal(launcher.sidebarOpen, true, `${pathname}: mobile sidebar is open`);
    else assert.equal(launcher.sidebarCollapsed, false, `${pathname}: desktop sidebar is expanded`);
    assertCompactLauncherGeometry(launcher, pathname, { mobile: viewport.width <= 768 });
    return launcher;
}

async function assertLauncherSurfaceParity(page, base) {
    const surfaces = [
        { name: 'desktop', viewport: { width: 1440, height: 960 } },
        { name: 'mobile', viewport: { width: 320, height: 800 } }
    ];
    for (const surface of surfaces) {
        await page.evaluate(() => {
            localStorage.setItem('pzp_dark_mode', 'true');
            localStorage.setItem('pzp_sidebar_collapsed', 'false');
            localStorage.setItem('pzp_timeline_view', 'rooms');
            localStorage.removeItem('eg_sidebar_extra_menu_items_v3');
        });
        const timeline = await captureParkLauncherSurface(page, base, `/?businessContext=${PARK_CONTEXT}&timelineView=rooms`, surface.viewport);
        await page.evaluate(() => {
            localStorage.setItem('pzp_dark_mode', 'true');
            localStorage.setItem('pzp_sidebar_collapsed', 'false');
            localStorage.setItem('pzp_timeline_view', 'rooms');
        });
        const dashboard = await captureParkLauncherSurface(page, base, `/dashboard?businessContext=${PARK_CONTEXT}`, surface.viewport);
        assert.equal(timeline.activeMode, dashboard.activeMode, `${surface.name}: active mode parity`);
        assert.equal(timeline.modeCount, dashboard.modeCount, `${surface.name}: mode count parity`);
        assert.deepEqual(
            timeline.modes.map(mode => [mode.key, mode.label, mode.timelineView]),
            dashboard.modes.map(mode => [mode.key, mode.label, mode.timelineView]),
            `${surface.name}: mode DOM contract parity`
        );
        assertLauncherGeometryParity(dashboard, timeline, `${surface.name} /dashboard vs /`);
    }
}

async function readFavoritesTimelineState(page) {
    return page.evaluate(() => {
        const extras = document.getElementById('sidebarDesignExtras');
        const toggle = extras?.querySelector('[data-sidebar-extra-toggle-section]');
        const editorToggle = extras?.querySelector('[data-sidebar-extra-toggle-editor]');
        const list = extras?.querySelector('.sidebar-design-extra-list');
        const editor = extras?.querySelector('[data-sidebar-extra-editor]');
        const launcher = extras?.querySelector('[data-sidebar-timeline-launcher]');
        const rectFor = element => {
            if (!element) return { width: 0, height: 0, left: 0, right: 0 };
            const rect = element.getBoundingClientRect();
            return {
                width: Number(rect.width.toFixed(2)),
                height: Number(rect.height.toFixed(2)),
                left: Number(rect.left.toFixed(2)),
                right: Number(rect.right.toFixed(2))
            };
        };
        const modeRects = Array.from(extras?.querySelectorAll('[data-sidebar-timeline-mode]') || []).map(rectFor);
        const active = document.activeElement;
        return {
            hasExtras: Boolean(extras),
            ariaExpanded: toggle?.getAttribute('aria-expanded') || '',
            editorAriaExpanded: editorToggle?.getAttribute('aria-expanded') || '',
            collapsedClass: Boolean(extras?.classList.contains('is-collapsed')),
            editingClass: Boolean(extras?.classList.contains('is-editing')),
            listHidden: Boolean(list?.hidden),
            editorVisible: Boolean(editor && rectFor(editor).height > 0),
            launcherPresent: Boolean(launcher),
            launcherVisible: Boolean(launcher && rectFor(launcher).width > 0 && rectFor(launcher).height > 0),
            modeVisibleCount: modeRects.filter(rect => rect.width > 0 && rect.height > 0).length,
            localCollapsed: localStorage.getItem('eg_sidebar_extra_menu_collapsed_v1') || '',
            localEditor: localStorage.getItem('eg_sidebar_extra_menu_edit_v1') || '',
            focusedTimelineControl: Boolean(active?.matches?.('[data-sidebar-timeline-mode], .sidebar-design-timeline-main')),
            focusedEditorToggle: Boolean(active === editorToggle),
            focusedHref: active?.getAttribute?.('href') || '',
            launcherRect: rectFor(launcher)
        };
    });
}

function assertFavoritesTimelineExpanded(state, label) {
    assert.equal(state.hasExtras, true, `${label}: Favorites block exists`);
    assert.equal(state.ariaExpanded, 'true', `${label}: Favorites aria-expanded is true`);
    assert.equal(state.collapsedClass, false, `${label}: Favorites is not collapsed`);
    assert.equal(state.listHidden, false, `${label}: Favorites list is visible`);
    assert.equal(state.launcherPresent, true, `${label}: launcher remains mounted`);
    assert.equal(state.launcherVisible, true, `${label}: launcher is visible`);
    assert.equal(state.modeVisibleCount, 2, `${label}: both timeline modes have visible geometry`);
}

function assertFavoritesTimelineCollapsed(state, label) {
    assert.equal(state.hasExtras, true, `${label}: Favorites block exists`);
    assert.equal(state.ariaExpanded, 'false', `${label}: Favorites aria-expanded is false`);
    assert.equal(state.collapsedClass, true, `${label}: Favorites has collapsed class`);
    assert.equal(state.listHidden, true, `${label}: Favorites list is hidden`);
    assert.equal(state.launcherPresent, true, `${label}: launcher remains mounted inside collapsible content`);
    assert.equal(state.launcherVisible, false, `${label}: launcher has no visible geometry`);
    assert.equal(state.modeVisibleCount, 0, `${label}: hidden timeline modes have no visible geometry`);
    assert.equal(state.localCollapsed, 'true', `${label}: collapsed state is persisted`);
}

async function assertFavoritesTimelineCollapseBehavior(page, base) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/dashboard?businessContext=${PARK_CONTEXT}`, { waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.evaluate(() => {
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.setItem('pzp_sidebar_collapsed', 'false');
        localStorage.setItem('pzp_timeline_view', 'rooms');
        localStorage.removeItem('eg_sidebar_extra_menu_collapsed_v1');
        localStorage.removeItem('eg_sidebar_extra_menu_edit_v1');
        localStorage.removeItem('eg_sidebar_extra_menu_items_v3');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
    assertFavoritesTimelineExpanded(await readFavoritesTimelineState(page), 'initial expanded Favorites');

    await page.locator('[data-sidebar-extra-toggle-section]').click();
    await page.waitForFunction(() => {
        const extras = document.getElementById('sidebarDesignExtras');
        return extras?.classList.contains('is-collapsed')
            && extras.querySelector('.sidebar-design-extra-list')?.hidden === true;
    });
    assertFavoritesTimelineCollapsed(await readFavoritesTimelineState(page), 'click collapsed Favorites');

    await page.locator('[data-sidebar-extra-toggle-section]').focus();
    await page.keyboard.press('Tab');
    const afterTab = await readFavoritesTimelineState(page);
    assert.equal(afterTab.focusedTimelineControl, false, 'Tab does not focus hidden timeline controls while Favorites is collapsed');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    assertFavoritesTimelineCollapsed(await readFavoritesTimelineState(page), 'reload keeps Favorites collapsed');

    await page.locator('[data-sidebar-extra-toggle-section]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-sidebar-extra-toggle-section]')?.getAttribute('aria-expanded') === 'true');
    assertFavoritesTimelineExpanded(await readFavoritesTimelineState(page), 'Space expands Favorites');

    await page.locator('[data-sidebar-extra-toggle-section]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-sidebar-extra-toggle-section]')?.getAttribute('aria-expanded') === 'false');
    assertFavoritesTimelineCollapsed(await readFavoritesTimelineState(page), 'Enter collapses Favorites');

    await page.locator('[data-sidebar-extra-toggle-section]').click();
    await page.waitForFunction(() => document.querySelector('[data-sidebar-extra-toggle-section]')?.getAttribute('aria-expanded') === 'true');
    await page.locator('[data-sidebar-extra-toggle-editor]').click();
    await page.waitForFunction(() => {
        const extras = document.getElementById('sidebarDesignExtras');
        return extras?.classList.contains('is-editing')
            && extras.querySelector('.sidebar-design-extra-list')?.hidden === true
            && Boolean(extras.querySelector('[data-sidebar-extra-editor]'));
    });
    const editorOpen = await readFavoritesTimelineState(page);
    assert.equal(editorOpen.editorAriaExpanded, 'true', 'Favorites editor toggle aria-expanded is true while editor is open');
    assert.equal(editorOpen.editorVisible, true, 'Favorites editor is visible');
    assert.equal(editorOpen.launcherVisible, false, 'Favorites editor hides timeline launcher with the shared hidden list');
    assert.equal(editorOpen.modeVisibleCount, 0, 'Favorites editor hides timeline mode geometry');

    await page.locator('[data-sidebar-extra-toggle-editor]').click();
    await page.waitForFunction(() => {
        const extras = document.getElementById('sidebarDesignExtras');
        return !extras?.classList.contains('is-editing')
            && extras?.classList.contains('is-collapsed')
            && extras.querySelector('.sidebar-design-extra-list')?.hidden === true;
    });
    assertFavoritesTimelineCollapsed(await readFavoritesTimelineState(page), 'closing editor returns Favorites to collapsed state');

    await page.locator('[data-sidebar-extra-toggle-section]').click();
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
    assertFavoritesTimelineExpanded(await readFavoritesTimelineState(page), 'final click restores launcher');
}
async function assertParkLauncher(page, base) {
    await gotoContext(page, base, PARK_CONTEXT, 'rooms');
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');

    const launcher = await readLauncher(page);
    assert.ok(launcher, 'Park renders the timeline launcher');
    assert.equal(launcher.modeCount, 2);
    assert.equal(launcher.directLinkCount, 1, 'only the main timeline link is a direct launcher link');
    assert.equal(launcher.insetModeLinkCount, 2, 'two mode links are siblings inside the inset selector');
    assert.equal(launcher.modeLinksShareInset, true, 'mode links share one inset parent');
    assert.equal(launcher.nestedInteractiveCount, 0, 'launcher has no nested interactive elements');
    assertLauncherCountContract(launcher, '/');
    assert.equal(launcher.mainPathname, '/');
    assert.equal(launcher.mainSearch, '', 'main Park link keeps the system/last-view URL');
    assert.deepEqual(
        launcher.modes.map(mode => [mode.key, mode.label, mode.timelineView]),
        [
            ['animators', 'Свята', 'animators'],
            ['rooms', 'Кімнати', 'rooms']
        ]
    );
    const topSwitch = await page.evaluate(() => document.querySelectorAll('[data-timeline-type-selector], #timelineTypeSelector, .timeline-visible-type-switch').length);
    assert.equal(topSwitch, 0, 'legacy header timeline type selector is removed');

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
        && document.querySelector('[data-sidebar-timeline-mode="animators"]')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-sidebar-timeline-launcher]')?.dataset.sidebarTimelineActiveMode === 'animators'
        && !document.getElementById('sidebarNav')?.classList.contains('open')
        && !document.body.classList.contains('sidebar-mobile-open')
    ));
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'mobile switch does not reload the page');

    await page.locator('#sidebarToggle').click();
    await page.waitForFunction(() => document.getElementById('sidebarNav')?.classList.contains('open'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('sidebarNav')?.classList.contains('open'));
    await page.evaluate(() => localStorage.setItem('pzp_sidebar_collapsed', 'true'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.waitForFunction(() => document.getElementById('sidebarNav')?.classList.contains('collapsed'));
    await page.locator('#sidebarToggle').click();
    await page.waitForFunction(() => {
        const sidebar = document.getElementById('sidebarNav');
        const launcher = document.querySelector('[data-sidebar-timeline-launcher]');
        const rect = launcher?.getBoundingClientRect?.();
        return Boolean(
            sidebar?.classList.contains('open')
            && !sidebar.classList.contains('collapsed')
            && document.body.classList.contains('sidebar-mobile-open')
            && rect
            && rect.width > 0
            && rect.right >= 0
            && rect.left <= window.innerWidth
        );
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
        const sidebar = document.getElementById('sidebarNav');
        return !sidebar?.classList.contains('open') && sidebar?.classList.contains('collapsed');
    });

    await page.evaluate(() => {
        localStorage.setItem('pzp_sidebar_collapsed', 'false');
        localStorage.setItem('eg_sidebar_extra_menu_items_v3', JSON.stringify([{
            id: 'smoke_staff_only',
            label: 'Staff only',
            href: '/staff',
            hidden: false,
            custom: true
        }]));
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.waitForSelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]');
    assert.equal(
        await page.locator('[data-sidebar-timeline-launcher]').count(),
        1,
        'timeline launcher survives a saved Favorites selection without the timeline href'
    );
    await page.evaluate(() => localStorage.removeItem('eg_sidebar_extra_menu_items_v3'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);

    await page.goto(`${base}/leads?businessContext=${PARK_CONTEXT}`, { waitUntil: 'domcontentloaded' });
    await waitForSidebar(page);
    await page.waitForFunction(() => {
        const profile = window.CrmBusinessContext?.profileFor?.('event_genix') || null;
        return profile?.timeline?.mode === 'park'
            && profile?.timeline?.roomTimelineEnabled === true
            && Boolean(document.querySelector('[data-sidebar-timeline-launcher][data-sidebar-timeline-mode-count="2"]'));
    });
    const crossPagePath = new URL(page.url()).pathname;
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
    await traverseSidebarHistory(page, 'back', { pathname: crossPagePath });
    await traverseSidebarHistory(page, 'forward', { pathname: '/', view: 'rooms' });
    await traverseSidebarHistory(page, 'back', { pathname: crossPagePath });

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
    const localBase = isLocalBase(base);
    if (!localBase && (!ALLOW_NON_LOCAL || !TEST_ACCOUNT_CONFIRMED)) {
        fail('non-local QA requires SIDEBAR_TIMELINE_SMOKE_ALLOW_PRODUCTION=true and SIDEBAR_TIMELINE_SMOKE_TEST_ACCOUNT=true');
    }
    if (!localBase && (!DATA_DATE || !EMPTY_DATE)) {
        fail('non-local QA requires SIDEBAR_TIMELINE_SMOKE_DATA_DATE and SIDEBAR_TIMELINE_SMOKE_EMPTY_DATE');
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
    const requestControl = {
        delayedBookings: null
    };
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        serviceWorkers: 'block'
    });
    await context.route('**/*', async route => {
        const request = route.request();
        const method = request.method().toUpperCase();
        const url = new URL(request.url());
        const pathname = url.pathname;
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
            if (requestControl.delayedBookings && method === 'GET' && isBookingsSummaryPath(pathname)) {
                requestControl.delayedBookings.hitCount += 1;
                await requestControl.delayedBookings.release.promise;
            }
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
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.setItem('pzp_sidebar_collapsed', 'false');
        localStorage.setItem('pzp_timeline_view', 'rooms');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    try {
        await assertLauncherSurfaceParity(page, base);
        if (DATA_DATE) await assertLauncherCountsForDate(page, base, DATA_DATE, 'data');
        else console.log('  SKIP data-date count assertion: SIDEBAR_TIMELINE_SMOKE_DATA_DATE is not set');
        if (EMPTY_DATE) await assertLauncherCountsForDate(page, base, EMPTY_DATE, 'empty');
        else console.log('  SKIP empty-date zero-count assertion: SIDEBAR_TIMELINE_SMOKE_EMPTY_DATE is not set');
        await assertLoadingLayoutStability(page, base, requestControl);
        await assertFavoritesTimelineCollapseBehavior(page, base);
        await assertParkLauncher(page, base);
        if (singleContext) await assertSingleModeCard(page, base, singleContext);
        assert.deepEqual(blockedMutations, [], 'read-only launcher smoke attempted no non-read requests');
        console.log(`Sidebar timeline launcher smoke OK: ${base}`);
        console.log(`  OK Park two-mode launcher, / vs /dashboard parity, desktop/mobile geometry, local switching, mobile close, keyboard, direct URLs and Back/Forward`);
        if (DATA_DATE) console.log(`  OK data-date counts for ${DATA_DATE}`);
        if (EMPTY_DATE) console.log(`  OK empty-date zero counts for ${EMPTY_DATE}`);
        console.log('  OK loading-to-ready launcher geometry parity');
        console.log('  OK Favorites collapse, reload persistence, editor and keyboard navigation');
        if (singleContext) console.log(`  OK ${singleContext} one-mode direct card`);
        else console.log('  SKIP one-mode direct card: test account has no Dar/Maysternya context');
        console.log('  Safety gate observed no non-read requests');
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

run().catch(error => fail(error?.stack || error?.message || String(error)));
