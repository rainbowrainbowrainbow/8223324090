#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const BASE_URL = normalizeBase(
    process.env.LIVE_TICKET_QA_URL
    || process.env.LIVE_SMOKE_URL
    || 'https://8223324090-production.up.railway.app'
);
const BUSINESS_CONTEXT = 'event_genix';
let BOOKING_ID = '';
let BOOKING_DATE = String(process.env.LIVE_TICKET_QA_DATE || '2026-09-01').trim();
let WEEKEND_DATE = String(process.env.LIVE_TICKET_QA_WEEKEND_DATE || '2026-09-05').trim();
let BOOKING_TIME = String(process.env.LIVE_TICKET_QA_TIME || '12:00').trim();
const EXPECTED_VERSION = String(process.env.LIVE_TICKET_QA_EXPECTED_VERSION || pkg.version || '').trim();
const ROOM_RESOURCE_ID = String(process.env.LIVE_TICKET_QA_ROOM_ID || 'room-yellow-table').trim();
const ROOM_NAME = String(process.env.LIVE_TICKET_QA_ROOM_NAME || 'Жовтий стіл').trim();
const TIMEOUT_MS = Number(process.env.LIVE_TICKET_QA_TIMEOUT_MS || 30000);
const QA_CUSTOMER_ID = Number(process.env.LIVE_TICKET_QA_CUSTOMER_ID || 0);
const QA_CUSTOMER_NAME = String(process.env.LIVE_TICKET_QA_CUSTOMER_NAME || '').trim();
const ARTIFACT_ROOT = path.join(
    __dirname,
    '..',
    'output',
    'playwright',
    'ticket-release-gate',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-v${EXPECTED_VERSION || 'unknown'}`
);
const MANAGER_ARTIFACT_DIR = path.join(ARTIFACT_ROOT, 'manager');
const SENIOR_ARTIFACT_DIR = path.join(ARTIFACT_ROOT, 'senior-manager');
const TICKET_MATRIX = Object.freeze({
    regular_child: {
        standard: { weekday: 350, weekend: 400 },
        reserved_table_room: { weekday: 310, weekend: 350 }
    },
    under_3_child: {
        standard: { weekday: 175, weekend: null },
        reserved_table_room: { weekday: 175, weekend: null }
    },
    discounted_child: {
        standard: { weekday: 175, weekend: 200 },
        reserved_table_room: { weekday: 175, weekend: 200 }
    },
    birthday_child: {
        standard: { weekday: 10, weekend: 10 },
        reserved_table_room: { weekday: 10, weekend: 10 }
    },
    adult_companion: {
        standard: { weekday: 10, weekend: 10 },
        reserved_table_room: { weekday: 10, weekend: 10 }
    },
    adult_game: {
        standard: { weekday: 75, weekend: 75 },
        reserved_table_room: { weekday: 75, weekend: 75 }
    }
});

function normalizeBase(value) {
    return new URL(value).origin;
}

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function scopedPath(routePath, params = {}) {
    const url = new URL(routePath, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    }
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return `${url.pathname}${url.search}`;
}

async function readBody(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchResult(routePath, options = {}) {
    const response = await fetch(`${BASE_URL}${routePath}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return {
        response,
        body: await readBody(response)
    };
}

function responseDetail(body) {
    if (body && typeof body === 'object') {
        return body.error || body.message || body.code || JSON.stringify(body);
    }
    return String(body || '');
}

async function fetchJson(routePath, options = {}) {
    const result = await fetchResult(routePath, options);
    if (!result.response.ok) {
        throw new Error(
            `${routePath} returned ${result.response.status}: ${responseDetail(result.body)}`
        );
    }
    return result.body;
}

