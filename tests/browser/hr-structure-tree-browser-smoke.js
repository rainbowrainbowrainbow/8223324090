#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.HR_STRUCTURE_BROWSER_SMOKE_HEADLESS !== 'false';

function fail(message) {
    console.error(`HR Structure tree browser smoke failed: ${message}`);
    process.exit(1);
}

function readRepo(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function extractDivMarkup(source, id) {
    const marker = `<div id="${id}"`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Unable to find #${id} in production markup`);
    const divTag = /<\/?div\b[^>]*>/gi;
    divTag.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = divTag.exec(source))) {
        if (/^<div\b/i.test(match[0])) depth += 1;
        else depth -= 1;
        if (depth === 0) return source.slice(start, divTag.lastIndex);
    }
    throw new Error(`Unable to extract #${id} from production markup`);
}

const HR_HTML = readRepo('hr.html');
const STRUCTURE_MARKUP = extractDivMarkup(HR_HTML, 'tab-structure');
const UI_CODE = readRepo('js', 'ui.js');
const HR_CODE = readRepo('js', 'hr-page.js');
const CSS_BUNDLE = [
    readRepo('css', 'base.css'),
    readRepo('css', 'modals.css'),
    readRepo('css', 'hr-page.css'),
    readRepo('css', 'pages-hr-foundation.css'),
    readRepo('css', 'pages-hr-staff.css')
].join('\n');

