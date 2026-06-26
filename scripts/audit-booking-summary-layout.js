#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright');
const HEADLESS = process.env.BOOKING_SUMMARY_LAYOUT_AUDIT_HEADLESS !== 'false';
const FIXTURE_NAMES = Object.freeze(['compact', 'realistic', 'long']);

const THRESHOLDS = Object.freeze({
    a4WidthMm: 210,
    a4HeightMm: 297,
    a4ToleranceMm: 1.25,
    bottomFreeMinMm: 8,
    clientRowMaxMm: 5.4,
    scheduleNormalRowMaxMm: 5.2,
    orderBodyFontMinPx: 9.8
});

function usage() {
    return [
        'Usage: node scripts/audit-booking-summary-layout.js [--fixture compact|realistic|long|all]',
        '',
        'Default fixture: realistic'
    ].join('\n');
}

function parseArgs(argv) {
    let fixture = 'realistic';
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            console.log(usage());
            process.exit(0);
        }
        if (arg === '--fixture') {
            fixture = argv[index + 1] || fixture;
            index += 1;
            continue;
        }
        if (arg.startsWith('--fixture=')) {
            fixture = arg.slice('--fixture='.length);
        }
    }
    const normalized = String(fixture || '').trim().toLowerCase();
    if (normalized === 'all') return [...FIXTURE_NAMES];
    if (FIXTURE_NAMES.includes(normalized)) return [normalized];
    throw new Error(`Unknown fixture "${fixture}". Expected one of: ${FIXTURE_NAMES.join(', ')}, all.`);
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.json') return 'application/json; charset=utf-8';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.ico') return 'image/x-icon';
    if (ext === '.woff') return 'font/woff';
    if (ext === '.woff2') return 'font/woff2';
    if (ext === '.ttf') return 'font/ttf';
    return 'application/octet-stream';
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://local');
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (relativePath === 'booking-summary') relativePath = 'booking-summary.html';
    const absolutePath = path.resolve(ROOT, relativePath);
    const rootPrefix = `${ROOT}${path.sep}`;
    if (absolutePath !== ROOT && !absolutePath.startsWith(rootPrefix)) return null;
    return absolutePath;
}

