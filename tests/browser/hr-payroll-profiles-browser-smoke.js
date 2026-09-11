#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'hr-payroll-profiles-browser-smoke');
const HEADLESS = process.env.HR_PAYROLL_PROFILES_BROWSER_SMOKE_HEADLESS !== 'false';

function fail(message) {
    console.error(`HR payroll profiles browser smoke failed: ${message}`);
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
const HR_CODE = readRepo('js', 'hr-page.js');
const SIDEBAR_CODE = readRepo('js', 'components', 'sidebar.js');
const PROFILE_PANEL = extractDivMarkup(HR_HTML, 'tab-profiles');
const CSS_BUNDLE = [
    readRepo('css', 'base.css'),
    readRepo('css', 'dark-mode.css'),
    readRepo('css', 'sidebar-aurora.css'),
    readRepo('css', 'hr-page.css')
].join('\n');

const PANEL_IDS = ['today', 'schedule', 'team', 'structure', 'professions', 'checklists', 'reports', 'salary', 'zrs', 'kpi', 'vacancies', 'accounts'];

const PROFILE_CARD_HTML = `
<article class="hr-payroll-profile-card is-selected is-draft">
    <header class="hr-payroll-profile-card-header">
        <div>
            <button type="button" class="hr-payroll-profile-title">QA Animator Base</button>
            <div class="hr-payroll-profile-meta">Аніматор · shared</div>
        </div>
        <div class="hr-payroll-profile-badges">
            <span class="hr-payroll-profile-badge">base</span>
            <span class="hr-payroll-profile-badge is-draft">draft</span>
            <span class="hr-payroll-profile-badge is-ready">profile-ready</span>
        </div>
    </header>
    <div class="hr-payroll-profile-rate-grid">
        <div><span>Ставка</span><strong>120 ₴/год</strong><small>оновлено сьогодні</small></div>
        <div><span>Зміни</span><strong>Пн-Пт</strong><small>override active</small></div>
    </div>
    <div class="hr-payroll-profile-period-grid">
        <div><span>Період</span><strong>Вересень</strong><small>активний</small></div>
        <div class="is-mixed"><span>Diff</span><strong>2 поля</strong><small>потребує синхронізації</small></div>
    </div>
    <div class="hr-payroll-profile-day-grid">
        <span class="hr-payroll-profile-day is-override">Пн<br>140</span>
        <span class="hr-payroll-profile-day">Вт<br>120</span>
        <span class="hr-payroll-profile-day is-empty">Немає версії</span>
    </div>
    <footer class="hr-payroll-profile-card-footer">
        <span>3 працівники</span>
        <div class="hr-payroll-profile-actions"><button type="button">Редагувати</button></div>
    </footer>
</article>`;

const PROFILE_INSPECTOR_HTML = `
<section class="hr-payroll-profile-inspector-card">
    <div class="hr-payroll-profile-inspector-head">
        <div><strong>QA Animator Base</strong><span>Персональний клон</span></div>
        <button type="button">Клонувати</button>
    </div>
    <div class="hr-payroll-profile-inspector-stats">
        <div><span>Активні</span><strong>3</strong></div>
        <div><span>Default</span><strong>Так</strong></div>
    </div>
    <form class="hr-payroll-profile-editor">
        <div class="hr-payroll-profile-editor-title"><strong>Версія</strong><span>без збереження</span></div>
        <div class="hr-payroll-profile-form-grid">
            <label>Назва<input value="QA Animator Base"></label>
            <label>Тип<select><option>shared</option></select></label>
        </div>
    </form>
    <div class="hr-payroll-profile-impact">
        <div class="hr-payroll-profile-impact-grid"><div><span>Вплив</span><strong>+240 ₴</strong><small>preview</small></div></div>
        <div class="hr-payroll-profile-impact-note">Вкажіть ставку, щоб побачити вплив до активації.</div>
    </div>
    <div class="hr-payroll-profile-compare">
        <label class="hr-payroll-profile-diff-row"><input type="checkbox"><span><strong>default_rate</strong>120 → 140</span></label>
    </div>
</section>`;

function harnessHtml(theme) {
    const panels = PANEL_IDS.map(id => `<div id="tab-${id}" class="hr-tab-content"></div>`).join('\n');
    return `<!doctype html>
<html lang="uk" data-theme="${theme}">
<head><meta charset="utf-8"><style>${CSS_BUNDLE}</style></head>
<body data-page-group="hr" class="${theme === 'dark' ? 'dark-mode' : ''}">
    <aside id="sidebarNav" class="sidebar-nav"><div id="sidebarLinks" class="sidebar-links"></div></aside>
    <main class="page-container" id="main-content">
        <header class="page-header"><h1 id="hrPageTitle">HR</h1></header>
        <nav id="hrNav" class="hr-nav" aria-label="Навігація HR"></nav>
        ${panels}
        ${PROFILE_PANEL}
    </main>
</body>
</html>`;
}

async function installHarness(page, theme, width) {
    await page.setViewportSize({ width, height: width < 600 ? 820 : 900 });
    await page.route('https://eventgenix.test/hr*', route => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: harnessHtml(theme)
    }));
    await page.goto('https://eventgenix.test/hr#profiles', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', roles: ['creator'], name: 'QA Creator' } };
        window.RolePreview = { getPreviewRole: () => null };
        window.canAccess = () => true;
        window.canAccessPage = () => true;
        window.getPermissionLifecycle = () => ({ status: 'ready' });
        window.isAuthenticatedRuntimeReady = () => true;
        window.resolveCapability = () => ({ allowed: true });
        window.showNotification = () => {};
        window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    });
    await page.addScriptTag({ content: SIDEBAR_CODE });
    await page.addScriptTag({ content: HR_CODE });
    await page.evaluate(({ cardHtml, inspectorHtml }) => {
        document.getElementById('payrollProfilesList').innerHTML = cardHtml;
        document.getElementById('payrollProfileInspector').innerHTML = inspectorHtml;
        document.getElementById('tab-profiles').classList.add('active');
        renderHrNav('profiles');
        syncHrNavActive('profiles');
        Sidebar.render('#sidebarLinks');
    }, { cardHtml: PROFILE_CARD_HTML, inspectorHtml: PROFILE_INSPECTOR_HTML });
}

