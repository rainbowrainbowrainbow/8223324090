'use strict';

// Real sidebar DOM/clicks with synthetic capability snapshots. This is not
// PostgreSQL or live-account proof; those remain separate acceptance gates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');
const { createStaticServer, requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const output = path.resolve(__dirname, '../../output/baseline-access-browser');
function fixture(user, snapshot) {
    return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Перевірка робочої навігації</title><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/layout.css">
    <link rel="stylesheet" href="/css/sidebar-aurora.css"></head><body class="shell-ready" data-page-group="crm">
    <button id="sidebarToggle" type="button" aria-label="Робоче меню">Меню</button>
    <div id="sidebarOverlay" class="sidebar-overlay hidden"></div>
    <aside id="sidebarNav" class="sidebar-nav"><div class="sidebar-header"><div class="sidebar-brand">CRM</div></div>
    <nav id="sidebarLinks" class="sidebar-links" aria-label="Робочі розділи"></nav></aside>
    <main id="main-content"><h1>Робочі розділи</h1><p>Синтетичний працівник</p></main>
    <script>window.AppState={currentUser:${JSON.stringify(user)}};
    window.RolePreview={getPreviewRole:()=>null,getEffectiveRole:()=>AppState.currentUser.role};
    window.CrmBusinessContext={current:()=> 'event_genix',hasModule:()=>true,activeProfile:()=>null};
    window.canAccessPage=page=>(${JSON.stringify(snapshot.pages)})[page.split('?')[0]]===true;
    window.canUseAction=action=>(${JSON.stringify(snapshot.actions)})[action]===true;
    </script><script src="/js/components/sidebar.js"></script>
    <script>Sidebar.render('#sidebarLinks',{refreshOperational:false});Sidebar.initToggle();</script></body></html>`;
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const { server, baseUrl } = await createStaticServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
    const results = [];
    try {
        for (const role of ['instructor', 'reception', 'animator', 'hr', 'accountant', 'waiter']) {
            for (const width of [1280, 390]) {
                const user = { id: 800, name: 'Тестовий працівник', role, roles: [role] };
                const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await context.addInitScript(() => {
                    localStorage.setItem('eg_sidebar_extra_menu_items_v3', '[]');
                    localStorage.setItem('eg_sidebar_productivity_menu_items_v1', '[]');
                    localStorage.setItem('eg_sidebar_favorites_productivity_merged_v1', 'true');
                });
                await page.route('**/api/**', route => route.fulfill({ json: {} }));
                for (const url of ['/__baseline-ui', '/staff']) {
                    await page.route(`${baseUrl}${url}`, route => route.fulfill({ contentType: 'text/html', body: fixture(user, buildCapabilitySnapshot(user)) }));
                }
                await page.goto(`${baseUrl}/__baseline-ui`);
                if (width < 768) await page.locator('#sidebarToggle').click();
                await page.waitForFunction(() => {
                    const rect = document.getElementById('sidebarNav').getBoundingClientRect();
                    return rect.x >= -1 && rect.right <= innerWidth + 1;
                });
                await page.locator('#sidebarNav').evaluate(async element => {
                    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
                    await document.fonts.ready;
                });
                for (const href of ['/profile?tab=myday', '/tasks', '/staff', '/chat', '/afisha', '/training']) {
                    const link = page.locator(`#sidebarNav a[href="${href}"]`).filter({ visible: true }).first();
                    await link.waitFor({ state: 'visible' });
                    assert.ok((await link.innerText()).trim(), `${role} ${href}: accessible visible label`);
                }
                const screenshot = path.join(output, `${role}-${width}.png`);
                await page.screenshot({ path: screenshot, fullPage: true });
                const schedule = page.locator('#sidebarNav a[href="/staff"]').filter({ visible: true }).first();
                await schedule.focus();
                await page.keyboard.press('Enter');
                await page.waitForURL(`${baseUrl}/staff`);
                await page.evaluate(() => {
                    CrmBusinessContext.hasModule = (_context, module) => !['chat', 'training'].includes(module);
                    CrmBusinessContext.activeProfile = () => ({ modules: { descriptors: [
                        { key: 'chat', canEnable: false, reason: 'Чат ще не розмежований за бізнесами.' },
                        { key: 'training', canEnable: false, reason: 'Навчання ще не розмежоване за бізнесами.' }
                    ] } });
                    window.showNotification = message => { window.__blockedWorkNotice = message; };
                    Sidebar.render('#sidebarLinks', { refreshOperational: false, refreshTimelineSummary: false });
                    Sidebar.initToggle();
                });
                if (width < 768) await page.locator('#sidebarToggle').click();
                const unavailable = page.locator('#sidebarNav a[href="/chat"]').filter({ visible: true }).first();
                assert.equal(await unavailable.getAttribute('aria-disabled'), 'true');
                await unavailable.focus();
                await page.keyboard.press('Enter');
                assert.equal(new URL(page.url()).pathname, '/staff', 'disabled work link must not navigate');
                assert.match(await page.evaluate(() => window.__blockedWorkNotice), /не розмежований/);
                await page.waitForFunction(() => document.getElementById('sidebarNav').getBoundingClientRect().x >= -1);
                await page.locator('#sidebarNav').evaluate(async element => {
                    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
                    await document.fonts.ready;
                });
                await page.screenshot({ path: path.join(output, `${role}-${width}-unavailable.png`), fullPage: true });
                assert.deepEqual(errors, [], `${role}-${width}: browser errors`);
                results.push({ role, width, keyboardScheduleNavigation: 'passed', screenshot });
                await context.close();
            }
        }
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ fixtureOnly: true, results }, null, 2));
        console.log(`Baseline navigation browser smoke passed: ${results.length} role/viewport combinations.`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