const FIXTURE_NODES = [
    { id: 'director', title: 'Директор із дуже довгою назвою для перевірки переносу рядків', description: 'Фінальна відповідальність за бізнес, команду і стандарти.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 80, y: 40 },
    { id: 'ops', title: 'Адміністративно-операційний відділ із довгою назвою', description: 'Керує щоденною операційною роботою.', tone: 'purple', lane: 'operations', parentId: 'director', order: 2, x: 80, y: 210 },
    { id: 'archived-parent', title: 'Архівний проміжний підрозділ', description: 'Архівний контейнер.', tone: 'violet', lane: 'support', parentId: 'ops', order: 3, x: 80, y: 380, archived: true },
    { id: 'deep-child', title: 'Активний нащадок під архівним батьком із дуже довгою назвою', description: 'Активний вузол має залишатися видимим у дереві.', tone: 'blue', lane: 'leadership', parentId: 'archived-parent', order: 4, x: 80, y: 550 }
];

const FIXTURE_PROFESSIONS = [
    { key: 'admin', title: 'Адміністратор зміни', structure_node_id: 'deep-child', is_active: true },
    { key: 'crm-manager', title: 'Менеджер CRM із довгою назвою', structure_node_id: 'deep-child', is_active: true }
];

const FIXTURE_STAFF = [
    { id: 11, name: 'QA Tree Manager', role_type: 'manager', phone: '+380001', company_structure_node_id: 'deep-child' },
    { id: 12, name: 'QA Tree Administrator With Long Name', role_type: 'administrator', phone: '+380002', company_structure_node_id: 'deep-child' }
];

async function installHarness(page, width = 1280, theme = 'light') {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${CSS_BUNDLE}</style></head><body data-page-group="hr" class="${theme === 'dark' ? 'dark-mode' : ''}"></body></html>`);
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', name: 'QA Creator' } };
        window.canAccess = action => action === 'hr.staff.manage';
        window.apiVerifyToken = async () => ({ id: 1, role: 'creator', name: 'QA Creator' });
        window.showNotification = () => {};
        window.openProfessionWorkspace = options => {
            window.__lastProfessionWorkspace = options;
            return options;
        };
        window.openStaffEdit = id => {
            window.__lastStaffEdit = Number(id);
            return id;
        };
        window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options = {}) {
            this.dataset.scrollBlock = String(options.block || '');
        };
        window.__originalAddEventListener = document.addEventListener.bind(document);
        document.addEventListener = (type, listener, options) => {
            if (type === 'DOMContentLoaded') return undefined;
            return window.__originalAddEventListener(type, listener, options);
        };
    });
    await page.addScriptTag({ content: UI_CODE });
    await page.addScriptTag({ content: HR_CODE });
    await page.evaluate(({ markup, nodes, professions, staff }) => {
        document.addEventListener = window.__originalAddEventListener;
        document.body.innerHTML = markup;
        document.getElementById('tab-structure')?.classList.add('active');
        hrProfessions = professions;
        teamStaff = staff;
        companyStructureNodes = normalizeCompanyStructureNodes(nodes);
        selectedCompanyStructureNodeId = 'deep-child';
        companyStructureLoaded = true;
        companyStructureHasSavedData = true;
        companyStructureLoadState = 'ready';
        companyStructureSaveState = 'clean';
        companyStructureDraftRevision = 0;
        companyStructureSavedRevision = 0;
        companyStructureUpdatedAt = '2099-05-31T12:00:00Z';
        companyStructurePermissionDenied = false;
        resetCompanyOrgHistory();
        resetCompanyOrgViewState();
        bindCompanyStructureEditorControls();
        renderCompanyOrgWorkspace();
        setCompanyOrgViewMode('tree', { focus: false });
        selectCompanyOrgNodeById('deep-child', { openInspector: true });
        recordCompanyStructureSavedBaseline();
    }, {
        markup: STRUCTURE_MARKUP,
        nodes: FIXTURE_NODES,
        professions: FIXTURE_PROFESSIONS,
        staff: FIXTURE_STAFF
    });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-org-tree-select="deep-child"]')));
}

async function setTheme(page, theme) {
    await page.evaluate(nextTheme => {
        document.body.classList.toggle('dark-mode', nextTheme === 'dark');
    }, theme);
}

async function setViewportAndEnsureInspector(page, width) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
        resetCompanyOrgViewState();
        setCompanyOrgViewMode('tree', { focus: false });
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById('deep-child', { openInspector: true });
    });
    await page.waitForFunction(() => {
        const inspector = document.getElementById('hrOrgInspector');
        const node = document.querySelector('[data-org-tree-select="deep-child"]');
        return Boolean(inspector && node && inspector.getBoundingClientRect().width > 0);
    }, null, { timeout: 5000 }).catch(async error => {
        const details = await page.evaluate(() => {
            const inspector = document.getElementById('hrOrgInspector');
            const tab = document.getElementById('tab-structure');
            const node = document.querySelector('[data-org-tree-select="deep-child"]');
            const rect = inspector?.getBoundingClientRect();
            const style = inspector ? getComputedStyle(inspector) : null;
            return {
                bodyClass: document.body.className,
                tabClass: tab?.className,
                inspectorClass: inspector?.className,
                inspectorHidden: inspector?.hidden,
                inspectorAriaHidden: inspector?.getAttribute('aria-hidden'),
                inspectorDisplay: style?.display,
                inspectorVisibility: style?.visibility,
                inspectorWidth: rect?.width,
                selectedExists: Boolean(node),
                selectedClass: node?.className,
                selectedId: selectedCompanyStructureNodeId
            };
        });
        throw new Error(`Inspector did not become visible at ${width}px: ${error.message}; ${JSON.stringify(details)}`);
    });
}

function findRole(node, role) {
    if (!node) return null;
    if (node.role === role) return node;
    for (const child of node.children || []) {
        const found = findRole(child, role);
        if (found) return found;
    }
    return null;
}

function cdnNodeHasRole(node, role) {
    const value = typeof node?.role === 'string' ? node.role : node?.role?.value;
    return value === role;
}

async function exposesAccessibilityRole(page, role) {
    if (page.accessibility && typeof page.accessibility.snapshot === 'function') {
        return Boolean(findRole(await page.accessibility.snapshot({ interestingOnly: false }), role));
    }
    const session = await page.context().newCDPSession(page);
    try {
        const tree = await session.send('Accessibility.getFullAXTree');
        return tree.nodes.some(node => cdnNodeHasRole(node, role));
    } finally {
        await session.detach();
    }
}

async function contrastSnapshot(page) {
    return page.evaluate(() => {
        function parseColor(value) {
            const match = String(value || '').match(/rgba?\(([^)]+)\)/);
            if (!match) return null;
            const parts = match[1].split(',').map(part => Number(part.trim()));
            return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
        }
        function composite(fg, bg) {
            const alpha = fg.a ?? 1;
            return {
                r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
                g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
                b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
                a: 1
            };
        }
        function backgroundFor(element) {
            let cursor = element;
            let color = { r: 255, g: 255, b: 255, a: 1 };
            const layers = [];
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
        return ['#hrOrgDetailText', '#hrOrgDetailTitle', '[data-org-tree-select="deep-child"]'].map(selector => {
            const element = document.querySelector(selector);
            const color = parseColor(getComputedStyle(element).color);
            const background = backgroundFor(element);
            return { selector, ratio: ratio(color, background), color, background };
        });
    });
}

async function assertGeometryAtBreakpoint(page, width) {
    await setViewportAndEnsureInspector(page, width);
    await page.evaluate(() => {
        document.getElementById('hrOrgSystemInfo').open = true;
    });
    const geometry = await page.evaluate(() => {
        const rect = selector => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { width: box.width, height: box.height, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        const tree = document.getElementById('companyOrgTree');
        return {
            viewportWidth: window.innerWidth,
            title: rect('#hrOrgDetailTitle'),
            body: rect('#hrOrgDetailText'),
            meta: rect('#hrOrgDetailMeta'),
            inspector: rect('#hrOrgInspector'),
            treeClientWidth: tree.clientWidth,
            treeScrollWidth: tree.scrollWidth,
            documentScrollWidth: document.documentElement.scrollWidth
        };
    });
    assert.ok(geometry.title.width > 0, `title width > 0 at ${width}`);
    assert.ok(geometry.body.width > 0, `body width > 0 at ${width}`);
    assert.ok(geometry.meta.width > 0, `meta width > 0 at ${width}`);
    assert.ok(geometry.inspector.left >= -1, `inspector does not escape left at ${width}`);
    assert.ok(geometry.inspector.right <= geometry.viewportWidth + 1, `inspector does not escape right at ${width}`);
    assert.ok(geometry.documentScrollWidth <= geometry.viewportWidth + 4, `page has no critical horizontal clipping at ${width}`);
    assert.ok(geometry.treeScrollWidth >= geometry.treeClientWidth, `tree remains reachable at ${width}`);
}

async function assertTreeControlsAndA11y(page) {
    await page.locator('#hrOrgViewTree').click();
    await assert.equal(await page.locator('#hrOrgZoomOut').evaluate(node => node.hidden), true);
    await assert.equal(await page.locator('#hrOrgZoomIn').evaluate(node => node.hidden), true);
    await assert.equal(await page.locator('#hrOrgZoomValue').evaluate(node => node.hidden), true);

    const selected = page.locator('[data-org-tree-select="deep-child"]');
    await assert.equal(await selected.getAttribute('aria-selected'), 'true');
    await assert.equal(await page.locator('[data-org-tree-toggle="archived-parent"]').getAttribute('aria-expanded'), 'true');

    assert.ok(await exposesAccessibilityRole(page, 'tree'), 'accessibility snapshot exposes tree role');

    await selected.focus();
    await page.keyboard.press('Home');
    await assert.equal(await page.evaluate(() => document.activeElement?.dataset?.orgTreeSelect), 'director');
    await page.keyboard.press('End');
    await assert.equal(await page.evaluate(() => document.activeElement?.dataset?.orgTreeSelect), 'deep-child');
    await page.locator('[data-org-tree-toggle="archived-parent"]').focus();
    await page.locator('[data-org-tree-toggle="archived-parent"]').click();
    await assert.equal(await page.evaluate(() => document.activeElement?.dataset?.orgTreeSelect), 'archived-parent');
}

async function run() {
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    try {
        await installHarness(page, 1280, 'light');
        await assertTreeControlsAndA11y(page);
        for (const width of [1920, 1280, 901, 900, 821, 820, 390]) {
            await assertGeometryAtBreakpoint(page, width);
        }
        for (const theme of ['light', 'dark']) {
            await setTheme(page, theme);
            const contrasts = await contrastSnapshot(page);
            contrasts.forEach(item => {
                assert.ok(item.ratio >= 4.5, `${theme} contrast for ${item.selector} is ${item.ratio.toFixed(2)}`);
            });
        }
        console.log('HR Structure tree browser smoke passed');
    } finally {
        await browser.close();
    }
}

run().catch(error => fail(error.stack || error.message));
