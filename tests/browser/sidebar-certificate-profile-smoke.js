#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            if (!/node_modules[\\/]?\.bin$/i.test(entry.replace(/[\\/]+$/, ''))) continue;
            try { return require(path.join(path.dirname(entry), 'playwright')); } catch {}
        }
        throw error;
    }
}

const ROOT = path.resolve(__dirname, '../..');
const HTML = `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/layout.css">
<link rel="stylesheet" href="/css/sidebar-aurora.css"><link rel="stylesheet" href="/css/dark-mode.css">
</head><body class="shell-ready" data-page-group="crm">
<aside id="sidebarNav" class="sidebar-nav">
  <div class="sidebar-header"><div class="sidebar-brand"><span>CRM</span></div></div>
  <div id="sidebarUserCard" class="sidebar-user-card">
    <span id="sidebarUserAvatar" class="sidebar-user-avatar">?</span>
    <div class="sidebar-user-info"><button id="sidebarUserName" class="sidebar-user-name"></button>
    <span id="sidebarUserRole" class="sidebar-user-role"></span></div>
  </div>
  <nav id="sidebarLinks" class="sidebar-links"></nav>
</aside><main id="main-content">Fixture</main>
<script>
window.AppState = { currentUser: { id: 1, name: 'Тестовий працівник', username: 'fixture', role: 'creator', roles: ['creator'] } };
window.RolePreview = { getPreviewRole: () => null, getEffectiveRole: () => 'creator' };
window.CrmBusinessContext = { current: () => 'event_genix', hasModule: () => true, activeProfile: () => null };
window.canAccessPage = page => !new URLSearchParams(location.search).has('checkOnly') || page === '/certificates/check';
</script>
<script src="/js/components/sidebar.js"></script>
<script>Sidebar.render('#sidebarLinks', { refreshOperational: false }); Sidebar.initToggle(); Sidebar.initUserCard();</script>
</body></html>`;

function fixtureServer() {
    const mutations = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            mutations.push(`${req.method} ${url.pathname}`);
            return res.writeHead(405).end();
        }
        if (url.pathname.startsWith('/api/')) return res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        if (url.pathname.startsWith('/css/') || url.pathname === '/js/components/sidebar.js') {
            const file = path.resolve(ROOT, '.' + url.pathname);
            if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
            return res.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(fs.readFileSync(file));
        }
        return res.writeHead(200, { 'content-type': 'text/html' }).end(HTML);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, mutations, base: `http://127.0.0.1:${server.address().port}` })));
}

async function main() {
    const fixture = await fixtureServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const route of ['/certificates', '/certificates/check?code=TEST', '/certificates/new', '/certificates/batch', '/hr', '/dashboard']) {
            await page.goto(fixture.base + route);
            await page.locator('#sidebarNav.has-command-identity').waitFor();
            const visible = await page.evaluate(() => ({
                legacy: getComputedStyle(document.querySelector('.sidebar-user-card')).display !== 'none',
                deck: getComputedStyle(document.querySelector('#sidebarIdentityCard')).display !== 'none',
                name: document.querySelector('#sidebarIdentityName')?.textContent,
                compact: Boolean(document.querySelector('#sidebarCompactProfile'))
            }));
            assert.equal(visible.legacy, false, `${route}: no duplicate profile`);
            assert.equal(visible.deck, true, `${route}: shared profile remains visible`);
            assert.equal(visible.name, 'Тестовий працівник');
            assert.equal(visible.compact, true, `${route}: compact profile exists`);
            if (route.startsWith('/certificates')) {
                const link = page.locator('[data-group-key="product"] a.nav-link[data-page-access="/certificates"]');
                assert.equal(await link.count(), 1, `${route}: one Product entry`);
                assert.equal(await link.getAttribute('aria-current'), 'page');
            }
        }

        await page.goto(fixture.base + '/certificates/check?checkOnly=1');
        const entry = page.locator('[data-group-key="product"] a.nav-link[data-page-access="/certificates"]');
        assert.equal(await entry.getAttribute('href'), '/certificates/check', 'check-only user gets an allowed destination');
        await page.locator('#sidebarIdentityCard').focus();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'sidebarIdentityCard');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => document.body.classList.add('dark-mode'));
        assert.equal(await page.locator('.sidebar-user-card').evaluate(element => getComputedStyle(element).display), 'none');
        await page.evaluate(() => document.getElementById('sidebarNav').classList.add('collapsed'));
        assert.equal(await page.locator('#sidebarCompactProfile').evaluate(element => getComputedStyle(element).display), 'flex');
        assert.deepEqual(errors, [], 'browser runtime errors');
        assert.deepEqual(fixture.mutations, [], 'fixture is read only');
        console.log('Sidebar certificate/profile browser smoke passed.');
    } finally {
        await browser.close();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