async function login(username, password) {
    assert.ok(username && password, 'QA credentials are available');
    const body = await fetchJson('/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const legacyToken = body.token || body.accessToken;
    assert.ok(legacyToken, 'login returns token');
    return {
        token: legacyToken,
        accessToken: body.accessToken || legacyToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user || null
    };
}

async function managerImpersonationSession() {
    const creator = await login(
        process.env.LIVE_CREATOR_USER,
        process.env.LIVE_CREATOR_PASS
    );
    assert.equal(creator.user?.role, 'creator', 'creator QA credentials role');
    const users = await fetchJson('/api/auth/users-list', {
        token: creator.token
    });
    assert.ok(Array.isArray(users), 'creator users list is an array');
    const candidates = users.filter(user => {
        if (String(user?.role || '') !== 'manager') return false;
        return /(qa|test|codex|smoke|demo|тест)/i.test(
            `${user?.username || ''} ${user?.name || ''}`
        );
    });
    assert.equal(candidates.length, 1, 'exactly one safe QA manager candidate');
    const body = await fetchJson('/api/auth/impersonate', {
        method: 'POST',
        token: creator.token,
        body: { userId: candidates[0].id }
    });
    assert.equal(body.user?.role, 'manager', 'impersonation returns manager');
    assert.equal(String(body.user?.id || ''), String(candidates[0].id), 'impersonation returns selected QA user');
    assert.ok(body.token, 'impersonation returns token');
    return {
        token: body.token,
        accessToken: body.token,
        refreshToken: '',
        refreshExpiresAt: '',
        user: body.user
    };
}

async function verifyRole(session, expectedRole) {
    const body = await fetchJson('/api/auth/verify', { token: session.token });
    assert.equal(body.user?.role, expectedRole, `${expectedRole} session verifies`);
    return body.user;
}

async function validateSafeTestCustomer(token, customerId) {
    assert.ok(Number.isInteger(customerId) && customerId > 0, 'safe QA customer id is configured');
    const body = await fetchJson(
        scopedPath(`/api/customers/${encodeURIComponent(customerId)}`),
        { token }
    );
    const customer = body?.customer || body;
    assert.equal(Number(customer?.id), customerId, 'safe QA customer id round-trips');
    assert.match(String(customer?.name || ''), /^Codex QA\b/i, 'safe QA customer marker');
    return customerId;
}

function normalizeQaCustomerName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function isSafeQaCustomer(customer) {
    return /^Codex QA\b/i.test(normalizeQaCustomerName(customer?.name));
}

function compareCustomersById(first, second) {
    return Number(first?.id || 0) - Number(second?.id || 0);
}

async function discoverSafeTestCustomer(token) {
    const search = QA_CUSTOMER_NAME || 'Codex QA';
    const body = await fetchJson(
        scopedPath('/api/customers', { search, limit: 100, sortBy: 'name' }),
        { token }
    );
    const safeCustomers = (Array.isArray(body?.customers) ? body.customers : [])
        .filter(isSafeQaCustomer);
    assert.ok(safeCustomers.length > 0, 'safe QA customer discovery found a Codex QA customer');

    const exactName = normalizeQaCustomerName(QA_CUSTOMER_NAME).toLowerCase();
    if (exactName) {
        const exactMatches = safeCustomers.filter(customer => (
            normalizeQaCustomerName(customer?.name).toLowerCase() === exactName
        ));
        assert.equal(exactMatches.length, 1, 'LIVE_TICKET_QA_CUSTOMER_NAME matches exactly one safe QA customer');
        return Number(exactMatches[0].id);
    }

    const banquetCandidates = safeCustomers.filter(customer => (
        /(admission|banquet|ticket)/i.test(normalizeQaCustomerName(customer?.name))
    ));
    const selected = [...(banquetCandidates.length ? banquetCandidates : safeCustomers)]
        .sort(compareCustomersById)[0];
    assert.ok(Number.isInteger(Number(selected?.id)) && Number(selected.id) > 0, 'safe QA customer discovery returns id');
    console.log('[qa customer] selected ' + selected.id + ': ' + normalizeQaCustomerName(selected.name));
    return Number(selected.id);
}

async function resolveSafeTestCustomer(token, configuredCustomerId) {
    if (Number.isInteger(configuredCustomerId) && configuredCustomerId > 0) {
        return validateSafeTestCustomer(token, configuredCustomerId);
    }
    const discoveredCustomerId = await discoverSafeTestCustomer(token);
    return validateSafeTestCustomer(token, discoveredCustomerId);
}

function addDays(dateText, offset) {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

function isWeekendDate(dateText) {
    const day = new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
}

function minutesFromTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function timeFromMinutes(total) {
    const minutes = ((Number(total) % 1440) + 1440) % 1440;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function bookingOverlapsSlot(booking = {}, slotStart, slotDuration) {
    const activeStatus = String(booking.status || '').toLowerCase();
    if (['cancelled', 'canceled', 'deleted'].includes(activeStatus)) return false;
    const resourceId = String(
        booking.resourceId
        || booking.resource_id
        || booking.roomResourceId
        || booking.room_resource_id
        || ''
    ).trim();
    const roomName = String(booking.room || '').trim();
    if (resourceId && resourceId !== ROOM_RESOURCE_ID) return false;
    if (!resourceId && roomName && roomName !== ROOM_NAME) return false;
    const start = minutesFromTime(booking.time);
    if (start === null) return false;
    const duration = Math.max(15, Number(booking.duration || booking.duration_minutes || 60));
    return start < slotStart + slotDuration && slotStart < start + duration;
}

async function findFreeTestSlot(token, {
    startDate,
    wantWeekend = false,
    duration = 60,
    candidateTimes = ['12:00', '12:15', '12:30', '13:00', '13:30', '14:00', '15:00', '16:00', '17:00', '18:00']
}) {
    for (let offset = 0; offset < 90; offset += 1) {
        const date = addDays(startDate, offset);
        if (isWeekendDate(date) !== wantWeekend) continue;
        const bookings = await fetchJson(
            scopedPath(`/api/bookings/${encodeURIComponent(date)}`, { timelineView: 'rooms' }),
            { token }
        );
        assert.ok(Array.isArray(bookings), `booking list is array for ${date}`);
        for (const time of candidateTimes) {
            const start = minutesFromTime(time);
            if (start === null) continue;
            if (!bookings.some(booking => bookingOverlapsSlot(booking, start, duration))) {
                return { date, time };
            }
        }
    }
    throw new Error(`No free ${wantWeekend ? 'weekend' : 'weekday'} QA slot found for ${ROOM_RESOURCE_ID}`);
}

async function createDisposableBooking(token, createdBy, customerId) {
    const runId = `ticket-qa-${Date.now()}`;
    const marker = `QA Admission Tickets Smoke ${runId}`;
    const body = await fetchJson(
        scopedPath('/api/bookings', { timelineView: 'rooms' }),
        {
            method: 'POST',
            token,
            body: {
                date: BOOKING_DATE,
                time: BOOKING_TIME,
                lineId: 'banquet-service',
                resourceId: 'banquet-service',
                label: marker,
                programName: marker,
                category: 'banquet',
                duration: 60,
                price: 0,
                hosts: 0,
                room: ROOM_NAME,
                roomResourceId: ROOM_RESOURCE_ID,
                notes: `safe automated smoke; disposable booking; cleanup expected; run=${runId}`,
                createdBy,
                customerId,
                status: 'preliminary',
                kidsCount: null,
                banquetGuests: 0,
                banquetAdults: 0,
                banquetTables: 0,
                banquetMenu: null,
                extraData: {
                    smokeTest: {
                        kind: 'admission_tickets',
                        safe: true,
                        cleanupExpected: true,
                        runId
                    }
                },
                skipNotification: true
            }
        }
    );
    assert.equal(body?.success, true, 'disposable booking create success');
    const booking = body?.booking || body?.allBookings?.[0] || null;
    assert.ok(booking?.id, 'disposable booking returns id');
    assert.equal(String(booking.label || ''), marker, 'disposable booking marker round-trips');
    return {
        id: String(booking.id),
        marker,
        runId
    };
}

function requirePlaywrightOrReexec() {
    try {
        return require('playwright');
    } catch (error) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        if (process.env.LIVE_TICKET_QA_PLAYWRIGHT_BOOTSTRAPPED === '1') throw error;
        const result = spawnSync(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['--yes', '--package', 'playwright', 'node', __filename],
            {
                env: {
                    ...process.env,
                    LIVE_TICKET_QA_PLAYWRIGHT_BOOTSTRAPPED: '1'
                },
                stdio: 'inherit',
                shell: process.platform === 'win32'
            }
        );
        if (result.error) throw result.error;
        process.exit(result.status ?? 1);
    }
}

async function openAuthenticatedContext(browser, session) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: 'block'
    });
    await context.addInitScript(auth => {
        localStorage.setItem('pzp_token', auth.token);
        localStorage.setItem('pzp_access_token', auth.accessToken || auth.token);
        if (auth.refreshToken) localStorage.setItem('pzp_refresh_token', auth.refreshToken);
        if (auth.refreshExpiresAt) {
            localStorage.setItem('pzp_refresh_expires_at', String(auth.refreshExpiresAt));
        }
        localStorage.setItem('pzp_current_user', JSON.stringify(auth.user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    const fulfillBlockedExternal = route => route.fulfill({
        status: 204,
        body: ''
    });
    await page.route('https://www.clarity.ms/**', fulfillBlockedExternal);
    await page.route('https://fonts.googleapis.com/**', fulfillBlockedExternal);
    await page.route('https://fonts.gstatic.com/**', fulfillBlockedExternal);
    const diagnostics = {
        consoleErrors: [],
        ignoredConsoleErrors: [],
        pageErrors: [],
        navigations: [],
        authFailures: []
    };
    page.on('console', message => {
        if (message.type() === 'error') {
            const entry = message.text();
            if (
                /Failed to load resource: net::ERR_FAILED/i.test(entry)
                || /^Failed to load resource: the server responded with a status of 422 \(\)$/i.test(entry)
            ) {
                diagnostics.ignoredConsoleErrors.push(entry);
                return;
            }
            diagnostics.consoleErrors.push(entry);
            console.error(`[browser console] ${entry}`);
        }
    });
    page.on('pageerror', error => {
        const entry = error.message || String(error);
        diagnostics.pageErrors.push(entry);
        console.error(`[browser pageerror] ${entry}`);
    });
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) {
            const url = frame.url();
            diagnostics.navigations.push(url);
            console.error(`[browser navigation] ${url}`);
        }
    });
    page.on('response', response => {
        if (response.status() === 401 || response.status() === 403) {
            const entry = `${response.status()} ${response.request().method()} ${response.url()}`;
            diagnostics.authFailures.push(entry);
            console.error(`[browser auth] ${entry}`);
        }
    });
    await page.goto(`${BASE_URL}/`, {
        waitUntil: 'domcontentloaded'
    });
    await page.waitForFunction(() => {
        const app = document.getElementById('mainApp');
        return app
            && !app.classList.contains('hidden')
            && window.AppState
            && window.TimelineView
            && typeof window.editBooking === 'function'
            && typeof window.renderTimeline === 'function';
    });
    const browserBusinessContext = await page.evaluate(() => {
        return window.CrmBusinessContext?.set?.('event_genix', {
            user: window.AppState?.currentUser,
            updateUrl: false,
            emit: true
        }) || null;
    });
    assert.equal(browserBusinessContext, 'event_genix', 'browser uses Event Genix business context');
    return { context, page, diagnostics };
}

