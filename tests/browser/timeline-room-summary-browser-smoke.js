#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.TIMELINE_ROOM_SUMMARY_BROWSER_SMOKE_HEADLESS !== 'false';
const SMOKE_DATE = '2026-07-07';
const SMOKE_TIME = '15:00';
const ROOM_NAME = 'Рок';
const DAY_HINT_CUSTOMER = 'Day Hint Customer';
const SUMMARY_CUSTOMER = 'Summary Customer';

const SMOKE_USER = {
    id: 1,
    username: 'timeline.summary.smoke',
    name: 'Timeline Summary Smoke',
    role: 'creator',
    roles: ['creator'],
    businessContext: 'event_genix',
    defaultBusinessContext: 'event_genix',
    businessContexts: ['event_genix'],
    actionAllowlist: ['create_booking', 'edit_booking', 'export_data', 'manage_settings']
};

const ROOM_LINES = [
    {
        id: 'room-rock',
        resourceId: 'room-rock',
        resource_id: 'room-rock',
        name: ROOM_NAME,
        shortName: ROOM_NAME,
        short_name: ROOM_NAME,
        type: 'room',
        resourceType: 'room',
        resource_type: 'room',
        capacity: 20,
        color: '#2563eb'
    }
];

const DAY_BOOKINGS = [
    {
        id: 'day-booking-1',
        date: SMOKE_DATE,
        time: '15:00',
        duration: 60,
        room: ROOM_NAME,
        status: 'confirmed',
        category: 'animation',
        customerName: DAY_HINT_CUSTOMER,
        customer_name: DAY_HINT_CUSTOMER,
        label: DAY_HINT_CUSTOMER,
        businessContext: 'event_genix'
    },
    {
        id: 'day-booking-2',
        date: SMOKE_DATE,
        time: '17:00',
        duration: 60,
        room: ROOM_NAME,
        status: 'confirmed',
        category: 'animation',
        customerName: 'Second Day Customer',
        customer_name: 'Second Day Customer',
        label: 'Second Day Customer',
        businessContext: 'event_genix'
    }
];

function fail(message) {
    console.error(`Timeline room summary browser smoke failed: ${message}`);
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
    if (relativePath === '') relativePath = 'index.html';
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

function businessProfilePayload() {
    return {
        businessProfile: {
            activeBusinessId: 'event_genix',
            activeBusinessContext: 'event_genix',
            scope: {
                mode: 'single',
                activeContext: 'event_genix',
                selectedContexts: ['event_genix']
            },
            businesses: [{
                id: 'event_genix',
                key: 'event_genix',
                businessContext: 'event_genix',
                name: 'Event Genix Smoke',
                label: 'Event Genix Smoke',
                timeline: {
                    timelineEnabled: true,
                    mode: 'park',
                    parkKitchenMode: 'with_kitchen',
                    startPage: 'timeline',
                    roomTimelineEnabled: true,
                    defaultTimelineView: 'rooms',
                    enabledModules: {
                        timeline: true,
                        bookings: true,
                        kitchen: true,
                        products: true,
                        afisha: false
                    },
                    timelineFeatures: {
                        kitchen: true,
                        freeResources: true,
                        afisha: false
                    }
                }
            }]
        }
    };
}

function roomsFreePayload() {
    return {
        success: true,
        free: [ROOM_NAME],
        occupied: [],
        dayBookingsByRoom: {
            [ROOM_NAME]: DAY_BOOKINGS
        },
        rooms: [{
            name: ROOM_NAME,
            room: ROOM_NAME,
            occupied: false,
            available: true,
            capacity: 20,
            dayBookings: DAY_BOOKINGS
        }]
    };
}

async function routeMockedApi(page) {
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());

    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;
        let body;

        if (pathname === '/api/auth/verify') {
            body = { user: SMOKE_USER };
        } else if (pathname === '/api/auth/permissions') {
            body = {
                actions: {
                    create_booking: true,
                    edit_booking: true,
                    export_data: true,
                    manage_settings: true
                },
                actionAllowlist: SMOKE_USER.actionAllowlist,
                actionDenylist: []
            };
        } else if (pathname === '/api/business/profile') {
            body = businessProfilePayload();
        } else if (pathname === '/api/timeline/resources') {
            body = {
                context: 'event_genix',
                type: 'room',
                resources: [{
                    resourceId: 'room-rock',
                    name: ROOM_NAME,
                    type: 'room',
                    isActive: true,
                    color: '#2563eb',
                    sortOrder: 1
                }]
            };
        } else if (/^\/api\/lines\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
            body = ROOM_LINES;
        } else if (/^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
            body = DAY_BOOKINGS;
        } else if (pathname.startsWith('/api/rooms/free/')) {
            body = roomsFreePayload();
        } else if (pathname === '/api/products') {
            body = [];
        } else if (pathname === '/api/warehouse/costumes') {
            body = { success: true, data: [] };
        } else if (pathname.startsWith('/api/center/prices/')) {
            const code = decodeURIComponent(pathname.split('/').pop() || '');
            body = {
                success: true,
                price: {
                    code,
                    name: `Smoke ${code}`,
                    value: 300,
                    unit: 'грн/дитина',
                    category: 'banquet'
                }
            };
        } else if (pathname.startsWith('/api/afisha')) {
            body = [];
        } else if (pathname.includes('/customers/search')) {
            body = [];
        } else if (pathname.startsWith('/api/banquets')) {
            body = { success: true, groups: [], candidates: [] };
        } else {
            body = { success: true, data: [], items: [] };
        }

        return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(body)
        });
    });
}

