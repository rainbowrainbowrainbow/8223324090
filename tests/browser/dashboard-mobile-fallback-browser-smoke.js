#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'dashboard-mobile-fallback-smoke');
const VIEWPORTS = Object.freeze([
    Object.freeze({ label: '360', width: 360, height: 800 }),
    Object.freeze({ label: '390', width: 390, height: 844 }),
    Object.freeze({ label: '768', width: 768, height: 900 }),
    Object.freeze({ label: '1440', width: 1440, height: 950 })
]);
const THEMES = Object.freeze(['light', 'dark']);
const SIDEBAR_STATES = Object.freeze(['expanded', 'collapsed']);

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readCssWithImports(relPath, seen = new Set()) {
    const normalized = relPath.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);
    const css = read(normalized);
    const dir = path.posix.dirname(normalized);
    const imports = [];
    const importPattern = /@import\s+(?:url\()?['"]?([^"')]+\.css(?:\?[^"')]+)?)['"]?\)?\s*;?/g;
    let match;
    while ((match = importPattern.exec(css)) !== null) {
        const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
        const imported = rawRef.startsWith('css/')
            ? rawRef
            : path.posix.normalize(path.posix.join(dir, rawRef));
        imports.push(readCssWithImports(imported, seen));
    }
    return [css, ...imports].filter(Boolean).join('\n');
}

function instrumentDashboardSource() {
    const source = read('js/dashboard-page.js');
    const injection = /    return \{\r?\n        init,/;
    assert.match(source, injection, 'dashboard injection point must exist');
    return source.replace(injection, `
    window.__dashboardMobileFallbackSmoke = {
        setConfig(config) { _config = normalizeDashboardConfig(config); },
        renderWidgets,
        renderDashboardOpenFallback,
        retryDashboardBoardRender,
        boardSnapshot() { return JSON.stringify(_config?.boardState || null); }
    };

    return {
        init,`);
}

function fixtureHtml() {
    return `<!doctype html><html lang="uk" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${readCssWithImports('css/dashboard.css')}</style>
<style data-smoke-stability>*,*::before,*::after{animation:none!important;transition:none!important}body{margin:0}.app-container{min-width:0}.main-content{min-width:0;max-width:100%;padding:0}.sidebar{width:248px}.sidebar.collapsed{width:72px}</style>
</head><body class="authenticated-shell shell-ready">
<div class="app-container">
  <aside id="sidebar" class="sidebar" aria-label="Навігація"></aside>
  <div class="main-content" id="mainApp">
    <main class="dashboard-page">
      <header class="dashboard-header">
        <div><h1>Dashboard</h1><p class="dashboard-greeting">Мобільний smoke</p></div>
        <div class="dashboard-actions">
          <button type="button" class="dashboard-btn primary" id="dashboardAddWidgetBtn" onclick="DashboardPage.openWidgetManager()">Додати віджет</button>
          <button type="button" class="dashboard-btn" id="dashboardSettingsBtn" onclick="DashboardPage.openSettings()">Налаштувати</button>
        </div>
      </header>
      <div id="dashboardBoardToolbar" class="dashboard-board-toolbar dashboard-workspace-toolbar" aria-label="Єдина робоча сцена дашборду">
        <div class="dashboard-workspace-status"><span id="boardUnifiedModeLabel" class="dashboard-mode-btn">Єдиний режим</span><div class="dashboard-workspace-title"><span>Workspace</span><strong>Єдина sandbox-сцена</strong><em>Esc повертає вибір</em></div></div>
        <div id="boardToolOptions" class="board-tool-options"></div>
      </div>
      <div class="dashboard-workspace-stage">
        <div id="boardEditControls" class="board-pro-palette board-tool-rail">
          <div class="board-tools-group board-palette-group board-tool-family" data-board-tool-family="navigate" data-board-tool-family-label="Навігація"><button type="button" class="dashboard-btn" data-board-tool="select" data-tool-label="Вибір" onclick="DashboardPage.setBoardTool('select')">Вибір</button><button type="button" class="dashboard-btn" data-board-tool="hand" data-tool-label="Рука" onclick="DashboardPage.setBoardTool('hand')">Рука</button></div>
          <div class="board-actions-group board-palette-group board-tool-family" data-board-tool-family="actions" data-board-tool-family-label="Дії"><button type="button" id="boardUndoBtn" class="dashboard-btn" data-board-action="undo">Назад</button><button type="button" id="boardRedoBtn" class="dashboard-btn" data-board-action="redo">Вперед</button><span class="board-save-status" id="boardSaveStatus" data-state="saved">Збережено</span></div>
        </div>
        <section id="dashboardBoardShell" class="dashboard-board-shell hidden"><div id="dashboardBoardCanvas" class="dashboard-board-canvas" aria-label="Dashboard board canvas"></div></section>
      </div>
      <div id="dashboardGrid" class="dashboard-grid"><div class="widget-loading">Завантаження...</div></div>
    </main>
  </div>
</div>
<script>
window.AppState = { currentUser: { id: 7, username: 'creator', role: 'creator' } };
window.getUserRole = () => 'creator';
window.hasMinRole = () => true;
window.canAccessPage = () => true;
window.resolveCapability = () => ({ allowed: false });
window.CrmBusinessContext = {
    current: () => 'event_genix',
    scope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
    apiUrl: url => url
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
localStorage.setItem('pzp_token', 'test-token');
localStorage.setItem('pzp_auth_session_generation', 'session-1');
</script>
<script>${instrumentDashboardSource()}</script>
</body></html>`;
}

function boardConfig() {
    return {
        widgets: ['tasks'],
        mode: 'workspace',
        layout: {},
        boardState: {
            items: [
                { id: 'weather-widget', type: 'widget', widgetType: 'weather', title: 'weather', depth: 'live-compact', x: 28, y: 80, w: 320, h: 220, z: 1 },
                { id: 'note-mobile', type: 'note', title: 'Mobile note', body: 'Перевірка введення нотатки', x: 380, y: 90, w: 260, h: 170, z: 2 }
            ],
            drawings: [],
            connectors: [],
            preferences: { maxLiveWidgets: 8, showGrid: true, showGuides: true }
        }
    };
}

async function waitForStableLayout(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function bootstrapPage(page, viewport, theme, sidebarState) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('http://127.0.0.1/dashboard', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ theme: nextTheme, sidebarState: nextSidebarState, config }) => {
        window.AppState = { currentUser: { id: 7, username: 'creator', role: 'creator' } };
        window.getUserRole = () => 'creator';
        window.hasMinRole = () => true;
        window.canAccessPage = () => true;
        window.resolveCapability = () => ({ allowed: false });
        window.CrmBusinessContext = {
            current: () => 'event_genix',
            scope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
            apiUrl: url => url
        };
        window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
        localStorage.setItem('pzp_token', 'test-token');
        localStorage.setItem('pzp_auth_session_generation', 'session-1');
        document.documentElement.dataset.theme = nextTheme;
        document.body.classList.toggle('dark-mode', nextTheme === 'dark');
        document.getElementById('sidebar')?.classList.toggle('collapsed', nextSidebarState === 'collapsed');
        window.__dashboardMobileFallbackSmoke.setConfig(config);
        window.__dashboardMobileFallbackSmoke.renderWidgets();
    }, { theme, sidebarState, config: boardConfig() });
    await waitForStableLayout(page);
}

