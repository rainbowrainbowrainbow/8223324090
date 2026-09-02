'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        error.message = `${error.message}; run with NODE_PATH pointing at an installed EventGenix node_modules or install dependencies`;
        throw error;
    }
}

const ROOT = path.resolve(__dirname, '..', '..');
const VIEWPORTS = [
    { name: 'mobile', width: 390, height: 844, headerWidth: 62 },
    { name: 'tablet', width: 768, height: 1024, headerWidth: 90 },
    { name: 'desktop', width: 1440, height: 900, headerWidth: 130 }
];
const THEMES = ['dark', 'light'];
const NAMES = ['Аніматор 1', 'Пасенко Женя', 'Дуже довга синтетична назва ресурсу'];

function html() {
    const timelineCss = fs.readFileSync(path.join(ROOT, 'css', 'timeline.css'), 'utf8');
    const responsiveCss = fs.readFileSync(path.join(ROOT, 'css', 'responsive.css'), 'utf8');
    const lines = NAMES.map(name => `
        <div class="timeline-line">
            <div class="line-header line-header--title-only" title="${name}" aria-label="${name}">
                <span class="line-name">${name}</span>
            </div>
            <div class="line-grid"></div>
        </div>
    `).join('');
    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                :root {
                    --font-base: 14px;
                    --gray-800: #1f2937;
                    --gray-400: #9ca3af;
                    --gray-50: #f9fafb;
                    --primary: #0ea586;
                    --primary-50: rgba(14, 165, 134, 0.08);
                    --primary-light: rgba(14, 165, 134, 0.16);
                    --primary-dark: #0d9488;
                    --radius-xs: 6px;
                    --speed-fast: 120ms;
                    --ease-smooth: ease;
                }
                ${timelineCss}
                ${responsiveCss}
                body { margin: 0; }
                .timeline-scroll {
                    --timeline-grid-width: 1800px !important;
                    --timeline-content-width: calc(var(--timeline-line-header-w) + 1800px) !important;
                    box-sizing: border-box;
                    width: 100vw !important;
                    max-width: 100vw !important;
                    overflow-x: auto !important;
                }
                .timeline-lines,
                .timeline-line {
                    width: calc(var(--timeline-line-header-w) + 1800px) !important;
                    min-width: calc(var(--timeline-line-header-w) + 1800px) !important;
                }
                .timeline-line { display: flex !important; }
                .line-header {
                    flex: 0 0 var(--timeline-line-header-w) !important;
                    width: var(--timeline-line-header-w) !important;
                    min-width: var(--timeline-line-header-w) !important;
                }
                .line-grid {
                    flex: 0 0 1800px !important;
                    width: 1800px !important;
                    min-width: 1800px !important;
                }
            </style>
        </head>
        <body class="timeline-dashboard-page">
            <div id="timelineScroll" class="timeline-scroll">
                <div class="timeline-lines">${lines}</div>
            </div>
        </body>
        </html>`;
}

async function main() {
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        for (const viewport of VIEWPORTS) {
            for (const theme of THEMES) {
                const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
                try {
                    await page.setContent(html(), { waitUntil: 'domcontentloaded' });
                    await page.evaluate(({ nextTheme, headerWidth }) => {
                        document.documentElement.dataset.theme = nextTheme;
                        document.body.classList.toggle('dark-mode', nextTheme === 'dark');
                        document.documentElement.style.setProperty('--timeline-line-header-w', `${headerWidth}px`);
                    }, { nextTheme: theme, headerWidth: viewport.headerWidth });
                    const rows = await page.$$eval('.line-header--title-only', headers => headers.map(header => {
                        const name = header.querySelector('.line-name');
                        const headerRect = header.getBoundingClientRect();
                        const nameRect = name.getBoundingClientRect();
                        const style = getComputedStyle(name);
                        return {
                            title: header.getAttribute('title'),
                            ariaLabel: header.getAttribute('aria-label'),
                            text: name.textContent.trim(),
                            overflowWrap: style.overflowWrap,
                            wordBreak: style.wordBreak,
                            hyphens: style.hyphens,
                            webkitLineClamp: style.webkitLineClamp,
                            textOverflow: style.textOverflow,
                            whiteSpace: style.whiteSpace,
                            fontSize: Number.parseFloat(style.fontSize),
                            nameInsideHeader: nameRect.left >= headerRect.left - 1
                                && nameRect.right <= headerRect.right + 1
                                && nameRect.top >= headerRect.top - 1
                                && nameRect.bottom <= headerRect.bottom + 1
                        };
                    }));
                    assert.equal(rows.length, NAMES.length, `${viewport.name}/${theme}: all resource labels rendered`);
                    for (const row of rows) {
                        assert.equal(row.title, row.text, `${viewport.name}/${theme}: title keeps full name`);
                        assert.equal(row.ariaLabel, row.text, `${viewport.name}/${theme}: aria-label keeps full name`);
                        assert.equal(row.overflowWrap, 'normal', `${viewport.name}/${theme}: no anywhere wrapping`);
                        assert.equal(row.wordBreak, 'normal', `${viewport.name}/${theme}: normal word breaks`);
                        assert.equal(row.hyphens, 'none', `${viewport.name}/${theme}: no hyphenation`);
                        assert.equal(row.webkitLineClamp, '2', `${viewport.name}/${theme}: two-line clamp`);
                        assert.equal(row.textOverflow, 'ellipsis', `${viewport.name}/${theme}: long names ellipsize`);
                        assert.equal(row.whiteSpace, 'normal', `${viewport.name}/${theme}: word-boundary wrapping enabled`);
                        assert.ok(row.fontSize >= 11, `${viewport.name}/${theme}: readable font size`);
                        assert.equal(row.nameInsideHeader, true, `${viewport.name}/${theme}: label stays inside sticky header`);
                    }
                    const scroll = await page.$eval('#timelineScroll', node => ({
                        horizontalScroll: node.scrollWidth > node.clientWidth,
                        maxScrollLeft: node.scrollWidth - node.clientWidth
                    }));
                    assert.equal(scroll.horizontalScroll, true, `${viewport.name}/${theme}: horizontal scroll remains available`);
                    assert.ok(scroll.maxScrollLeft > 0, `${viewport.name}/${theme}: timeline content remains scrollable`);
                } finally {
                    await page.close();
                }
            }
        }
        console.log(JSON.stringify({ success: true, viewports: VIEWPORTS.map(item => item.name), themes: THEMES, names: NAMES }));
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(JSON.stringify({ success: false, message: error.message }));
    process.exitCode = 1;
});
