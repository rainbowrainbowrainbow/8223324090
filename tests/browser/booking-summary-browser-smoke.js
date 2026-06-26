#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.BOOKING_SUMMARY_BROWSER_SMOKE_HEADLESS !== 'false';
const SUMMARY_PATH = '/booking-summary.html?id=BK-SMOKE-001&mode=client&businessContext=event_genix';

const SMOKE_SUMMARY = {
    success: true,
    mode: 'client',
    bookingId: 'BK-SMOKE-001',
    document: {
        title: 'БАНКЕТНИЙ ЛИСТ',
        generatedBy: 'Smoke QA'
    },
    venue: {
        name: 'Event Genix',
        addressLine1: 'вул. Закревського 61/2, 3 поверх',
        addressLine2: 'м. Київ',
        phone: '+380000000000'
    },
    event: {
        date: '2026-06-25',
        time: '15:00',
        room: 'Поні',
        programName: 'Паперове Неон-шоу',
        programDisplayName: 'Паперове Неон-шоу',
        hasRealProgram: true,
        manager: 'Smoke QA',
        createdAt: '2026-06-20T10:00:00.000Z'
    },
    customer: {
        name: 'Тестовий клієнт',
        phone: '+380000000000',
        children: [
            { name: 'Марія', birthday: '2016-06-25' }
        ]
    },
    counts: {
        children: 10,
        adults: 2,
        guests: 12
    },
    responsible: {
        rows: [
            { label: 'Менеджер', name: 'Smoke QA', modes: ['client'] }
        ]
    },
    schedule: [
        { time: '15:00', title: 'Прихід гостей', note: 'Кімната: Поні', modes: ['client'] },
        { time: '15:15', title: 'Паперове Неон-шоу', note: '30 хв', modes: ['client'] },
        { time: '16:30', title: 'Видача меню', note: 'Овочева тарілка', modes: ['client'] }
    ],
    orderRows: [
        {
            type: 'program',
            title: 'Паперове Неон-шоу',
            quantity: 1,
            unitPrice: 1500,
            subtotal: 1500,
            durationMinutes: 30,
            meta: { time: '15:15' }
        },
        {
            type: 'entry',
            title: 'Вхід',
            quantity: 10,
            unitPrice: 270,
            subtotal: 2700
        },
        {
            type: 'menu',
            title: 'Овочева тарілка',
            quantity: 10,
            unitPrice: 360,
            subtotal: 3600,
            comment: 'Без гострого',
            meta: { servingTime: '16:30', servingUnit: 'порція' }
        }
    ],
    finance: {
        currency: 'UAH',
        rows: [
            { key: 'total', label: 'Загальна сума', amount: 7800, currency: 'UAH', role: 'total' }
        ]
    },
    totals: {
        currency: 'UAH',
        orderTotal: 7800,
        bookingPrice: 7800
    },
    terms: {
        title: 'Умови банкету',
        items: [
            'Корегування меню здійснюється заздалегідь.',
            'Деталі можна уточнити у менеджера.'
        ]
    },
    warnings: []
};

function fail(message) {
    console.error(`Booking summary browser smoke failed: ${message}`);
    process.exit(1);
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
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.ico') return 'image/x-icon';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.json') return 'application/json; charset=utf-8';
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

async function visibleText(locator) {
    return String(await locator.textContent() || '').replace(/\s+/g, ' ').trim();
}

async function assertTextIncludes(locator, expected, label) {
    const text = await visibleText(locator);
    assert.ok(text.includes(expected), `${label} includes "${expected}"`);
}

async function assertNoHorizontalOverflow(page) {
    const metrics = await page.evaluate(() => ({
        htmlScrollWidth: document.documentElement.scrollWidth,
        htmlClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth
    }));
    assert.ok(metrics.htmlScrollWidth <= metrics.htmlClientWidth + 1, `html has no horizontal overflow: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth + 1, `body has no horizontal overflow: ${JSON.stringify(metrics)}`);
}

async function routeBookingSummaryApi(page) {
    await page.route('**/api/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ success: true })
    }));

    await page.route('**/api/bookings/*/banquet-summary**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/banquet-summary.pdf')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/pdf',
                headers: {
                    'content-disposition': 'attachment; filename="booking-summary-smoke.pdf"'
                },
                body: Buffer.from('%PDF-1.4\n% booking summary smoke\n%%EOF\n', 'utf8')
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(SMOKE_SUMMARY)
        });
    });
}

async function assertPrintCssHidesToolbar(page) {
    await page.emulateMedia({ media: 'print' });
    const printDisplay = await page.locator('.booking-summary-toolbar').evaluate(el => getComputedStyle(el).display);
    assert.equal(printDisplay, 'none', 'print CSS hides booking summary toolbar');
    await page.emulateMedia({ media: 'screen' });
}

async function verifyBookingSummary(page, baseUrl) {
    await page.addInitScript(() => {
        window.localStorage.setItem('pzp_token', 'booking-summary-browser-smoke-token');
    });
    await routeBookingSummaryApi(page);

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`${baseUrl}${SUMMARY_PATH}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#bookingSummaryDocument:not([hidden])', { timeout: 5000 });

    const toolbar = page.locator('.booking-summary-toolbar');
    assert.equal(await toolbar.isVisible(), true, 'booking summary toolbar is visible');
    assert.equal(await page.locator('#bookingSummaryClose[aria-label="Закрити банкетний лист"]').isVisible(), true, 'close button is visible');
    assert.equal(await page.locator('#bookingSummaryClientPdf[data-booking-summary-pdf-mode="client"]').isVisible(), true, 'client PDF action is visible');
    assert.equal(await page.locator('#bookingSummaryPrint').isVisible(), true, 'print action is visible');

    const bodyText = await visibleText(page.locator('body'));
    assert.equal(bodyText.includes('Для кухні'), false, 'kitchen mode button is absent');
    assert.equal(bodyText.includes('Для персоналу'), false, 'staff mode button is absent');
    assert.equal(await page.locator('.banquet-final-brand').count(), 0, 'legacy final brand footer is absent');

    const document = page.locator('#bookingSummaryDocument');
    await assertTextIncludes(document, 'Замовлення', 'order section');
    await assertTextIncludes(document, 'Позиція', 'order table header');
    await assertTextIncludes(document, 'К-сть', 'order table header');
    await assertTextIncludes(document, 'Ціна', 'order table header');
    await assertTextIncludes(document, 'Сума', 'order table header');
    await assertTextIncludes(document, 'Паперове Неон-шоу', 'program row');
    await assertTextIncludes(document, 'Овочева тарілка', 'menu row');
    await assertTextIncludes(document, 'Без гострого', 'menu row note');

    await assertPrintCssHidesToolbar(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await assertNoHorizontalOverflow(page);
}

(async () => {
    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node tests/browser/booking-summary-browser-smoke.js');
    }

    const { server, baseUrl } = await createStaticServer();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    try {
        await verifyBookingSummary(page, baseUrl);
        console.log(`Booking summary browser smoke passed: ${baseUrl}${SUMMARY_PATH}`);
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