function createStaticServer() {
    const server = http.createServer((req, res) => {
        const filePath = staticFilePath(req.url || '/');
        if (!filePath) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, body) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': contentType(filePath),
                'Cache-Control': 'no-store'
            });
            res.end(body);
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`
            });
        });
    });
}

function fixturePath(name) {
    return path.join(FIXTURE_DIR, `booking-summary-layout-${name}.fixture.json`);
}

function loadFixture(name) {
    const filePath = fixturePath(name);
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const summary = fixture.summary || fixture;
    if (!summary || typeof summary !== 'object') throw new Error(`Fixture ${name} has no summary object.`);
    if (!summary.bookingId) throw new Error(`Fixture ${name} summary has no bookingId.`);
    return {
        name,
        filePath,
        expected: fixture.expected || {},
        summary
    };
}

function artifactPaths(fixtureName, useCanonicalNames) {
    const prefix = useCanonicalNames ? 'booking-summary-audit' : `booking-summary-audit-${fixtureName}`;
    return {
        screenScreenshot: path.join(OUTPUT_DIR, `${prefix}-screen.png`),
        printScreenshot: path.join(OUTPUT_DIR, `${prefix}-print-emulated.png`),
        browserPrintPdf: path.join(OUTPUT_DIR, `${prefix}-browser-print.pdf`),
        metricsJson: path.join(OUTPUT_DIR, `${prefix}-metrics.json`)
    };
}

function summaryPath(summary) {
    const params = new URLSearchParams({
        id: summary.bookingId || 'BK-2026-0515',
        mode: summary.mode || 'client',
        businessContext: summary.businessContext || 'event_genix'
    });
    return `/booking-summary.html?${params.toString()}`;
}

function pdfPageCount(buffer) {
    const matches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
    return matches ? matches.length : 0;
}

function orderNoteVisibility(summary) {
    const rowsWithComments = (Array.isArray(summary.orderRows) ? summary.orderRows : [])
        .filter(row => row && row.comment);
    const metaText = (summary.orderRowViews?.client || [])
        .flatMap(row => Array.isArray(row.metaLines) ? row.metaLines : [])
        .join('\n');
    const missing = rowsWithComments
        .filter(row => !metaText.includes(String(row.comment || '').trim()))
        .map(row => row.title || row.name || row.id || 'order row');
    return {
        commentedOrderRows: rowsWithComments.length,
        missingOrderNotes: missing.length,
        missing
    };
}

async function routeBookingSummaryApi(page, getSummary) {
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (/\/api\/bookings\/[^/]+\/banquet-summary(?:\.pdf)?$/.test(url.pathname)) {
            if (url.pathname.endsWith('.pdf')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/pdf',
                    headers: {
                        'content-disposition': 'attachment; filename="booking-summary-audit.pdf"'
                    },
                    body: Buffer.from('%PDF-1.4\n% booking summary audit placeholder\n%%EOF\n', 'utf8')
                });
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json; charset=utf-8',
                body: JSON.stringify(getSummary())
            });
        }

        return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ success: true })
        });
    });
}

async function waitForStableDocument(page) {
    await page.waitForSelector('#bookingSummaryDocument:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(() => Array.from(document.images).every(img => img.complete), null, { timeout: 10000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
}

async function measureLayout(page, media) {
    await page.emulateMedia({ media });
    await waitForStableDocument(page);

    return page.evaluate((mediaName) => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:100mm;height:1mm;left:-10000px;top:-10000px;';
        document.body.appendChild(probe);
        const pxPerMm = probe.getBoundingClientRect().width / 100;
        probe.remove();

        const round = value => Math.round(value * 100) / 100;
        const mm = px => round(px / pxPerMm);
        const px = value => Number.parseFloat(value) || 0;
        const element = selector => document.querySelector(selector);
        const elements = selector => Array.from(document.querySelectorAll(selector));
        const rectFor = el => {
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {
                topPx: round(rect.top),
                leftPx: round(rect.left),
                widthPx: round(rect.width),
                heightPx: round(rect.height),
                bottomPx: round(rect.bottom),
                widthMm: mm(rect.width),
                heightMm: mm(rect.height)
            };
        };
        const rowStats = selector => {
            const rows = elements(selector).map(rectFor).filter(Boolean);
            if (!rows.length) return null;
            const heights = rows.map(row => row.heightMm);
            return {
                count: rows.length,
                firstMm: heights[0],
                minMm: Math.min(...heights),
                maxMm: Math.max(...heights),
                avgMm: round(heights.reduce((sum, height) => sum + height, 0) / heights.length)
            };
        };
        const fontSize = selector => {
            const el = element(selector);
            return el ? round(px(getComputedStyle(el).fontSize)) : null;
        };

        const documentEl = element('#bookingSummaryDocument');
        const documentRect = rectFor(documentEl);
        const documentStyle = documentEl ? getComputedStyle(documentEl) : null;
        const padding = documentStyle ? {
            topMm: mm(px(documentStyle.paddingTop)),
            rightMm: mm(px(documentStyle.paddingRight)),
            bottomMm: mm(px(documentStyle.paddingBottom)),
            leftMm: mm(px(documentStyle.paddingLeft))
        } : null;

        const childRects = documentEl
            ? Array.from(documentEl.children).map(child => child.getBoundingClientRect())
            : [];
        const contentBottomPx = childRects.length
            ? Math.max(...childRects.map(rect => rect.bottom))
            : documentRect?.topPx || 0;
        const contentTopPx = documentRect && documentStyle
            ? documentEl.getBoundingClientRect().top + px(documentStyle.paddingTop)
            : 0;
        const contentHeightPx = Math.max(0, contentBottomPx - contentTopPx);
        const freeBottomPx = documentRect && documentStyle
            ? documentEl.getBoundingClientRect().bottom - px(documentStyle.paddingBottom) - contentBottomPx
            : 0;

        const normalScheduleRow = elements('.summary-schedule-item')
            .find(row => !row.querySelector('small')) || element('.summary-schedule-item');
        const sectionTitle = element('.summary-section h2');
        const sectionTitleStyle = sectionTitle ? getComputedStyle(sectionTitle) : null;
        const sectionTitleRect = rectFor(sectionTitle);
        const sectionTitleCostMm = sectionTitleRect && sectionTitleStyle
            ? mm(sectionTitle.getBoundingClientRect().height + px(sectionTitleStyle.marginTop) + px(sectionTitleStyle.marginBottom))
            : null;

        return {
            media: mediaName,
            pxPerMm: round(pxPerMm),
            viewport: {
                widthPx: window.innerWidth,
                heightPx: window.innerHeight
            },
            a4: {
                widthMm: documentRect?.widthMm ?? null,
                heightMm: documentRect?.heightMm ?? null
            },
            documentPadding: padding,
            content: {
                usedHeightMm: mm(contentHeightPx),
                availableHeightMm: documentRect && padding ? round(documentRect.heightMm - padding.topMm - padding.bottomMm) : null,
                freeBottomMm: mm(freeBottomPx)
            },
            horizontalOverflow: {
                htmlScrollWidthPx: document.documentElement.scrollWidth,
                htmlClientWidthPx: document.documentElement.clientWidth,
                bodyScrollWidthPx: document.body.scrollWidth,
                viewportWidthPx: window.innerWidth,
                hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
                    || document.body.scrollWidth > window.innerWidth + 1
            },
            blocks: {
                hero: rectFor(element('.banquet-hero')),
                clientBlock: rectFor(element('.summary-brief')),
                orderTable: rectFor(element('.summary-order-table')),
                sectionTitle: {
                    ...sectionTitleRect,
                    costMm: sectionTitleCostMm
                }
            },
            rows: {
                client: rowStats('.summary-brief-item'),
                responsible: rowStats('.summary-responsible-item'),
                schedule: rowStats('.summary-schedule-item'),
                scheduleNormal: rectFor(normalScheduleRow),
                orderFirstBodyRow: rectFor(element('.summary-order-table tbody tr'))
            },
            fonts: {
                orderBodyPx: fontSize('.summary-order-table tbody td'),
                clientPx: fontSize('.summary-brief-item'),
                schedulePx: fontSize('.summary-schedule-item')
            }
        };
    }, media);
}

function checkValue(name, actual, expected, pass, details = {}) {
    return {
        name,
        pass: Boolean(pass),
        actual,
        expected,
        ...details
    };
}

function buildChecks(report) {
    const checks = [];
    const expectedPages = Number(report.expected.browserPrintPages || 1);
    for (const item of [report.metrics.screen, report.metrics.print]) {
        const prefix = `${report.fixture}:${item.media}`;
        checks.push(checkValue(
            `${prefix}: A4 width`,
            item.a4.widthMm,
            `${THRESHOLDS.a4WidthMm}mm +/- ${THRESHOLDS.a4ToleranceMm}mm`,
            Math.abs(item.a4.widthMm - THRESHOLDS.a4WidthMm) <= THRESHOLDS.a4ToleranceMm
        ));
        checks.push(checkValue(
            `${prefix}: document height policy`,
            item.a4.heightMm,
            expectedPages === 1
                ? `${THRESHOLDS.a4HeightMm}mm +/- ${THRESHOLDS.a4ToleranceMm}mm`
                : `>= ${THRESHOLDS.a4HeightMm - THRESHOLDS.a4ToleranceMm}mm`,
            expectedPages === 1
                ? Math.abs(item.a4.heightMm - THRESHOLDS.a4HeightMm) <= THRESHOLDS.a4ToleranceMm
                : item.a4.heightMm >= THRESHOLDS.a4HeightMm - THRESHOLDS.a4ToleranceMm
        ));
        checks.push(checkValue(
            `${prefix}: no horizontal overflow`,
            item.horizontalOverflow.hasOverflow,
            false,
            !item.horizontalOverflow.hasOverflow,
            item.horizontalOverflow
        ));
        if (Number.isFinite(Number(report.expected.bottomFreeMinMm))) {
            checks.push(checkValue(
                `${prefix}: bottom free space`,
                item.content.freeBottomMm,
                `>= ${report.expected.bottomFreeMinMm}mm`,
                item.content.freeBottomMm >= Number(report.expected.bottomFreeMinMm)
            ));
        }
        checks.push(checkValue(
            `${prefix}: client row max height`,
            item.rows.client?.maxMm ?? null,
            `<= ${THRESHOLDS.clientRowMaxMm}mm`,
            item.rows.client && item.rows.client.maxMm <= THRESHOLDS.clientRowMaxMm
        ));
        checks.push(checkValue(
            `${prefix}: normal schedule row height`,
            item.rows.scheduleNormal?.heightMm ?? null,
            `<= ${THRESHOLDS.scheduleNormalRowMaxMm}mm`,
            item.rows.scheduleNormal && item.rows.scheduleNormal.heightMm <= THRESHOLDS.scheduleNormalRowMaxMm
        ));
        checks.push(checkValue(
            `${prefix}: order table body font`,
            item.fonts.orderBodyPx,
            `>= ${THRESHOLDS.orderBodyFontMinPx}px`,
            item.fonts.orderBodyPx >= THRESHOLDS.orderBodyFontMinPx
        ));
    }
    checks.push(checkValue(
        `${report.fixture}: browser print page count`,
        report.browserPrintPdf.pageCount,
        expectedPages,
        report.browserPrintPdf.pageCount === expectedPages
    ));
    checks.push(checkValue(
        `${report.fixture}: visible order notes`,
        report.orderNoteVisibility.missingOrderNotes,
        0,
        report.orderNoteVisibility.commentedOrderRows > 0 && report.orderNoteVisibility.missingOrderNotes === 0,
        report.orderNoteVisibility
    ));
    return checks;
}

function printSummary(report) {
    const line = '-'.repeat(128);
    console.log(`\nBooking summary layout audit: ${report.fixture}`);
    console.log(line);
    console.log('media   A4 mm       used/free mm   hero  brief row  responsible row  schedule normal  order table/row  order font  pdf pages');
    console.log(line);
    for (const item of [report.metrics.screen, report.metrics.print]) {
        const row = [
            item.media.padEnd(7),
            `${item.a4.widthMm}x${item.a4.heightMm}`.padEnd(12),
            `${item.content.usedHeightMm}/${item.content.freeBottomMm}`.padEnd(14),
            String(item.blocks.hero?.heightMm ?? 'n/a').padEnd(5),
            String(item.rows.client?.maxMm ?? 'n/a').padEnd(10),
            String(item.rows.responsible?.maxMm ?? 'n/a').padEnd(16),
            String(item.rows.scheduleNormal?.heightMm ?? 'n/a').padEnd(16),
            `${item.blocks.orderTable?.heightMm ?? 'n/a'}/${item.rows.orderFirstBodyRow?.heightMm ?? 'n/a'}`.padEnd(16),
            `${item.fonts.orderBodyPx}px`.padEnd(11),
            String(report.browserPrintPdf.pageCount)
        ];
        console.log(row.join(' '));
    }
    console.log(line);
    console.log(`Artifacts:
  ${report.artifacts.screenScreenshot}
  ${report.artifacts.printScreenshot}
  ${report.artifacts.browserPrintPdf}
  ${report.artifacts.metricsJson}`);

    const failed = report.checks.filter(check => !check.pass);
    if (failed.length) {
        console.log('\nFailed checks:');
        failed.forEach(check => {
            console.log(`- ${check.name}: actual=${check.actual} expected=${check.expected}`);
        });
    } else {
        console.log('\nAll layout audit checks passed.');
    }
}

async function runFixture({ page, baseUrl, fixture, useCanonicalNames }) {
    const artifacts = artifactPaths(fixture.name, useCanonicalNames);
    const urlPath = summaryPath(fixture.summary);
    await page.setViewportSize({ width: 1366, height: 1600 });
    await page.goto(`${baseUrl}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForStableDocument(page);

    await page.emulateMedia({ media: 'screen' });
    const screen = await measureLayout(page, 'screen');
    await page.screenshot({ path: artifacts.screenScreenshot, fullPage: true });

    await page.emulateMedia({ media: 'print' });
    const print = await measureLayout(page, 'print');
    await page.screenshot({ path: artifacts.printScreenshot, fullPage: true });
    const pdfBuffer = await page.pdf({
        path: artifacts.browserPrintPdf,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true
    });

    const report = {
        generatedAt: new Date().toISOString(),
        fixture: fixture.name,
        fixturePath: fixture.filePath,
        url: `${baseUrl}${urlPath}`,
        thresholds: THRESHOLDS,
        expected: fixture.expected,
        artifacts,
        orderNoteVisibility: orderNoteVisibility(fixture.summary),
        browserPrintPdf: {
            pageCount: pdfPageCount(pdfBuffer)
        },
        metrics: { screen, print }
    };
    report.checks = buildChecks(report);

    fs.writeFileSync(artifacts.metricsJson, `${JSON.stringify(report, null, 2)}\n`);
    printSummary(report);
    return report;
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const fixtureNames = parseArgs(process.argv.slice(2));
    const fixtures = fixtureNames.map(loadFixture);
    let activeSummary = fixtures[0].summary;

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        console.error('Playwright is not available. Run: npx --yes --package playwright node scripts/audit-booking-summary-layout.js');
        process.exit(1);
    }

    const { server, baseUrl } = await createStaticServer();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    try {
        await page.addInitScript(() => {
            window.localStorage.setItem('pzp_token', 'booking-summary-layout-audit-token');
            window.localStorage.setItem('pzp_dark_mode', 'false');
        });
        await routeBookingSummaryApi(page, () => activeSummary);

        const reports = [];
        for (const fixture of fixtures) {
            activeSummary = fixture.summary;
            reports.push(await runFixture({
                page,
                baseUrl,
                fixture,
                useCanonicalNames: fixtures.length === 1
            }));
        }

        const failed = reports.flatMap(report => report.checks.filter(check => !check.pass));
        if (failed.length) {
            process.exitCode = 1;
        } else if (reports.length > 1) {
            console.log(`\nAll ${reports.length} fixture audits passed.`);
        }
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
