#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_FILES = [
    'css/base.css', 'css/layout.css', 'css/timeline.css', 'css/panel.css',
    'css/controls.css', 'css/features.css', 'css/dark-mode.css', 'css/responsive.css'
];

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

const HTML = `<!doctype html><html lang="uk" data-theme="light"><head><meta charset="utf-8"></head>
<body class="timeline-dashboard-page">
<a class="skip-link" href="#fixture">До вмісту</a>
<header class="header"><div class="user-panel header-actions"><button class="btn-logout">Вийти</button></div></header>
<main id="fixture" class="theme-fixture"><section class="theme-fixture-card">
<p class="form-hint">Час видачі та кімната</p>
<div class="status-radio-group"><label class="status-radio"><input type="radio" name="status-confirmed" checked><span class="status-radio-label confirmed">Підтверджене</span></label><label class="status-radio"><input type="radio" name="status-preliminary" checked><span class="status-radio-label preliminary">Попереднє</span></label></div>
<button class="booking-mini-action">Новий клієнт</button><button class="booking-panel-close" aria-label="Закрити">× Закрити</button>
<div id="bookingTicketsSection">
<div class="booking-ticket-control"><span>Звичайні діти</span><output id="ticketOutput">0</output></div>
<div class="booking-ticket-control"><span>Іменинники</span><input id="ticketInput" type="number" value="0"></div></div>
<div class="booking-ticket-quote-state">Вкажіть кількість дітей і дорослих.</div>
<div class="booking-menu-catalog-entry"><button id="menuOpen" class="booking-menu-catalog-open"><span aria-hidden="true">+</span>Додати з меню</button><span class="booking-menu-catalog-entry-summary">0 позицій · 0 ₴</span></div>
<footer class="booking-sticky-footer"><div class="booking-sticky-footer__top"><strong>Підсумок</strong><small>Можна створювати бронювання.</small></div><div class="booking-summary-row">Меню <strong>0 ₴</strong></div><div class="booking-summary-note booking-summary-note--warning"><strong>Передзамовлення / завдаток</strong>Завдаток не вказано.</div></footer>
</section><section class="booking-menu-catalog-panel"><header class="booking-menu-catalog-header"><strong id="catalogTitle">Каталог меню</strong></header><div class="booking-menu-catalog-body"><p>Оберіть позиції меню</p></div></section>
<div class="afisha-line-header">АФІША <button class="afisha-dist-btn" aria-label="Розподілити афішу по ведучих">↔</button></div>
</main></body></html>`;

const FIXTURE_CSS = `body{margin:0;min-height:100vh}.theme-fixture{display:grid;gap:16px;max-width:920px;margin:72px auto 24px;padding:20px}.theme-fixture-card{padding:16px;border:1px solid var(--border-color,#cbd5e1);border-radius:12px;background:var(--bg-card,#fff)}.booking-menu-catalog-panel{position:relative;inset:auto;width:100%;height:auto;min-height:180px;padding:12px}.booking-menu-catalog-body{min-height:80px}.afisha-line-header{width:220px;padding:12px}`;