function assertNoUnknownBrowserErrors(diagnostics, label) {
    const consoleErrors = diagnostics?.consoleErrors || [];
    const pageErrors = diagnostics?.pageErrors || [];
    const authFailures = diagnostics?.authFailures || [];
    const unknown = [...consoleErrors, ...pageErrors, ...authFailures].filter(Boolean);
    assert.deepEqual(unknown, [], `${label} browser diagnostics has no unknown errors`);
}

async function renderRoomTimeline(page, date) {
    await page.evaluate(async selectedDate => {
        AppState.selectedDate = new Date(`${selectedDate}T00:00:00`);
        const input = document.getElementById('timelineDate');
        if (input) input.value = selectedDate;
        if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(selectedDate);
        if (window.TimelineView?.set) {
            await window.TimelineView.set('rooms', { render: false });
        }
        await window.renderTimeline();
    }, date);
    await page.waitForTimeout(200);
}

async function openBookingEditor(page, bookingId, date = BOOKING_DATE) {
    const preflight = await page.evaluate(async input => {
        window.CrmBusinessContext?.set?.('event_genix', {
            user: window.AppState?.currentUser,
            updateUrl: false,
            emit: true
        });
        AppState.selectedDate = new Date(`${input.date}T00:00:00`);
        const dateInput = document.getElementById('timelineDate');
        if (dateInput) dateInput.value = input.date;
        if (window.TimelineView?.set) {
            await window.TimelineView.set('rooms', { render: false });
        }
        const rows = await window.apiGetBookings(input.date, {
            timelineView: 'rooms',
            businessContext: 'event_genix',
            fresh: true
        });
        return {
            count: Array.isArray(rows) ? rows.length : -1,
            found: Array.isArray(rows) && rows.some(row => String(row.id || '') === input.bookingId),
            businessContext: window.CrmBusinessContext?.current?.() || null,
            timelineView: window.TimelineView?.current?.() || null
        };
    }, { bookingId: String(bookingId), date });
    assert.equal(preflight.businessContext, 'event_genix', 'editor preflight business context');
    assert.equal(preflight.timelineView, 'rooms', 'editor preflight timeline view');
    assert.equal(preflight.found, true, `manager-visible booking preflight ${JSON.stringify(preflight)}`);
    let result;
    try {
        result = await page.evaluate(async id => {
            await window.editBooking(id);
            const panel = document.getElementById('bookingPanel');
            return {
                visible: Boolean(panel && !panel.classList.contains('hidden')),
                editingBookingId: String(window.AppState?.editingBookingId || ''),
                ticketSectionExists: Boolean(document.getElementById('bookingTicketsSection'))
            };
        }, bookingId);
    } catch (error) {
        throw new Error(`booking editor failed at ${page.url()}: ${error.message || error}`);
    }
    assert.equal(result.visible, true, `booking ${bookingId} editor visible ${JSON.stringify(result)}`);
    assert.equal(result.editingBookingId, String(bookingId), `booking ${bookingId} is editing target`);
    assert.equal(result.ticketSectionExists, true, 'ticket editor exists');
    await page.waitForSelector('#bookingTicketsSection');
}

async function closeBookingEditor(page) {
    await page.evaluate(async () => {
        if (typeof window.closeBookingPanel === 'function') {
            await window.closeBookingPanel(true);
        }
    });
}