async function assertNavigation(page) {
    const tabs = await page.$$eval('#hrNav .hr-tab', buttons => buttons.map(button => ({
        tab: button.dataset.tab,
        text: button.textContent.replace(/\s+/g, ' ').trim(),
        beta: button.querySelector('.hr-nav-beta-badge')?.textContent.trim() || '',
        betaAriaHidden: button.querySelector('.hr-nav-beta-badge')?.getAttribute('aria-hidden') || '',
        ariaLabel: button.getAttribute('aria-label') || '',
        active: button.classList.contains('active')
    })));
    assert.deepEqual(tabs.map(tab => tab.tab), ['salary', 'zrs', 'kpi', 'profiles']);
    assert.deepEqual(tabs.map(tab => tab.text), ['Зарплата', 'ЗРС', 'KPI', 'Профілі Beta']);
    assert.equal(tabs[3].beta, 'Beta');
    assert.equal(tabs[3].betaAriaHidden, 'true');
    assert.equal(tabs[3].ariaLabel, 'Профілі, Beta');
    assert.equal(tabs[3].active, true);

    const sidebarActive = await page.$eval('#sidebarLinks .nav-link.active[aria-current="page"]', link => ({
        href: link.getAttribute('href'),
        label: link.querySelector('.nav-text')?.textContent.trim()
    }));
    assert.equal(sidebarActive.href, '/hr#payroll');
    assert.equal(sidebarActive.label, 'ЗП та KPI');
}

