#!/usr/bin/env node
'use strict';

/**
 * Browser/live smoke for the booking drawer customer context panel.
 *
 * The smoke creates one clearly marked disposable customer, selects that
 * customer through the real booking drawer search in activity and kitchen
 * modes, verifies the right-side context panel, and stops before saving.
 *
 * Usage:
 *   npm run smoke:booking-customer-context -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_TOKEN=<jwt> npm run smoke:booking-customer-context
 *   LIVE_SMOKE_USER=codex.qa LIVE_SMOKE_PASS=... npm run smoke:booking-customer-context -- <url>
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUSINESS_CONTEXT = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const HEADLESS = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const RUN_ID = `booking-context-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const SMOKE_DATE = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_DATE', 'LIVE_SMOKE_DATE') || futureDate(45);
const TIMEOUT_MS = Number(readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const CLEANUP_DISABLED = isConfirmed(readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_KEEP_CUSTOMER'));

const SCENARIOS = Object.freeze([
    Object.freeze({
        name: 'desktop activity',
        bookingMode: 'activity',
        timelineView: 'animators',
        viewport: Object.freeze({ width: 1440, height: 960 }),
        eventEnabled: true,
        kitchenEnabled: false
    }),
    Object.freeze({
        name: 'desktop kitchen',
        bookingMode: 'kitchen_room',
        timelineView: 'rooms',
        viewport: Object.freeze({ width: 1440, height: 960 }),
        eventEnabled: false,
        kitchenEnabled: true
    }),
    Object.freeze({
        name: 'mobile activity',
        bookingMode: 'activity',
        timelineView: 'animators',
        viewport: Object.freeze({ width: 390, height: 844 }),
        eventEnabled: true,
        kitchenEnabled: false
    }),
    Object.freeze({
        name: 'mobile kitchen',
        bookingMode: 'kitchen_room',
        timelineView: 'rooms',
        viewport: Object.freeze({ width: 390, height: 844 }),
        eventEnabled: false,
        kitchenEnabled: true
    })
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

function fail(message) {
    console.error(`Live booking customer context smoke failed: ${message}`);
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
    const token = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_BOOKING_CUSTOMER_CONTEXT_PASS', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS');
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

function disposableCustomerPayload() {
    const phoneTail = String(Date.now()).slice(-7);
    return {
        name: `QA Codex Context ${RUN_ID}`,
        phone: `+38063${phoneTail}`,
        instagram: `qa_context_${phoneTail}`,
        source: 'manual',
        notes: `QA customer note ${RUN_ID}: right booking context panel`,
        children: [
            {
                name: 'QA Nut Child',
                birthday: '2020-01-02',
                note: 'алергія на горіхи, без арахісу'
            },
            {
                name: 'QA Seat Child',
                birthday: '2018-05-03',
                note: 'посадити поруч з мамою'
            }
        ]
    };
}

async function createDisposableCustomer(base, token) {
    const payload = disposableCustomerPayload();
    const customer = await fetchJson(base, scopedPath('/api/customers'), {
        method: 'POST',
        token,
        body: payload
    });
    if (!customer?.id) throw new Error('/api/customers did not create a disposable customer');
    return customer;
}

async function deleteCustomer(base, token, customerId) {
    if (!customerId) return false;
    const body = await fetchJson(base, scopedPath(`/api/customers/${encodeURIComponent(customerId)}`), {
        method: 'DELETE',
        token
    });
    return body?.success === true;
}

async function assertSearchProjection(base, token, customer) {
    const results = await fetchJson(base, scopedPath('/api/customers/search', { q: customer.name }), { token });
    if (!Array.isArray(results)) throw new Error('/api/customers/search did not return an array');
    const found = results.find(item => String(item.id) === String(customer.id));
    assert.ok(found, 'created customer is searchable before browser smoke');
    assert.equal(found.notes, customer.notes, 'search result includes customer.notes');
    assert.ok(Array.isArray(found.children), 'search result includes children projection');
    assert.equal(found.children.length, 2, 'search result includes both disposable children');
    assert.equal(found.children[0].note, customer.children[0].note, 'search result includes first child note');
    assert.equal(found.children[1].note, customer.children[1].note, 'search result includes second child note');
}

async function openAuthenticatedContext(browser, session, scenario) {
    const context = await browser.newContext({ viewport: scenario.viewport });
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

function bookingUrl(base, scenario) {
    const params = new URLSearchParams({
        businessContext: BUSINESS_CONTEXT,
        timelineView: scenario.timelineView,
        date: SMOKE_DATE,
        eventDate: SMOKE_DATE,
        convert: 'booking',
        // The lead id is an open hint only. The script never submits a booking.
        leadId: '999999',
        bookingMode: scenario.bookingMode
    });
    return `${base}/?${params.toString()}`;
}

async function waitForBookingPanel(page) {
    await page.waitForFunction(() => {
        const mainApp = document.getElementById('mainApp');
        const loginScreen = document.getElementById('loginScreen');
        return mainApp && !mainApp.classList.contains('hidden')
            && (!loginScreen || loginScreen.classList.contains('hidden'));
    });
    await page.waitForFunction(() => {
        const panel = document.getElementById('bookingPanel');
        return panel && !panel.classList.contains('hidden');
    });
}

async function selectCustomerThroughSearch(page, customer) {
    await page.locator('#customerSearch').fill(customer.name);
    await page.waitForSelector(`.customer-search-item[data-id="${customer.id}"]`);
    await page.locator(`.customer-search-item[data-id="${customer.id}"]`).click();
    await page.waitForFunction(id => {
        return document.getElementById('selectedCustomerId')?.value === String(id);
    }, String(customer.id));
}

async function readContextState(page) {
    return page.evaluate(() => {
        const text = selector => document.querySelector(selector)?.textContent || '';
        const rectOf = selector => {
            const rect = document.querySelector(selector)?.getBoundingClientRect?.();
            if (!rect) return null;
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            };
        };
        const card = document.getElementById('bookingSelectedCustomerCard');
        const eventFields = document.getElementById('bookingEventFields');
        const banquetFields = document.getElementById('banquetFields');
        const layout = document.querySelector('.booking-customer-layout');
        const kitchenAddButton = document.querySelector('[data-booking-kitchen-context-add]');
        return {
            selectedCustomerId: document.getElementById('selectedCustomerId')?.value || '',
            cardHidden: Boolean(card?.classList.contains('hidden')),
            cardText: text('#bookingSelectedCustomerCard'),
            kitchenText: text('.booking-selected-customer__kitchen'),
            kitchenBlockCount: document.querySelectorAll('.booking-selected-customer__kitchen').length,
            kitchenPriorityCount: document.querySelectorAll('.booking-selected-customer__kitchen-row.is-priority').length,
            kitchenAddButtonCount: document.querySelectorAll('[data-booking-kitchen-context-add]').length,
            kitchenAddButtonPressed: kitchenAddButton?.getAttribute('aria-pressed') || '',
            kitchenAddStatus: text('.booking-selected-customer__kitchen-status').trim(),
            contextPanelExists: Boolean(document.getElementById('bookingCustomerContextPanel')),
            gridColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
            primaryRect: rectOf('.booking-customer-primary'),
            panelRect: rectOf('#bookingCustomerContextPanel'),
            eventEnabled: typeof getBookingWorkspaceHasEvent === 'function' ? getBookingWorkspaceHasEvent() : null,
            kitchenEnabled: typeof isBookingKitchenEnabled === 'function' ? isBookingKitchenEnabled() : null,
            eventFieldsHidden: Boolean(eventFields?.hidden || eventFields?.classList.contains('hidden')),
            banquetFieldsHidden: Boolean(banquetFields?.hidden || banquetFields?.classList.contains('hidden')),
            kitchenToggleChecked: Boolean(document.getElementById('bookingKitchenToggle')?.checked),
            bookingNotes: document.getElementById('bookingNotes')?.value || '',
            bookingLine: document.getElementById('bookingLine')?.value || '',
            room: document.getElementById('roomSelect')?.value || ''
        };
    });
}

function assertPanelText(state, customer, scenario) {
    const combinedText = `${state.cardText}\n${state.kitchenText}`;
    const expectedFragments = [
        customer.name,
        customer.phone,
        `@${customer.instagram}`,
        customer.notes,
        customer.children[0].name,
        customer.children[1].name,
        customer.children[0].note,
        customer.children[1].note,
        'Важливо для кухні'
    ];
    for (const fragment of expectedFragments) {
        assert.ok(combinedText.includes(fragment), `${scenario.name}: missing "${fragment}" in customer context`);
    }
}

function assertScenarioState(state, customer, scenario) {
    assert.equal(state.contextPanelExists, true, `${scenario.name}: context panel is missing`);
    assert.equal(state.cardHidden, false, `${scenario.name}: selected customer card is hidden`);
    assert.equal(state.selectedCustomerId, String(customer.id), `${scenario.name}: selected customer mismatch`);
    assert.equal(state.kitchenBlockCount, 1, `${scenario.name}: kitchen context block missing`);
    assert.ok(state.kitchenPriorityCount >= 1, `${scenario.name}: priority kitchen note is not highlighted`);
    assert.equal(state.bookingNotes, '', `${scenario.name}: booking notes were mutated`);
    assert.equal(state.kitchenAddButtonCount, scenario.kitchenEnabled ? 1 : 0, `${scenario.name}: kitchen add action visibility mismatch`);
    assert.equal(state.eventEnabled, scenario.eventEnabled, `${scenario.name}: event enabled state mismatch`);
    assert.equal(state.kitchenEnabled, scenario.kitchenEnabled, `${scenario.name}: kitchen enabled state mismatch`);
    assert.equal(state.eventFieldsHidden, !scenario.eventEnabled, `${scenario.name}: event fields visibility mismatch`);
    assert.equal(state.banquetFieldsHidden, !scenario.kitchenEnabled, `${scenario.name}: banquet fields visibility mismatch`);
    assert.equal(state.kitchenToggleChecked, scenario.kitchenEnabled, `${scenario.name}: kitchen toggle mismatch`);

    if (scenario.bookingMode === 'kitchen_room') {
        assert.equal(state.bookingLine, 'banquet-service', `${scenario.name}: expected banquet-service line`);
        assert.ok(state.room, `${scenario.name}: room is not selected`);
    } else {
        assert.notEqual(state.bookingLine, 'banquet-service', `${scenario.name}: activity should not use banquet-service line`);
    }

    assert.ok(state.primaryRect && state.panelRect, `${scenario.name}: missing panel geometry`);
    if (scenario.viewport.width >= 900) {
        assert.ok(state.panelRect.left >= state.primaryRect.right - 1, `${scenario.name}: context panel is not right of the search column`);
        assert.ok(Math.abs(state.panelRect.top - state.primaryRect.top) < 48, `${scenario.name}: desktop panel is not aligned with search column`);
    } else {
        assert.ok(Math.abs(state.panelRect.left - state.primaryRect.left) < 6, `${scenario.name}: mobile context panel is not stacked in the same column`);
        assert.ok(state.panelRect.width <= state.primaryRect.width + 6, `${scenario.name}: mobile context panel width is unstable`);
        assert.ok(state.panelRect.right <= scenario.viewport.width + 1, `${scenario.name}: mobile context panel creates horizontal overflow`);
    }
}

async function assertKitchenNotesAction(page, customer, scenario) {
    if (!scenario.kitchenEnabled) return false;
    await page.locator('[data-booking-kitchen-context-add]').click();
    await page.waitForFunction(() => {
        return document.getElementById('bookingNotes')?.value.includes('Важливо для кухні:');
    });
    const afterFirstClick = await readContextState(page);
    assert.ok(afterFirstClick.bookingNotes.includes(customer.children[0].note), `${scenario.name}: first child note was not copied`);
    assert.ok(afterFirstClick.bookingNotes.includes(customer.children[1].note), `${scenario.name}: second child note was not copied`);
    assert.equal(afterFirstClick.kitchenAddStatus, 'Додано', `${scenario.name}: kitchen action added state missing`);
    assert.equal(afterFirstClick.kitchenAddButtonPressed, 'true', `${scenario.name}: kitchen action aria state missing`);

    await page.locator('[data-booking-kitchen-context-add]').click();
    const afterSecondClick = await readContextState(page);
    assert.equal(afterSecondClick.bookingNotes, afterFirstClick.bookingNotes, `${scenario.name}: kitchen action duplicated notes`);
    return true;
}

async function runScenario(browser, base, session, customer, scenario) {
    const bookingPostRequests = [];
    const serverErrors = [];
    let context;
    let page;
    try {
        ({ context, page } = await openAuthenticatedContext(browser, session, scenario));
        page.on('request', request => {
            if (request.method() !== 'POST') return;
            const pathname = new URL(request.url()).pathname;
            if (pathname === '/api/bookings' || pathname === '/api/bookings/full' || pathname.includes('/member-booking')) {
                bookingPostRequests.push(`${request.method()} ${pathname}`);
            }
        });
        page.on('response', response => {
            const pathname = new URL(response.url()).pathname;
            if (response.status() >= 500 && (pathname.startsWith('/api/bookings') || pathname.startsWith('/api/customers'))) {
                serverErrors.push(`${response.request().method()} ${pathname} ${response.status()}`);
            }
        });

        await page.goto(bookingUrl(base, scenario), { waitUntil: 'domcontentloaded' });
        await waitForBookingPanel(page);
        await selectCustomerThroughSearch(page, customer);
        const state = await readContextState(page);
        assertPanelText(state, customer, scenario);
        assertScenarioState(state, customer, scenario);
        const kitchenNotesAction = await assertKitchenNotesAction(page, customer, scenario);
        assert.deepEqual(bookingPostRequests, [], `${scenario.name}: booking was saved unexpectedly`);
        assert.deepEqual(serverErrors, [], `${scenario.name}: API 500 responses`);
        return {
            name: scenario.name,
            selectedCustomerId: state.selectedCustomerId,
            gridColumns: state.gridColumns,
            bookingLine: state.bookingLine || '-',
            room: state.room || '-',
            kitchenNotesAction
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or LIVE_BOOKING_CUSTOMER_CONTEXT_URL/LIVE_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node scripts/live-booking-customer-context-smoke.js');
    }

    const session = await login(base);
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let customer = null;
    let cleanupOk = false;
    let primaryError = null;

    try {
        customer = await createDisposableCustomer(base, session.token);
        await assertSearchProjection(base, session.token, customer);

        const results = [];
        for (const scenario of SCENARIOS) {
            results.push(await runScenario(browser, base, session, customer, scenario));
        }

        console.log(`Live booking customer context smoke OK: ${base}`);
        console.log(`  OK customer: ${customer.id} (created disposable)`);
        console.log(`  OK date: ${SMOKE_DATE}`);
        for (const result of results) {
            console.log(`  OK ${result.name}: selected=${result.selectedCustomerId}, line=${result.bookingLine}, room=${result.room}, kitchenNotesAction=${result.kitchenNotesAction ? 'clicked' : 'hidden'}, grid=${result.gridColumns}`);
        }
        console.log(`  OK businessContext: ${BUSINESS_CONTEXT}`);
    } catch (err) {
        primaryError = err;
    } finally {
        await browser.close().catch(() => {});
        if (customer?.id && !CLEANUP_DISABLED) {
            try {
                cleanupOk = await deleteCustomer(base, session.token, customer.id);
            } catch (err) {
                if (!primaryError) primaryError = err;
                console.warn(`cleanup customer ${customer.id} failed: ${err.message || err}`);
            }
        }
    }

    if (primaryError) throw primaryError;
    if (customer?.id && CLEANUP_DISABLED) {
        throw new Error(`cleanup disabled; disposable customer ${customer.id} was intentionally left in place`);
    }
    if (customer?.id && !cleanupOk) {
        throw new Error(`cleanup customer ${customer.id} did not return success`);
    }
    if (customer?.id) console.log(`  OK cleanup: deleted disposable customer ${customer.id}`);
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