async function collectLayout(page) {
    return page.evaluate(() => {
        const rect = selector => {
            const element = document.querySelector(selector);
            const box = element?.getBoundingClientRect();
            const style = element ? getComputedStyle(element) : null;
            return box ? {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                height: box.height,
                display: style.display,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                visibility: style.visibility
            } : null;
        };
        const viewportWidth = window.innerWidth;
        const selectors = [
            '.dashboard-page',
            '.dashboard-header',
            '.dashboard-actions',
            '#dashboardAddWidgetBtn',
            '#dashboardSettingsBtn',
            '#dashboardBoardToolbar',
            '#boardEditControls',
            '#boardSaveStatus',
            '#dashboardBoardShell'
        ];
        return {
            viewportWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            boxes: Object.fromEntries(selectors.map(selector => [selector, rect(selector)])),
            shell: {
                clientWidth: document.getElementById('dashboardBoardShell').clientWidth,
                scrollWidth: document.getElementById('dashboardBoardShell').scrollWidth,
                clientHeight: document.getElementById('dashboardBoardShell').clientHeight,
                scrollHeight: document.getElementById('dashboardBoardShell').scrollHeight
            }
        };
    });
}

function assertInViewport(metrics, selector) {
    const box = metrics.boxes[selector];
    assert.ok(box, `${selector} exists`);
    assert.notEqual(box.display, 'none', `${selector} is displayed`);
    assert.ok(box.right <= metrics.viewportWidth + 1, `${selector} does not overflow viewport: right ${box.right}, viewport ${metrics.viewportWidth}`);
    assert.ok(box.left >= -1, `${selector} does not start outside viewport`);
}