async function collect(page, theme) {
    await page.evaluate(value => {
        document.documentElement.dataset.theme = value;
        document.body.classList.toggle('dark-mode', value === 'dark');
    }, theme);
    const input = page.locator('#ticketInput');
    const menu = page.locator('#menuOpen');
    await input.focus();
    const inputFocus = await input.evaluate(el => getComputedStyle(el).boxShadow);
    await menu.focus();
    const menuFocus = await menu.evaluate(el => getComputedStyle(el).boxShadow);
    await page.evaluate(() => document.activeElement?.blur());

    return page.evaluate(currentTheme => {
        const parse = value => {
            const text = String(value || '');
            const parts = text.match(/[\d.]+/g)?.map(Number) || [];
            if (parts.length < 3) return null;
            const srgbScale = text.startsWith('color(srgb') ? 255 : 1;
            return { r: parts[0] * srgbScale, g: parts[1] * srgbScale, b: parts[2] * srgbScale, a: parts[3] ?? 1 };
        };
        const blend = (top, bottom) => ({
            r: top.r * top.a + bottom.r * (1 - top.a),
            g: top.g * top.a + bottom.g * (1 - top.a),
            b: top.b * top.a + bottom.b * (1 - top.a), a: 1
        });
        const background = element => {
            const chain = [];
            for (let node = element; node; node = node.parentElement) chain.push(node);
            let result = currentTheme === 'dark' ? { r: 15, g: 23, b: 42, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
            for (const node of chain.reverse()) {
                const color = parse(getComputedStyle(node).backgroundColor);
                if (color?.a > 0) result = blend(color, result);
            }
            return result;
        };
        const luminance = color => [color.r, color.g, color.b]
            .map(channel => channel / 255)
            .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const contrast = selector => {
            const element = document.querySelector(selector);
            const bg = background(element);
            const fg = blend(parse(getComputedStyle(element).color), bg);
            return Math.round(((Math.max(luminance(fg), luminance(bg)) + 0.05) / (Math.min(luminance(fg), luminance(bg)) + 0.05)) * 100) / 100;
        };
        const box = selector => {
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { width: rect.width, height: rect.height, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, textAlign: style.textAlign, fontVariantNumeric: style.fontVariantNumeric };
        };
        const selectors = ['.skip-link','.form-hint','.status-radio-label.confirmed','.status-radio-label.preliminary','.booking-panel-close','.booking-mini-action','.booking-ticket-control output','.booking-ticket-control input','.booking-ticket-quote-state','.booking-menu-catalog-open','.booking-menu-catalog-entry-summary','.booking-sticky-footer__top strong','.booking-summary-row','.booking-summary-note--warning','#catalogTitle','.btn-logout','.afisha-dist-btn'];
        return {
            theme: currentTheme,
            contrasts: Object.fromEntries(selectors.map(selector => [selector, contrast(selector)])),
            input: box('#ticketInput'), output: box('#ticketOutput'),
            stickyBackground: getComputedStyle(document.querySelector('.booking-sticky-footer')).backgroundImage,
            catalogBackground: getComputedStyle(document.querySelector('.booking-menu-catalog-panel')).backgroundColor
        };
    }, theme).then(metrics => ({ ...metrics, inputFocus, menuFocus }));
}

function verify(metrics) {
    for (const [selector, ratio] of Object.entries(metrics.contrasts)) {
        assert.ok(ratio >= 4.5, `${metrics.theme} ${selector} contrast is ${ratio}:1; expected >= 4.5:1`);
    }
    for (const key of ['width','height','fontSize','fontWeight','lineHeight','textAlign','fontVariantNumeric']) {
        assert.equal(metrics.input[key], metrics.output[key], `${metrics.theme} ticket input/output ${key} matches`);
    }
    assert.equal(metrics.input.textAlign, 'center', `${metrics.theme} ticket number is centered`);
    assert.notEqual(metrics.inputFocus, 'none', `${metrics.theme} ticket input has focus ring`);
    assert.notEqual(metrics.menuFocus, 'none', `${metrics.theme} menu button has focus ring`);
}

async function main() {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'booking-tickets.js'), 'utf8');
    assert.equal(source.includes('Серверний розрахунок актуальний'), false, 'technical quote success copy stays removed');
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    try {
        await page.setContent(HTML, { waitUntil: 'domcontentloaded' });
        for (const file of CSS_FILES) await page.addStyleTag({ path: path.join(ROOT, file) });
        await page.addStyleTag({ content: FIXTURE_CSS });
        const light = await collect(page, 'light');
        const dark = await collect(page, 'dark');
        verify(light); verify(dark);
        assert.notEqual(light.stickyBackground, dark.stickyBackground, 'summary footer has light/dark backgrounds');
        assert.notEqual(light.catalogBackground, dark.catalogBackground, 'menu catalog has light/dark backgrounds');
        console.log('Booking theme browser smoke passed: light/dark contrast, ticket alignment, focus, catalog and summary themes.');
    } catch (error) {
        const output = path.join(ROOT, 'test-results', 'booking-theme-browser-smoke');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        throw error;
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