async function openAuthenticatedTimelinePage(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        serviceWorkers: 'block'
    });
    await context.addInitScript(({ user }) => {
        const token = 'timeline-room-summary-smoke-token';
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_crm_business_context', 'event_genix');
        localStorage.setItem('pzp_crm_business_context_user', String(user.id));
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.removeItem('pzp_crm_business_scope_mode');
        localStorage.removeItem('pzp_crm_business_scope_contexts');
    }, { user: SMOKE_USER });

    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.TIMELINE_ROOM_SUMMARY_BROWSER_SMOKE_TIMEOUT_MS || 20000));
    await routeMockedApi(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const appVisible = document.getElementById('mainApp')
            && !document.getElementById('mainApp').classList.contains('hidden');
        return appVisible
            && window.AppState
            && window.TimelineView
            && typeof openBookingPanel === 'function'
            && typeof applySelectedCustomerToBookingForm === 'function'
            && typeof setBookingMenuPositions === 'function';
    });
    await page.waitForFunction(() => window.__crmBusinessNavigationPending !== true);
    return { context, page };
}

async function openRoomFirstDrawerAndReadSummary(page) {
    return page.evaluate(async ({ date, time, roomName, summaryCustomer }) => {
        AppState.selectedDate = new Date(`${date}T00:00:00`);
        const dateInput = document.getElementById('timelineDate');
        if (dateInput) dateInput.value = date;
        if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(date);
        if (window.TimelineView?.set) await window.TimelineView.set('rooms', { render: false });
        if (typeof renderTimeline === 'function') await renderTimeline();

        const lines = await getLinesForDate(AppState.selectedDate, { force: true });
        const line = lines.find(item => String(item.name || '') === roomName || String(item.id || '') === 'room-rock');
        if (!line) {
            return {
                opened: false,
                error: `room line not found: ${roomName}`,
                lines: lines.map(item => ({ id: item.id, name: item.name }))
            };
        }

        const opened = await openBookingPanel(time, line.id || line.name);
        await new Promise(resolve => setTimeout(resolve, 350));
        applySelectedCustomerToBookingForm({
            id: 'summary-customer',
            name: summaryCustomer,
            phone: '+380990000000',
            childName: 'Smoke Child',
            source: 'manual'
        }, { markDirty: false });
        setBookingMenuPositions([{
            productId: 'smoke-menu',
            title: 'Smoke Menu',
            quantity: 1,
            unitPrice: 120,
            subtotal: 120,
            kitchenType: 'menu',
            servingUnit: 'portion',
            servingTime: '16:00'
        }]);
        if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();

        const roomSelect = document.getElementById('roomSelect');
        const selectedOption = roomSelect?.selectedOptions?.[0] || null;
        const rows = Array.from(document.querySelectorAll('#bookingPackageSummary .booking-summary-row'))
            .map(row => ({
                label: row.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim() || '',
                value: row.querySelector('strong')?.textContent?.replace(/\s+/g, ' ').trim() || '',
                text: row.textContent?.replace(/\s+/g, ' ').trim() || ''
            }));
        const rowsByLabel = {};
        rows.forEach(row => {
            if (row.label) rowsByLabel[row.label] = row;
        });

        return {
            opened,
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            timelineView: window.TimelineView?.current?.() || '',
            roomValue: roomSelect?.value || '',
            optionText: selectedOption?.textContent?.replace(/\s+/g, ' ').trim() || '',
            optionRoomLabel: selectedOption?.dataset?.roomLabel || '',
            rows,
            rowsByLabel
        };
    }, {
        date: SMOKE_DATE,
        time: SMOKE_TIME,
        roomName: ROOM_NAME,
        summaryCustomer: SUMMARY_CUSTOMER
    });
}