async function verifyNormalLayout(page, label) {
    const metrics = await collectLayout(page);
    assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, `${label}: page has no horizontal overflow (${metrics.documentWidth}/${metrics.viewportWidth})`);
    assertInViewport(metrics, '.dashboard-page');
    assertInViewport(metrics, '.dashboard-header');
    assertInViewport(metrics, '#dashboardAddWidgetBtn');
    assertInViewport(metrics, '#dashboardSettingsBtn');
    assertInViewport(metrics, '#dashboardBoardToolbar');
    assertInViewport(metrics, '#boardEditControls');
    assertInViewport(metrics, '#dashboardBoardShell');
    assert.ok(metrics.boxes['#dashboardAddWidgetBtn'].height >= 40, `${label}: add widget touch target is usable`);
    assert.ok(metrics.boxes['#dashboardSettingsBtn'].height >= 40, `${label}: settings touch target is usable`);
    assert.ok(metrics.boxes['#boardSaveStatus'].height >= 20, `${label}: save status remains visible`);
    assert.ok(metrics.shell.scrollWidth >= metrics.shell.clientWidth, `${label}: canvas scroll area is preserved`);
    assert.ok(metrics.shell.scrollHeight >= metrics.shell.clientHeight, `${label}: vertical canvas scroll area is preserved`);
    await page.locator('[data-board-tool="hand"]').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('.board-note-text').first().click();
    await page.keyboard.type(' mobile input');
    await page.keyboard.press('Escape');
}

async function verifyFallback(page, label) {
    const before = await page.evaluate(() => window.__dashboardMobileFallbackSmoke.boardSnapshot());
    await page.evaluate(() => window.__dashboardMobileFallbackSmoke.renderDashboardOpenFallback(new Error('forced browser smoke failure'), 'browser-smoke'));
    await waitForStableLayout(page);
    const fallback = await page.evaluate(() => ({
        boardSnapshot: window.__dashboardMobileFallbackSmoke.boardSnapshot(),
        gridHidden: document.getElementById('dashboardGrid').classList.contains('hidden'),
        ariaHidden: document.getElementById('dashboardGrid').getAttribute('aria-hidden'),
        hasBanner: Boolean(document.querySelector('.dashboard-fallback-banner')),
        hasWeather: Boolean(document.getElementById('widget-weather')),
        hasTasks: Boolean(document.getElementById('widget-tasks')),
        shellFallback: document.getElementById('dashboardBoardShell').classList.contains('dashboard-render-fallback'),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
    }));
    assert.equal(fallback.boardSnapshot, before, `${label}: fallback does not mutate boardState`);
    assert.equal(fallback.gridHidden, false, `${label}: fallback grid is visible`);
    assert.equal(fallback.ariaHidden, null, `${label}: fallback grid is accessible`);
    assert.equal(fallback.hasBanner, true, `${label}: fallback banner is visible`);
    assert.equal(fallback.hasWeather, true, `${label}: board-only widget appears in fallback`);
    assert.equal(fallback.hasTasks, true, `${label}: config widget appears in fallback`);
    assert.equal(fallback.shellFallback, true, `${label}: shell carries fallback state`);
    assert.ok(fallback.documentWidth <= fallback.viewportWidth + 1, `${label}: fallback has no page overflow`);
    await page.locator('.dashboard-board-warning .dashboard-btn').click();
    await waitForStableLayout(page);
    const retry = await page.evaluate(() => ({
        boardSnapshot: window.__dashboardMobileFallbackSmoke.boardSnapshot(),
        gridHidden: document.getElementById('dashboardGrid').classList.contains('hidden'),
        shellFallback: document.getElementById('dashboardBoardShell').classList.contains('dashboard-render-fallback'),
        hasBoardWidget: Boolean(document.getElementById('board-widget-weather-widget'))
    }));
    assert.equal(retry.boardSnapshot, before, `${label}: retry keeps boardState intact`);
    assert.equal(retry.gridHidden, true, `${label}: retry hides fallback grid after board render`);
    assert.equal(retry.shellFallback, false, `${label}: retry clears fallback state`);
    assert.equal(retry.hasBoardWidget, true, `${label}: retry restores board widget`);
}

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('http://127.0.0.1/dashboard', route => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixtureHtml()
    }));
    try {
        const results = [];
        for (const viewport of VIEWPORTS) {
            for (const theme of THEMES) {
                for (const sidebarState of SIDEBAR_STATES) {
                    const label = `${viewport.label}-${theme}-${sidebarState}`;
                    await bootstrapPage(page, viewport, theme, sidebarState);
                    await verifyNormalLayout(page, label);
                    results.push(label);
                }
            }
        }
        await bootstrapPage(page, VIEWPORTS[1], 'dark', 'collapsed');
        await verifyFallback(page, '390-dark-collapsed-fallback');
        console.log(`Dashboard mobile fallback browser smoke passed: ${results.length} layout combinations plus forced fallback/retry.`);
    } catch (error) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'failure.png'), fullPage: true }).catch(() => {});
        throw error;
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error);
    process.exit(1);
});
