#!/usr/bin/env node
'use strict';

/**
 * Live smoke for cake decoration products and booking catalog behavior.
 *
 * The script verifies the production products catalog, opens the Products UI,
 * opens the booking menu catalog, adds paid/free/custom cake decorations to
 * the cart, creates one clearly marked disposable booking, and always attempts
 * cleanup in finally.
 *
 * Usage:
 *   node scripts/live-cake-decorations-smoke.js https://example.up.railway.app
 *   npm run smoke:cake-decorations -- https://example.up.railway.app
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DISPOSABLE_QA_CAKE_DECORATIONS_SOURCE: QA_CLEANUP_SOURCE, attachDisposableQaMarker, inspectDisposableQaMarker } = require('../services/disposableQa');
const { resolveBookingWorkingHoursPolicy } = require('../services/booking');

const BUSINESS_CONTEXT = readEnv('LIVE_CAKE_DECORATIONS_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_CAKE_DECORATIONS_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const HEADLESS = readEnv('LIVE_CAKE_DECORATIONS_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const TIMEOUT_MS = Number(readEnv('LIVE_CAKE_DECORATIONS_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const RUN_ID = `cake-decorations-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const SAFE_LABEL_PREFIX = 'QA Cake Decorations Smoke';
const SAFE_NOTE_MARKER = 'safe automated smoke; disposable booking; cleanup expected';
const PREFERRED_DATE = readEnv('LIVE_CAKE_DECORATIONS_DATE', 'LIVE_SMOKE_DATE') || futureDate(45);
const SMOKE_DURATION = Number(readEnv('LIVE_CAKE_DECORATIONS_DURATION_MINUTES') || 60);
const SMOKE_TIME_OVERRIDE = splitCsv(readEnv('LIVE_CAKE_DECORATIONS_TIMES'));
const QA_TEST_CUSTOMER_MARKER = `${QA_CLEANUP_SOURCE}:${RUN_ID}:no_customer`;
const CREATED_BOOKING_IDS = new Set();
const CREATED_GROUP_IDS = new Set();
const KEEP_BOOKING = isConfirmed(readEnv('LIVE_CAKE_DECORATIONS_KEEP_BOOKING'));
const PERMANENT_CLEANUP = readEnv('LIVE_CAKE_DECORATIONS_PERMANENT_CLEANUP') !== 'false';
const EXPECTED_SUBTOTAL = 950;
const CAKE_DECORATION_SECTION = 'Оформлення торта';

const EXPECTED_PRODUCTS = Object.freeze([
    Object.freeze({ id: 'cake_decor_sweets', code: 'CAKEDECOR-001', name: 'Солодощі', price: 250 }),
    Object.freeze({ id: 'cake_decor_berries', code: 'CAKEDECOR-002', name: 'Ягідне оформлення', price: 500 }),
    Object.freeze({ id: 'cake_decor_rice_picture', code: 'CAKEDECOR-003', name: 'Рисова картинка', price: 150 }),
    Object.freeze({ id: 'cake_decor_cream_inscription', code: 'CAKEDECOR-004', name: 'Крем + напис', price: 0 }),
    Object.freeze({ id: 'cake_decor_custom', code: 'CAKEDECOR-005', name: 'Індивідуальне оформлення', price: 0 })
]);

const CART_PRODUCT_IDS = Object.freeze([
    'cake_decor_sweets',
    'cake_decor_berries',
    'cake_decor_cream_inscription',
    'cake_decor_custom'
]);

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function isConfirmed(value) {
    return ['1', 'true', 'yes', 'y', 'keep'].includes(String(value || '').trim().toLowerCase());
}

function splitCsv(value) {
    const items = String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return items.length ? items : null;
}

function fail(message) {
    console.error(`Live cake decorations smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function futureDate(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function datePlus(dateText, days) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function scopedPath(routePath, params = {}) {
    const url = new URL(routePath, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    }
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return `${url.pathname}${url.search}`;
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

function responseDetail(body) {
    return body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || '';
}

async function fetchJson(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeader(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        throw new Error(`${routePath} returned ${res.status}${responseDetail(body) ? `: ${responseDetail(body)}` : ''}`);
    }
    return body;
}

async function fetchJsonAllowStatus(base, routePath, options = {}) {
    const res = await fetch(`${base}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeader(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    return { ok: res.ok, status: res.status, body };
}

function listFrom(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['products', 'prices', 'data', 'items', 'rows']) {
        if (payload && Array.isArray(payload[key])) return payload[key];
    }
    return [];
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base) {
    const token = readEnv('LIVE_CAKE_DECORATIONS_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_CAKE_DECORATIONS_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_CAKE_DECORATIONS_PASS', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS');
    if (!username || !password) {
        throw new Error('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS');
    }

    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token');
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null,
        source: 'login'
    };
}

function requirePlaywrightOrReexec() {
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
        if (process.env.LIVE_CAKE_DECORATIONS_PLAYWRIGHT_BOOTSTRAPPED === '1') {
            throw err;
        }
        const env = {
            ...process.env,
            LIVE_CAKE_DECORATIONS_PLAYWRIGHT_BOOTSTRAPPED: '1'
        };
        const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const result = spawnSync(npxBin, [
            '--yes',
            '--package',
            'playwright',
            'node',
            __filename,
            ...process.argv.slice(2)
        ], {
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });
        if (result.error) {
            throw new Error(`Playwright is not available and npx bootstrap failed: ${result.error.message}`);
        }
        process.exit(result.status ?? 1);
    }
}

function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeText(value) {
    return String(value || '').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
}

function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function rangesOverlap(startA, durationA, startB, durationB) {
    const a = timeToMinutes(startA);
    const b = timeToMinutes(startB);
    if (a === null || b === null) return false;
    return a < b + Number(durationB || 0) && b < a + Number(durationA || 0);
}

function activeBookingsForRoom(bookings, room) {
    const normalizedRoom = normalizeText(room);
    return (Array.isArray(bookings) ? bookings : []).filter(booking => {
        if (normalizeText(booking.status) === 'cancelled') return false;
        return normalizeText(booking.room) === normalizedRoom;
    });
}


function productPrice(product) {
    return money(product?.price ?? product?.base_price ?? product?.basePrice ?? product?.default_price ?? product?.current_price);
}

async function assertProductsApi(base, token) {
    const sectionQuery = new URLSearchParams({
        businessContext: BUSINESS_CONTEXT,
        active: 'true',
        domain: 'kitchen',
        kitchenType: 'menu',
        menuSection: CAKE_DECORATION_SECTION
    });
    const allMenuQuery = new URLSearchParams({
        businessContext: BUSINESS_CONTEXT,
        active: 'true',
        domain: 'kitchen',
        kitchenType: 'menu'
    });
    const [sectionPayload, allMenuPayload] = await Promise.all([
        fetchJson(base, `/api/products?${sectionQuery}`, { token }),
        fetchJson(base, `/api/products?${allMenuQuery}`, { token })
    ]);
    const sectionProducts = listFrom(sectionPayload);
    const allMenuProducts = listFrom(allMenuPayload);
    const byId = new Map(sectionProducts.map(product => [String(product.id), product]));

    for (const expected of EXPECTED_PRODUCTS) {
        const product = byId.get(expected.id);
        assert.ok(product, `Products API missing ${expected.id}`);
        assert.equal(product.code, expected.code, `${expected.id}: code`);
        assert.equal(product.name, expected.name, `${expected.id}: name`);
        assert.equal(product.domain, 'kitchen', `${expected.id}: domain`);
        assert.equal(product.kitchenType || product.kitchen_type, 'menu', `${expected.id}: kitchenType`);
        assert.equal(product.category, 'menu', `${expected.id}: category`);
        assert.equal(product.menuSection || product.menu_section, CAKE_DECORATION_SECTION, `${expected.id}: menuSection`);
        assert.equal(product.servingUnit || product.serving_unit, 'додаток', `${expected.id}: servingUnit`);
        assert.equal(productPrice(product), expected.price, `${expected.id}: price`);
    }

    const expectedNames = new Set(EXPECTED_PRODUCTS.map(product => normalizeText(product.name)));
    const duplicates = [];
    const byName = new Map();
    for (const product of allMenuProducts) {
        const name = normalizeText(product.name);
        if (!expectedNames.has(name)) continue;
        const group = byName.get(name) || [];
        group.push(product);
        byName.set(name, group);
    }
    for (const group of byName.values()) {
        if (group.length > 1) duplicates.push(group.map(product => product.id).join(', '));
    }
    assert.equal(duplicates.length, 0, `duplicate active cake decoration products: ${duplicates.join('; ')}`);
    return sectionProducts;
}

function scheduleCandidateTimes(date, duration, override = SMOKE_TIME_OVERRIDE) {
    const policy = resolveBookingWorkingHoursPolicy({ date }, { businessContext: BUSINESS_CONTEXT });
    if (!policy.applies) throw new Error(`No EventGenix working-hours policy for business context ${BUSINESS_CONTEXT}`);
    const hours = policy.workingHours;
    const durationMinutes = Number(duration);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error('LIVE_CAKE_DECORATIONS_DURATION_MINUTES must be a positive number');
    if (durationMinutes > hours.endMinutes - hours.startMinutes) throw new Error('LIVE_CAKE_DECORATIONS_DURATION_MINUTES exceeds the working-day window');
    const candidates = override || Array.from({ length: Math.floor((hours.endMinutes - hours.startMinutes - durationMinutes) / 15) + 1 }, (_, index) => {
        const minutes = hours.startMinutes + index * 15;
        return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    });
    const valid = candidates.filter(time => { const start = timeToMinutes(time); return start !== null && start >= hours.startMinutes && start + durationMinutes <= hours.endMinutes; });
    if (valid.length !== candidates.length || !valid.length) throw new Error(`LIVE_CAKE_DECORATIONS_TIMES contains an out-of-hours value for ${date}; allowed ${hours.start}-${hours.end} with duration ${durationMinutes}m`);
    return valid;
}

function assertExactDisposableMarker(booking = {}) {
    const inspection = inspectDisposableQaMarker(booking, { runId: RUN_ID, source: QA_CLEANUP_SOURCE, testCustomerMarker: QA_TEST_CUSTOMER_MARKER });
    if (!inspection.ok) throw new Error(`refusing cleanup: booking marker mismatch (${inspection.reasons.join(',')})`);
    return inspection.marker;
}

function cleanupPreflightPath(permanentCleanup = PERMANENT_CLEANUP) {
    return scopedPath('/api/bookings/QA-CLEANUP-PREFLIGHT-NOT-FOUND', permanentCleanup ? { permanent: 'true' } : {});
}

async function assertCleanupTransportReady(base, token) {
    const marker = inspectDisposableQaMarker({ disposableQa: { schemaVersion: 1, runId: RUN_ID, source: QA_CLEANUP_SOURCE, cleanupExpected: true, testCustomerMarker: QA_TEST_CUSTOMER_MARKER, kind: 'cake_decorations', createdAt: new Date().toISOString() } }, { runId: RUN_ID, source: QA_CLEANUP_SOURCE, testCustomerMarker: QA_TEST_CUSTOMER_MARKER });
    if (!marker.ok) throw new Error(`cleanup marker preflight failed: ${marker.reasons.join(',')}`);
    const probePath = cleanupPreflightPath();
    const probe = await fetchJsonAllowStatus(base, probePath, { method: 'DELETE', token });
    // The sentinel cannot match a generated booking id; 404 proves the canonical cleanup route and authorization without touching data.
    if (probe.status !== 404) throw new Error(`cleanup transport preflight returned unexpected status ${probe.status}`);
    return true;
}

async function cleanupBooking(base, token, bookingId, options = {}) {
    if (!bookingId || !CREATED_BOOKING_IDS.has(String(bookingId))) throw new Error('refusing cleanup outside this smoke run exact booking ID set');
    const detail = await fetchJson(base, scopedPath(`/api/bookings/detail/${encodeURIComponent(bookingId)}`), { token });
    assertExactDisposableMarker(detail.booking || detail);
    const paths = [];
    if (PERMANENT_CLEANUP && options.permanent !== false) paths.push(scopedPath(`/api/bookings/${encodeURIComponent(bookingId)}`, { permanent: 'true' }));
    paths.push(scopedPath(`/api/bookings/${encodeURIComponent(bookingId)}`));
    let lastError = null;
    for (const routePath of paths) {
        const res = await fetchJsonAllowStatus(base, routePath, { method: 'DELETE', token });
        if (res.ok) return { ok: true, mode: routePath.includes('permanent=true') ? 'permanent' : 'soft' };
        lastError = `${routePath} returned ${res.status}${responseDetail(res.body) ? `: ${responseDetail(res.body)}` : ''}`;
    }
    throw new Error(`cleanup booking ${bookingId} failed: ${lastError || 'unknown error'}`);
}

async function assertBookingAbsentFromActiveList(base, token, bookingId, date) {
    const bookings = await fetchJson(base, scopedPath(`/api/bookings/${encodeURIComponent(date)}`, { timelineView: 'rooms' }), { token });
    const activeMatch = (Array.isArray(bookings) ? bookings : []).find(booking => String(booking.id || '') === String(bookingId));
    assert.equal(activeMatch, undefined, `cleanup booking ${bookingId}: still present in active booking list`);
    return true;
}


function roomNameFromLine(line = {}) {
    return String(line.name || line.shortName || line.short_name || line.resourceName || line.resource_name || line.id || '').trim();
}

function isUsableRoomLine(line = {}) {
    const id = String(line.id || line.resourceId || '').trim().toLowerCase();
    const name = normalizeText(roomNameFromLine(line));
    if (!id && !name) return false;
    if (id === 'banquet-service' || id === 'room-takeaway') return false;
    if (name === normalizeText('На виніс')) return false;
    return true;
}

async function loadRoomLines(base, token, date) {
    const lines = await fetchJson(base, scopedPath(`/api/lines/${encodeURIComponent(date)}`, { timelineView: 'rooms' }), { token });
    assert.ok(Array.isArray(lines), `/api/lines/${date} returned an array`);
    return lines.filter(isUsableRoomLine);
}

async function pickSafeSlot(base, token) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
        const date = datePlus(PREFERRED_DATE, dayOffset);
        const candidateTimes = scheduleCandidateTimes(date, SMOKE_DURATION);
        const [rooms, bookings] = await Promise.all([loadRoomLines(base, token, date), fetchJson(base, scopedPath(`/api/bookings/${encodeURIComponent(date)}`, { timelineView: 'rooms' }), { token })]);
        for (const roomLine of rooms) {
            const room = roomNameFromLine(roomLine);
            const roomBookings = activeBookingsForRoom(bookings, room);
            for (const time of candidateTimes) {
                if (!roomBookings.some(booking => rangesOverlap(time, SMOKE_DURATION, booking.time, booking.duration || 60))) return { date, time, room, candidateTimes };
            }
        }
    }
    throw new Error(`no free in-hours room slot found for ${PREFERRED_DATE} + 6 days`);
}

async function openAuthenticatedContext(browser, session, viewport = { width: 1440, height: 960 }) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return { context, page };
}

async function assertProductsUi(browser, base, session) {
    let context;
    let page;
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session));
        const url = `${base}/programs?smoke=${encodeURIComponent(RUN_ID)}#kitchen-menu`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#kitchenPanel');
        await page.waitForFunction(() => Boolean(document.querySelector('[data-product-tab="kitchen"]')));
        await page.evaluate(() => {
            document.querySelector('[data-product-tab="kitchen"]')?.click();
            document.querySelector('[data-kitchen-tab="menu"]')?.click();
        });
        await page.waitForFunction(section => {
            const chips = Array.from(document.querySelectorAll('#menuSectionFilter [data-menu-section]'));
            return chips.some(button => button.dataset.menuSection === section);
        }, CAKE_DECORATION_SECTION);
        await page.evaluate(section => {
            const chips = Array.from(document.querySelectorAll('#menuSectionFilter [data-menu-section]'));
            chips.find(button => button.dataset.menuSection === section)?.click();
        }, CAKE_DECORATION_SECTION);
        await page.waitForFunction(expectedIds => {
            return expectedIds.every(id => document.querySelector(`#kitchenGrid [data-id="${CSS.escape(id)}"]`));
        }, EXPECTED_PRODUCTS.map(product => product.id));
        const state = await page.evaluate(({ section, expectedIds }) => {
            const chip = Array.from(document.querySelectorAll('#menuSectionFilter [data-menu-section]'))
                .find(button => button.dataset.menuSection === section);
            const datalistOption = Array.from(document.querySelectorAll('#menu-section-options option'))
                .find(option => option.value === section);
            const cards = expectedIds.map(id => {
                const card = document.querySelector(`#kitchenGrid [data-id="${CSS.escape(id)}"]`);
                return {
                    id,
                    exists: Boolean(card),
                    text: card?.textContent || ''
                };
            });
            return {
                chipActive: Boolean(chip?.classList.contains('active')),
                datalistHasSection: Boolean(datalistOption),
                cardCount: cards.filter(card => card.exists).length,
                cards
            };
        }, {
            section: CAKE_DECORATION_SECTION,
            expectedIds: EXPECTED_PRODUCTS.map(product => product.id)
        });
        assert.equal(state.chipActive, true, 'Products UI cake decoration filter chip is active');
        assert.equal(state.datalistHasSection, true, 'Products UI menu section datalist includes cake decorations');
        assert.equal(state.cardCount, EXPECTED_PRODUCTS.length, 'Products UI shows all cake decoration products');
        return state;
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

function bookingUrl(base, slot) {
    const params = new URLSearchParams({
        businessContext: BUSINESS_CONTEXT,
        timelineView: 'rooms',
        date: slot.date,
        eventDate: slot.date,
        convert: 'booking',
        bookingMode: 'kitchen_room',
        smoke: RUN_ID
    });
    return `${base}/?${params.toString()}`;
}

async function waitForBookingPanel(page, slot) {
    await page.waitForFunction(() => {
        const mainApp = document.getElementById('mainApp');
        const loginScreen = document.getElementById('loginScreen');
        return mainApp && !mainApp.classList.contains('hidden')
            && (!loginScreen || loginScreen.classList.contains('hidden'));
    });
    try {
        await page.waitForFunction(() => {
            const panel = document.getElementById('bookingPanel');
            return panel && !panel.classList.contains('hidden');
        }, null, { timeout: 5000 });
    } catch {
        await page.waitForFunction(() => typeof window.openBookingPanel === 'function');
        const opened = await page.evaluate(async ({ date, time, room }) => {
            if (window.AppState) window.AppState.selectedDate = new Date(`${date}T00:00:00`);
            return window.openBookingPanel(time, room, {
                contextSource: 'live_cake_decorations_smoke'
            });
        }, slot);
        if (!opened) {
            const diagnostic = await page.evaluate(() => ({
                url: window.location.href,
                timelineView: window.TimelineView?.current?.() || '',
                hasOpenBookingPanel: typeof window.openBookingPanel === 'function',
                roomFirst: typeof window.isRoomFirstTimelineView === 'function' ? window.isRoomFirstTimelineView() : null,
                linesCount: Array.isArray(window.AppState?.lines) ? window.AppState.lines.length : null
            }));
            throw new Error(`booking panel did not open: ${JSON.stringify(diagnostic)}`);
        }
    }
    await page.waitForFunction(() => {
        const fields = document.getElementById('banquetFields');
        return fields && !fields.hidden && !fields.classList.contains('hidden');
    });
}

async function assertBookingCatalogUi(browser, base, session, slot) {
    let context;
    let page;
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session));
        await page.goto(bookingUrl(base, slot), { waitUntil: 'domcontentloaded' });
        await waitForBookingPanel(page, slot);
        await page.evaluate(({ time, room, label }) => {
            const timeInput = document.getElementById('bookingTime');
            const lineInput = document.getElementById('bookingLine');
            const roomSelect = document.getElementById('roomSelect');
            const groupName = document.getElementById('bookingGroupName');
            if (timeInput) {
                timeInput.value = time;
                timeInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (lineInput) {
                lineInput.value = 'banquet-service';
                lineInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (roomSelect) {
                roomSelect.value = room;
                roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (groupName) {
                groupName.value = label;
                groupName.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, {
            ...slot,
            label: `${SAFE_LABEL_PREFIX} ${RUN_ID}`
        });
        await page.locator('#bookingMenuCatalogOpenBtn').click();
        await page.waitForFunction(() => {
            const panel = document.getElementById('bookingMenuCatalogPanel');
            return panel && !panel.hidden && !panel.classList.contains('hidden') && panel.getAttribute('aria-hidden') === 'false';
        });
        await page.waitForFunction(() => {
            return Array.from(document.querySelectorAll('#bookingMenuCatalogTabs [data-menu-catalog-filter]'))
                .some(tab => tab.dataset.menuCatalogFilter === 'section:cake-decorations');
        });
        await page.locator('#bookingMenuCatalogTabs [data-menu-catalog-filter="section:cake-decorations"]').click();
        await page.waitForFunction(expectedIds => {
            return expectedIds.every(id => document.querySelector(`#bookingMenuCatalogList [data-menu-catalog-product="${CSS.escape(id)}"]`));
        }, EXPECTED_PRODUCTS.map(product => product.id));

        for (const productId of CART_PRODUCT_IDS) {
            await page.locator(`#bookingMenuCatalogList [data-menu-catalog-add="${productId}"]`).click();
        }

        await page.locator('#bookingMenuCatalogList [data-menu-catalog-edit-price="cake_decor_custom"]').click();
        await page.locator('#bookingMenuCatalogList [data-menu-catalog-price-input="cake_decor_custom"]').fill('200');
        await page.locator('#bookingMenuCatalogList [data-menu-catalog-price-input="cake_decor_custom"]').press('Enter');
        await page.waitForFunction(expectedSubtotal => {
            const raw = document.getElementById('bookingMenuPositionsJson')?.value || '[]';
            let positions = [];
            try { positions = JSON.parse(raw); } catch {}
            const subtotal = positions.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
            return Math.round(subtotal * 100) / 100 === expectedSubtotal;
        }, EXPECTED_SUBTOTAL);

        const state = await page.evaluate(({ expectedIds, expectedSubtotal }) => {
            const selectedTab = document.querySelector('#bookingMenuCatalogTabs [data-menu-catalog-filter="section:cake-decorations"]');
            const raw = document.getElementById('bookingMenuPositionsJson')?.value || '[]';
            let positions = [];
            try { positions = JSON.parse(raw); } catch {}
            const subtotal = Math.round(positions.reduce((sum, item) => sum + Number(item.subtotal || 0), 0) * 100) / 100;
            const summaryText = [
                document.getElementById('bookingMenuCatalogEntrySummary')?.textContent || '',
                document.getElementById('bookingMenuCatalogFooterTotal')?.textContent || '',
                document.getElementById('bookingPackageSummary')?.textContent || ''
            ].join('\n');
            return {
                selectedTabActive: selectedTab?.getAttribute('aria-pressed') === 'true',
                tabLabel: selectedTab?.textContent?.trim() || '',
                listedIds: expectedIds.filter(id => document.querySelector(`#bookingMenuCatalogList [data-menu-catalog-product="${CSS.escape(id)}"]`)),
                positions,
                subtotal,
                summaryHasSubtotal: summaryText.includes(String(expectedSubtotal))
            };
        }, {
            expectedIds: EXPECTED_PRODUCTS.map(product => product.id),
            expectedSubtotal: EXPECTED_SUBTOTAL
        });

        assert.equal(state.selectedTabActive, true, 'Booking catalog cake decorations tab is active');
        assert.equal(state.listedIds.length, EXPECTED_PRODUCTS.length, 'Booking catalog tab lists all cake decorations');
        assert.equal(state.positions.length, CART_PRODUCT_IDS.length, 'Booking catalog cart contains expected selected decorations');
        assert.equal(state.subtotal, EXPECTED_SUBTOTAL, 'Booking catalog cart subtotal');
        assert.equal(state.summaryHasSubtotal, true, 'Booking summary includes cart subtotal');
        return state;
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

function legacyMenuText(positions) {
    return positions.map(item => {
        const quantity = Number(item.quantity || 1);
        const unitPrice = money(item.unitPrice || 0);
        const note = item.note ? ` (${item.note})` : '';
        return `${item.title} - ${quantity} ${item.servingUnit || 'додаток'} x ${unitPrice} грн${note}`;
    }).join('\n');
}

function safeBookingPayload(slot, cartPositions, session) {
    const positions = cartPositions.map((item, index) => ({
        id: item.id || `cake-decoration-${index + 1}`,
        productId: item.productId,
        code: item.code || null,
        title: item.title,
        quantity: Number(item.quantity || 1),
        unitPrice: money(item.unitPrice || 0),
        subtotal: money(item.subtotal || 0),
        note: item.productId === 'cake_decor_custom' ? 'QA custom price smoke' : '',
        menuSection: item.menuSection || CAKE_DECORATION_SECTION,
        servingUnit: item.servingUnit || 'додаток',
        kitchenType: item.kitchenType || 'menu',
        servingTime: item.servingTime || slot.time,
        source: 'product'
    }));
    const subtotal = money(positions.reduce((sum, item) => sum + item.subtotal, 0));
    const label = `${SAFE_LABEL_PREFIX} ${RUN_ID}`;
    const payload = {
        businessContext: BUSINESS_CONTEXT,
        date: slot.date,
        time: slot.time,
        lineId: 'banquet-service',
        lineName: 'Banquet service',
        room: slot.room,
        label,
        programCode: 'CAKEDECOR-SMOKE',
        programName: label,
        category: 'banquet',
        duration: SMOKE_DURATION,
        price: subtotal,
        hosts: 0,
        status: 'preliminary',
        createdBy: session.user?.username || 'codex-live-smoke',
        notes: `${SAFE_NOTE_MARKER}; run=${RUN_ID}`,
        groupName: label,
        skipNotification: true,
        banquetGuests: null,
        banquetAdults: null,
        banquetTables: null,
        banquetMenu: legacyMenuText(positions),
        programBasePrice: 0,
        menuPositions: positions,
        serviceEvents: [],
        bookingPackage: {
            schemaVersion: 2,
            programBasePrice: 0,
            positionsSubtotal: subtotal,
            entryCharge: null,
            entrySubtotal: 0,
            finalTotal: subtotal,
            menuPositions: positions,
            serviceEvents: [],
            source: 'live_cake_decorations_smoke'
        },
        extraData: {
            disposableQa: {
                schemaVersion: 1, runId: RUN_ID, source: QA_CLEANUP_SOURCE, cleanupExpected: true,
                testCustomerMarker: QA_TEST_CUSTOMER_MARKER, kind: 'cake_decorations', createdAt: new Date().toISOString()
            },
            smokeTest: {
                kind: 'cake_decorations',
                runId: RUN_ID,
                safe: true,
                cleanupExpected: true
            },
            bookingWorkspace: {
                schemaVersion: 2,
                mode: 'room_first_workspace',
                hasEvent: false,
                scenario: 'kitchen_only',
                leadDetails: {},
                comments: {},
                roomFirst: true,
                kitchen: {
                    itemsCount: positions.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
                    menuCount: positions.length,
                    cakeCount: 0,
                    serviceEventCount: 0,
                    missingServingTimeCount: 0,
                    positionsSubtotal: subtotal
                },
                source: 'live_cake_decorations_smoke'
            }
        }
    };
    return attachDisposableQaMarker(payload, { runId: RUN_ID, source: QA_CLEANUP_SOURCE, testCustomerMarker: QA_TEST_CUSTOMER_MARKER, kind: 'cake_decorations' });
}

async function createSafeBooking(base, token, slot, cartPositions, session) {
    const payload = safeBookingPayload(slot, cartPositions, session);
    assert.equal(payload.price, EXPECTED_SUBTOTAL, 'Safe booking payload subtotal');
    const result = await fetchJson(base, scopedPath('/api/bookings'), {
        method: 'POST',
        token,
        body: payload
    });
    assert.equal(result.success, true, 'booking create success');
    assert.ok(result.booking?.id, 'booking create returns id');
    CREATED_BOOKING_IDS.add(String(result.booking.id));
    const groupId = result.group?.id || result.banquetGroup?.id || result.booking?.groupId || result.booking?.group_id;
    if (groupId) CREATED_GROUP_IDS.add(String(groupId));
    return result.booking;
}

async function assertSavedBooking(base, token, bookingId) {
    const detail = await fetchJson(base, scopedPath(`/api/bookings/detail/${encodeURIComponent(bookingId)}`), { token });
    assert.equal(detail.success, true, 'booking detail success');
    const booking = detail.booking || {};
    const extra = booking.extraData || booking.extra_data || {};
    const pkg = extra.bookingPackage || extra.booking_package || {};
    const positions = Array.isArray(pkg.menuPositions) ? pkg.menuPositions : [];
    assert.equal(money(booking.price), EXPECTED_SUBTOTAL, 'saved booking price');
    assert.equal(money(pkg.positionsSubtotal), EXPECTED_SUBTOTAL, 'saved booking package subtotal');
    assert.equal(money(pkg.finalTotal), EXPECTED_SUBTOTAL, 'saved booking package final total');
    assert.equal(positions.length, CART_PRODUCT_IDS.length, 'saved booking package positions count');
    for (const productId of CART_PRODUCT_IDS) {
        assert.ok(positions.some(item => String(item.productId || item.product_id) === productId), `saved booking has ${productId}`);
    }
    return {
        id: booking.id,
        price: money(booking.price),
        positionsCount: positions.length,
        status: booking.status || null
    };
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or LIVE_CAKE_DECORATIONS_URL/LIVE_SMOKE_URL/TEST_URL');
    if (KEEP_BOOKING) {
        throw new Error('LIVE_CAKE_DECORATIONS_KEEP_BOOKING is not allowed for this smoke; cleanup must stay enabled');
    }

    const base = normalizeBase(TARGET_URL);
    const playwright = requirePlaywrightOrReexec();
    const session = await login(base);
    await assertCleanupTransportReady(base, session.token);
    const products = await assertProductsApi(base, session.token);
    const slot = await pickSafeSlot(base, session.token);

    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let booking = null;
    let cleanup = null;
    let cleanupVerified = false;
    let primaryError = null;
    let productsUi = null;
    let catalogUi = null;
    let saved = null;

    try {
        productsUi = await assertProductsUi(browser, base, session);
        catalogUi = await assertBookingCatalogUi(browser, base, session, slot);
        booking = await createSafeBooking(base, session.token, slot, catalogUi.positions, session);
        saved = await assertSavedBooking(base, session.token, booking.id);
    } catch (err) {
        primaryError = err;
    } finally {
        await browser.close().catch(() => {});
        if (booking?.id) {
            try {
                cleanup = await cleanupBooking(base, session.token, booking.id);
                cleanupVerified = await assertBookingAbsentFromActiveList(base, session.token, booking.id, slot.date);
            } catch (err) {
                if (!primaryError) primaryError = err;
                console.warn(`cleanup booking ${booking.id} failed: ${err.message || err}`);
            }
        }
    }

    if (primaryError) throw primaryError;
    if (booking?.id && !cleanup?.ok) throw new Error(`cleanup booking ${booking.id} did not complete`);
    if (booking?.id && !cleanupVerified) throw new Error(`cleanup booking ${booking.id} was not verified`);

    console.log(`Live cake decorations smoke OK: ${base}`);
    console.log(`  OK products API: ${products.length}/${EXPECTED_PRODUCTS.length} in "${CAKE_DECORATION_SECTION}"`);
    console.log(`  OK Products UI: filter chip active, cards=${productsUi.cardCount}`);
    console.log(`  OK Booking catalog: tab=${catalogUi.tabLabel}, cart=${catalogUi.positions.length}, subtotal=${catalogUi.subtotal}`);
    console.log(`  OK safe booking: ${saved.id}, status=${saved.status}, total=${saved.price}, positions=${saved.positionsCount}`);
    console.log(`  OK cleanup: ${cleanup.mode} delete for ${booking.id}; active record absent`);
    console.log(`  OK slot: ${slot.date} ${slot.time}, room selected, candidateSlots=${slot.candidateTimes.length}`);
    console.log(`  OK exact cleanup IDs: bookings=${[...CREATED_BOOKING_IDS].join(',') || '-'}, groups=${[...CREATED_GROUP_IDS].join(',') || '-'}`);
    console.log(`  OK businessContext: ${BUSINESS_CONTEXT}`);
}

if (require.main === module) {
    run().catch(error => fail(error?.stack || error?.message || String(error)));
}

module.exports = { scheduleCandidateTimes, safeBookingPayload, assertExactDisposableMarker, cleanupPreflightPath, QA_CLEANUP_SOURCE };