async function assertBookingTimeControls(page, expectedTime) {
    const state = await page.evaluate(() => {
        const control = document.getElementById('bookingTime');
        const back = document.getElementById('bookingTimeStepBack');
        const forward = document.getElementById('bookingTimeStepForward');
        return {
            tagName: String(control?.tagName || '').toLowerCase(),
            value: control?.value || '',
            options: Array.from(control?.options || []).map(option => option.value),
            backVisible: Boolean(back && !back.hidden && getComputedStyle(back).display !== 'none'),
            forwardVisible: Boolean(forward && !forward.hidden && getComputedStyle(forward).display !== 'none'),
            hintStatus: document.getElementById('bookingTimeHint')?.dataset?.status || ''
        };
    });
    assert.equal(state.tagName, 'select', 'booking start time uses a select control');
    assert.equal(state.value, expectedTime, 'booking start time rehydrates');
    assert.ok(state.options.includes('12:00'), 'booking time options include 12:00');
    assert.ok(state.options.includes('12:15'), 'booking time options include 12:15');
    assert.ok(state.options.includes('19:00'), 'booking time options include last valid 60-minute slot');
    assert.equal(state.options.includes('20:00'), false, 'booking time options exclude closing time for non-zero duration');
    assert.equal(state.backVisible, true, 'booking -15 control is visible');
    assert.equal(state.forwardVisible, true, 'booking +15 control is visible');
    return state;
}

async function stepBookingTimeForward(page, expectedTime) {
    const control = page.locator('#bookingTimeStepForward');
    assert.equal(await control.isEnabled(), true, 'booking +15 control is enabled');
    await control.click();
    await page.waitForFunction(time => {
        const bookingTime = document.getElementById('bookingTime');
        const status = document.getElementById('bookingTimeHint')?.dataset?.status || '';
        return bookingTime?.value === time && status !== 'checking';
    }, expectedTime);
    const state = await page.evaluate(() => ({
        value: document.getElementById('bookingTime')?.value || '',
        status: document.getElementById('bookingTimeHint')?.dataset?.status || '',
        hint: document.getElementById('bookingTimeHint')?.textContent?.trim() || '',
        dirty: Boolean(window.BookingForm?._dirty),
        submitDisabled: Boolean(document.getElementById('bookingSubmitBtn')?.disabled)
    }));
    assert.equal(state.value, expectedTime, 'booking +15 control changes start time');
    assert.equal(state.status, 'free', `booking time preflight is free: ${state.hint}`);
    assert.equal(state.dirty, true, 'booking time change marks form dirty');
    assert.equal(state.submitDisabled, false, `booking save remains enabled: ${state.hint}`);
    return state;
}

async function assertStoredBookingTime(token, expectedTime) {
    const detail = await fetchJson(
        scopedPath(`/api/bookings/detail/${encodeURIComponent(BOOKING_ID)}`),
        { token }
    );
    const booking = detail.booking || detail.data?.booking || detail;
    assert.equal(String(booking.time || ''), expectedTime, 'booking detail stores changed start time');
    return booking;
}

async function fillTicketQuote(page, input, expected) {
    const firstManual = page.locator('#ticketBirthdayChildQuantity');
    if (await firstManual.isDisabled()) {
        const convert = page.locator('#bookingTicketsConvert');
        assert.equal(await convert.isVisible(), true, 'ticket opt-in action is visible');
        await convert.click();
        await page.waitForTimeout(800);
        const optInState = await page.evaluate(() => ({
            disabled: Boolean(document.getElementById('ticketBirthdayChildQuantity')?.disabled),
            bannerHidden: Boolean(document.getElementById('bookingTicketsLegacyBanner')?.classList.contains('hidden')),
            buttonText: document.getElementById('bookingTicketsConvert')?.textContent?.trim() || '',
            quoteStatus: document.getElementById('bookingTicketQuoteState')?.textContent?.trim() || '',
            hasQuote: Boolean(window.BookingTickets?.getQuote?.())
        }));
        console.error(`[ticket opt-in preview] ${JSON.stringify(optInState)}`);
        assert.equal(optInState.disabled, false, `ticket fields enabled after opt-in preview ${JSON.stringify(optInState)}`);
    }
    const values = {
        banquetGuests: input.guests,
        banquetAdults: input.adults,
        ticketBirthdayChildQuantity: input.birthday,
        ticketUnder3ChildQuantity: input.under3,
        ticketDiscountedChildQuantity: input.discounted,
        ticketAdultGameQuantity: input.adultGame
    };
    for (const [id, value] of Object.entries(values)) {
        const locator = page.locator(`#${id}`);
        await locator.fill(String(value));
    }
    const quoteState = await page.evaluate(async () => {
        await window.BookingTickets.quoteNow();
        const quote = window.BookingTickets.getQuote();
        return {
            quote,
            regularChildren: document.getElementById('ticketRegularChildQuantity')?.textContent?.trim() || '',
            adultCompanions: document.getElementById('ticketAdultCompanionQuantity')?.textContent?.trim() || '',
            stateText: document.getElementById('bookingTicketQuoteState')?.textContent?.trim() || '',
            metaText: document.getElementById('bookingTicketQuoteMeta')?.textContent?.trim() || '',
            totalText: document.getElementById('bookingTicketQuoteTotal')?.textContent?.trim() || '',
            stickyError: document.getElementById('bookingTicketStickyError')?.textContent?.trim() || ''
        };
    });
    assert.equal(Number(quoteState.quote?.ticketSubtotal), expected.subtotal, 'ticket quote subtotal');
    assert.equal(quoteState.quote?.admissionContext, expected.context, 'ticket admission context');
    assert.equal(quoteState.quote?.dayType, expected.dayType, 'ticket day type');
    assert.match(quoteState.regularChildren, new RegExp(String(expected.regularChildren)), 'automatic regular child count');
    assert.match(quoteState.adultCompanions, new RegExp(String(expected.adultCompanions)), 'automatic adult companion count');
    const conversionBanner = page.locator('#bookingTicketsLegacyBanner');
    if (await conversionBanner.isVisible()) {
        let confirmState = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await page.locator('#bookingTicketsConvert').click();
            await page.waitForTimeout(500);
            confirmState = await page.evaluate(() => ({
                bannerHidden: Boolean(document.getElementById('bookingTicketsLegacyBanner')?.classList.contains('hidden')),
                buttonText: document.getElementById('bookingTicketsConvert')?.textContent?.trim() || '',
                hasQuote: Boolean(window.BookingTickets?.getQuote?.()),
                collectHasTickets: Boolean(window.BookingTickets?.collect?.()?.ticketQuantities)
            }));
            console.error(`[ticket opt-in confirm ${attempt + 1}] ${JSON.stringify(confirmState)}`);
            if (confirmState.bannerHidden) break;
        }
        assert.equal(confirmState?.bannerHidden, true, `ticket opt-in confirmed ${JSON.stringify(confirmState)}`);
        assert.equal(confirmState?.collectHasTickets, true, `ticket payload collectable ${JSON.stringify(confirmState)}`);
    }
    return quoteState;
}

