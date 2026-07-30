#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..', '..');
const USER = {
    id: 9001,
    username: 'ci.sidebar',
    name: 'CI Sidebar',
    role: 'creator',
    businessContexts: ['event_genix', 'dar'],
    business_contexts: ['event_genix', 'dar'],
    defaultBusinessContext: 'event_genix',
    default_business_context: 'event_genix',
    pageAllowlist: null,
    page_allowlist: null,
    actionAllowlist: [],
    action_allowlist: []
};
const PERMISSIONS = (() => {
    const snapshot = buildCapabilitySnapshot(USER);
    return {
        role: USER.role,
        roles: [USER.role],
        pageAllowlist: [],
        actionAllowlist: [],
        actionDenylist: [],
        pages: snapshot.pages,
        actions: snapshot.actions,
        capabilities: snapshot.decisions,
        capabilityCatalog: snapshot.catalog
    };
})();
const PROFILE = {
    activeBusinessId: 'event_genix',
    activeBusinessContext: 'event_genix',
    scope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'], readOnly: false },
    businesses: [{
        key: 'event_genix',
        id: 'event_genix',
        businessContext: 'event_genix',
        shell: { timelineEnabled: true },
        timeline: { mode: 'park', enabled: true, timelineEnabled: true, roomTimelineEnabled: true, defaultTimelineView: 'rooms' },
        modules: { enabled: { timeline: true, tasks: true, customers: true, leads: true, omni: true, chat: true } }
    }]
};
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.json':'application/json' };

function playwright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            if (!/node_modules[\\/]?\.bin$/i.test(entry.replace(/[\\/]+$/, ''))) continue;
            try { return require(path.join(path.dirname(entry), 'playwright')); } catch {}
        }
        throw error;
    }
}

