'use strict';

// Local synthetic UI contract; no Express/PostgreSQL or production requests.
// Run with the repository's existing Playwright package (no dependency changes):
// npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const browserOption = process.argv.indexOf('--browser');
const browserName = browserOption < 0 ? 'chromium' : process.argv[browserOption + 1];
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), 'Use chromium, firefox or webkit');
const BASELINE = process.argv.includes('--baseline');
const baselineRefIndex = process.argv.indexOf('--baseline-ref');
const baselineRef = baselineRefIndex >= 0 ? process.argv[baselineRefIndex + 1] : null;
assert.ok(!BASELINE || baselineRef, 'Baseline capture requires --baseline-ref <commit>; HEAD is not an implicit historical baseline');
assert.ok(!BASELINE || /^[a-f0-9]{7,40}$/i.test(baselineRef), 'Use a commit SHA for baseline provenance');
const NATIVE_ZOOM = process.argv.includes('--native-zoom');
assert.ok(!NATIVE_ZOOM || browserName === 'chromium', 'Native zoom extension requires Chromium');
const SHELL = process.argv.includes('--shell') || NATIVE_ZOOM;
const OUT = path.join(ROOT, 'output/playwright/hr-checklists', (BASELINE ? 'before' : 'after') + (SHELL ? '-shell' : '') + (NATIVE_ZOOM ? '-zoom' : '') + (browserName === 'chromium' ? '' : `-${browserName}`));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            if (!/node_modules[\\/]\.bin[\\/]?$/i.test(entry)) continue;
            const candidate = path.join(path.dirname(entry), 'playwright');
            if (fs.existsSync(candidate)) return require(candidate);
        }
        throw error;
    }
}
function extractDiv(source, id) {
    const start = source.indexOf(`<div id="${id}"`);
    assert.ok(start >= 0, id);
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = start;
    let depth = 0;
    for (let match; (match = tags.exec(source));) {
        depth += /^<div\b/i.test(match[0]) ? 1 : -1;
        if (!depth) return source.slice(start, tags.lastIndex);
    }
    throw new Error(`Unclosed ${id}`);
}
const source = read('hr.html');
// Serve separate local stylesheets so the browser resolves nested @imports normally.
const stylesheetFiles = [...source.matchAll(/href="(css\/[^?" ]+)/g)].map(match => match[1]);
const styles = stylesheetFiles.map(file => `<link rel="stylesheet" href="/${file}">`).join('');
const checklistCssPath = 'css/hr-page.css';
const baselineCommit = BASELINE ? execFileSync('git', ['rev-parse', '--verify', baselineRef + '^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim() : null;
const baselineCss = BASELINE ? execFileSync('git', ['show', baselineCommit + ':' + checklistCssPath], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) : null;
const html = SHELL ? source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace('</head>', `${styles}</head>`)
    : `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body data-page-group="hr"><main class="page-container" id="main-content">${extractDiv(source, 'tab-checklists')}</main>${extractDiv(source, 'professionWorkspaceOverlay')}</body></html>`;
const authSource = read('js/auth.js');
const themeStart = authSource.indexOf('function isCrmDarkThemeActive()');
const themeEnd = authSource.indexOf('function initHeaderThemeToggle()', themeStart);
assert.ok(themeStart >= 0 && themeEnd > themeStart, 'canonical theme functions found');

async function install(page) {
    await page.route('**/*', route => {
        if (route.request().url() === 'http://127.0.0.1:47839/hr') return route.fulfill({ contentType: 'text/html', body: html });
        if (route.request().url() === 'http://127.0.0.1:47839/images/gear-logo.svg') return route.fulfill({ contentType: 'image/svg+xml', body: read('images/gear-logo.svg') });
        const url = new URL(route.request().url());
        if (url.origin === 'http://127.0.0.1:47839' && /^\/css\/[a-z0-9-]+\.css$/i.test(url.pathname)) {
            const file = url.pathname.slice(1);
            return route.fulfill({ contentType: 'text/css', body: BASELINE && file === checklistCssPath ? baselineCss : read(file) });
        }
        return route.abort();
    });
    await page.goto('http://127.0.0.1:47839/hr');
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 9001, role: 'creator', name: 'QA Synthetic' } };
        window.canAccess = () => true;
        window.resolveCapability = () => ({ allowed: true });
    });
    await page.addScriptTag({ content: read('js/ui.js') });
    await page.addScriptTag({ content: authSource.slice(themeStart, themeEnd) });
    if (SHELL) await page.addScriptTag({ content: read('js/hr-pulse-switcher.js') });
    // Added after DOMContentLoaded: unrelated app startup and integrations never run.
    await page.addScriptTag({ content: read('js/hr-page.js') });
    await page.evaluate(() => {
        window.qa = { mode: 'ready', writes: [], requests: [], readonly: false };
        const titles = ['Перевірити безпеку ігрової зони', 'Довгий навчальний пункт: перевірити обладнання, ознайомитися з інструкцією та виконати підготовку робочого місця перед початком зміни'];
        qa.items = titles.map((title, index) => ({ itemKey: `chk_qa_${index + 1}`, title, isActive: true }));
        qa.items.push({ itemKey: 'chk_qa_archived', title: 'Архівний тестовий пункт', isActive: false });
        qa.template = () => ({ source: 'hr_profession_checklist_items', items: structuredClone(qa.items), activeItems: structuredClone(qa.items.filter(item => item.isActive)), archivedItems: structuredClone(qa.items.filter(item => !item.isActive)) });
        qa.profession = { id: 9001, key: 'qa_animator', title: 'QA Аніматор — довга назва професії для перевірки читабельності чекліста', department: 'Тестовий напрям', source: 'db', responsibilities: [], people: [{ id: 9001, name: 'QA Синтетичний працівник' }] };
        hrProfessions = [qa.profession];
        professionCatalogLoadState = 'ready';
        qa.rows = ['not_started', 'in_progress', 'completed'].map((status, index) => ({ professionKey: qa.profession.key, professionTitle: qa.profession.title, department: qa.profession.department, staffId: 9001, staffName: 'QA Синтетичний працівник', status, total: 2, completed: index, percent: index * 50 }));
        qa.dashboard = () => {
            const filters = professionChecklistDashboardFilters;
            const matches = row => (!filters.status || row.status === filters.status) && (!filters.search || row.professionTitle.toLowerCase().includes(filters.search.toLowerCase()));
            const extra = status => qa.mode === 'empty' ? [] : [{ professionKey: qa.profession.key, professionTitle: qa.profession.title, department: qa.profession.department, status, itemTitle: status === 'without_template' ? '' : 'QA Історичний пункт' }].filter(matches);
            return { summary: { without_template: 1, not_started: 1, in_progress: 1, completed: 1, archived: 1, orphaned: 1 }, assignments: qa.mode === 'empty' ? [] : qa.rows.filter(matches), professionsWithoutTemplate: extra('without_template'), archived: extra('archived'), orphaned: extra('orphaned') };
        };
        hrFetch = async (request, options = {}) => {
            qa.requests.push({ request, method: options.method || 'GET' });
            if (request === '/professions') return { success: true, data: [{ ...qa.profession, source: 'db', people: [{ id: 9001, name: 'QA Синтетичний працівник' }] }] };
            if (options.method) {
                qa.writes.push({ request, ...options });
                if (qa.holdSave) await new Promise(resolve => { qa.releaseSave = resolve; });
                if (qa.failSave) { qa.failSave = false; return { success: false, error: 'QA: збереження відхилено' }; }
                if (request.endsWith('/reorder')) qa.items.sort((a, b) => options.body.itemKeys.indexOf(a.itemKey) - options.body.itemKeys.indexOf(b.itemKey));
                else if (request.endsWith('/archive')) qa.items.find(item => request.includes(item.itemKey)).isActive = false;
                else if (options.method === 'POST') qa.items.push({ itemKey: `chk_qa_added_${qa.writes.length}`, title: options.body.title, isActive: true });
                else qa.items.find(item => request.endsWith(item.itemKey)).title = options.body.title;
                return { success: true };
            }
            if (request.startsWith('/checklists/dashboard')) {
                if (qa.mode === 'loading') await new Promise(resolve => { qa.releaseLoad = resolve; });
                return qa.mode === 'error' ? { success: false, error: 'QA: завантаження недоступне' } : { success: true, data: qa.dashboard() };
            }
            if (request.startsWith('/professions/workspace/')) return { success: true, data: { profession: { ...qa.profession, isReadonly: qa.readonly }, people: [], checklistTemplate: qa.template(), checklistProgress: { activeCompleted: 3, activeRecords: 6 } } };
            if (request.includes('/checklist?')) return { success: true, data: qa.template() };
            throw new Error(`Unexpected mock request: ${request}`);
        };
        document.querySelector('#tab-checklists').classList.add('active');
        window.addEventListener('popstate', () => { if (!parseProfessionWorkspaceLocation()) closeProfessionWorkspaceUi(); });
    });
    if (SHELL) {
        await page.evaluate(() => {
            document.querySelector('#mainApp').classList.remove('hidden');
            document.body.classList.add('shell-ready');
            document.querySelector('#currentUser').textContent = 'QA Synthetic';
            document.querySelector('#sidebarUserName').textContent = 'QA Synthetic';
            document.querySelectorAll('.hr-tab-content').forEach(el => el.classList.remove('active'));
            renderHrNav('checklists');
            bindHrNavClicks();
        });
        await page.locator('#hrNav [data-tab="checklists"]').click();
        await page.locator('.hr-checklist-dashboard-row').first().waitFor();
    } else await page.evaluate(() => loadProfessionChecklists());
}
async function theme(page, dark) {
    // Execute the canonical helper extracted read-only, without starting auth/network code.
    await page.evaluate(dark => applyCrmThemeMode(dark, false), dark);
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });
}
async function colors(page, selector) {
    return page.locator(selector).first().evaluate(el => {
        const style = getComputedStyle(el);
        return { color: style.color, background: style.backgroundColor, border: style.borderColor };
    });
}
async function toolbarGeometry(page) {
    return page.locator('.hr-checklist-dashboard-toolbar').evaluate(el => {
        const box = el.getBoundingClientRect();
        const controls = [...el.querySelectorAll('input, select')].map(control => {
            const rect = control.getBoundingClientRect();
            return { id: control.id, left: rect.left, right: rect.right };
        });
        return { left: box.left, right: box.right, controls, clipped: controls.some(control => control.left < box.left - 1 || control.right > box.right + 1) };
    });
}
async function contrast(page, selector, pseudo = null) {
    return page.locator(selector).first().evaluate((el, pseudo) => {
        const rgba = color => {
            const values = color.match(/[\d.]+/g).map(Number);
            return color.startsWith('color(srgb') ? [...values.slice(0, 3).map(value => value * 255), values[3] ?? 1] : [...values.slice(0, 3), values[3] ?? 1];
        };
        const blend = (fg, bg) => fg.slice(0, 3).map((value, index) => value * fg[3] + bg[index] * (1 - fg[3]));
        const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const ancestors = [];
        for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
        let bg = [255, 255, 255];
        for (const node of ancestors) bg = blend(rgba(getComputedStyle(node).backgroundColor), bg);
        const fg = blend(rgba(getComputedStyle(el, pseudo).color), bg);
        const a = luminance(fg), b = luminance(bg);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }, pseudo);
}
async function run() {
    fs.mkdirSync(OUT, { recursive: true });
    const extensionPath = path.join(OUT, 'zoom-helper');
    if (NATIVE_ZOOM) {
        assert.equal(BASELINE, false, 'Native zoom mode verifies the final patch');
        fs.mkdirSync(extensionPath, { recursive: true });
        fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({
            manifest_version: 3, name: 'Local checklist zoom test', version: '1.0',
            host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' }
        }));
        fs.writeFileSync(path.join(extensionPath, 'background.js'), 'globalThis.checklistZoomHelper = true;');
    }
    const browser = NATIVE_ZOOM
        ? await requirePlaywright().chromium.launchPersistentContext('', {
            channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
            args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
        })
        : await requirePlaywright()[browserName].launch({ headless: true });
    const page = NATIVE_ZOOM ? await browser.newPage() : await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const evidence = { mode: BASELINE ? 'baseline' : 'verification', engine: browserName, shell: SHELL, provenance: { cssBaselineCommit: baselineCommit, htmlAndJavaScript: 'current working tree', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() }, themes: {} };
    try {
        await install(page);
        evidence.stylesheets = await page.evaluate(() => {
            const found = [];
            const visit = sheet => {
                found.push(sheet.href);
                for (const rule of sheet.cssRules) if (rule.type === CSSRule.IMPORT_RULE) visit(rule.styleSheet);
            };
            [...document.styleSheets].forEach(visit);
            return found;
        });
        assert.ok(evidence.stylesheets.some(href => href?.includes('/pages-core.css')), 'nested page layout stylesheet loaded');
        assert.ok(evidence.stylesheets.some(href => href?.includes('/pages-shared-widgets.css')), 'nested shared widgets stylesheet loaded');
        if (NATIVE_ZOOM) {
            await verifyNativeZoom(page, browser, evidence);
            assert.deepEqual(errors, [], 'no uncaught browser errors');
            fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(evidence, null, 2));
            console.log(`HR Checklists native browser zoom passed: ${OUT}`);
            return;
        }
        for (const dark of [false, true]) {
            const name = dark ? 'dark' : 'light';
            await theme(page, dark);
            await page.mouse.move(0, 850);
            await shot(page, `dashboard-${name}`);
            const normal = await colors(page, '.hr-checklist-dashboard-summary-card');
            evidence.themes[name] = { normal, row: await colors(page, '.hr-checklist-dashboard-row') };
            evidence.themes[name].contrast = {
                summaryLabel: await contrast(page, '.hr-checklist-dashboard-summary-card span'),
                profession: await contrast(page, '.hr-checklist-dashboard-profession strong'),
                completed: await contrast(page, '.is-completed .hr-checklist-dashboard-status'),
                inProgress: await contrast(page, '.is-in_progress .hr-checklist-dashboard-status'),
                orphaned: await contrast(page, '.is-orphaned .hr-checklist-dashboard-status'),
                searchPlaceholder: await contrast(page, '#professionChecklistDashboardSearch', '::placeholder')
            };
            await page.locator('[data-checklist-dashboard-status="not_started"]').click();
            await page.waitForFunction(() => document.querySelectorAll('.hr-checklist-dashboard-row').length === 1);
            await page.mouse.move(0, 0);
            const selected = await colors(page, '.hr-checklist-dashboard-summary-card.is-active');
            evidence.themes[name].selected = selected;
            await shot(page, `selected-${name}`);
            if (!BASELINE) assert.notEqual(selected.background, normal.background, `${name} selected filter has a visible surface`);
            await page.locator('[data-checklist-dashboard-status="not_started"]').click();
            await page.locator('[data-checklist-open-profession]').first().click();
            await page.locator('[data-checklist-item-title]').first().waitFor();
            evidence.themes[name].input = await colors(page, '[data-checklist-item-title]');
            evidence.themes[name].contrast.editorInput = await contrast(page, '[data-checklist-item-title]');
            evidence.themes[name].contrast.activeChecklistTab = await contrast(page, '[data-profession-workspace-tab="checklist"].active');
            evidence.themes[name].contrast.professionSourceBadge = await contrast(page, '#professionWorkspaceSource');
            await page.locator('#professionWorkspaceSource').evaluate(el => el.classList.add('is-system'));
            evidence.themes[name].contrast.systemSourceBadge = await contrast(page, '#professionWorkspaceSource');
            await page.locator('#professionWorkspaceSource').evaluate(el => el.classList.remove('is-system'));
            await shot(page, `editor-${name}`);
            await page.locator('[data-checklist-item-title]').first().focus();
            evidence.themes[name].inputFocusOutline = await page.locator('[data-checklist-item-title]').first().evaluate(el => getComputedStyle(el).outlineStyle);
            if (!BASELINE && dark) {
                assert.equal(evidence.themes[name].row.background, 'rgb(30, 30, 56)');
                assert.equal(evidence.themes[name].input.color, 'rgb(248, 250, 252)');
                for (const [part, ratio] of Object.entries(evidence.themes[name].contrast)) assert.ok(ratio >= 4.5, `${name} ${part} contrast ${ratio.toFixed(2)} < 4.5`);
            }
            await page.locator('#professionWorkspaceClose').click();
            await page.locator('#professionWorkspaceOverlay').waitFor({ state: 'hidden' });
        }
        if (!BASELINE) await verifyFlow(page, evidence);
        else {
            evidence.toolbar = [];
            for (const width of [1440, 1200, 1101, 1024, 768, 720, 390]) {
                await page.setViewportSize({ width, height: 900 });
                for (const dark of [false, true]) {
                    await theme(page, dark);
                    await shot(page, `dashboard-${width}-${dark ? 'dark' : 'light'}`);
                    evidence.toolbar.push({ width, dark, ...await toolbarGeometry(page) });
                }
            }
        }
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(evidence, null, 2));
        console.log(`HR Checklists ${BASELINE ? 'baseline captured' : 'browser smoke passed'}: ${OUT}`);
    } catch (error) {
        await shot(page, 'failure');
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...evidence, errors, failure: error.message }, null, 2));
        throw error;
    } finally { await browser.close(); }
}
async function verifyNativeZoom(page, context, evidence) {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(await worker.evaluate(() => globalThis.checklistZoomHelper), true);
    const cdp = await context.newCDPSession(page);
    const settle = () => page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
            .map(animation => animation.finished.catch(() => {})));
    });
    // Capture the physical viewport directly; fullPage screenshot clipping uses CSS pixels.
    const zoomShot = async name => {
        await settle();
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const setZoom = async factor => {
        const result = await worker.evaluate(async ({ factor, url }) => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(candidate => candidate.url === url);
            if (!tab) throw new Error('Local checklist tab not found');
            await chrome.tabs.setZoom(tab.id, factor);
            return chrome.tabs.getZoom(tab.id);
        }, { factor, url: page.url() });
        assert.equal(result, factor, 'Chromium reports the requested native tab zoom');
        await page.waitForFunction(factor => Math.abs(devicePixelRatio - factor) < 0.01, factor);
        await settle();
    };
    evidence.nativeZoom = [];
    for (const dark of [false, true]) {
        await theme(page, dark);
        for (const factor of [1, 1.25, 1.5, 2]) {
            await setZoom(factor);
            const metrics = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, scroll: document.documentElement.scrollWidth }));
            assert.ok(Math.abs(metrics.width * factor - 1440) <= factor, 'browser zoom changes CSS viewport');
            assert.ok(metrics.scroll <= metrics.width, 'zoomed dashboard has no horizontal overflow');
            const toolbar = await toolbarGeometry(page);
            assert.equal(toolbar.clipped, false, 'zoomed checklist filters remain within toolbar');
            assert.ok(toolbar.left >= 0 && toolbar.right <= metrics.width + 1, 'zoomed toolbar remains within viewport');
            const label = `${Math.round(factor * 100)}-${dark ? 'dark' : 'light'}`;
            await zoomShot(`dashboard-zoom-${label}`);
            await page.locator('[data-checklist-open-profession]').first().click();
            const title = page.locator('[data-checklist-item-title]').first();
            await title.waitFor();
            await title.focus();
            await title.press('End');
            await settle();
            const editor = await page.locator('[data-profession-workspace-panel="checklist"]').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
            assert.ok(editor.scroll <= editor.width + 1, 'zoomed editor has no horizontal overflow');
            await page.locator('#professionWorkspaceChecklistNewTitle').scrollIntoViewIfNeeded();
            await zoomShot(`editor-zoom-${label}`);
            await page.locator('#professionWorkspaceClose').click();
            await page.locator('#professionWorkspaceOverlay').waitFor({ state: 'hidden' });
            evidence.nativeZoom.push({ factor, theme: dark ? 'dark' : 'light', metrics, toolbar, editor, status: 'PASS' });
        }
    }
    await setZoom(1);
}
async function verifyFlow(page, evidence) {
    evidence.flow = {};
    const originalItems = await page.evaluate(() => structuredClone(qa.items));
    const open = async () => {
        await page.locator('[data-checklist-open-profession]').first().click();
        await page.locator('#professionWorkspaceContent').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.activeElement.closest('#professionWorkspace'));
    };
    const close = async () => {
        await page.locator('#professionWorkspaceClose').click();
        await page.locator('#professionWorkspaceOverlay').waitFor({ state: 'hidden' });
    };
    const saved = () => page.waitForFunction(() => document.querySelector('#professionWorkspaceChecklistState').dataset.state === 'saved');
    for (const dark of [false, true]) {
        const name = dark ? 'dark' : 'light';
        await theme(page, dark);
        await page.evaluate(items => { qa.items = structuredClone(items); }, originalItems);
        await page.locator('#professionChecklistDashboardProfession').selectOption('qa_animator');
        await page.locator('#professionChecklistDashboardDepartment').selectOption('Тестовий напрям');
        await page.locator('#professionChecklistDashboardStaff').selectOption('9001');
        await page.locator('#professionChecklistDashboardSearch').fill('No matching QA profession');
        await page.locator('#professionChecklistList .hr-account-empty').waitFor();
        await shot(page, `empty-${name}`);
        await page.locator('#professionChecklistDashboardSearch').fill('');
        await page.locator('.hr-checklist-dashboard-row').first().waitFor();
        assert.match(await page.evaluate(() => qa.requests.at(-1).request), /professionKey=qa_animator.*staffId=9001/);
        await page.evaluate(() => { qa.mode = 'loading'; void loadProfessionChecklists(); });
        await page.locator('.hr-checklist-dashboard-skeleton').first().waitFor();
        await shot(page, `loading-${name}`);
        await page.evaluate(() => { qa.mode = 'error'; qa.releaseLoad(); });
        await page.locator('#professionChecklistDashboardRetry').waitFor();
        await shot(page, `error-${name}`);
        assert.match(await page.locator('#professionChecklistDashboardState').innerText(), /QA: завантаження недоступне/);
        await page.evaluate(() => { qa.mode = 'ready'; });
        await page.locator('#professionChecklistDashboardRetry').click();
        await page.locator('.hr-checklist-dashboard-row').first().waitFor();
        await open();
        const titles = page.locator('[data-checklist-item-title]');
        const longTitle = await titles.nth(1).inputValue();
        await titles.nth(1).press('End');
        await page.waitForFunction(() => {
            const el = document.querySelectorAll('[data-checklist-item-title]')[1];
            return el.selectionStart === el.value.length && el.scrollLeft > 0;
        });
        assert.equal(await titles.nth(1).evaluate(el => document.activeElement === el), true, 'long single-line item remains reachable by keyboard');
        assert.equal(await titles.nth(1).inputValue(), longTitle);
        assert.equal(await page.locator('[data-checklist-item-action="up"]').first().isDisabled(), true);
        assert.equal(await page.locator('[data-checklist-item-action="down"]').last().isDisabled(), true);
        await titles.first().focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.checklistItemAction), 'down');
        await page.keyboard.press('Shift+Tab');
        assert.notEqual(await titles.first().evaluate(el => getComputedStyle(el).outlineStyle), 'none');
        await shot(page, `focus-${name}`);
        await titles.first().fill('');
        const writesBefore = await page.evaluate(() => qa.writes.length);
        await titles.first().press('Enter');
        assert.equal(await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state'), 'error');
        assert.equal(await page.evaluate(() => qa.writes.length), writesBefore);
        await shot(page, `validation-${name}`);
        await titles.first().fill('QA Перейменований пункт');
        await page.evaluate(() => { qa.holdSave = true; });
        await titles.first().press('Enter');
        await page.waitForFunction(() => Boolean(qa.releaseSave));
        assert.equal(await page.locator('#professionWorkspaceChecklistEditor').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        await shot(page, `saving-${name}`);
        await page.evaluate(() => { qa.holdSave = false; qa.releaseSave(); });
        await saved();
        assert.equal(await titles.first().inputValue(), 'QA Перейменований пункт');
        await close();
        await open();
        assert.equal(await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state'), '', 'previous saved state clears on reopen');
        assert.equal(await page.locator('#professionWorkspaceChecklistState').innerText(), '');
        assert.equal(await titles.first().inputValue(), 'QA Перейменований пункт', 'mock state survives reopen');
        await page.evaluate(() => { qa.failSave = true; });
        await titles.first().fill('QA Відхилена зміна');
        await titles.first().press('Enter');
        await page.waitForFunction(() => document.querySelector('#professionWorkspaceChecklistState').textContent.includes('відхилено'));
        assert.equal(await page.evaluate(() => qa.items.find(item => item.itemKey === 'chk_qa_1').title), 'QA Перейменований пункт');
        await shot(page, `save-error-${name}`);
        await close();
        await open();
        assert.equal(await page.locator('#professionWorkspaceChecklistState').getAttribute('data-state'), '', 'previous error state clears on reopen');
        assert.equal(await page.locator('#professionWorkspaceChecklistState').innerText(), '');
        await page.locator('#professionWorkspaceChecklistAddButton').click();
        assert.match(await page.locator('#professionWorkspaceChecklistState').innerText(), /Введіть назву/);
        await page.locator('#professionWorkspaceChecklistNewTitle').fill('QA Доданий пункт');
        await page.locator('#professionWorkspaceChecklistNewTitle').press('Enter');
        await saved();
        assert.equal(await titles.count(), 3);
        await page.locator('[data-checklist-item-key="chk_qa_1"] [data-checklist-item-action="down"]').click();
        await page.waitForFunction(() => document.querySelector('[data-checklist-item-key]').dataset.checklistItemKey === 'chk_qa_2');
        await page.locator('[data-checklist-item-action="archive"]').first().click();
        await page.locator('.confirm-overlay').waitFor();
        await shot(page, `confirm-${name}`);
        await theme(page, !dark);
        await shot(page, `confirm-switched-from-${name}`);
        await page.locator('.confirm-cancel').click();
        await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
        assert.equal(await titles.count(), 3, 'cancel does not archive');
        await theme(page, dark);
        await page.locator('[data-checklist-item-action="archive"]').first().click();
        await page.locator('.confirm-ok').click();
        await page.locator('.confirm-overlay').waitFor({ state: 'detached' });
        await saved();
        assert.equal(await titles.count(), 2);
        await page.locator('#professionWorkspaceChecklistShowArchived').check();
        assert.equal(await page.locator('.hr-checklist-template-item.is-archived').count(), 2);
        assert.equal(await page.locator('.is-archived input').first().getAttribute('readonly'), '');
        await shot(page, `archived-${name}`);
        await theme(page, !dark);
        assert.equal(await page.locator('#professionWorkspaceChecklistShowArchived').isChecked(), true);
        await theme(page, dark);
        await close();
        await page.evaluate(() => { qa.readonly = true; });
        await open();
        assert.equal(await page.locator('[data-checklist-item-action]').count(), 0);
        assert.equal(await page.locator('#professionWorkspaceChecklistAdd').isVisible(), false);
        assert.equal(await titles.first().getAttribute('readonly'), '');
        await shot(page, `readonly-${name}`);
        await close();
        await page.evaluate(() => { qa.readonly = false; qa.items = []; });
        await open();
        assert.equal(await page.locator('#professionWorkspaceChecklistShowArchived').isDisabled(), true);
        assert.match(await page.locator('#professionWorkspaceChecklistItems').innerText(), /Шаблон ще порожній/);
        await shot(page, `empty-template-${name}`);
        await close();
        await page.evaluate(items => { qa.items = structuredClone(items); }, originalItems);
        evidence.flow[name] = 'PASS: filter query, loading/error/retry/empty, focus/disabled, validation, mock rename/reopen/reject/add/reorder/archive/cancel, readonly, empty template, theme switch';
    }
    evidence.widths = [];
    // 720 CSS px also exercises reflow at half of a 1440px desktop viewport.
    for (const width of [1440, 1200, 1101, 1024, 768, 720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const dark of [false, true]) {
            await theme(page, dark);
            const name = `${width}-${dark ? 'dark' : 'light'}`;
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: dashboard horizontal overflow`);
            const toolbar = await toolbarGeometry(page);
            assert.equal(toolbar.clipped, false, `${name}: checklist filters clipped by page overflow rules`);
            await shot(page, `dashboard-${name}`);
            await open();
            const footer = await page.locator('#professionWorkspaceArchive, #professionWorkspaceSave').evaluateAll(buttons => buttons.map(button => ({ height: button.getBoundingClientRect().height, radius: getComputedStyle(button).borderRadius })));
            assert.ok(footer.every(button => button.height >= 44 && button.radius === '10px'), `${name}: workspace footer preserves HR button styles`);
            const geometry = await page.locator('[data-profession-workspace-panel="checklist"]').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
            assert.ok(geometry.scroll <= geometry.width + 1, `${name}: editor horizontal overflow ${JSON.stringify(geometry)}`);
            await shot(page, `editor-${name}`);
            await close();
            evidence.widths.push({ width, theme: dark ? 'dark' : 'light', geometry, toolbar, result: 'PASS' });
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
        qa.items = Array.from({ length: 32 }, (_, index) => ({ itemKey: `chk_qa_long_${index}`, title: `QA ${index + 1}: довга інструкція для перевірки прокрутки наявного чекліста`, isActive: true }));
    });
    for (const dark of [false, true]) {
        await theme(page, dark);
        await open();
        await page.locator('[data-checklist-item-title]').last().scrollIntoViewIfNeeded();
        assert.equal(await page.locator('[data-checklist-item-title]').count(), 32);
        await shot(page, `long-list-${dark ? 'dark' : 'light'}`);
        await close();
    }
    evidence.longList = 'PASS: 32 items, final item reachable in both themes';
    evidence.zoom = '720 CSS px reflow PASS; native browser UI zoom NOT_RUN (headless harness)';
}
run().catch(error => { console.error(error); process.exitCode = 1; });
