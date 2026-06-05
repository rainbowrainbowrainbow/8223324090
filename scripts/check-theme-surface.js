#!/usr/bin/env node
/**
 * Theme surface guard.
 *
 * This keeps light/dark support explicit for root CRM pages and prevents
 * known inline-style debt from growing while the UI is gradually consolidated.
 */

const fs = require('fs');
const path = require('path');
const { ROOT_HTML_SURFACE } = require('../config/staticSurface');
const {
    THEME_REDIRECT_PAGES,
    THEME_STANDALONE_PAGES,
    THEME_INLINE_DEBT_BUDGETS,
    THEME_CSS_DEBT_BUDGETS
} = require('../config/themeSurface');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const REQUIRED_SHARED_CSS = ['css/base.css', 'css/dark-mode.css', 'css/responsive.css'];

function fail(message) {
    failures.push(message);
}

function repoPath(file) {
    return path.join(ROOT, file);
}

function read(file) {
    return fs.readFileSync(repoPath(file), 'utf8');
}

function metricForHtml(html) {
    return {
        styleBytes: Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).reduce((sum, match) => sum + match[1].length, 0),
        inlineStyleAttrs: (html.match(/\sstyle\s*=/g) || []).length,
        hardColors: (html.match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || []).length
    };
}

function metricForCss(css) {
    return {
        important: (css.match(/!important/g) || []).length,
        hardColors: (css.match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || []).length
    };
}

function assertMax(label, actual, max, metric) {
    if (actual > max) fail(`${label}: ${metric} ${actual} exceeds budget ${max}`);
}

function hasThemeBootstrap(html) {
    return html.includes('pzp_dark_mode') && html.includes("data-theme");
}

function hasLocalLightDarkContract(html) {
    return html.includes('html[data-theme="light"]') && html.includes('html[data-theme="dark"]');
}

function checkPackageScripts() {
    const pkg = JSON.parse(read('package.json'));
    if (!pkg.scripts?.['check:theme-surface']) fail('package.json must define check:theme-surface');
    if (!String(pkg.scripts?.verify || '').includes('check:theme-surface')) {
        fail('package.json verify script must include check:theme-surface');
    }
}

function checkRedirectPage(file, html, entry) {
    if (!html.includes(entry.target)) fail(`${file}: redirect target ${entry.target} is missing`);
    if (!/window\.location\.replace|http-equiv=["']refresh["']/i.test(html)) {
        fail(`${file}: redirect-only theme exception must remain an actual redirect`);
    }
    const metrics = metricForHtml(html);
    assertMax(file, metrics.styleBytes, 1000, 'styleBytes');
    assertMax(file, metrics.inlineStyleAttrs, 2, 'inlineStyleAttrs');
}

function checkStandalonePage(file, html, entry) {
    if (!hasThemeBootstrap(html)) fail(`${file}: standalone page must set html data-theme from pzp_dark_mode`);
    if (!hasLocalLightDarkContract(html)) fail(`${file}: standalone page must define local light and dark theme rules`);
    const metrics = metricForHtml(html);
    assertMax(file, metrics.styleBytes, entry.maxStyleBytes, 'styleBytes');
    assertMax(file, metrics.inlineStyleAttrs, entry.maxInlineStyleAttrs, 'inlineStyleAttrs');
    assertMax(file, metrics.hardColors, entry.maxHardColors, 'hardColors');
}

function checkSharedCrmPage(file, html) {
    for (const css of REQUIRED_SHARED_CSS) {
        if (!html.includes(css)) fail(`${file}: missing shared theme CSS ${css}`);
    }
    if (!hasThemeBootstrap(html)) fail(`${file}: missing early pzp_dark_mode data-theme bootstrap`);
}

function checkInlineDebtBudget(file, html) {
    const budget = THEME_INLINE_DEBT_BUDGETS[file];
    const metrics = metricForHtml(html);
    const shouldBeBudgeted = metrics.styleBytes > 32000 || metrics.inlineStyleAttrs > 30 || metrics.hardColors > 220;

    if (shouldBeBudgeted && !budget) {
        fail(`${file}: large inline theme surface needs an explicit budget in config/themeSurface.js`);
        return;
    }
    if (!budget) return;
    assertMax(file, metrics.styleBytes, budget.maxStyleBytes, 'styleBytes');
    assertMax(file, metrics.inlineStyleAttrs, budget.maxInlineStyleAttrs, 'inlineStyleAttrs');
    assertMax(file, metrics.hardColors, budget.maxHardColors, 'hardColors');
}

function checkHtmlSurface() {
    const knownRootFiles = new Set(ROOT_HTML_SURFACE.map(entry => entry.file));
    for (const file of Object.keys(THEME_REDIRECT_PAGES)) {
        if (!knownRootFiles.has(file)) fail(`${file}: redirect theme exception is not in static surface`);
    }
    for (const file of Object.keys(THEME_STANDALONE_PAGES)) {
        if (!knownRootFiles.has(file)) fail(`${file}: standalone theme exception is not in static surface`);
    }
    for (const file of Object.keys(THEME_INLINE_DEBT_BUDGETS)) {
        if (!knownRootFiles.has(file)) fail(`${file}: inline debt budget is not in static surface`);
    }

    for (const entry of ROOT_HTML_SURFACE) {
        const file = entry.file;
        const html = read(file);
        if (THEME_REDIRECT_PAGES[file]) {
            checkRedirectPage(file, html, THEME_REDIRECT_PAGES[file]);
            continue;
        }
        if (THEME_STANDALONE_PAGES[file]) {
            checkStandalonePage(file, html, THEME_STANDALONE_PAGES[file]);
        } else {
            checkSharedCrmPage(file, html);
        }
        checkInlineDebtBudget(file, html);
    }
}

function checkCssDebtBudgets() {
    for (const [file, budget] of Object.entries(THEME_CSS_DEBT_BUDGETS)) {
        if (!fs.existsSync(repoPath(file))) {
            fail(`${file}: CSS debt budget target does not exist`);
            continue;
        }
        const metrics = metricForCss(read(file));
        assertMax(file, metrics.important, budget.maxImportant, 'important');
        assertMax(file, metrics.hardColors, budget.maxHardColors, 'hardColors');
    }
}

checkPackageScripts();
checkHtmlSurface();
checkCssDebtBudgets();

if (failures.length) {
    console.error('Theme surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Theme surface check passed: ${ROOT_HTML_SURFACE.length} root HTML pages, ${Object.keys(THEME_INLINE_DEBT_BUDGETS).length} inline debt budgets, ${Object.keys(THEME_CSS_DEBT_BUDGETS).length} CSS debt budgets.`);