async function submitBookingEditor(page, bookingId) {
    const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'PUT'
            && url.pathname === `/api/bookings/${bookingId}`;
    }, { timeout: 8000 }).catch(() => null);
    await page.locator('#bookingSubmitBtn').click();
    const response = await responsePromise;
    if (!response) {
        const state = await page.evaluate(() => {
            const validation = window.BookingForm?.validate?.() || null;
            const issue = window.BookingTickets?.validationIssue?.() || null;
            return {
                editingBookingId: String(window.AppState?.editingBookingId || ''),
                submitDisabled: Boolean(document.getElementById('bookingSubmitBtn')?.disabled),
                submitText: document.getElementById('bookingSubmitBtn')?.textContent?.trim() || '',
                validation,
                ticketIssue: issue,
                visibleNotifications: Array.from(document.querySelectorAll('.notification, .toast, [role="alert"]'))
                    .filter(element => {
                        const style = getComputedStyle(element);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                    })
                    .map(element => element.textContent?.trim() || '')
                    .filter(Boolean)
                    .slice(-5),
                invalidFields: Array.from(document.querySelectorAll('#bookingForm [aria-invalid="true"], #bookingForm .invalid, #bookingForm .is-invalid'))
                    .map(element => element.id || element.name || element.className)
                    .filter(Boolean)
            };
        });
        await page.locator('#bookingPanel').screenshot({
            path: path.join(MANAGER_ARTIFACT_DIR, '02a-submit-blocked.png')
        });
        throw new Error(`booking submit produced no PUT ${JSON.stringify(state)}`);
    }
    const body = await readBody(response);
    if (!response.ok()) {
        throw new Error(
            `booking save returned ${response.status()}: ${responseDetail(body)}`
        );
    }
    assert.equal(body?.success, true, 'booking save success');
    return body;
}

