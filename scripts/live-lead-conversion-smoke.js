#!/usr/bin/env node
'use strict';

/**
 * Browser/live smoke for Kanban lead -> booking conversion modes.
 *
 * Default behavior creates a clearly marked disposable lead/customer, opens the
 * conversion drawer for both modes, and stops before saving a booking.
 *
 * Usage:
 *   npm run smoke:lead-conversion -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_TOKEN=<jwt> npm run smoke:lead-conversion
 *   LIVE_SMOKE_USER=codex.qa LIVE_SMOKE_PASS=... LIVE_LEAD_CONVERSION_CONFIRM_WRITE=yes npm run smoke:lead-conversion -- <url>
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUSINESS_CONTEXT = readEnv('LIVE_LEAD_CONVERSION_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_LEAD_CONVERSION_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const HEADLESS = readEnv('LIVE_LEAD_CONVERSION_HEADLESS') !== 'false';
const RUN_ID = `lead-conversion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PREFERRED_DATE = readEnv('LIVE_LEAD_CONVERSION_DATE', 'LIVE_SMOKE_DATE') || futureDate(45);
const EXPLICIT_LEAD_ID = readEnv('LIVE_LEAD_CONVERSION_LEAD_ID', 'LIVE_SMOKE_LEAD_ID');
const CONFIRM_WRITE = isConfirmed(readEnv('LIVE_LEAD_CONVERSION_CONFIRM_WRITE', 'LIVE_SMOKE_CONFIRM_WRITE'));
const SAVE_BOOKINGS = isConfirmed(readEnv('LIVE_LEAD_CONVERSION_SAVE_BOOKINGS'));
const CLEANUP_EXPLICIT = isConfirmed(readEnv('LIVE_LEAD_CONVERSION_CLEANUP'));

const MODES = Object.freeze({
    activity: Object.freeze({
        bookingMode: 'activity',
        timelineView: 'animators',
        eventEnabled: true,
        kitchenEnabled: false
    }),
    kitchen_room: Object.freeze({
        bookingMode: 'kitchen_room',
        timelineView: 'rooms',
        eventEnabled: false,
        kitchenEnabled: true
    })
});

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function isConfirmed(value) {
    return ['1', 'true', 'yes', 'y', 'write'].includes(String(value || '').trim().toLowerCase());
}

function fail(message) {
    console.error(`Live lead conversion smoke failed: ${message}`);
    process.exit(1);
}

function blocked(message) {
    console.log(`Live lead conversion smoke blocked: ${message}`);
    process.exit(0);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function isLocalBase(base) {
    const host = new URL(base).hostname;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${routePath} did not return a JSON object`);
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
    const token = readEnv('LIVE_LEAD_CONVERSION_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_LEAD_CONVERSION_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_LEAD_CONVERSION_PASS', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS');
    if (!username || !password) {
        blocked('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS');
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

function leadHasBooking(lead = {}) {
    return Boolean(lead.bookingId || lead.booking_id || lead.booking);
}

async function readLeadWorkspace(base, token, leadId) {
    const body = await fetchJson(base, scopedPath(`/api/leads/${encodeURIComponent(leadId)}/workspace`), { token });
    if (body.success !== true || !body.workspace?.lead) {
        throw new Error(`/api/leads/${leadId}/workspace did not return { success: true, workspace.lead }`);
    }
    return body.workspace;
}

async function createDisposableLead(base, token) {
    const phoneTail = String(Date.now()).slice(-7);
    const leadName = `QA Codex Lead Conversion ${RUN_ID}`;
    const body = await fetchJson(base, scopedPath('/api/leads'), {
        method: 'POST',
        token,
        body: {
            businessContext: BUSINESS_CONTEXT,
            client_name: leadName,
            phone: `+38050${phoneTail}`,
            source: 'codex_live_smoke',
            event_date: PREFERRED_DATE,
            children_count: 4,
            child_age: '6',
            notes: [
                `QA disposable lead conversion smoke ${RUN_ID}`,
                'Safe policy: do not use for real bookings or customer work.'
            ].join('\n')
        }
    });
    if (body.success !== true || !body.lead?.id) {
        throw new Error('/api/leads did not create a disposable lead');
    }
    return body.lead;
}

async function deleteLead(base, token, leadId) {
    if (!leadId) return;
    await fetchJson(base, scopedPath(`/api/leads/${encodeURIComponent(leadId)}`), {
        method: 'DELETE',
        token
    }).catch(err => console.warn(`cleanup lead ${leadId} failed: ${err.message}`));
}

async function deleteCustomer(base, token, customerId) {
    if (!customerId) return;
    await fetchJson(base, scopedPath(`/api/customers/${encodeURIComponent(customerId)}`), {
        method: 'DELETE',
        token
    }).catch(err => console.warn(`cleanup customer ${customerId} failed: ${err.message}`));
}

async function openAuthenticatedContext(browser, base, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);

    const page = await context.newPage();
    page.setDefaultTimeout(Number(readEnv('LIVE_LEAD_CONVERSION_TIMEOUT_MS') || 25000));
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return { context, page };
}

async function openKanbanForLead(page, base, leadId, leadName) {
    const params = new URLSearchParams({
        view: 'kanban',
        search: leadName,
        businessContext: BUSINESS_CONTEXT
    });
    await page.goto(`${base}/sales-funnel?${params.toString()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => {
        return typeof window.convertLeadToBookingMode === 'function'
            && Boolean(document.querySelector(`.kanban-card[data-id="${CSS.escape(String(id))}"] [data-lead-booking-convert]`));
    }, String(leadId));
}

function assertUrlHandoff(pageUrl, leadId, mode) {
    const url = new URL(pageUrl);
    assert.equal(url.searchParams.get('leadId'), String(leadId), `${mode.bookingMode}: URL keeps leadId`);
    assert.equal(url.searchParams.get('bookingMode'), mode.bookingMode, `${mode.bookingMode}: URL keeps bookingMode`);
    assert.equal(url.searchParams.get('timelineView'), mode.timelineView, `${mode.bookingMode}: URL keeps timelineView`);
    assert.equal(url.searchParams.get('date'), PREFERRED_DATE, `${mode.bookingMode}: URL keeps date`);
    assert.equal(url.searchParams.get('eventDate'), PREFERRED_DATE, `${mode.bookingMode}: URL keeps eventDate`);
}

async function readDrawerState(page) {
    return page.evaluate(() => {
        const panel = document.getElementById('bookingPanel');
        const eventFields = document.getElementById('bookingEventFields');
        const banquetFields = document.getElementById('banquetFields');
        const selectedDate = window.AppState?.selectedDate instanceof Date
            ? window.AppState.selectedDate.toISOString().slice(0, 10)
            : '';
        return {
            panelVisible: Boolean(panel && !panel.classList.contains('hidden')),
            timelineView: window.TimelineView?.current?.() || '',
            selectedDate,
            timelineDateInput: document.getElementById('timelineDate')?.value || '',
            leadConversionContext: window.AppState?.leadConversionContext || null,
            selectedCustomerId: document.getElementById('selectedCustomerId')?.value || '',
            bookingLeadInterestDate: document.getElementById('bookingLeadInterestDate')?.value || '',
            selectedProgram: document.getElementById('selectedProgram')?.value || '',
            bookingLine: document.getElementById('bookingLine')?.value || '',
            room: document.getElementById('roomSelect')?.value || '',
            eventEnabled: typeof getBookingWorkspaceHasEvent === 'function' ? getBookingWorkspaceHasEvent() : null,
            kitchenEnabled: typeof isBookingKitchenEnabled === 'function' ? isBookingKitchenEnabled() : null,
            eventFieldsHidden: Boolean(eventFields?.hidden || eventFields?.classList.contains('hidden')),
            banquetFieldsHidden: Boolean(banquetFields?.hidden || banquetFields?.classList.contains('hidden')),
            kitchenToggleChecked: Boolean(document.getElementById('bookingKitchenToggle')?.checked)
        };
    });
}

function assertDrawerMode(state, leadId, mode) {
    assert.equal(state.panelVisible, true, `${mode.bookingMode}: booking drawer is visible`);
    assert.equal(state.timelineView, mode.timelineView, `${mode.bookingMode}: active timeline view`);
    assert.equal(state.timelineDateInput, PREFERRED_DATE, `${mode.bookingMode}: timeline date input`);
    assert.equal(state.leadConversionContext?.leadId, Number(leadId), `${mode.bookingMode}: AppState lead id`);
    assert.equal(state.leadConversionContext?.eventDate, PREFERRED_DATE, `${mode.bookingMode}: AppState event date`);
    assert.equal(state.leadConversionContext?.bookingMode, mode.bookingMode, `${mode.bookingMode}: AppState booking mode`);
    assert.ok(state.selectedCustomerId, `${mode.bookingMode}: customer context is selected`);
    assert.equal(state.bookingLeadInterestDate, PREFERRED_DATE, `${mode.bookingMode}: lead interest date`);
    assert.equal(state.eventEnabled, mode.eventEnabled, `${mode.bookingMode}: event enabled state`);
    assert.equal(state.kitchenEnabled, mode.kitchenEnabled, `${mode.bookingMode}: kitchen enabled state`);
    assert.equal(state.eventFieldsHidden, !mode.eventEnabled, `${mode.bookingMode}: event fields visibility`);
    assert.equal(state.banquetFieldsHidden, !mode.kitchenEnabled, `${mode.bookingMode}: kitchen/menu fields visibility`);
    assert.equal(state.kitchenToggleChecked, mode.kitchenEnabled, `${mode.bookingMode}: kitchen toggle state`);
    if (mode.bookingMode === 'activity') {
        assert.notEqual(state.bookingLine, 'banquet-service', 'activity: drawer is not on banquet-service line');
    }
    if (mode.bookingMode === 'kitchen_room') {
        assert.equal(state.bookingLine, 'banquet-service', 'kitchen_room: drawer uses banquet-service line');
        assert.ok(state.room, 'kitchen_room: room is preselected');
    }
}

async function runModeSmoke(browser, base, session, lead, modeKey) {
    const mode = MODES[modeKey];
    const bookingPostRequests = [];
    const serverErrors = [];
    let context;
    let page;
    try {
        ({ context, page } = await openAuthenticatedContext(browser, base, session));
        page.on('request', request => {
            if (request.method() !== 'POST') return;
            const pathname = new URL(request.url()).pathname;
            if (pathname === '/api/bookings' || pathname === '/api/bookings/full' || pathname.includes('/member-booking')) {
                bookingPostRequests.push(`${request.method()} ${pathname}`);
            }
        });
        page.on('response', response => {
            const pathname = new URL(response.url()).pathname;
            if (response.status() >= 500 && (pathname.startsWith('/api/leads') || pathname.startsWith('/api/bookings'))) {
                serverErrors.push(`${response.request().method()} ${pathname} ${response.status()}`);
            }
        });

        await openKanbanForLead(page, base, lead.id, lead.client_name || lead.clientName || String(lead.id));
        await page.locator(`[data-lead-booking-convert][data-lead-id="${lead.id}"]`).click();
        await page.locator(`.lead-booking-conversion-item[data-lead-id="${lead.id}"][data-booking-mode="${mode.bookingMode}"]`).click();
        await page.waitForURL(url => {
            const parsed = new URL(String(url));
            return parsed.searchParams.get('leadId') === String(lead.id)
                && parsed.searchParams.get('bookingMode') === mode.bookingMode
                && parsed.searchParams.get('timelineView') === mode.timelineView;
        });
        await page.waitForSelector('#bookingPanel:not(.hidden)');
        await page.waitForFunction(expectedMode => {
            return window.AppState?.leadConversionContext?.bookingMode === expectedMode
                && document.getElementById('bookingPanel')
                && !document.getElementById('bookingPanel').classList.contains('hidden');
        }, mode.bookingMode);

        assertUrlHandoff(page.url(), lead.id, mode);
        const state = await readDrawerState(page);
        assertDrawerMode(state, lead.id, mode);
        assert.deepEqual(bookingPostRequests, [], `${mode.bookingMode}: no booking was saved before submit`);
        assert.deepEqual(serverErrors, [], `${mode.bookingMode}: no lead/booking 500 responses`);
        return {
            mode: mode.bookingMode,
            timelineView: state.timelineView,
            selectedCustomerId: state.selectedCustomerId
        };
    } finally {
        await page?.close().catch(() => {});
        await context?.close().catch(() => {});
    }
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or LIVE_LEAD_CONVERSION_URL/LIVE_SMOKE_URL/TEST_URL');
    if (SAVE_BOOKINGS) {
        blocked('booking save mode is intentionally disabled until a production-safe booking cleanup policy is approved');
    }

    const base = normalizeBase(TARGET_URL);
    const local = isLocalBase(base);
    if (!local && !CONFIRM_WRITE) {
        blocked(`set LIVE_LEAD_CONVERSION_CONFIRM_WRITE=yes before running lead conversion writes on ${base}`);
    }
    if (!local && CLEANUP_EXPLICIT && !CONFIRM_WRITE) {
        blocked('non-local cleanup requires LIVE_LEAD_CONVERSION_CONFIRM_WRITE=yes and LIVE_LEAD_CONVERSION_CLEANUP=yes');
    }

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node scripts/live-lead-conversion-smoke.js');
    }

    const cleanup = local ? readEnv('LIVE_LEAD_CONVERSION_CLEANUP') !== 'false' : CLEANUP_EXPLICIT;
    const session = await login(base);
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let createdLead = false;
    let lead = null;
    let createdCustomerId = '';
    try {
        if (EXPLICIT_LEAD_ID) {
            const workspace = await readLeadWorkspace(base, session.token, EXPLICIT_LEAD_ID);
            lead = workspace.lead;
            if (leadHasBooking(lead)) {
                throw new Error(`lead ${EXPLICIT_LEAD_ID} already has booking_id; use an unlinked disposable lead`);
            }
        } else {
            lead = await createDisposableLead(base, session.token);
            createdLead = true;
        }

        const before = await readLeadWorkspace(base, session.token, lead.id);
        assert.equal(leadHasBooking(before.lead), false, 'lead has no booking before smoke');

        const results = [];
        for (const modeKey of Object.keys(MODES)) {
            const result = await runModeSmoke(browser, base, session, lead, modeKey);
            results.push(result);
            if (result.selectedCustomerId) createdCustomerId = result.selectedCustomerId;
            const afterMode = await readLeadWorkspace(base, session.token, lead.id);
            assert.equal(leadHasBooking(afterMode.lead), false, `${modeKey}: lead has no booking after drawer open`);
        }

        console.log(`Live lead conversion smoke OK: ${base}`);
        console.log(`  OK lead: ${lead.id} (${createdLead ? 'created disposable' : 'provided disposable'})`);
        console.log(`  OK preferred date: ${PREFERRED_DATE}`);
        for (const result of results) {
            console.log(`  OK ${result.mode}: timelineView=${result.timelineView}, customer=${result.selectedCustomerId || '-'}, no booking saved`);
        }
        console.log(`  OK businessContext: ${BUSINESS_CONTEXT}`);
        if (!cleanup && createdLead) {
            console.log('  NOTE disposable lead/customer were left in place by policy; set LIVE_LEAD_CONVERSION_CLEANUP=yes for an explicitly approved cleanup run');
        }
    } finally {
        await browser.close().catch(() => {});
        if (cleanup) {
            if (createdCustomerId) await deleteCustomer(base, session.token, createdCustomerId);
            if (createdLead && lead?.id) await deleteLead(base, session.token, lead.id);
        }
    }
}

run().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