async function verifyRoomSummarySmoke(page) {
    const result = await openRoomFirstDrawerAndReadSummary(page);
    const openError = result.error
        ? `${result.error}; lines=${JSON.stringify(result.lines || [])}`
        : 'booking drawer opens';
    assert.equal(result.opened, true, openError);
    assert.equal(result.panelVisible, true, 'booking drawer is visible');
    assert.equal(result.timelineView, 'rooms', 'timeline is in room-first mode');
    assert.equal(result.roomValue, ROOM_NAME, 'room select keeps the stored room value');

    assert.equal(result.optionRoomLabel, ROOM_NAME, 'selected option stores clean data-room-label');
    assert.ok(result.optionText.includes(ROOM_NAME), 'dropdown option shows room');
    assert.ok(
        result.optionText.includes('15:00'),
        'dropdown option shows day booking time hint; optionText=' + JSON.stringify(result.optionText)
    );
    assert.ok(result.optionText.includes(DAY_HINT_CUSTOMER), 'dropdown option shows day booking customer hint');
    assert.ok(result.optionText.includes('+1'), 'dropdown option shows extra day booking count');

    const roomRow = result.rowsByLabel['Кімната'];
    const clientRow = result.rowsByLabel['Клієнт'];
    assert.ok(roomRow, 'summary has room row');
    assert.ok(clientRow, 'summary has client row');
    assert.equal(roomRow.value, ROOM_NAME, 'summary room row uses clean room label');
    assert.equal(clientRow.value, SUMMARY_CUSTOMER, 'summary client row uses selected customer');
    assert.equal(roomRow.text.includes(DAY_HINT_CUSTOMER), false, 'summary room row excludes day booking customer hint');
    assert.equal(roomRow.text.includes(SUMMARY_CUSTOMER), false, 'summary room row excludes selected customer name');
    assert.equal(roomRow.text.includes('15:00'), false, 'summary room row excludes day booking time hint');
    assert.equal(roomRow.text.includes('+1'), false, 'summary room row excludes day booking count hint');
}

(async () => {
    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node tests/browser/timeline-room-summary-browser-smoke.js');
    }

    const { server, baseUrl } = await createStaticServer();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let context;

    try {
        const opened = await openAuthenticatedTimelinePage(browser, baseUrl);
        context = opened.context;
        await verifyRoomSummarySmoke(opened.page);
        console.log(`Timeline room summary browser smoke passed: ${baseUrl}/?businessContext=event_genix&date=${SMOKE_DATE}`);
    } finally {
        if (context) await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