function fixtureServer() {
    const requests = [];
    const mutations = [];
    const json = (res, value) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        const key = `${req.method} ${url.pathname}${url.search}`;
        requests.push(key);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            mutations.push(key);
            return res.writeHead(405).end();
        }
        if (url.pathname === '/api/auth/verify') return json(res, { user: USER });
        if (url.pathname === '/api/auth/permissions') return json(res, PERMISSIONS);
        if (url.pathname === '/api/business/profile') return json(res, { businessProfile: PROFILE });
        if (/^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return json(res, []);
        if (/^\/api\/lines\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return json(res, []);
        if (url.pathname === '/api/products') return json(res, []);
        if (url.pathname.startsWith('/api/tasks')) return json(res, { tasks: [] });
        if (url.pathname.startsWith('/api/dashboard/alerts')) return json(res, { alerts: [] });
        if (url.pathname.startsWith('/api/timeline/resources')) return json(res, { resources: [] });
        if (url.pathname.startsWith('/api/')) return json(res, {});
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, requests, mutations, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

async function waitForStableCounts(page) {
    await page.waitForFunction(() => {
        const badges = [...document.querySelectorAll('[data-sidebar-timeline-count-mode]')];
        return badges.length === 2 && badges.every(badge => /^\d+$/.test(badge.textContent.trim()) && badge.dataset.sidebarTimelineCountStatus === 'ready');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-sidebar-timeline-count-status="ready"]').count(), 2, 'both runtime badges remain ready');
}

async function readState(page) {
    return page.evaluate(() => {
        const list = document.querySelector('#sidebarDesignExtras .sidebar-design-extra-list');
        const launcher = document.querySelector('[data-sidebar-timeline-launcher]');
        const rect = element => { const value = element?.getBoundingClientRect(); return { width: value?.width || 0, height: value?.height || 0, right: value?.right || 0 }; };
        return {
            href: location.href,
            timeOrigin: performance.timeOrigin,
            context: window.CrmBusinessContext?.current?.(),
            expanded: document.querySelector('[data-sidebar-extra-toggle-section]')?.getAttribute('aria-expanded'),
            editorExpanded: document.querySelector('[data-sidebar-extra-toggle-editor]')?.getAttribute('aria-expanded'),
            hidden: Boolean(list?.hidden),
            editing: document.getElementById('sidebarDesignExtras')?.classList.contains('is-editing'),
            launcher: rect(launcher),
            slotInsideList: Boolean(list?.querySelector(':scope > .sidebar-design-timeline-slot [data-sidebar-timeline-launcher]')),
            modes: [...document.querySelectorAll('[data-sidebar-timeline-mode]')].map(link => ({ key: link.dataset.sidebarTimelineMode, rect: rect(link), badge: rect(link.querySelector('[data-sidebar-timeline-count-mode]')) })),
            focusInsideList: Boolean(document.activeElement?.closest?.('.sidebar-design-extra-list'))
        };
    });
}

async function run() {
    const fixture = await fixtureServer();
    const { chromium } = playwright();
    const browser = await chromium.launch({ headless: true });
    const blocked = [];
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    await context.addInitScript(user => {
        localStorage.setItem('pzp_token', 'ci-read-only-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.setItem('pzp_sidebar_collapsed', 'false');
    }, USER);
    await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== fixture.base) {
            return route.abort('blockedbyclient');
        }
        const method = route.request().method();
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
        blocked.push(`${method} ${route.request().url()}`);
        return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
        await page.goto(`${fixture.base}/?businessContext=event_genix&date=2099-01-01`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.isAuthenticatedRuntimeReady?.() === true && document.querySelector('[data-sidebar-timeline-launcher]'));
        await waitForStableCounts(page);
        let current = await readState(page);
        const canonical = new URL(current.href);
        assert.equal(current.context, 'event_genix', 'default business context is active');
        assert.equal(canonical.searchParams.has('businessContext'), false, 'default context is canonicalized');
        assert.equal(canonical.searchParams.get('date'), '2099-01-01', 'explicit date survives canonicalization');
        assert.equal(current.slotInsideList, true, 'runtime timeline slot is inside shared Favorites list');
        assert.equal(current.expanded, 'true', 'Favorites starts expanded');
        assert.equal(current.modes.length, 2, 'both runtime modes render');
        current.modes.forEach(mode => {
            assert.ok(mode.rect.height >= 30 && mode.rect.height <= 38, `${mode.key} remains compact`);
            assert.ok(mode.badge.height >= 14 && mode.badge.height <= 18, `${mode.key} badge remains compact`);
        });

        await page.locator('[data-sidebar-extra-toggle-section]').focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('.sidebar-design-extra-list')?.hidden === true);
        current = await readState(page);
        assert.equal(current.expanded, 'false', 'Space collapses Favorites');
        assert.equal(current.launcher.height, 0, 'collapsed launcher has no geometry');
        current.modes.forEach(mode => assert.equal(mode.rect.height, 0, `collapsed ${mode.key} has no geometry`));
        await page.keyboard.press('Tab');
        assert.equal((await readState(page)).focusInsideList, false, 'Tab skips hidden controls');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.isAuthenticatedRuntimeReady?.() === true && document.querySelector('[data-sidebar-timeline-launcher]'));
        assert.equal((await readState(page)).expanded, 'false', 'collapsed state persists after reload');
        await page.locator('[data-sidebar-extra-toggle-section]').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('.sidebar-design-extra-list')?.hidden === false);
        await page.waitForTimeout(100);
        assert.equal((await readState(page)).expanded, 'true', 'Enter performs exactly one toggle');

        const timeOrigin = (await readState(page)).timeOrigin;
        await page.locator('[data-sidebar-timeline-mode="animators"]').press('Space');
        await page.waitForFunction(() => document.querySelector('[data-sidebar-timeline-mode="animators"]')?.getAttribute('aria-pressed') === 'true');
        await page.locator('[data-sidebar-timeline-mode="rooms"]').press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-sidebar-timeline-mode="rooms"]')?.getAttribute('aria-pressed') === 'true');
        current = await readState(page);
        assert.equal(current.timeOrigin, timeOrigin, 'mode switching does not reload');
        assert.equal(new URL(current.href).searchParams.get('date'), '2099-01-01', 'mode switching preserves date');

        await page.locator('[data-sidebar-extra-toggle-editor]').click();
        await page.waitForFunction(() => document.querySelector('[data-sidebar-extra-editor]'));
        current = await readState(page);
        assert.equal(current.editing, true, 'Favorites editor opens');
        assert.equal(current.editorExpanded, 'true', 'editor aria state is synchronized');
        assert.equal(current.hidden, true, 'editor hides the shared list');
        assert.equal(current.launcher.height, 0, 'editor hides launcher geometry');
        await page.locator('[data-sidebar-extra-toggle-editor]').click();
        await page.waitForFunction(() => !document.querySelector('[data-sidebar-extra-editor]'));
        current = await readState(page);
        assert.equal(current.editorExpanded, 'false', 'editor aria state resets');
        assert.equal(current.expanded, 'false', 'editor close restores collapsed state');

        assert.ok(fixture.requests.some(request => request.includes('GET /api/bookings/2099-01-01')), 'runtime requests retain explicit date');
        assert.deepEqual(blocked, [], 'browser attempted no same-origin mutation requests');
        assert.deepEqual(fixture.mutations, [], 'fixture received no mutation requests');
        console.log('Sidebar timeline real-runtime CI smoke OK');
    } finally {
        await context.close();
        await browser.close();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => {
    console.error(`Sidebar timeline real-runtime CI smoke failed: ${error.stack || error.message}`);
    process.exit(1);
});