function findTicketPackage(value, seen = new Set()) {
    if (!value || typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (
        Number(value.schemaVersion ?? value.schema_version) >= 3
        && Array.isArray(value.ticketLines ?? value.ticket_lines)
    ) {
        return value;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        const found = findTicketPackage(child, seen);
        if (found) return found;
    }
    return null;
}

async function assertStoredTicketSnapshot(token, expectedSubtotal, expectedQuantities) {
    const detail = await fetchJson(
        scopedPath(`/api/bookings/detail/${encodeURIComponent(BOOKING_ID)}`),
        { token }
    );
    const bookingPackage = findTicketPackage(detail);
    assert.ok(bookingPackage, 'detail contains booking package v3');
    const subtotal = Number(
        bookingPackage.ticketSubtotal
        ?? bookingPackage.ticket_subtotal
    );
    assert.equal(subtotal, expectedSubtotal, 'stored ticket subtotal');
    const lines = bookingPackage.ticketLines || bookingPackage.ticket_lines || [];
    const quantities = Object.fromEntries(lines.map(line => [
        line.ticketTypeCode || line.ticket_type_code || line.code,
        Number(line.quantity)
    ]));
    for (const [code, quantity] of Object.entries(expectedQuantities)) {
        assert.equal(quantities[code] || 0, quantity, `stored ${code} quantity`);
    }
    const booking = detail.booking || detail.data?.booking || detail;
    const storedPrice = Number(booking.price ?? booking.total ?? expectedSubtotal);
    assert.equal(storedPrice, expectedSubtotal, 'booking price matches ticket subtotal');
    return { detail, bookingPackage };
}

async function assertSummaryAndPdf(token, expectedSubtotal) {
    const summary = await fetchJson(
        scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_ID)}/banquet-summary`),
        { token }
    );
    const serialized = JSON.stringify(summary);
    assert.match(serialized, /regular_child|Звичайний дитячий/, 'summary contains ticket rows');
    assert.ok(
        serialized.includes(String(expectedSubtotal)),
        'summary contains ticket subtotal'
    );
    const clientPdf = await fetch(
        `${BASE_URL}${scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_ID)}/banquet-summary.pdf`, { mode: 'client' })}`,
        { headers: authHeaders(token) }
    );
    let clientPdfBlocked = false;
    if (clientPdf.status === 422) {
        const validation = await readBody(clientPdf);
        assert.equal(validation?.code, 'banquet_summary_pdf_validation_failed', 'client PDF validation code');
        clientPdfBlocked = true;
    } else {
        assert.equal(clientPdf.ok, true, `client summary PDF returns ${clientPdf.status}`);
    }
    const pdf = clientPdfBlocked
        ? await fetch(
            `${BASE_URL}${scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_ID)}/banquet-summary.pdf`, { mode: 'staff' })}`,
            { headers: authHeaders(token) }
        )
        : clientPdf;
    assert.equal(pdf.ok, true, `staff summary PDF returns ${pdf.status}`);
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/i, 'summary PDF content type');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.ok(bytes.length > 1000, 'summary PDF is non-empty');
    return {
        summaryOk: true,
        pdfBytes: bytes.length,
        pdfMode: clientPdfBlocked ? 'staff' : 'client',
        clientPdfBlocked
    };
}

function ticketLineMap(quote) {
    return Object.fromEntries((quote?.ticketLines || []).map(line => [
        line.ticketTypeCode,
        {
            quantity: Number(line.quantity || 0),
            unitPriceUah: Number(line.unitPriceUah || 0),
            subtotalUah: Number(line.subtotalUah || 0)
        }
    ]));
}

async function quoteTicketMatrixScenario(token, {
    label,
    date,
    admissionContext,
    expectedDayType,
    includeUnder3
}) {
    const ticketQuantities = [
        { code: 'birthday_child', quantity: 1 },
        { code: 'discounted_child', quantity: 1 },
        { code: 'adult_game', quantity: 1 }
    ];
    if (includeUnder3) {
        ticketQuantities.push({ code: 'under_3_child', quantity: 1 });
    }
    const body = {
        date,
        roomResourceId: ROOM_RESOURCE_ID,
        banquetGuests: 5,
        banquetAdults: 2,
        ticketQuantities
    };
    if (admissionContext === 'reserved_table_room') {
        body.banquetContext = {
            mode: 'new',
            groupId: null,
            guestArrivalTime: BOOKING_TIME
        };
    }
    const result = await fetchResult(
        scopedPath('/api/bookings/ticket-quote'),
        { method: 'POST', token, body }
    );
    if (!includeUnder3 && !result.response.ok) {
        throw new Error(`${label} quote failed: ${result.response.status} ${responseDetail(result.body)}`);
    }
    assert.equal(result.response.ok, true, `${label} quote succeeds`);
    const quote = result.body.quote;
    assert.equal(quote.admissionContext, admissionContext, `${label} admission context`);
    assert.equal(quote.dayType, expectedDayType, `${label} day type`);
    const lines = ticketLineMap(quote);
    const expectedQuantities = {
        regular_child: includeUnder3 ? 2 : 3,
        discounted_child: 1,
        birthday_child: 1,
        adult_companion: 1,
        adult_game: 1
    };
    if (includeUnder3) expectedQuantities.under_3_child = 1;
    for (const [code, quantity] of Object.entries(expectedQuantities)) {
        assert.equal(lines[code]?.quantity || 0, quantity, `${label} ${code} quantity`);
        assert.equal(
            lines[code]?.unitPriceUah,
            TICKET_MATRIX[code][admissionContext][expectedDayType],
            `${label} ${code} tariff`
        );
    }
    const expectedSubtotal = Object.entries(expectedQuantities).reduce((sum, [code, quantity]) => {
        return sum + (TICKET_MATRIX[code][admissionContext][expectedDayType] * quantity);
    }, 0);
    assert.equal(quote.ticketSubtotal, expectedSubtotal, `${label} subtotal`);
    return {
        label,
        date,
        admissionContext,
        dayType: expectedDayType,
        subtotal: expectedSubtotal,
        quantities: expectedQuantities
    };
}

async function assertTicketTariffMatrix(token) {
    const scenarios = [
        {
            label: 'standard weekday all ticket types',
            date: BOOKING_DATE,
            admissionContext: 'standard',
            expectedDayType: 'weekday',
            includeUnder3: true
        },
        {
            label: 'reserved weekday all ticket types',
            date: BOOKING_DATE,
            admissionContext: 'reserved_table_room',
            expectedDayType: 'weekday',
            includeUnder3: true
        },
        {
            label: 'standard weekend available ticket types',
            date: WEEKEND_DATE,
            admissionContext: 'standard',
            expectedDayType: 'weekend',
            includeUnder3: false
        },
        {
            label: 'reserved weekend available ticket types',
            date: WEEKEND_DATE,
            admissionContext: 'reserved_table_room',
            expectedDayType: 'weekend',
            includeUnder3: false
        }
    ];
    const results = [];
    for (const scenario of scenarios) {
        results.push(await quoteTicketMatrixScenario(token, scenario));
    }
    const unavailable = await fetchResult(
        scopedPath('/api/bookings/ticket-quote'),
        {
            method: 'POST',
            token,
            body: {
                date: WEEKEND_DATE,
                roomResourceId: ROOM_RESOURCE_ID,
                banquetGuests: 1,
                banquetAdults: 0,
                ticketQuantities: [{ code: 'under_3_child', quantity: 1 }]
            }
        }
    );
    assert.equal(unavailable.response.status, 422, 'weekend under-3 quote is blocked');
    assert.equal(unavailable.body?.code, 'TICKET_TYPE_UNAVAILABLE', 'weekend under-3 blocker code');
    return results;
}

async function assertHydratedEditor(page, expected) {
    await openBookingEditor(page, BOOKING_ID);
    const state = await page.evaluate(() => ({
        guests: Number(document.getElementById('banquetGuests')?.value || 0),
        adults: Number(document.getElementById('banquetAdults')?.value || 0),
        birthday: Number(document.getElementById('ticketBirthdayChildQuantity')?.value || 0),
        under3: Number(document.getElementById('ticketUnder3ChildQuantity')?.value || 0),
        discounted: Number(document.getElementById('ticketDiscountedChildQuantity')?.value || 0),
        adultGame: Number(document.getElementById('ticketAdultGameQuantity')?.value || 0),
        subtotal: Number(window.BookingTickets.getSubtotal())
    }));
    assert.deepEqual(state, expected, 'ticket editor rehydrates stored values');
    return state;
}

async function showTicketDetails(page, screenshotPath) {
    await closeBookingEditor(page);
    const opened = await page.evaluate(async id => window.showBookingDetails(id), BOOKING_ID);
    assert.equal(opened, true, 'booking detail opens');
    await page.waitForSelector('#bookingModal:not(.hidden)');
    const state = await page.evaluate(() => ({
        hasTicketGroup: Boolean(document.querySelector('.booking-detail-package-serving-group--tickets')),
        ticketRowCount: document.querySelectorAll('.booking-detail-package-table-row--ticket').length,
        text: document.getElementById('bookingDetails')?.textContent || ''
    }));
    assert.equal(state.hasTicketGroup, true, 'booking detail contains ticket group');
    assert.ok(state.ticketRowCount > 0, 'booking detail contains ticket rows');
    assert.match(state.text, /Квитки|Звичайний|Пільговий|Іменинник|КВИТОК/, 'booking detail contains ticket labels');
    await page.locator('#bookingModal').screenshot({ path: screenshotPath });
    return state;
}

async function reservedWeekendPreview(page) {
    await closeBookingEditor(page);
    await page.evaluate(async selectedDate => {
        AppState.selectedDate = new Date(`${selectedDate}T00:00:00`);
        const input = document.getElementById('timelineDate');
        if (input) input.value = selectedDate;
        if (window.TimelineView?.set) {
            await window.TimelineView.set('rooms', { render: false });
        }
    }, WEEKEND_DATE);
    const opened = await page.evaluate(async input => {
        return window.openBookingPanel('10:00', input.roomResourceId, {
            contextSource: 'live_admission_ticket_qa',
            banquetContext: {
                mode: 'new',
                groupId: null,
                guestArrivalTime: '09:45'
            }
        });
    }, { roomResourceId: ROOM_RESOURCE_ID });
    assert.equal(opened, true, 'reserved preview booking panel opens');
    await page.waitForSelector('#bookingPanel:not(.hidden)');
    const arrival = page.locator('#bookingGuestArrivalTime');
    if (await arrival.count()) await arrival.fill('09:45');
    const quoteState = await fillTicketQuote(page, {
        guests: 5,
        adults: 2,
        birthday: 1,
        under3: 0,
        discounted: 1,
        adultGame: 1
    }, {
        subtotal: 1345,
        context: 'reserved_table_room',
        dayType: 'weekend',
        regularChildren: 3,
        adultCompanions: 1
    });
    await page.locator('#bookingTicketsSection').screenshot({
        path: path.join(SENIOR_ARTIFACT_DIR, '04-reserved-weekend-preview.png')
    });
    await page.locator('#ticketUnder3ChildQuantity').fill('1');
    const blocked = await page.evaluate(async () => {
        await window.BookingTickets.quoteNow();
        return {
            quote: window.BookingTickets.getQuote(),
            stateText: document.getElementById('bookingTicketQuoteState')?.textContent || '',
            stickyError: document.getElementById('bookingTicketStickyError')?.textContent || ''
        };
    });
    const blockedText = `${blocked.stateText} ${blocked.stickyError}`;
    assert.equal(blocked.quote, null, 'weekend under-3 has no accepted quote');
    assert.match(blockedText, /до 3|трьох/i, 'weekend under-3 error identifies ticket');
    assert.match(blockedText, /будн|вихідн/i, 'weekend under-3 error identifies day restriction');
    await page.locator('#bookingTicketsSection').screenshot({
        path: path.join(SENIOR_ARTIFACT_DIR, '05-weekend-under3-blocked.png')
    });
    await closeBookingEditor(page);
    return {
        reservedSubtotal: quoteState.quote.ticketSubtotal,
        under3Blocked: true
    };
}

async function softDeleteAndVerify(token) {
    const result = await fetchResult(
        scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_ID)}`),
        { method: 'DELETE', token }
    );
    if (!result.response.ok && result.response.status !== 404) {
        throw new Error(
            `cleanup returned ${result.response.status}: ${responseDetail(result.body)}`
        );
    }
    const bookings = await fetchJson(
        scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_DATE)}`, { timelineView: 'rooms' }),
        { token }
    );
    assert.ok(Array.isArray(bookings), 'cleanup verification booking list');
    const active = bookings.find(booking => String(booking.id || '') === BOOKING_ID);
    assert.equal(active, undefined, 'cleanup removes test booking from active timeline');
    return {
        mode: result.response.status === 404 ? 'already-absent' : 'soft',
        activeTimelineAbsent: true
    };
}

async function main() {

    fs.mkdirSync(MANAGER_ARTIFACT_DIR, { recursive: true });
    fs.mkdirSync(SENIOR_ARTIFACT_DIR, { recursive: true });

    const playwright = requirePlaywrightOrReexec();
    const seniorSession = await login(
        process.env.LIVE_SMOKE_USER,
        process.env.LIVE_SMOKE_PASS
    );
    assert.equal(seniorSession.user?.role, 'senior_manager', 'senior QA credentials role');
    const managerSession = await managerImpersonationSession();
    await verifyRole(seniorSession, 'senior_manager');
    await verifyRole(managerSession, 'manager');
    const safeCustomerId = await resolveSafeTestCustomer(seniorSession.token, QA_CUSTOMER_ID);
    const weekdaySlot = await findFreeTestSlot(managerSession.token, {
        startDate: BOOKING_DATE,
        wantWeekend: false
    });
    const weekendSlot = await findFreeTestSlot(managerSession.token, {
        startDate: WEEKEND_DATE,
        wantWeekend: true
    });
    BOOKING_DATE = weekdaySlot.date;
    BOOKING_TIME = weekdaySlot.time;
    WEEKEND_DATE = weekendSlot.date;
    const disposableBooking = await createDisposableBooking(
        managerSession.token,
        managerSession.user?.username,
        safeCustomerId
    );
    BOOKING_ID = disposableBooking.id;

    const report = {
        version: null,
        roles: {
            manager: 'verified',
            senior_manager: 'verified'
        },
        manager: {},
        seniorManager: {},
        cleanup: null,
        testBooking: {
            id: BOOKING_ID,
            marker: disposableBooking.marker,
            disposable: true
        },
        diagnostics: {}
    };

    let browser;
    let managerContext;
    let seniorContext;
    try {
        const version = await fetchJson('/api/version');
        report.version = version.version || null;
        if (EXPECTED_VERSION) {
            assert.equal(report.version, EXPECTED_VERSION, 'live release version');
        }
        report.ticketTariffMatrix = await assertTicketTariffMatrix(seniorSession.token);
        const managerRows = await fetchJson(
            scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_DATE)}`, { timelineView: 'rooms' }),
            { token: managerSession.token }
        );
        const seniorRows = await fetchJson(
            scopedPath(`/api/bookings/${encodeURIComponent(BOOKING_DATE)}`, { timelineView: 'rooms' }),
            { token: seniorSession.token }
        );
        report.visibility = {
            managerCount: Array.isArray(managerRows) ? managerRows.length : -1,
            managerFound: Array.isArray(managerRows) && managerRows.some(row => String(row.id || '') === BOOKING_ID),
            seniorManagerCount: Array.isArray(seniorRows) ? seniorRows.length : -1,
            seniorManagerFound: Array.isArray(seniorRows) && seniorRows.some(row => String(row.id || '') === BOOKING_ID)
        };
        console.error(`[server visibility] ${JSON.stringify(report.visibility)}`);
        assert.equal(report.visibility.managerFound, true, 'manager server-side visibility of own disposable booking');
        assert.equal(report.visibility.seniorManagerFound, true, 'senior_manager server-side visibility of disposable booking');

        browser = await playwright.chromium.launch({ headless: true });
        const managerBrowser = await openAuthenticatedContext(browser, managerSession);
        managerContext = managerBrowser.context;
        report.diagnostics.manager = managerBrowser.diagnostics;

        await openBookingEditor(managerBrowser.page, BOOKING_ID);
        const initialTimeControl = await assertBookingTimeControls(managerBrowser.page, BOOKING_TIME);
        const changedTime = timeFromMinutes(minutesFromTime(BOOKING_TIME) + 15);
        const changedTimeControl = await stepBookingTimeForward(managerBrowser.page, changedTime);
        await managerBrowser.page.locator('.info-item--booking-time').screenshot({
            path: path.join(MANAGER_ARTIFACT_DIR, '02-booking-time-12-15.png')
        });
        const managerQuote = await fillTicketQuote(managerBrowser.page, {
            guests: 5,
            adults: 2,
            birthday: 1,
            under3: 0,
            discounted: 1,
            adultGame: 1
        }, {
            subtotal: 1320,
            context: 'standard',
            dayType: 'weekday',
            regularChildren: 3,
            adultCompanions: 1
        });
        await managerBrowser.page.locator('#bookingTicketsSection').screenshot({
            path: path.join(MANAGER_ARTIFACT_DIR, '02-standard-weekday-quote.png')
        });
        await submitBookingEditor(managerBrowser.page, BOOKING_ID);
        await assertStoredBookingTime(managerSession.token, changedTime);
        await assertStoredTicketSnapshot(managerSession.token, 1320, {
            regular_child: 3,
            discounted_child: 1,
            birthday_child: 1,
            adult_companion: 1,
            adult_game: 1
        });
        await assertHydratedEditor(managerBrowser.page, {
            guests: 5,
            adults: 2,
            birthday: 1,
            under3: 0,
            discounted: 1,
            adultGame: 1,
            subtotal: 1320
        });
        await assertBookingTimeControls(managerBrowser.page, changedTime);
        await showTicketDetails(
            managerBrowser.page,
            path.join(MANAGER_ARTIFACT_DIR, '03-reopened-ticket-detail.png')
        );
        report.manager = {
            standardWeekdaySubtotal: managerQuote.quote.ticketSubtotal,
            bookingTime: {
                initial: initialTimeControl.value,
                changed: changedTimeControl.value,
                preflight: changedTimeControl.status,
                persisted: true,
                reopened: true
            },
            saved: true,
            reopened: true,
            detail: true
        };

        const seniorBrowser = await openAuthenticatedContext(browser, seniorSession);
        seniorContext = seniorBrowser.context;
        report.diagnostics.seniorManager = seniorBrowser.diagnostics;

        await openBookingEditor(seniorBrowser.page, BOOKING_ID);
        await assertBookingTimeControls(seniorBrowser.page, changedTime);
        const seniorQuote = await fillTicketQuote(seniorBrowser.page, {
            guests: 4,
            adults: 2,
            birthday: 1,
            under3: 1,
            discounted: 1,
            adultGame: 1
        }, {
            subtotal: 795,
            context: 'standard',
            dayType: 'weekday',
            regularChildren: 1,
            adultCompanions: 1
        });
        await seniorBrowser.page.locator('#bookingTicketsSection').screenshot({
            path: path.join(SENIOR_ARTIFACT_DIR, '03-updated-standard-quote.png')
        });
        await submitBookingEditor(seniorBrowser.page, BOOKING_ID);
        await assertStoredTicketSnapshot(seniorSession.token, 795, {
            regular_child: 1,
            under_3_child: 1,
            discounted_child: 1,
            birthday_child: 1,
            adult_companion: 1,
            adult_game: 1
        });
        const summary = await assertSummaryAndPdf(seniorSession.token, 795);
        const reserved = await reservedWeekendPreview(seniorBrowser.page);
        report.seniorManager = {
            updatedStandardSubtotal: seniorQuote.quote.ticketSubtotal,
            bookingTimeReopened: changedTime,
            saved: true,
            summary: summary.summaryOk,
            pdfBytes: summary.pdfBytes,
            pdfMode: summary.pdfMode,
            clientPdfBlocked: summary.clientPdfBlocked,
            reservedWeekendSubtotal: reserved.reservedSubtotal,
            weekendUnder3Blocked: reserved.under3Blocked
        };

        await managerBrowser.page.evaluate(() => {
            AppState.cachedBookings = {};
            AppState.cachedLines = {};
            AppState.lines = [];
            AppState.linesByDate = {};
        });
        await assertHydratedEditor(managerBrowser.page, {
            guests: 4,
            adults: 2,
            birthday: 1,
            under3: 1,
            discounted: 1,
            adultGame: 1,
            subtotal: 795
        });
        await showTicketDetails(
            managerBrowser.page,
            path.join(MANAGER_ARTIFACT_DIR, '04-final-cross-role-detail.png')
        );
        report.manager.crossRoleReopen = true;
        assertNoUnknownBrowserErrors(managerBrowser.diagnostics, 'manager');
        assertNoUnknownBrowserErrors(seniorBrowser.diagnostics, 'senior_manager');
    } finally {
        try {
            report.cleanup = await softDeleteAndVerify(seniorSession.token);
        } finally {
            await managerContext?.close().catch(() => {});
            await seniorContext?.close().catch(() => {});
            await browser?.close().catch(() => {});
        }
        fs.writeFileSync(
            path.join(ARTIFACT_ROOT, 'result.json'),
            `${JSON.stringify(report, null, 2)}\n`,
            'utf8'
        );
    }

    console.log(`Ticket role live QA OK: ${BASE_URL} -> v${report.version}`);
    console.log(`  OK free slot selection: weekday ${BOOKING_DATE} ${BOOKING_TIME}, weekend ${WEEKEND_DATE}`);
    console.log(`  OK ticket tariff matrix: ${report.ticketTariffMatrix.length} scenarios`);
    console.log(`  OK manager standard quote/save/reopen: ${report.manager.standardWeekdaySubtotal} UAH`);
    console.log(`  OK booking time ${BOOKING_TIME} -> ${report.manager.bookingTime.changed}, preflight ${report.manager.bookingTime.preflight}, persisted/reopened`);
    console.log(`  OK senior_manager update/summary/PDF: ${report.seniorManager.updatedStandardSubtotal} UAH`);
    console.log(`  OK reserved weekend preview: ${report.seniorManager.reservedWeekendSubtotal} UAH`);
    console.log('  OK weekend under-3 blocked');
    console.log(`  OK cleanup: ${report.cleanup.mode}, active timeline absent`);
}

main().catch(error => {
    console.error(`Ticket role live QA failed: ${error.message || error}`);
    process.exit(1);
});