async function contrastSnapshot(page) {
    return page.evaluate(() => {
        function parseColor(value) {
            const match = String(value || '').match(/rgba?\(([^)]+)\)/);
            if (!match) return { r: 255, g: 255, b: 255, a: 1 };
            const parts = match[1].split(',').map(part => part.trim());
            return {
                r: Number(parts[0]),
                g: Number(parts[1]),
                b: Number(parts[2]),
                a: parts[3] === undefined ? 1 : Number(parts[3])
            };
        }
        function blend(top, bottom) {
            const alpha = Number.isFinite(top.a) ? top.a : 1;
            return {
                r: Math.round(top.r * alpha + bottom.r * (1 - alpha)),
                g: Math.round(top.g * alpha + bottom.g * (1 - alpha)),
                b: Math.round(top.b * alpha + bottom.b * (1 - alpha)),
                a: 1
            };
        }
        function paintedBackground(element) {
            let current = element;
            let color = { r: 255, g: 255, b: 255, a: 1 };
            const layers = [];
            while (current) {
                layers.push(parseColor(getComputedStyle(current).backgroundColor));
                current = current.parentElement;
            }
            for (let index = layers.length - 1; index >= 0; index -= 1) {
                color = blend(layers[index], color);
            }
            return color;
        }
        function channel(value) {
            const normalized = value / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        }
        function luminance(color) {
            return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
        }
        function ratio(foreground, background) {
            const light = Math.max(luminance(foreground), luminance(background));
            const dark = Math.min(luminance(foreground), luminance(background));
            return (light + 0.05) / (dark + 0.05);
        }
        function contrast(name, textSelector, backgroundSelector = textSelector) {
            const text = document.querySelector(textSelector);
            const background = document.querySelector(backgroundSelector);
            return {
                name,
                ratio: ratio(parseColor(getComputedStyle(text).color), paintedBackground(background)),
                color: getComputedStyle(text).color,
                background: getComputedStyle(background).backgroundColor
            };
        }
        return [
            contrast('profile title', '#tab-profiles .hr-payroll-profile-title', '#tab-profiles .hr-payroll-profile-card'),
            contrast('profile meta', '#tab-profiles .hr-payroll-profile-meta', '#tab-profiles .hr-payroll-profile-card'),
            contrast('draft badge', '#tab-profiles .hr-payroll-profile-badge.is-draft'),
            contrast('override day', '#tab-profiles .hr-payroll-profile-day.is-override'),
            contrast('form input', '#tab-profiles .hr-payroll-profile-form-grid input'),
            contrast('beta badge', '#hrNav .hr-tab[data-tab="profiles"] .hr-nav-beta-badge')
        ];
    });
}

async function assertTheme(page, theme, width) {
    const contrasts = await contrastSnapshot(page);
    for (const item of contrasts) {
        assert.ok(item.ratio >= 4.5, `${theme} ${width}px ${item.name} contrast is ${item.ratio.toFixed(2)} (${item.color} on ${item.background})`);
    }
    const cardBackground = await page.$eval('#tab-profiles .hr-payroll-profile-card', element => getComputedStyle(element).backgroundColor);
    if (theme === 'dark') assert.notEqual(cardBackground, 'rgb(255, 255, 255)');
    if (theme === 'light') assert.equal(cardBackground, 'rgb(255, 255, 255)');
    if (width < 600) {
        const overflow = await page.$eval('#tab-profiles', element => element.scrollWidth - element.clientWidth);
        assert.ok(overflow <= 1, `${theme} mobile profile tab overflows by ${overflow}px`);
    }
}

async function run() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        for (const theme of ['light', 'dark']) {
            for (const width of [1440, 390]) {
                const page = await browser.newPage();
                page.setDefaultTimeout(20000);
                try {
                    await installHarness(page, theme, width);
                    await assertNavigation(page);
                    await assertTheme(page, theme, width);
                    await page.screenshot({ path: path.join(OUTPUT_DIR, `${theme}-${width}.png`), fullPage: true });
                } finally {
                    await page.close();
                }
            }
        }
        console.log('HR payroll profiles browser smoke passed');
    } finally {
        await browser.close();
    }
}

run().catch(error => fail(error.stack || error.message));
