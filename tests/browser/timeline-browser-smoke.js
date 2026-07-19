#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BUSINESS_CONTEXT = process.env.TIMELINE_BROWSER_SMOKE_BUSINESS_CONTEXT || 'event_genix';
const DEFAULT_ROOM = process.env.TIMELINE_BROWSER_SMOKE_ROOM || 'Растішка';
const RUN_ID = `task37-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'timeline-browser-smoke', RUN_ID);
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || process.env.TIMELINE_BROWSER_SMOKE_URL
    || process.env.TEST_URL
    || process.env.LIVE_SMOKE_URL;
const HEADLESS = process.env.TIMELINE_BROWSER_SMOKE_HEADLESS !== 'false';
const CLEANUP = process.env.TIMELINE_BROWSER_SMOKE_CLEANUP !== 'false';
const ALLOW_NON_LOCAL = process.env.TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION === 'true';
const BOOKING_TIME_ONLY = process.env.TIMELINE_BROWSER_SMOKE_BOOKING_TIME_ONLY === 'true';
const TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX = 4;
const QA_CLEANUP_SOURCE = 'timeline_browser_smoke';
const QA_CLEANUP_CONFIRMATION = 'CANCEL_DISPOSABLE_QA_BANQUET';
const TEST_CUSTOMER_MARKER = `${QA_CLEANUP_SOURCE}:${RUN_ID}:test_customer`;

function fail(message) {
    console.error(`Timeline browser smoke failed: ${message}`);
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
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function isNavigationContextError(error) {
    return /execution context was destroyed|cannot find context with specified id|navigation|frame was detached/i
        .test(String(error?.message || error || ''));
}

function diagnosticFileLabel(label) {
    return String(label || 'failure')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'failure';
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
    return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function futureDate(days = 35) {
    const date = new Date();
    date.setDate(date.getDate() + days);
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

function scopedPath(path, params = {}) {
    const url = new URL(path, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    }
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}`;
}

function disposableQaMarker(kind = 'booking') {
    return {
        schemaVersion: 1,
        runId: RUN_ID,
        source: QA_CLEANUP_SOURCE,
        cleanupExpected: true,
        testCustomerMarker: TEST_CUSTOMER_MARKER,
        kind,
        createdAt: new Date().toISOString()
    };
}

function attachDisposableQaMarker(booking, kind = 'booking') {
    if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return booking;
    const extra = booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)
        ? { ...booking.extraData }
        : (booking.extra_data && typeof booking.extra_data === 'object' && !Array.isArray(booking.extra_data) ? { ...booking.extra_data } : {});
    extra.disposableQa = disposableQaMarker(kind);
    booking.extraData = extra;
    delete booking.extra_data;
    return booking;
}

function markCreateRequestPayload(payload, pathname = '') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    const cloned = JSON.parse(JSON.stringify(payload));
    const markNested = (key, kind) => {
        if (cloned[key] && typeof cloned[key] === 'object' && !Array.isArray(cloned[key])) {
            attachDisposableQaMarker(cloned[key], kind);
        }
    };
    markNested('main', 'booking_full_main');
    markNested('booking', 'banquet_member');
    markNested('memberBooking', 'banquet_member');
    markNested('member_booking', 'banquet_member');
    markNested('activityBooking', 'banquet_activity');
    markNested('activity_booking', 'banquet_activity');
    if (Array.isArray(cloned.linked)) cloned.linked.forEach(item => attachDisposableQaMarker(item, 'linked_booking'));
    if (Array.isArray(cloned.activities)) cloned.activities.forEach(item => attachDisposableQaMarker(item, 'activity_booking'));
    if (!cloned.main
        && !cloned.booking
        && !cloned.memberBooking
        && !cloned.member_booking
        && !cloned.activityBooking
        && !cloned.activity_booking
        && /^\/api\/bookings(?:\/full)?$/i.test(pathname)) {
        attachDisposableQaMarker(cloned, 'booking');
    }
    return cloned;
}

function isBookingCreateEndpoint(pathname) {
    return [
        '/api/bookings',
        '/api/bookings/full',
        '/api/banquets/from-source/member-booking',
        '/api/banquets/from-source/activity-booking'
    ].includes(pathname)
        || /^\/api\/banquets\/[^/]+\/(?:member-booking|activity-booking)$/i.test(pathname);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
    return /\breturned 429\b/.test(String(error?.message || error || ''));
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchJson(base, path, options = {}) {
    const res = await fetch(`${base}${path}`, {
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
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${res.status}`;
        throw new Error(`${path} returned ${res.status}: ${detail}`);
    }
    return body;
}

async function fetchJsonWithRetry(base, path, options = {}, retryOptions = {}) {
    const attempts = Number(retryOptions.attempts || 5);
    const delayMs = Number(retryOptions.delayMs || 15000);
    const label = retryOptions.label || path;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await fetchJson(base, path, options);
        } catch (error) {
            lastError = error;
            if (!isRateLimitError(error) || attempt >= attempts) break;
            console.warn(`${label}: rate limited during cleanup, retry ${attempt + 1}/${attempts}`);
            await sleep(delayMs);
        }
    }
    throw lastError;
}

async function login(base) {
    const envToken = process.env.TIMELINE_BROWSER_SMOKE_TOKEN || process.env.LIVE_SMOKE_TOKEN;
    if (envToken) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: envToken });
        return { token: envToken, user: verified.user || verified };
    }
    const username = process.env.TIMELINE_BROWSER_SMOKE_USER || process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = process.env.TIMELINE_BROWSER_SMOKE_PASS || process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) {
        fail('set TIMELINE_BROWSER_SMOKE_TOKEN or TIMELINE_BROWSER_SMOKE_USER/TIMELINE_BROWSER_SMOKE_PASS');
    }
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    if (!token) throw new Error('/api/auth/login did not return access token');
    return { token, refreshToken: body.refreshToken || '', refreshExpiresAt: body.refreshExpiresAt || '', user: body.user };
}

async function createCustomer(base, token, label) {
    return fetchJson(base, scopedPath('/api/customers'), {
        method: 'POST',
        token,
        body: {
            businessContext: BUSINESS_CONTEXT,
            name: `Task37 ${label} ${RUN_ID}`,
            phone: `+38099${String(Date.now()).slice(-7)}`,
            childName: `Child ${label}`,
            source: 'other',
            notes: `timeline browser smoke ${RUN_ID}; ${TEST_CUSTOMER_MARKER}`
        }
    });
}

async function loadLines(base, token, date, timelineView) {
    const rows = await fetchJson(base, scopedPath(`/api/lines/${encodeURIComponent(date)}`, { timelineView }), { token });
    assert.ok(Array.isArray(rows), `/api/lines/${date} returns array`);
    return rows;
}

async function firstAnimatorLine(base, token, date) {
    const lines = await loadLines(base, token, date, 'animators');
    const line = lines.find(item => String(item.id || '') !== 'afisha' && String(item.id || '') !== 'banquet-service');
    assert.ok(line, 'animator line exists for browser smoke');
    return line;
}

function smokeTimeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
}

function smokeBookingOverlaps(booking, startTime, duration) {
    const bookingStart = smokeTimeToMinutes(booking?.time);
    const candidateStart = smokeTimeToMinutes(startTime);
    if (bookingStart === null || candidateStart === null) return false;
    const bookingEnd = bookingStart + Math.max(1, Number(booking?.duration || 0) || 1);
    const candidateEnd = candidateStart + Math.max(1, Number(duration || 0) || 1);
    return bookingStart < candidateEnd && bookingEnd > candidateStart;
}

async function findBookingTimeSmokeSlot(base, token, room) {
    const startDate = futureDate(1);
    for (let offset = 0; offset < 45; offset += 1) {
        const date = datePlus(startDate, offset);
        const lines = await loadLines(base, token, date, 'animators');
        const candidates = lines.filter(item => {
            const id = String(item?.id || '');
            return id
                && !['afisha', 'banquet-service'].includes(id)
                && !id.startsWith('empty-roster-')
                && item.assignmentAllowed !== false
                && item.isUnavailable !== true;
        });
        if (!candidates.length) continue;

        const bookings = await fetchJson(
            base,
            scopedPath(`/api/bookings/${encodeURIComponent(date)}`, { timelineView: 'animators' }),
            { token }
        );
        const rows = Array.isArray(bookings) ? bookings : [];
        const normalizedRoom = String(room || '').trim().toLowerCase();
        const candidate = candidates.find(line => !rows.some(booking => {
            if (String(booking?.status || '').toLowerCase() === 'cancelled') return false;
            if (!smokeBookingOverlaps(booking, '12:30', 60)) return false;
            const sameLine = [booking?.lineId, booking?.line_id, booking?.resourceId, booking?.resource_id]
                .some(value => String(value || '') === String(line.id));
            const sameRoom = normalizedRoom
                && String(booking?.room || '').trim().toLowerCase() === normalizedRoom;
            return sameLine || sameRoom;
        }));
        if (candidate) return { date, line: candidate };
    }
    throw new Error('no visible free animator line found for the 12:15 -> 12:30 booking time smoke');
}

function bookingPayload(base = {}) {
    const payload = {
        businessContext: BUSINESS_CONTEXT,
        status: 'confirmed',
        duration: 60,
        price: 0,
        category: 'animation',
        programCode: 'TASK37',
        label: `Task37 ${RUN_ID}`,
        notes: `timeline browser smoke ${RUN_ID}`,
        ...base
    };
    return attachDisposableQaMarker(payload, 'api_booking');
}

function kitchenPackage(servingTime = '14:00') {
    return {
        schemaVersion: 2,
        source: 'timeline_browser_smoke',
        menuPositions: [{
            productId: `task37-menu-${RUN_ID}`,
            title: 'Task37 menu',
            quantity: 1,
            unitPrice: 100,
            subtotal: 100,
            kitchenType: 'menu',
            servingUnit: 'portion',
            servingTime
        }],
        serviceEvents: [{
            type: 'room_setup',
            title: 'Task37 setup',
            time: servingTime
        }],
        programBasePrice: 0,
        positionsSubtotal: 100,
        finalTotal: 100
    };
}

async function createBooking(base, token, body) {
    const result = await fetchJson(base, scopedPath('/api/bookings'), { method: 'POST', token, body });
    assert.equal(result.success, true, 'booking create success');
    assert.ok(result.booking?.id, 'booking create returns booking id');
    return result.booking;
}

async function deleteBooking(base, token, bookingId) {
    if (!bookingId) return;
    await fetchJsonWithRetry(
        base,
        scopedPath(`/api/bookings/${encodeURIComponent(bookingId)}`),
        { method: 'DELETE', token },
        { label: `cleanup booking ${bookingId}` }
    ).catch(err => console.warn(`cleanup booking ${bookingId} failed: ${err.message}`));
}

async function deleteCustomer(base, token, customerId) {
    if (!customerId) return;
    await fetchJsonWithRetry(
        base,
        scopedPath(`/api/customers/${encodeURIComponent(customerId)}`),
        { method: 'DELETE', token },
        { label: `cleanup customer ${customerId}` }
    ).catch(err => console.warn(`cleanup customer ${customerId} failed: ${err.message}`));
}

function parseJsonFromStdout(stdout) {
    const text = String(stdout || '').trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
        throw new Error(`operator script did not return JSON: ${text.slice(0, 500)}`);
    }
}

function runQaCleanupOperator(args) {
    const script = path.join(ROOT, 'scripts', 'banquet-production-recovery.js');
    const result = spawnSync(process.execPath, [script, 'qa-cleanup', ...args], {
        cwd: ROOT,
        env: process.env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: Number(process.env.TIMELINE_BROWSER_SMOKE_CLEANUP_TIMEOUT_MS || 45000)
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`qa cleanup operator failed (${result.status}): ${String(result.stderr || result.stdout || '').trim()}`);
    }
    return parseJsonFromStdout(result.stdout);
}

async function discoverBanquetCleanupTargets(base, token, bookingIds, knownTargets = []) {
    const byGroupId = new Map();
    for (const target of knownTargets) {
        const group = String(target?.groupId || '').trim();
        if (!group) continue;
        byGroupId.set(group, {
            groupId: group,
            primaryBookingId: String(target.primaryBookingId || '').trim() || null,
            bookingIds: new Set((target.bookingIds || []).map(String).filter(Boolean))
        });
    }
    for (const bookingId of bookingIds.filter(Boolean)) {
        const snapshot = await banquetSnapshot(base, token, bookingId).catch(() => null);
        const group = groupId(snapshot);
        if (!group) continue;
        const current = byGroupId.get(group) || {
            groupId: group,
            primaryBookingId: String(snapshot?.bookings?.primary?.id || snapshot?.group?.primaryBookingId || '').trim() || null,
            bookingIds: new Set()
        };
        current.primaryBookingId = current.primaryBookingId
            || String(snapshot?.bookings?.primary?.id || snapshot?.group?.primaryBookingId || '').trim()
            || null;
        current.bookingIds.add(String(bookingId));
        for (const member of snapshot?.members || []) {
            if (member?.bookingId) current.bookingIds.add(String(member.bookingId));
        }
        byGroupId.set(group, current);
    }
    return [...byGroupId.values()].map(target => ({
        ...target,
        bookingIds: [...target.bookingIds]
    }));
}

function assertQaCleanupDryRunReady(report, groupId) {
    assert.equal(report?.mode, 'qa-cleanup-group-dry-run', `qa cleanup dry-run mode for group ${groupId}`);
    const group = report.groups?.[0];
    assert.equal(group?.groupId, groupId, `qa cleanup dry-run returns group ${groupId}`);
    assert.ok(['ready', 'already_cancelled'].includes(group?.status), `qa cleanup dry-run safe for ${groupId}: ${group?.reason || group?.status}`);
}

function assertQaCleanupApplyVerified(report, groupId) {
    assert.equal(report?.mode, 'qa-cleanup-apply', `qa cleanup apply mode for group ${groupId}`);
    const after = report.after?.[0];
    assert.equal(after?.groupId, groupId, `qa cleanup apply returns group ${groupId}`);
    assert.equal(after?.status, 'already_cancelled', `qa cleanup apply verifies cancelled group ${groupId}: ${after?.reason || after?.status}`);
}

async function verifyBookingsNotActiveInTimeline(base, token, date, bookingIds, timelineViews = ['rooms', 'animators']) {
    const leaked = [];
    for (const timelineView of timelineViews) {
        const rows = await fetchJsonWithRetry(
            base,
            scopedPath(`/api/bookings/${encodeURIComponent(date)}`, { timelineView }),
            { token },
            { label: `cleanup verify ${timelineView} timeline ${date}` }
        );
        const activeIds = new Set((Array.isArray(rows) ? rows : []).map(item => String(item.id)));
        leaked.push(...bookingIds.map(String).filter(id => activeIds.has(id)).map(id => `${timelineView}:${id}`));
    }
    assert.deepEqual(leaked, [], `cleanup leaves no active bookings in timeline API for ${date}`);
}

async function cleanupBanquetGroups(base, token, bookingIds, knownTargets = [], date = '') {
    const targets = await discoverBanquetCleanupTargets(base, token, bookingIds, knownTargets);
    for (const target of targets) {
        const args = [
            `--run-id=${RUN_ID}`,
            `--group-id=${target.groupId}`,
            `--test-customer-marker=${TEST_CUSTOMER_MARKER}`,
            `--business-context=${BUSINESS_CONTEXT}`,
            '--json'
        ];
        if (target.primaryBookingId) args.push(`--primary-booking-id=${target.primaryBookingId}`);
        const dryRun = runQaCleanupOperator(args);
        assertQaCleanupDryRunReady(dryRun, target.groupId);
        const apply = runQaCleanupOperator([
            ...args,
            '--apply',
            `--confirm=${QA_CLEANUP_CONFIRMATION}`
        ]);
        assertQaCleanupApplyVerified(apply, target.groupId);
        if (date && target.bookingIds.length) {
            await verifyBookingsNotActiveInTimeline(base, token, date, target.bookingIds);
        }
    }
    return targets;
}

async function banquetSnapshot(base, token, bookingId) {
    return fetchJson(base, scopedPath(`/api/banquets/by-booking/${encodeURIComponent(bookingId)}`), { token });
}

function groupId(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    return String(snapshot.groupId || snapshot.group?.id || '').trim();
}

async function collectTimelineDiagnostics(page, label, error = null) {
    if (!page || page.isClosed()) {
        return {
            label,
            pageClosed: true,
            error: error?.message || String(error || '')
        };
    }
    const viewport = page.viewportSize();
    const browserState = await page.evaluate(async currentLabel => {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const selector = document.querySelector('[data-timeline-type-selector]');
        const selectorRect = selector?.getBoundingClientRect?.();
        const selectorStyle = selector ? getComputedStyle(selector) : null;
        const selectorParent = selector?.closest('.timeline-visible-type-switch');
        const selectorParentRect = selectorParent?.getBoundingClientRect?.();
        const selectorParentStyle = selectorParent ? getComputedStyle(selectorParent) : null;
        const panel = document.getElementById('timelineViewPanel');
        const panelRect = panel?.getBoundingClientRect?.();
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const toggle = document.getElementById('timelineViewPanelToggle');
        const toggleRect = toggle?.getBoundingClientRect?.();
        const badge = document.getElementById('timelineViewPanelBadge') || toggle?.querySelector?.('[data-filter-badge]');
        const badgeRect = badge?.getBoundingClientRect?.();
        const badgeStyle = badge ? getComputedStyle(badge) : null;
        const container = document.querySelector('.timeline-container');
        const containerRect = container?.getBoundingClientRect?.();
        const state = typeof window.TimelineView?.state === 'function' ? window.TimelineView.state() : null;
        let serviceWorkerRegistrations = [];
        try {
            serviceWorkerRegistrations = navigator.serviceWorker?.getRegistrations
                ? (await navigator.serviceWorker.getRegistrations()).map(reg => ({
                    scope: reg.scope,
                    active: reg.active?.scriptURL || null,
                    waiting: reg.waiting?.scriptURL || null,
                    installing: reg.installing?.scriptURL || null
                }))
                : [];
        } catch (serviceWorkerError) {
            serviceWorkerRegistrations = [{ error: serviceWorkerError?.message || String(serviceWorkerError) }];
        }
        const plainRect = rect => rect ? {
            left: Math.round(rect.left * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            bottom: Math.round(rect.bottom * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100
        } : null;
        const visibleFrom = (node, rect, style) => Boolean(
            node
            && rect
            && rect.width > 0
            && rect.height > 0
            && style?.display !== 'none'
            && style?.visibility !== 'hidden'
            && Number(style?.opacity || 1) > 0
            && rect.right >= -1
            && rect.left <= viewportWidth + 1
        );
        const elementLabel = el => {
            if (!el) return '';
            const id = el.id ? `#${el.id}` : '';
            const classes = String(el.className || '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 4)
                .map(name => `.${name}`)
                .join('');
            return `${el.tagName?.toLowerCase?.() || 'node'}${id}${classes}`;
        };
        const isControlledOffCanvasSidebar = (el, rect) => {
            const sidebar = el?.closest?.('#sidebarNav');
            if (!sidebar) return false;
            const sidebarRect = sidebar.getBoundingClientRect?.();
            const sidebarStyle = getComputedStyle(sidebar);
            const documentFitsViewport = document.documentElement.scrollWidth <= viewportWidth + 1;
            const sidebarRailWidth = Math.max(48, Math.min(72, viewportWidth * 0.1));
            return Boolean(
                sidebarRect
                && sidebarRect.width > 0
                && sidebarRect.right <= sidebarRailWidth
                && sidebarRect.left < -1
                && documentFitsViewport
                && ['fixed', 'absolute', 'sticky'].includes(sidebarStyle.position)
            );
        };
        const overflowElements = Array.from(document.body?.querySelectorAll('*') || [])
            .map(el => {
                const rect = el.getBoundingClientRect?.();
                const style = getComputedStyle(el);
                if (!rect || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null;
                const overflowRight = Math.round((rect.right - viewportWidth) * 100) / 100;
                const overflowLeft = Math.round((0 - rect.left) * 100) / 100;
                if (overflowRight <= 1 && overflowLeft <= 1) return null;
                return {
                    selector: elementLabel(el),
                    rect: plainRect(rect),
                    overflowRight,
                    overflowLeft,
                    controlledTimelineScroll: Boolean(el.closest('.timeline-scroll')),
                    controlledOffCanvasSidebar: isControlledOffCanvasSidebar(el, rect),
                    position: style.position,
                    overflow: style.overflow
                };
            })
            .filter(Boolean)
            .sort((a, b) => Math.max(b.overflowRight, b.overflowLeft) - Math.max(a.overflowRight, a.overflowLeft))
        const uncontrolledOverflowElements = overflowElements
            .filter(item => !item.controlledTimelineScroll && !item.controlledOffCanvasSidebar)
            .slice(0, 10);
        const controlledOverflowElements = overflowElements
            .filter(item => item.controlledTimelineScroll)
            .slice(0, 10);
        const controlledOffCanvasSidebarElements = overflowElements
            .filter(item => item.controlledOffCanvasSidebar)
            .slice(0, 10);
        return {
            label: currentLabel,
            url: window.location.href,
            readyState: document.readyState,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio
            },
            compact: {
                appState: Boolean(window.AppState?.compactMode),
                storage: localStorage.getItem('pzp_compact_mode'),
                htmlClass: document.documentElement.classList.contains('timeline-compact-mode'),
                bodyClass: document.body?.classList?.contains('timeline-compact-mode') || false,
                containerClass: container?.classList?.contains('compact') || false,
                density: document.documentElement.style.getPropertyValue('--timeline-density'),
                fitScreen: container?.dataset?.fitScreen || ''
            },
            serviceWorker: {
                controller: navigator.serviceWorker?.controller?.scriptURL || null,
                registrations: serviceWorkerRegistrations
            },
            timeline: {
                mainAppVisible: Boolean(document.getElementById('mainApp') && !document.getElementById('mainApp').classList.contains('hidden')),
                appStateExists: Boolean(window.AppState),
                timelineViewExists: Boolean(window.TimelineView),
                timelineViewCurrent: typeof window.TimelineView?.current === 'function' ? window.TimelineView.current() : null,
                timelineViewState: state,
                selectedDate: document.getElementById('timelineDate')?.value || '',
                renderTimelineType: typeof window.renderTimeline,
                openBookingPanelType: typeof window.openBookingPanel,
                containerExists: Boolean(container),
                containerRect: plainRect(containerRect),
                gridCellCount: document.querySelectorAll('.grid-cell[data-time][data-line]').length,
                bookingBlockCount: document.querySelectorAll('.booking-block').length,
                lineCount: document.querySelectorAll('.timeline-line, .line-row, .line-grid').length
            },
            typeSwitch: {
                exists: Boolean(selector),
                visible: visibleFrom(selector, selectorRect, selectorStyle),
                inViewPanel: Boolean(selector?.closest('#timelineViewPanel')),
                inUtilityRow: Boolean(selector?.closest('.schedule-command-row--utility')),
                rect: plainRect(selectorRect),
                parentRect: plainRect(selectorParentRect),
                computed: selectorStyle ? {
                    display: selectorStyle.display,
                    visibility: selectorStyle.visibility,
                    opacity: selectorStyle.opacity,
                    position: selectorStyle.position,
                    pointerEvents: selectorStyle.pointerEvents,
                    overflow: selectorStyle.overflow,
                    transform: selectorStyle.transform
                } : null,
                parentComputed: selectorParentStyle ? {
                    display: selectorParentStyle.display,
                    visibility: selectorParentStyle.visibility,
                    opacity: selectorParentStyle.opacity,
                    overflow: selectorParentStyle.overflow,
                    flexBasis: selectorParentStyle.flexBasis
                } : null,
                labels: Array.from(selector?.querySelectorAll('[data-timeline-view]') || [])
                    .map(btn => ({
                        view: btn.dataset.timelineView || '',
                        text: btn.textContent.trim(),
                        pressed: btn.getAttribute('aria-pressed') || '',
                        active: btn.classList.contains('active'),
                        hidden: Boolean(btn.hidden)
                    })),
                html: selector?.outerHTML?.slice(0, 1200) || ''
            },
            viewPanel: {
                exists: Boolean(panel),
                hidden: Boolean(panel?.hidden),
                rect: plainRect(panelRect),
                computed: panelStyle ? {
                    display: panelStyle.display,
                    visibility: panelStyle.visibility,
                    position: panelStyle.position,
                    overflow: panelStyle.overflow
                } : null,
                toggleExists: Boolean(toggle),
                toggleExpanded: toggle?.getAttribute('aria-expanded') || '',
                toggleRect: plainRect(toggleRect),
                badge: {
                    exists: Boolean(badge),
                    text: badge?.textContent.trim() || '',
                    count: badge?.dataset?.count || '',
                    rect: plainRect(badgeRect),
                    computed: badgeStyle ? {
                        display: badgeStyle.display,
                        visibility: badgeStyle.visibility,
                        opacity: badgeStyle.opacity,
                        transform: badgeStyle.transform
                    } : null
                }
            },
            overflow: {
                bodyX: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
                documentScrollWidth: document.documentElement.scrollWidth,
                documentClientWidth: document.documentElement.clientWidth,
                bodyScrollWidth: document.body?.scrollWidth || 0,
                bodyClientWidth: document.body?.clientWidth || 0,
                offenders: overflowElements.slice(0, 10),
                uncontrolledOffenders: uncontrolledOverflowElements,
                controlledTimelineScrollOffenders: controlledOverflowElements,
                controlledOffCanvasSidebarOffenders: controlledOffCanvasSidebarElements
            }
        };
    }, label);
    return {
        ...browserState,
        playwrightViewport: viewport,
        error: error?.message || String(error || '')
    };
}

async function writeTimelineFailureDiagnostic(page, label, error = null) {
    const fileLabel = diagnosticFileLabel(label);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const jsonPath = path.join(OUTPUT_DIR, `${fileLabel}.json`);
    const pngPath = path.join(OUTPUT_DIR, `${fileLabel}.png`);
    const diagnostics = await collectTimelineDiagnostics(page, label, error).catch(diagnosticError => ({
        label,
        diagnosticError: diagnosticError?.message || String(diagnosticError),
        error: error?.message || String(error || '')
    }));
    fs.writeFileSync(jsonPath, `${JSON.stringify(diagnostics, null, 2)}\n`);
    if (page && !page.isClosed()) {
        await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
    }
    return { jsonPath, pngPath, diagnostics };
}

async function waitForTimelineReady(page, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForFunction(() => {
                const appVisible = document.getElementById('mainApp')
                    && !document.getElementById('mainApp').classList.contains('hidden');
                const selector = document.querySelector('[data-timeline-type-selector]');
                const panel = document.getElementById('timelineViewPanel');
                const toggle = document.getElementById('timelineViewPanelToggle');
                const timelineContainer = document.querySelector('.timeline-container');
                return Boolean(
                    appVisible
                    && window.AppState
                    && window.TimelineView
                    && typeof window.TimelineView.current === 'function'
                    && typeof renderTimeline === 'function'
                    && typeof openBookingPanel === 'function'
                    && document.getElementById('timelineDate')
                    && selector
                    && panel
                    && toggle
                    && timelineContainer
                );
            });
            return;
        } catch (error) {
            lastError = error;
            if (!isNavigationContextError(error) && attempt >= 2) break;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(250);
        }
    }
    const diagnostics = await collectTimelineDiagnostics(page, label, lastError).catch(() => null);
    throw new Error(`${label}: timeline readiness did not stabilize: ${lastError?.message || lastError}; diagnostics=${JSON.stringify(diagnostics)}`);
}

async function waitForTimelineTypeSwitch(page, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await waitForTimelineReady(page, `${label}: readiness`);
            await page.waitForFunction(() => {
                const selector = document.querySelector('[data-timeline-type-selector]');
                const rect = selector?.getBoundingClientRect?.();
                const style = selector ? getComputedStyle(selector) : null;
                return Boolean(
                    selector
                    && rect
                    && rect.width > 0
                    && rect.height > 0
                    && style?.display !== 'none'
                    && style?.visibility !== 'hidden'
                    && Number(style?.opacity || 1) > 0
                );
            });
            return collectTimelineDiagnostics(page, label);
        } catch (error) {
            lastError = error;
            if (!isNavigationContextError(error) && attempt >= 2) break;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(250);
        }
    }
    const diagnostics = await collectTimelineDiagnostics(page, label, lastError).catch(() => null);
    throw new Error(`${label}: timeline type switch is not visible after readiness wait: ${lastError?.message || lastError}; diagnostics=${JSON.stringify(diagnostics)}`);
}

async function waitForTimelineLayoutSettle(page, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await waitForTimelineReady(page, `${label}: readiness`);
            await page.evaluate(() => new Promise(resolve => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));
            await page.waitForFunction(tolerance => {
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const documentOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
                const shellOverflowX = Array.from(document.querySelectorAll('.header, #main-content, .main-content'))
                    .map(el => {
                        const rect = el.getBoundingClientRect?.();
                        const style = getComputedStyle(el);
                        if (!rect || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return 0;
                        return Math.max(0, rect.right - viewportWidth);
                    })
                    .reduce((max, value) => Math.max(max, Math.round(value * 100) / 100), 0);
                return documentOverflowX <= tolerance && shellOverflowX <= tolerance;
            }, TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX, { timeout: 5000 });
            return;
        } catch (error) {
            lastError = error;
            if (!isNavigationContextError(error) && attempt >= 2) break;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(250);
        }
    }
    const diagnostics = await collectTimelineDiagnostics(page, label, lastError).catch(() => null);
    throw new Error(`${label}: timeline layout did not settle: ${lastError?.message || lastError}; diagnostics=${JSON.stringify(diagnostics)}`);
}

async function openAuthenticatedPage(browser, base, session) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        serviceWorkers: 'block'
    });
    await context.route('**/api/**', async route => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }
        const pathname = new URL(request.url()).pathname;
        if (!isBookingCreateEndpoint(pathname)) {
            await route.continue();
            return;
        }
        let payload;
        try {
            payload = request.postDataJSON();
        } catch {
            await route.continue();
            return;
        }
        const markedPayload = markCreateRequestPayload(payload, pathname);
        await route.continue({
            headers: {
                ...request.headers(),
                'content-type': 'application/json'
            },
            postData: JSON.stringify(markedPayload)
        });
    });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.TIMELINE_BROWSER_SMOKE_TIMEOUT_MS || 20000));
    await page.goto(`${base}/?businessContext=${encodeURIComponent(BUSINESS_CONTEXT)}`, { waitUntil: 'domcontentloaded' });
    await waitForTimelineReady(page, 'initial authenticated timeline load');
    return { context, page };
}

async function renderTimelineView(page, date, view) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await waitForTimelineReady(page, `before render timeline ${view} ${date}`);
            await page.evaluate(async ({ date, view }) => {
                AppState.selectedDate = new Date(`${date}T00:00:00`);
                const input = document.getElementById('timelineDate');
                if (input) input.value = date;
                if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(date);
                if (window.TimelineView?.set) await window.TimelineView.set(view, { render: false });
                if (typeof renderTimeline === 'function') await renderTimeline();
            }, { date, view });
            await waitForTimelineReady(page, `after render timeline ${view} ${date}`);
            return;
        } catch (error) {
            lastError = error;
            if (!isNavigationContextError(error) && attempt >= 2) break;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(250);
        }
    }
    const diagnostics = await collectTimelineDiagnostics(page, `render timeline ${view} ${date}`, lastError).catch(() => null);
    throw new Error(`render timeline ${view} ${date} failed after navigation-aware retries: ${lastError?.message || lastError}; diagnostics=${JSON.stringify(diagnostics)}`);
}

async function openRoomDrawer(page, date, room, time) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ room, time }) => {
        const lines = await getLinesForDate(AppState.selectedDate);
        const line = lines.find(item => {
            const values = [item.id, item.resourceId, item.resource_id, item.name, item.shortName, item.short_name];
            return values.some(value => String(value || '') === room || (typeof sameBookingRoom === 'function' && sameBookingRoom(value, room)));
        });
        if (!line) {
            return { ok: false, error: `room line not found: ${room}`, lines: lines.map(item => ({ id: item.id, name: item.name })) };
        }
        const opened = await openBookingPanel(time, line.id || line.name);
        await new Promise(resolve => setTimeout(resolve, 250));
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            ok: opened === true,
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || '',
            customerId: document.getElementById('selectedCustomerId')?.value || '',
            guests: document.getElementById('banquetGuests')?.value || ''
        };
    }, { room, time });
}

function assertBridgeSelector(result, label) {
    assert.equal(result.ok, true, `${label}: drawer opens`);
    assert.equal(result.panelVisible, true, `${label}: drawer visible`);
    const combined = `${result.selectorText || ''} ${result.hintText || ''}`.replace(/\s+/g, ' ').trim();
    assert.ok(!/^Без прив.?язки$/i.test(combined), `${label}: selector is not only "Без прив'язки"`);
    assert.doesNotMatch(combined, /Банкетів цього клієнта на дату не знайдено/i, `${label}: no false empty-candidates hint`);
    assert.match(combined, /(Створити банкет|Банкет буде створено|Прив.?язано|Банкет)/i, `${label}: selector exposes virtual or existing banquet state`);
}

async function ensureKitchenTicketQuoteReady(page, label, counts = {}) {
    const snapshot = await page.evaluate(async ({ label, counts }) => {
        const setNumberInput = (id, value, { onlyIfBlank = true } = {}) => {
            const input = document.getElementById(id);
            if (!input) return '';
            if (!onlyIfBlank || String(input.value || '').trim() === '') {
                input.value = String(value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return input.value;
        };
        const guests = setNumberInput('banquetGuests', counts.guests ?? 4);
        const adults = setNumberInput('banquetAdults', counts.adults ?? 0);
        const arrival = document.getElementById('bookingGuestArrivalTime');
        if (arrival && !arrival.value && document.getElementById('bookingTime')?.value) {
            arrival.value = document.getElementById('bookingTime').value;
            arrival.dispatchEvent(new Event('input', { bubbles: true }));
            arrival.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (window.BookingTickets?.setActive) {
            window.BookingTickets.setActive(true);
        }
        const quoteResult = window.BookingTickets?.quoteNow
            ? await window.BookingTickets.quoteNow()
            : null;
        if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
        if (typeof updateBookingSubmitState === 'function') updateBookingSubmitState();
        const quote = window.BookingTickets?.getQuote?.() || quoteResult?.quote || quoteResult || null;
        const collect = window.BookingTickets?.collect?.() || {};
        const ticketIssue = window.BookingTickets?.validationIssue?.() || null;
        const formValidation = window.BookingForm?.validate ? BookingForm.validate() : null;
        const roomSelect = document.getElementById('roomSelect');
        const roomOption = roomSelect?.selectedOptions?.[0] || null;
        return {
            label,
            guests,
            adults,
            room: roomSelect?.value || '',
            roomResourceId: roomOption?.dataset?.resourceId || '',
            bookingTime: document.getElementById('bookingTime')?.value || '',
            guestArrivalTime: arrival?.value || '',
            quoteStatusText: document.getElementById('bookingTicketQuoteState')?.textContent?.trim() || '',
            quoteSubtotal: quote && Object.prototype.hasOwnProperty.call(quote, 'ticketSubtotal')
                ? Number(quote.ticketSubtotal || 0)
                : null,
            quoteLineCount: Array.isArray(quote?.ticketLines) ? quote.ticketLines.length : 0,
            collectHasTicketQuantities: Array.isArray(collect.ticketQuantities),
            collectHasTicketQuote: Boolean(collect.ticketQuote),
            ticketIssue,
            formValidation
        };
    }, { label, counts });
    assert.equal(
        snapshot.ticketIssue,
        null,
        `${label}: ticket quote must be ready before submit; diagnostics=${JSON.stringify(snapshot)}`
    );
    assert.equal(
        snapshot.collectHasTicketQuote,
        true,
        `${label}: BookingTickets.collect() must include the server quote; diagnostics=${JSON.stringify(snapshot)}`
    );
    return snapshot;
}

function sourceBookingIdOf(sourceBooking) {
    if (sourceBooking && typeof sourceBooking === 'object') return String(sourceBooking.id || sourceBooking.bookingId || sourceBooking.booking_id || '').trim();
    return String(sourceBooking || '').trim();
}

async function ensureActivityFirstKitchenBridgeReady(page, sourceBooking, label, options = {}) {
    const sourceBookingId = sourceBookingIdOf(sourceBooking);
    assert.ok(sourceBookingId, `${label}: source booking id is available`);
    const snapshot = await page.evaluate(async ({ sourceBooking, sourceBookingId, expectCreatePath }) => {
        const state = window.BookingDrawerState || {};
        const read = () => {
            const roomContext = state.roomSelectionBanquetContext || {};
            const sourceContext = state.roomSourceContext || roomContext.roomSourceContext || {};
            let createPath = null;
            try {
                const formData = typeof getBookingFormData === 'function' ? getBookingFormData() : {};
                createPath = typeof window.resolveBookingCreatePath === 'function'
                    ? window.resolveBookingCreatePath({ formData }, state)
                    : null;
            } catch (error) {
                createPath = { error: error?.message || String(error) };
            }
            return {
                sourceBookingId: String(roomContext.sourceBookingId || sourceContext.sourceBookingId || '').trim(),
                groupId: String(roomContext.groupId || sourceContext.groupId || state.selectedBanquetGroupId || '').trim(),
                sourceRole: sourceContext.sourceRole || roomContext.sourceRole || '',
                staleReason: sourceContext.staleReason || roomContext.staleReason || '',
                selectedCustomerId: document.getElementById('selectedCustomerId')?.value || '',
                selectorValue: document.getElementById('bookingBanquetGroupSelect')?.value || '',
                selectorText: document.getElementById('bookingBanquetGroupSelect')?.textContent || '',
                hintText: document.getElementById('bookingBanquetGroupHint')?.textContent || '',
                createPath
            };
        };

        let current = read();
        if (String(current.sourceBookingId) !== String(sourceBookingId)) {
            const normalized = typeof normalizeRoomDayBookingEntry === 'function'
                ? normalizeRoomDayBookingEntry(sourceBooking || {})
                : (sourceBooking || {});
            const token = typeof nextBookingRoomSelectionContextToken === 'function'
                ? nextBookingRoomSelectionContextToken()
                : Number(state.roomSelectionContextRequestToken || 0) + 1;
            state.roomSelectionContextRequestToken = token;
            const sourceContext = typeof setBookingRoomSourceContext === 'function'
                ? setBookingRoomSourceContext(normalized, {
                    generationId: token,
                    sourceRole: 'activity',
                    source: 'timeline_browser_smoke_activity_first_kitchen_bridge'
                })
                : {
                    generationId: token,
                    drawerGenerationId: Number(state.drawerGenerationId || 0) || 0,
                    sourceBookingId,
                    sourceRole: 'activity',
                    customerId: normalized.customerId ?? normalized.customer_id ?? null,
                    date: normalized.date || '',
                    room: normalized.room || document.getElementById('roomSelect')?.value || null,
                    time: normalized.time || document.getElementById('bookingTime')?.value || '',
                    source: 'timeline_browser_smoke_activity_first_kitchen_bridge'
                };
            let context = null;
            if (typeof resolveRoomSelectionBanquetContext === 'function') {
                context = await resolveRoomSelectionBanquetContext(normalized, token).catch(error => ({
                    sourceBookingId,
                    sourceBooking: normalized,
                    sourceError: error?.message || String(error),
                    source: 'timeline_browser_smoke_activity_first_kitchen_bridge'
                }));
            }
            if (!context && typeof sourceBookingToBanquetContext === 'function') {
                context = sourceBookingToBanquetContext(normalized);
            }
            if (!context) {
                context = {
                    sourceBookingId,
                    sourceBooking: normalized,
                    sourceCustomerId: normalized.customerId ?? normalized.customer_id ?? null,
                    sourceCustomerName: normalized.customerName || normalized.customer_name || null,
                    sourceRoom: normalized.room || null,
                    sourceTime: normalized.time || '',
                    source: 'timeline_browser_smoke_activity_first_kitchen_bridge'
                };
            }
            state.roomSourceContext = state.roomSourceContext || sourceContext;
            state.roomSelectionBanquetContext = typeof attachBookingRoomSourceContext === 'function'
                ? attachBookingRoomSourceContext(context, state.roomSourceContext)
                : { ...context, roomSourceContext: state.roomSourceContext };
            state.autoFilledBanquetFromRoom = state.roomSelectionBanquetContext?.groupId
                ? state.roomSelectionBanquetContext
                : null;
            state.selectedBanquetGroupId = state.roomSelectionBanquetContext?.groupId || '';
            state.manualBanquetGroupSelection = false;
            state.standaloneBookingOverride = false;
            if (typeof syncAutoFilledBanquetGuestsFromRoom === 'function') {
                syncAutoFilledBanquetGuestsFromRoom(normalized);
            }
            if (!document.getElementById('selectedCustomerId')?.value && typeof hydrateBookingCustomerSelection === 'function') {
                await hydrateBookingCustomerSelection(normalized, { renderSummary: false }).catch(() => null);
            }
            if (typeof renderBookingBanquetGroupSelector === 'function') renderBookingBanquetGroupSelector();
            if (typeof syncBookingGuestArrivalField === 'function') syncBookingGuestArrivalField();
            if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
        }
        current = read();
        return {
            ...current,
            expectCreatePath: Boolean(expectCreatePath)
        };
    }, { sourceBooking, sourceBookingId, expectCreatePath: Boolean(options.expectCreatePath) });

    assert.equal(String(snapshot.sourceBookingId), sourceBookingId, `${label}: source bridge keeps source booking ${sourceBookingId}; snapshot=${JSON.stringify(snapshot)}`);
    assert.equal(String(snapshot.staleReason || ''), '', `${label}: source bridge is not stale; snapshot=${JSON.stringify(snapshot)}`);
    if (options.expectCreatePath) {
        assert.equal(snapshot.createPath?.blocked, false, `${label}: create path is not blocked; snapshot=${JSON.stringify(snapshot)}`);
        assert.equal(snapshot.createPath?.kind, 'source_activity_to_kitchen', `${label}: create path targets source activity -> kitchen; snapshot=${JSON.stringify(snapshot)}`);
        assert.equal(String(snapshot.createPath?.sourceBookingId || ''), sourceBookingId, `${label}: create payload path carries source booking id; snapshot=${JSON.stringify(snapshot)}`);
    }
    return snapshot;
}

async function acknowledgePreorderWarningIfVisible(page, label) {
    const visible = await page.waitForFunction(() => {
        const modal = document.getElementById('confirmModal');
        const yes = document.getElementById('confirmYes');
        const title = document.getElementById('confirmTitle')?.textContent || '';
        const message = document.getElementById('confirmMessage')?.textContent || '';
        const style = modal ? getComputedStyle(modal) : null;
        return Boolean(
            modal
            && yes
            && !yes.disabled
            && !modal.classList.contains('hidden')
            && style?.display !== 'none'
            && style?.visibility !== 'hidden'
            && /Передзамовлення|завдаток/i.test(`${title}\n${message}`)
        );
    }, undefined, { timeout: 1500 }).then(() => true).catch(() => false);
    if (!visible) return false;
    await page.locator('#confirmYes').click();
    await page.waitForFunction(() => {
        const modal = document.getElementById('confirmModal');
        const style = modal ? getComputedStyle(modal) : null;
        return !modal || modal.classList.contains('hidden') || style?.display === 'none' || style?.visibility === 'hidden';
    }, undefined, { timeout: 5000 }).catch(error => {
        throw new Error(`${label}: preorder warning confirmation did not close: ${error?.message || error}`);
    });
    return true;
}

async function fillKitchenAndSubmit(page, sourceBookingId) {
    const sourceBooking = sourceBookingId && typeof sourceBookingId === 'object' ? sourceBookingId : { id: sourceBookingId };
    sourceBookingId = sourceBookingIdOf(sourceBooking);
    await ensureActivityFirstKitchenBridgeReady(page, sourceBooking, 'source activity -> kitchen bridge before ticket quote');
    await ensureKitchenTicketQuoteReady(page, 'source activity -> kitchen');
    await ensureActivityFirstKitchenBridgeReady(page, sourceBooking, 'source activity -> kitchen bridge before submit', { expectCreatePath: true });
    const observedPostPaths = [];
    const requestHandler = request => {
        if (request.method() !== 'POST') return;
        observedPostPaths.push(new URL(request.url()).pathname);
    };
    page.on('request', requestHandler);
    try {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const responsePromise = page.waitForResponse(response =>
                response.url().includes('/api/banquets/from-source/member-booking')
                && response.request().method() === 'POST'
            ).catch(error => error);
            await page.evaluate(() => {
                const setInputValue = (id, value) => {
                    const input = document.getElementById(id);
                    if (!input) return;
                    input.value = String(value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                };
                setInputValue('banquetGuests', document.getElementById('banquetGuests')?.value || '4');
                setInputValue('banquetAdults', document.getElementById('banquetAdults')?.value || '0');
                if (typeof setBookingMenuPositions === 'function') {
                    setBookingMenuPositions([{
                        productId: 'task37-ui-menu',
                        title: 'Task37 UI menu',
                        quantity: 1,
                        unitPrice: 4500,
                        subtotal: 4500,
                        kitchenType: 'menu',
                        servingUnit: 'portion',
                        servingTime: '14:00'
                    }]);
                }
                if (typeof setBookingServiceEvents === 'function') {
                    setBookingServiceEvents([{ type: 'room_setup', title: 'Task37 setup', time: '13:45' }], { render: true });
                }
                document.getElementById('bookingNotes').value = 'Task37 kitchen browser smoke';
            });
            await ensureActivityFirstKitchenBridgeReady(page, sourceBooking, `source activity -> kitchen bridge before submit attempt ${attempt}`, { expectCreatePath: true });
            await page.locator('#bookingSubmitBtn').click();
            await acknowledgePreorderWarningIfVisible(page, 'source activity -> kitchen');
            const response = await responsePromise;
            if (!response || response instanceof Error) {
                const diagnostics = await page.evaluate(sourceId => ({
                    sourceBookingId: sourceId,
                    panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
                    submitDisabled: Boolean(document.getElementById('bookingSubmitBtn')?.disabled),
                    bookingTime: document.getElementById('bookingTime')?.value || '',
                    bookingLine: document.getElementById('bookingLine')?.value || '',
                    selectedCustomerId: document.getElementById('selectedCustomerId')?.value || '',
                    room: document.getElementById('roomSelect')?.value || '',
                    guests: document.getElementById('banquetGuests')?.value || '',
                    adults: document.getElementById('banquetAdults')?.value || '',
                    submitText: document.getElementById('bookingSubmitBtn')?.textContent?.trim() || '',
                    selectorValue: document.getElementById('bookingBanquetGroupSelect')?.value || '',
                    selectorText: document.getElementById('bookingBanquetGroupSelect')?.textContent || '',
                    hintText: document.getElementById('bookingBanquetGroupHint')?.textContent || '',
                    ticketIssue: window.BookingTickets?.validationIssue?.() || null,
                    ticketQuoteStatus: document.getElementById('bookingTicketQuoteState')?.textContent?.trim() || '',
                    ticketCollect: window.BookingTickets?.collect?.() || {},
                    activeContext: typeof getTimelineActiveBanquetContext === 'function' ? getTimelineActiveBanquetContext() : null,
                    drawerState: {
                        selectedBanquetGroupId: BookingDrawerState?.selectedBanquetGroupId || '',
                        banquetCreationMode: BookingDrawerState?.banquetCreationMode || '',
                        activeBanquetIntent: BookingDrawerState?.activeBanquetIntent || '',
                        activeBanquetRoleIntent: BookingDrawerState?.activeBanquetRoleIntent || '',
                        sourceBookingId: BookingDrawerState?.sourceBookingId || BookingDrawerState?.activeBanquetSourceBookingId || ''
                    },
                    validation: window.BookingForm?.validate ? BookingForm.validate() : null,
                    modalText: document.querySelector('.modal:not(.hidden), .confirm-modal, [role="dialog"]')?.textContent?.trim() || '',
                    notifications: Array.from(document.querySelectorAll('.notification, .toast, [role="alert"]'))
                        .map(node => String(node.textContent || '').trim())
                        .filter(Boolean)
                        .slice(-5)
                }), sourceBookingId);
                throw new Error(`source activity -> kitchen request was not observed: ${JSON.stringify({
                    waitError: response?.message || String(response || ''),
                    diagnostics,
                    observedPostPaths
                })}`);
            }
            const body = await response.json();
            if (response.status() === 429 && attempt < 3) {
                console.warn(`source activity -> kitchen rate limited; retry ${attempt + 1}/3`);
                await page.waitForFunction(() => {
                    const submit = document.getElementById('bookingSubmitBtn');
                    return Boolean(submit && !submit.disabled);
                }, undefined, { timeout: 15000 }).catch(() => {});
                await sleep(15000);
                continue;
            }
            assert.equal(response.ok(), true, `source activity -> kitchen endpoint returns ok: status=${response.status()} body=${JSON.stringify(body)}`);
            assert.equal(body.success, true, `source activity -> kitchen response success: status=${response.status()} body=${JSON.stringify(body)}`);
            assert.equal(String(body.group?.primaryBookingId || body.banquetGroup?.group?.primaryBookingId || body.banquetGroup?.group?.primary_booking_id || sourceBookingId), String(sourceBookingId));
            return body.booking || body.memberBooking || body.banquetGroup?.bookings?.kitchen?.[0];
        }
    } finally {
        page.off('request', requestHandler);
    }
    throw new Error('source activity -> kitchen retry loop exited unexpectedly');
}

async function assertTimelineDeepLinkSwitching(page, base, date) {
    const deepLink = new URL('/', base);
    deepLink.searchParams.set('date', date);
    deepLink.searchParams.set('timelineView', 'rooms');
    deepLink.searchParams.set('smokeKeep', '1');
    await page.goto(deepLink.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.TimelineView?.current?.() === 'rooms');

    const switched = await page.evaluate(async () => {
        await window.TimelineView.set('animators', { render: false });
        const afterAnimators = {
            current: window.TimelineView.current(),
            urlView: new URL(window.location.href).searchParams.get('timelineView'),
            keep: new URL(window.location.href).searchParams.get('smokeKeep')
        };
        await window.TimelineView.set('rooms', { render: false });
        const afterRooms = {
            current: window.TimelineView.current(),
            urlView: new URL(window.location.href).searchParams.get('timelineView')
        };
        return { afterAnimators, afterRooms };
    });
    assert.deepEqual(switched.afterAnimators, { current: 'animators', urlView: 'animators', keep: '1' });
    assert.deepEqual(switched.afterRooms, { current: 'rooms', urlView: 'rooms' });

    const unknownLink = new URL(page.url());
    unknownLink.searchParams.set('timelineView', 'unsupported');
    await page.goto(unknownLink.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.TimelineView?.current?.() === 'rooms');
    assert.equal(await page.evaluate(() => window.TimelineView.current()), 'rooms');
    await page.evaluate(async () => window.TimelineView.set('animators', { render: false }));
}

async function openActiveBanquetEmptyCellDrawer(page, date, room, time, snapshot) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ room, time, snapshot }) => {
        const groupId = String(snapshot?.groupId || snapshot?.group?.id || '').trim();
        const primary = snapshot?.bookings?.primary || {};
        const kitchen = Array.isArray(snapshot?.bookings?.kitchen) ? snapshot.bookings.kitchen[0] : null;
        const packageSource = kitchen || primary;
        const bookingPackage = packageSource?.extraData?.bookingPackage
            || packageSource?.extra_data?.bookingPackage
            || packageSource?.extraData?.booking_package
            || packageSource?.extra_data?.booking_package
            || {};
        const summary = {
            groupId,
            snapshot,
            primaryBooking: primary,
            carrierBooking: packageSource || primary,
            groupName: snapshot?.group?.groupName || snapshot?.group?.group_name || primary.groupName || primary.group_name || primary.label || '',
            customerId: snapshot?.group?.customerId || snapshot?.group?.customer_id || primary.customerId || primary.customer_id || null,
            customerName: primary.customerName || primary.customer_name || '',
            room,
            date,
            kidsCount: primary.kidsCount || primary.kids_count || packageSource?.banquetGuests || packageSource?.banquet_guests || null,
            banquetGuests: packageSource?.banquetGuests || packageSource?.banquet_guests || primary.kidsCount || primary.kids_count || null,
            banquetAdults: packageSource?.banquetAdults || packageSource?.banquet_adults || null,
            banquetTables: packageSource?.banquetTables || packageSource?.banquet_tables || null,
            menuCount: Array.isArray(bookingPackage.menuPositions) ? bookingPackage.menuPositions.length : 0,
            packageSnapshot: {
                sourceBookingId: packageSource?.id || primary.id || null,
                menuPositions: Array.isArray(bookingPackage.menuPositions) ? bookingPackage.menuPositions : [],
                serviceEvents: Array.isArray(bookingPackage.serviceEvents) ? bookingPackage.serviceEvents : [],
                banquetMenu: packageSource?.banquetMenu || packageSource?.banquet_menu || '',
                finalTotal: bookingPackage.finalTotal ?? null,
                source: 'timeline_browser_smoke'
            }
        };
        if (typeof showTimelineBanquetInspector !== 'function') {
            return { ok: false, error: 'showTimelineBanquetInspector unavailable' };
        }
        showTimelineBanquetInspector(null, summary, { dataset: { bookingId: packageSource?.id || primary.id || '' } });
        const lines = await getLinesForDate(AppState.selectedDate);
        const line = lines.find(item => {
            const values = [item.id, item.resourceId, item.resource_id, item.name, item.shortName, item.short_name];
            return values.some(value => String(value || '') === room || (typeof sameBookingRoom === 'function' && sameBookingRoom(value, room)));
        });
        if (!line) return { ok: false, error: `room line not found: ${room}` };
        const lineId = String(line.id || line.name || '').trim();
        const cell = Array.from(document.querySelectorAll('.grid-cell[data-time][data-line]'))
            .find(node => String(node.dataset.line || '') === lineId && String(node.dataset.time || '') === time);
        if (!cell) return { ok: false, error: `empty cell not found: ${lineId} ${time}` };
        await selectCell(cell);
        await new Promise(resolve => setTimeout(resolve, 250));
        const banner = document.querySelector('.booking-active-banquet-context');
        const standalone = document.querySelector('[data-booking-standalone-override]');
        return {
            ok: true,
            activeContext: typeof getTimelineActiveBanquetContext === 'function' ? getTimelineActiveBanquetContext() : null,
            selectedGroupId: BookingDrawerState.selectedBanquetGroupId || '',
            activeBanquetIntent: BookingDrawerState.activeBanquetIntent || '',
            roleIntent: BookingDrawerState.activeBanquetRoleIntent || '',
            bannerText: banner?.textContent || '',
            hasStandaloneOverride: Boolean(standalone),
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            guests: document.getElementById('banquetGuests')?.value || ''
        };
    }, { room, time, snapshot });
}

async function submitActiveBanquetMemberFromEmptyCell(page, groupId) {
    await ensureKitchenTicketQuoteReady(page, 'active inspector -> empty cell member');
    const genericBookingRequests = [];
    const requestHandler = request => {
        if (request.method() !== 'POST') return;
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/bookings' || pathname === '/api/bookings/full') {
            genericBookingRequests.push(request.url());
        }
    };
    page.on('request', requestHandler);
    const responsePromise = page.waitForResponse(response =>
        response.url().includes(`/api/banquets/${encodeURIComponent(groupId)}/member-booking`)
        && response.request().method() === 'POST'
    );
    await page.evaluate(() => {
        const setInputValue = (id, value) => {
            const input = document.getElementById(id);
            if (!input) return;
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (typeof setBookingKitchenEnabled === 'function') setBookingKitchenEnabled(true, { markDirty: true });
        setInputValue('banquetGuests', document.getElementById('banquetGuests')?.value || '4');
        setInputValue('banquetAdults', document.getElementById('banquetAdults')?.value || '0');
        if (typeof setBookingMenuPositions === 'function') {
            setBookingMenuPositions([{
                productId: 'task37-empty-cell-menu',
                title: 'Task37 empty cell menu',
                quantity: 1,
                unitPrice: 4500,
                subtotal: 4500,
                kitchenType: 'menu',
                servingUnit: 'portion',
                servingTime: '17:30'
            }]);
        }
        document.getElementById('bookingNotes').value = 'Task37 active inspector empty cell smoke';
        document.getElementById('bookingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await acknowledgePreorderWarningIfVisible(page, 'active inspector -> empty cell member');
    const response = await responsePromise;
    page.off('request', requestHandler);
    const body = await response.json();
    assert.equal(response.ok(), true, 'active inspector -> empty cell member endpoint returns ok');
    assert.equal(body.success, true, 'active inspector -> empty cell response success');
    assert.deepEqual(genericBookingRequests, [], 'active inspector -> empty cell does not use generic booking endpoints');
    return body.booking || body.memberBooking || body.banquetGroup?.bookings?.kitchen?.[0];
}

async function chooseFirstActivityProgram(page) {
    return page.evaluate(async () => {
        if (typeof getProducts === 'function') await getProducts();
        const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
        const program = products.find(item =>
            item
            && item.isActive !== false
            && item.domain !== 'kitchen'
            && item.category !== 'kitchen'
            && Number(item.duration || 0) > 0
            && Number(item.hosts || 1) <= 1
            && !item.isCustom
        );
        if (!program) return null;
        if (typeof setSelectedActivityPrograms === 'function') {
            setSelectedActivityPrograms([program.id], { markDirty: true, renderSummary: true, renderPackage: true });
        } else if (typeof selectProgram === 'function') {
            selectProgram(program.id);
        } else {
            document.getElementById('selectedProgram').value = program.id;
        }
        const kids = document.getElementById('kidsCountInput');
        if (kids) kids.value = '4';
        if (typeof updateBookingSubmitState === 'function') updateBookingSubmitState();
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            id: program.id,
            label: program.name || program.label || program.code || program.id,
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || '',
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden')
        };
    });
}

async function assertBookingDrawerResponsive(page) {
    const viewports = [
        { width: 1440, height: 960, label: 'desktop' },
        { width: 390, height: 844, label: 'mobile' }
    ];
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        const metrics = await page.evaluate(() => {
            const panel = document.getElementById('bookingPanel');
            const form = document.getElementById('bookingForm');
            const panelRect = panel?.getBoundingClientRect?.();
            return {
                viewportWidth: window.innerWidth,
                panelVisible: Boolean(panel && !panel.classList.contains('hidden')),
                panelLeft: panelRect?.left ?? Number.NaN,
                panelRight: panelRect?.right ?? Number.NaN,
                bodyOverflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
                formOverflowX: form ? Math.max(0, form.scrollWidth - form.clientWidth) : Number.NaN
            };
        });
        assert.equal(metrics.panelVisible, true, `booking drawer remains visible at ${viewport.label}`);
        assert.ok(metrics.panelLeft >= -1, `booking drawer stays inside the left viewport edge at ${viewport.label}: ${metrics.panelLeft}`);
        assert.ok(metrics.panelRight <= metrics.viewportWidth + 1, `booking drawer stays inside the right viewport edge at ${viewport.label}: ${metrics.panelRight}`);
        assert.ok(metrics.bodyOverflowX <= 2, `booking drawer does not create body horizontal overflow at ${viewport.label}: ${metrics.bodyOverflowX}`);
        assert.ok(metrics.formOverflowX <= 2, `booking form has no horizontal overflow at ${viewport.label}: ${metrics.formOverflowX}`);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
}

async function assertBookingTimeCreateDurability(page, date, animator, room, customer) {
    await renderTimelineView(page, date, 'animators');
    const opened = await page.evaluate(async ({ animator, room, customer, runId }) => {
        const cells = Array.from(document.querySelectorAll('.grid-cell[data-time="12:15"][data-line]'))
            .filter(node => !['afisha', 'banquet-service'].includes(String(node.dataset.line || '')));
        let result;
        if (cells.length && typeof selectCell === 'function') {
            for (const cell of cells) {
                await selectCell(cell);
                result = !document.getElementById('bookingPanel')?.classList.contains('hidden');
                if (result) break;
            }
        } else {
            result = await openBookingPanel('12:15', animator.id);
        }
        if (result !== true) {
            return {
                ok: false,
                error: `no eligible 12:15 timeline cell (${cells.map(cell => cell.dataset.line).join(', ')})`
            };
        }
        if (typeof selectCustomerFromSearch === 'function') {
            selectCustomerFromSearch(customer);
        } else if (typeof applySelectedCustomerToBookingForm === 'function') {
            applySelectedCustomerToBookingForm(customer);
        }
        const roomSelect = document.getElementById('roomSelect');
        if (roomSelect) roomSelect.value = room;
        const groupName = document.getElementById('bookingGroupName');
        if (groupName) groupName.value = `Task3 time draft ${runId}`;
        const notes = document.getElementById('bookingNotes');
        if (notes) notes.value = `Task3 booking time durability ${runId}`;
        if (typeof initializeBookingArrivalDraft === 'function') {
            initializeBookingArrivalDraft('11:45', {
                mode: 'new',
                groupId: null,
                guestArrivalTime: '11:45'
            });
        }
        const arrival = document.getElementById('bookingGuestArrivalTime');
        if (arrival) arrival.value = '11:45';
        if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
        if (typeof updateBookingSubmitState === 'function') updateBookingSubmitState();
        return {
            ok: true,
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            time: document.getElementById('bookingTime')?.value || '',
            lineId: document.getElementById('bookingLine')?.value || '',
            customerId: document.getElementById('selectedCustomerId')?.value || '',
            room: roomSelect?.value || ''
        };
    }, { animator, room, customer, runId: RUN_ID });
    assert.equal(opened.ok, true, `booking time drawer opens: ${opened.error || ''}`);
    assert.equal(opened.panelVisible, true, 'booking time drawer is visible');
    assert.equal(opened.time, '12:15', 'booking time drawer starts from the clicked 12:15 slot');
    assert.ok(opened.lineId, 'booking time drawer keeps the visible clicked timeline line');
    assert.equal(String(opened.customerId), String(customer.id), 'booking time draft keeps selected test customer');
    assert.equal(opened.room, room, 'booking time draft keeps selected test room');

    const program = await chooseFirstActivityProgram(page);
    assert.ok(program?.id, 'booking time durability scenario selected an activity program');
    await page.locator('#bookingTime').selectOption('12:30');
    await page.waitForFunction(() =>
        document.getElementById('bookingTime')?.value === '12:30'
        && ['free', 'conflict', 'failed'].includes(BookingDrawerState?.bookingTimePreflight?.status)
    );

    const draftBeforeSubmit = await page.evaluate(() => ({
        time: document.getElementById('bookingTime')?.value || '',
        groupName: document.getElementById('bookingGroupName')?.value || '',
        notes: document.getElementById('bookingNotes')?.value || '',
        arrival: document.getElementById('bookingGuestArrivalTime')?.value || '',
        customerId: document.getElementById('selectedCustomerId')?.value || '',
        programId: document.getElementById('selectedProgram')?.value || '',
        preflightStatus: BookingDrawerState?.bookingTimePreflight?.status || ''
    }));
    assert.equal(draftBeforeSubmit.time, '12:30');
    assert.equal(draftBeforeSubmit.arrival, '11:45', 'guest arrival stays independent from edited activity start');
    assert.equal(String(draftBeforeSubmit.customerId), String(customer.id));
    assert.equal(String(draftBeforeSubmit.programId), String(program.id));
    assert.equal(draftBeforeSubmit.preflightStatus, 'free', 'edited 12:30 slot passes browser preflight');
    await assertBookingDrawerResponsive(page);

    let capturedPayload = null;
    let capturedBanquetContext = null;
    let capturedCreatePath = null;
    let injectConflict = true;
    const routePattern = '**/api/bookings*';
    const observedPostPaths = [];
    const requestObserver = request => {
        if (request.method() === 'POST') observedPostPaths.push(new URL(request.url()).pathname);
    };
    page.on('request', requestObserver);
    const routeHandler = async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (injectConflict
            && request.method() === 'POST'
            && ['/api/bookings', '/api/bookings/full'].includes(pathname)) {
            injectConflict = false;
            const requestPayload = request.postDataJSON();
            capturedCreatePath = pathname;
            capturedPayload = requestPayload.main || requestPayload;
            capturedBanquetContext = requestPayload.banquetContext || capturedPayload.banquetContext || null;
            if (capturedPayload && capturedBanquetContext && !capturedPayload.banquetContext) {
                capturedPayload.banquetContext = capturedBanquetContext;
            }
            if (capturedPayload && !capturedPayload.notes) {
                const comments = capturedPayload.extraData?.bookingWorkspace?.comments || {};
                capturedPayload.notes = Object.values(comments).find(value => String(value || '').trim()) || null;
            }
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: false,
                    error: 'Task3 simulated occupied slot conflict',
                    conflictBookingId: `TASK3-CONFLICT-${RUN_ID}`
                })
            });
            return;
        }
        await route.continue();
    };
    await page.route(routePattern, routeHandler);
    const conflictResponse = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && ['/api/bookings', '/api/bookings/full'].includes(new URL(response.url()).pathname)
        && response.status() === 409
    ).catch(error => error);
    await page.evaluate(() => {
        document.getElementById('bookingForm')?.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true
        }));
    });
    await acknowledgePreorderWarningIfVisible(page, 'booking create occupied-slot conflict');
    const conflictResult = await Promise.race([
        conflictResponse,
        page.waitForTimeout(5000).then(() => null)
    ]);
    if (!conflictResult || conflictResult instanceof Error) {
        const diagnostics = await page.evaluate(() => ({
            submitDisabled: Boolean(document.getElementById('bookingSubmitBtn')?.disabled),
            selectedProgram: document.getElementById('selectedProgram')?.value || '',
            selectedCustomerId: document.getElementById('selectedCustomerId')?.value || '',
            bookingTime: document.getElementById('bookingTime')?.value || '',
            preflightStatus: BookingDrawerState?.bookingTimePreflight?.status || '',
            validation: window.BookingForm?.validate ? BookingForm.validate() : null,
            notifications: Array.from(document.querySelectorAll('.notification, .toast, [role="alert"]'))
                .map(node => String(node.textContent || '').trim())
                .filter(Boolean)
                .slice(-5)
        }));
        page.off('request', requestObserver);
        await page.unroute(routePattern, routeHandler);
        throw new Error(`booking create request was blocked before API: ${JSON.stringify({ diagnostics, observedPostPaths })}`);
    }
    await page.waitForFunction(() => {
        const panel = document.getElementById('bookingPanel');
        const submit = document.getElementById('bookingSubmitBtn');
        return panel && !panel.classList.contains('hidden') && submit && !submit.disabled;
    });
    await page.unroute(routePattern, routeHandler);
    page.off('request', requestObserver);

    assert.ok(capturedPayload, 'booking create request payload was captured');
    assert.ok(capturedCreatePath, 'booking create endpoint was captured');
    assert.equal(capturedPayload.time, '12:30');
    assert.equal(capturedPayload.banquetContext?.guestArrivalTime, '11:45');
    assert.equal(capturedPayload.notes, draftBeforeSubmit.notes);
    assert.equal(String(capturedPayload.customerId), String(customer.id));

    const draftAfterConflict = await page.evaluate(() => ({
        panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
        time: document.getElementById('bookingTime')?.value || '',
        groupName: document.getElementById('bookingGroupName')?.value || '',
        notes: document.getElementById('bookingNotes')?.value || '',
        arrival: document.getElementById('bookingGuestArrivalTime')?.value || '',
        customerId: document.getElementById('selectedCustomerId')?.value || ''
    }));
    assert.equal(draftAfterConflict.panelVisible, true, 'server conflict keeps booking drawer open');
    assert.deepEqual(draftAfterConflict, {
        panelVisible: true,
        time: draftBeforeSubmit.time,
        groupName: draftBeforeSubmit.groupName,
        notes: draftBeforeSubmit.notes,
        arrival: draftBeforeSubmit.arrival,
        customerId: draftBeforeSubmit.customerId
    });
    await assertBookingDrawerResponsive(page);

    // Live smoke must leave a booking that the public cleanup endpoint can remove.
    // The intercepted request above still verifies the independent guest-arrival
    // contract; the durable retry intentionally creates a standalone test booking.
    await page.evaluate(() => {
        if (typeof initializeBookingArrivalDraft === 'function') {
            initializeBookingArrivalDraft('12:30', { mode: 'standalone' });
        } else {
            BookingDrawerState.banquetCreationMode = null;
        }
    });

    const createResponsePromise = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && ['/api/bookings', '/api/bookings/full'].includes(new URL(response.url()).pathname)
    );
    await page.evaluate(() => {
        document.getElementById('bookingForm')?.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true
        }));
    });
    await acknowledgePreorderWarningIfVisible(page, 'booking create retry after conflict');
    const createResponse = await createResponsePromise;
    const createBody = await createResponse.json();
    const createdBooking = createBody.booking || createBody.mainBooking;
    assert.equal(createResponse.ok(), true, JSON.stringify(createBody));
    assert.equal(createBody.success, true, 'retry after server conflict creates booking');
    assert.equal(createdBooking?.time, '12:30', 'created booking persisted edited 12:30 start');
    await page.waitForFunction(() => document.getElementById('bookingPanel')?.classList.contains('hidden'));
    return createdBooking;
}

async function openActivityFromKitchenSource(page, date, kitchenId) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ kitchenId }) => {
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        if (!bookings.find(item => String(item.id) === String(kitchenId))) {
            return { ok: false, error: 'source kitchen booking not in room bookings cache' };
        }
        await openRoomBookingAnimationBridge(kitchenId);
        await new Promise(resolve => setTimeout(resolve, 250));
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            ok: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || ''
        };
    }, { kitchenId });
}

async function submitActivityFromKitchen(page) {
    const responsePromise = page.waitForResponse(response =>
        response.url().includes('/api/banquets/from-source/activity-booking')
        && response.request().method() === 'POST'
    );
    await page.evaluate(() => {
        document.getElementById('bookingNotes').value = 'Task37 activity browser smoke';
        document.getElementById('bookingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await acknowledgePreorderWarningIfVisible(page, 'source kitchen -> activity');
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.ok(), true, 'source kitchen -> activity endpoint returns ok');
    assert.equal(body.success, true, 'source kitchen -> activity response success');
    return body.booking || body.activityBooking || body.mainBooking;
}

async function assertRoomMarkerVisible(page, bookingId) {
    await page.waitForFunction(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(
            document.querySelector(`.timeline-room-service-marker[data-booking-id="${escaped}"]`)
            || Array.from(document.querySelectorAll('.timeline-room-service-marker[data-booking-ids]')).some(node =>
                String(node.dataset.bookingIds || '').split(/\s+/).includes(String(id))
            )
            || document.querySelector(`.booking-block[data-booking-id="${escaped}"]`)
        );
    }, bookingId);
}

async function assertKitchenHiddenFromAnimator(page, kitchenId) {
    await renderTimelineView(page, await page.evaluate(() => document.getElementById('timelineDate')?.value), 'animators');
    const visible = await page.evaluate(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(
            document.querySelector(`.timeline-room-service-marker[data-booking-id="${escaped}"]`)
            || document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`)
        );
    }, kitchenId);
    assert.equal(visible, false, 'kitchen is not rendered as normal animator block');
}

async function assertBookingBlockVisible(page, bookingId) {
    await page.waitForFunction(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`));
    }, bookingId);
}

async function setTimelineViewPanelOpen(page, open) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await page.evaluate(nextOpen => {
                const panel = document.getElementById('timelineViewPanel');
                const toggle = document.getElementById('timelineViewPanelToggle');
                if (!panel || !toggle) return;
                if (!panel.hidden !== Boolean(nextOpen)) toggle.click();
            }, open);
            await page.waitForFunction(nextOpen => {
                const panel = document.getElementById('timelineViewPanel');
                const toggle = document.getElementById('timelineViewPanelToggle');
                return Boolean(
                    panel
                    && toggle
                    && panel.hidden === !nextOpen
                    && toggle.getAttribute('aria-expanded') === String(Boolean(nextOpen))
                );
            }, open);
            return;
        } catch (error) {
            if (attempt > 0 || !/execution context was destroyed/i.test(String(error?.message || error))) throw error;
            await page.waitForLoadState('domcontentloaded');
            await waitForTimelineReady(page, 'timeline view panel retry after navigation context reset');
        }
    }
}

async function assertTimelineViewPanelInteractions(page) {
    assert.equal(await page.locator('#digestBtn').count(), 0, 'digest button is not rendered on the timeline page');

    const readFilterBadgeState = () => page.evaluate(() => {
        const toggle = document.getElementById('timelineViewPanelToggle');
        const badge = document.getElementById('timelineViewPanelBadge');
        const badgeStyle = badge ? getComputedStyle(badge) : null;
        return {
            count: toggle?.dataset.filterCount || '',
            state: toggle?.getAttribute('data-filter-state') || '',
            hasActiveClass: Boolean(toggle?.classList.contains('has-active-filters')),
            badgeText: badge?.textContent.trim() || '',
            badgeVisible: Boolean(
                badge
                && badgeStyle
                && badgeStyle.visibility !== 'hidden'
                && Number(badgeStyle.opacity) > 0
            )
        };
    });
    const waitForFilterBadgeState = async (expected, label) => {
        await page.waitForFunction(({ count, visible }) => {
            const toggle = document.getElementById('timelineViewPanelToggle');
            const badge = document.getElementById('timelineViewPanelBadge');
            const badgeStyle = badge ? getComputedStyle(badge) : null;
            const activeClass = Boolean(toggle?.classList.contains('has-active-filters'));
            const badgeVisible = Boolean(
                badge
                && badgeStyle
                && badgeStyle.visibility !== 'hidden'
                && Number(badgeStyle.opacity) > 0
            );
            return Boolean(
                toggle
                && badge
                && toggle.dataset.filterCount === String(count)
                && toggle.getAttribute('data-filter-state') === (Number(count) > 0 ? 'custom' : 'default')
                && activeClass === Boolean(visible)
                && badgeVisible === Boolean(visible)
            );
        }, expected);
        const state = await readFilterBadgeState();
        assert.equal(state.count, String(expected.count), `${label}: filter badge count: ${JSON.stringify(state)}`);
        assert.equal(state.state, Number(expected.count) > 0 ? 'custom' : 'default', `${label}: filter badge state: ${JSON.stringify(state)}`);
        assert.equal(state.hasActiveClass, Boolean(expected.visible), `${label}: filter badge active class: ${JSON.stringify(state)}`);
        assert.equal(state.badgeVisible, Boolean(expected.visible), `${label}: filter badge visibility: ${JSON.stringify(state)}`);
        if (expected.text !== undefined) {
            assert.equal(state.badgeText, expected.text, `${label}: filter badge text: ${JSON.stringify(state)}`);
        }
        return state;
    };

    await setTimelineViewPanelOpen(page, false);
    let badgeState = await waitForFilterBadgeState({ count: 0, visible: false, text: '' }, 'default state');
    assert.equal(badgeState.count, '0', 'filter badge starts at zero in default state');
    assert.equal(badgeState.state, 'default', 'filter toggle starts in default state');
    assert.equal(badgeState.hasActiveClass, false, 'filter toggle is not visually active by default');
    assert.equal(badgeState.badgeVisible, false, 'filter badge is hidden in default state');

    const typeSwitchDiagnostics = await waitForTimelineTypeSwitch(page, 'timeline type switch default visibility');
    const typeSwitch = typeSwitchDiagnostics.typeSwitch;
    const typeSwitchDetail = JSON.stringify(typeSwitchDiagnostics);
    assert.equal(typeSwitch.exists, true, 'timeline type switch exists');
    assert.equal(typeSwitch.visible, true, `timeline type switch is visible without opening filters: ${typeSwitchDetail}`);
    assert.equal(typeSwitch.inViewPanel, false, 'timeline type switch is outside the hidden filters shelf');
    assert.equal(typeSwitch.labels.map(item => item.text).join('|'), 'Кімнати|Свята', `timeline type switch keeps expected labels: ${typeSwitchDetail}`);

    await page.locator('#timelineViewPanelToggle').click();
    await page.waitForFunction(() => {
        const panel = document.getElementById('timelineViewPanel');
        const toggle = document.getElementById('timelineViewPanelToggle');
        return Boolean(panel && !panel.hidden && toggle?.getAttribute('aria-expanded') === 'true');
    });
    await page.locator('#timelineViewPanelToggle').click();
    await page.waitForFunction(() => {
        const panel = document.getElementById('timelineViewPanel');
        const toggle = document.getElementById('timelineViewPanelToggle');
        return Boolean(panel && panel.hidden && toggle?.getAttribute('aria-expanded') === 'false');
    });
    await setTimelineViewPanelOpen(page, true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('timelineViewPanel')?.hidden === true);

    await setTimelineViewPanelOpen(page, true);
    await page.locator('#timelineViewPanel .status-filter-btn[data-filter="confirmed"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('#timelineViewPanel .status-filter-btn[data-filter="confirmed"]');
        return AppState?.statusFilter === 'confirmed'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    badgeState = await waitForFilterBadgeState({ count: 1, visible: true, text: '1' }, 'confirmed status');
    assert.equal(badgeState.count, '1', 'filter badge counts non-default status');
    assert.equal(badgeState.state, 'custom', 'filter toggle marks custom state for status');
    assert.equal(badgeState.badgeText, '1', 'filter badge text is minimal for status');
    assert.equal(badgeState.badgeVisible, true, 'filter badge is visible for non-default status');
    await page.locator('#timelineViewPanel .status-filter-btn[data-filter="all"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('#timelineViewPanel .status-filter-btn[data-filter="all"]');
        return AppState?.statusFilter === 'all'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    badgeState = await waitForFilterBadgeState({ count: 0, visible: false, text: '' }, 'all status');
    assert.equal(badgeState.count, '0', 'filter badge clears when status returns to all');
    assert.equal(badgeState.badgeVisible, false, 'filter badge hides after status default is restored');

    await page.locator('#timelineViewPanel [data-schedule-view-mode="week"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('#timelineViewPanel [data-schedule-view-mode="week"]');
        return window.TimelineView?.state?.().viewMode === 'week'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    badgeState = await waitForFilterBadgeState({ count: 1, visible: true, text: '1' }, 'week period');
    assert.equal(badgeState.count, '1', 'filter badge counts non-default week period');
    assert.equal(badgeState.badgeVisible, true, 'filter badge is visible for week period');
    await page.locator('#timelineViewPanel [data-schedule-view-mode="day"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('#timelineViewPanel [data-schedule-view-mode="day"]');
        return window.TimelineView?.state?.().viewMode === 'day'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    badgeState = await waitForFilterBadgeState({ count: 0, visible: false, text: '' }, 'day period');
    assert.equal(badgeState.count, '0', 'filter badge clears when period returns to day');
    assert.equal(badgeState.badgeVisible, false, 'filter badge hides after period default is restored');

    await setTimelineViewPanelOpen(page, false);
    await page.locator('[data-timeline-type-selector] [data-timeline-view="rooms"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('[data-timeline-type-selector] [data-timeline-view="rooms"]');
        return window.TimelineView?.current?.() === 'rooms'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    await page.locator('[data-timeline-type-selector] [data-timeline-view="animators"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('[data-timeline-type-selector] [data-timeline-view="animators"]');
        return window.TimelineView?.current?.() === 'animators'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });
    await page.locator('[data-timeline-type-selector] [data-timeline-view="rooms"]').click();
    await page.waitForFunction(() => {
        const btn = document.querySelector('[data-timeline-type-selector] [data-timeline-view="rooms"]');
        return window.TimelineView?.current?.() === 'rooms'
            && btn?.classList.contains('active')
            && btn?.getAttribute('aria-pressed') === 'true';
    });

    await setTimelineViewPanelOpen(page, true);
    const history = await page.evaluate(() => {
        const btn = document.getElementById('historyBtn');
        const rect = btn?.getBoundingClientRect?.();
        const style = btn ? getComputedStyle(btn) : null;
        const visible = Boolean(
            btn
            && rect
            && rect.width > 0
            && rect.height > 0
            && style?.display !== 'none'
            && style?.visibility !== 'hidden'
            && !btn.classList.contains('hidden')
        );
        return {
            exists: Boolean(btn),
            inTopbar: Boolean(btn?.closest('.timeline-header-actions')),
            inViewPanel: Boolean(btn?.closest('#timelineViewPanel .timeline-view-panel-actions')),
            visible,
            disabled: Boolean(btn?.disabled),
            title: btn?.getAttribute('title') || '',
            ariaLabel: btn?.getAttribute('aria-label') || '',
            canView: typeof canViewHistory === 'function' ? Boolean(canViewHistory()) : null
        };
    });
    assert.equal(history.exists, true, 'history button exists');
    assert.equal(history.inTopbar, false, 'history button is not mounted in the topbar');
    assert.equal(history.inViewPanel, true, 'history button is mounted in the timeline filter panel actions');
    assert.match(`${history.title} ${history.ariaLabel}`, /Історія|історію/i, 'history button keeps accessible labeling');
    if (history.canView !== false) {
        assert.equal(history.visible, true, 'history button is reachable from the opened filter panel for the authenticated timeline user');
        assert.equal(history.disabled, false, 'history button is enabled for the authenticated timeline user');
        await page.locator('#historyBtn').click();
        await page.waitForFunction(() => {
            const modal = document.getElementById('historyModal');
            return Boolean(modal && !modal.classList.contains('hidden'));
        });
        await page.evaluate(() => document.getElementById('historyModal')?.classList.add('hidden'));
    }
    await setTimelineViewPanelOpen(page, false);
}

async function assertTimelineHeaderAnd15MinuteGeometry(page, date, bookingId) {
    const desktopViewports = [
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1366, height: 768 }
    ];
    const narrowViewports = [
        { width: 768, height: 900 },
        { width: 430, height: 932 },
        { width: 390, height: 844 }
    ];
    const readZoomState = () => page.evaluate(() => {
        const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('zoom_level') : 'pzp_zoom_level';
        const buttons = Array.from(document.querySelectorAll('.timeline-header-filters .zoom-btn')).map(btn => ({
            zoom: btn.dataset.zoom,
            active: btn.classList.contains('active'),
            pressed: btn.getAttribute('aria-pressed')
        }));
        return {
            configCellMinutes: Number(CONFIG?.TIMELINE?.CELL_MINUTES),
            appZoomLevel: Number(AppState?.zoomLevel),
            savedZoom: localStorage.getItem(key),
            activeZoom: buttons.find(btn => btn.active)?.zoom || '',
            filterBadgeCount: document.getElementById('timelineViewPanelToggle')?.dataset.filterCount || '',
            filterBadgeVisible: document.getElementById('timelineViewPanelToggle')?.classList.contains('has-active-filters') || false,
            buttons
        };
    });
    const assertZoomLevel = async (level, label) => {
        const expected = String(level);
        await page.evaluate(() => {
            const panel = document.getElementById('timelineViewPanel');
            const toggle = document.getElementById('timelineViewPanelToggle');
            if (panel?.hidden) toggle?.click();
        });
        await page.waitForFunction(() => document.getElementById('timelineViewPanel') && !document.getElementById('timelineViewPanel').hidden);
        await page.locator(`#timelineViewPanel .zoom-btn[data-zoom="${expected}"]`).click();
        await page.waitForFunction(zoom => {
            const zoomButton = document.querySelector(`#timelineViewPanel .zoom-btn[data-zoom="${zoom}"]`);
            return Number(CONFIG?.TIMELINE?.CELL_MINUTES) === Number(zoom)
                && Number(AppState?.zoomLevel) === Number(zoom)
                && zoomButton?.classList.contains('active')
                && zoomButton?.getAttribute('aria-pressed') === 'true';
        }, expected);
        const state = await readZoomState();
        assert.equal(state.configCellMinutes, level, `${label}: CONFIG.TIMELINE.CELL_MINUTES is ${level}`);
        assert.equal(state.appZoomLevel, level, `${label}: AppState.zoomLevel is ${level}`);
        assert.equal(state.savedZoom, expected, `${label}: saved zoom preference is ${expected}`);
        assert.equal(state.activeZoom, expected, `${label}: active zoom button is ${expected}`);
        assert.equal(state.filterBadgeCount, level === 15 ? '0' : '1', `${label}: filter badge reflects zoom default state`);
        assert.equal(state.filterBadgeVisible, level !== 15, `${label}: filter badge visibility follows zoom default state`);
        for (const button of state.buttons) {
            assert.equal(button.pressed, button.zoom === expected ? 'true' : 'false', `${label}: aria-pressed for ${button.zoom}`);
            assert.equal(button.active, button.zoom === expected, `${label}: active class for ${button.zoom}`);
        }
    };

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
        if (typeof AppState !== 'undefined') AppState.compactMode = true;
        localStorage.setItem('pzp_compact_mode', 'true');
        document.body?.classList?.add('timeline-compact-mode');
        document.documentElement?.classList?.add('timeline-compact-mode');
    });
    await renderTimelineView(page, date, 'animators');
    await assertTimelineViewPanelInteractions(page);
    await assertZoomLevel(30, '30-minute zoom switch');
    await assertZoomLevel(60, '60-minute zoom switch');
    await assertZoomLevel(15, '15-minute zoom switch');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTimelineReady(page, 'timeline reload after zoom preference');
    await renderTimelineView(page, date, 'animators');
    const reloadedZoom = await readZoomState();
    assert.equal(reloadedZoom.configCellMinutes, 15, 'saved 15-minute zoom survives reload in CONFIG');
    assert.equal(reloadedZoom.appZoomLevel, 15, 'saved 15-minute zoom survives reload in AppState');
    assert.equal(reloadedZoom.savedZoom, '15', 'saved 15-minute zoom remains in localStorage after reload');
    assert.equal(reloadedZoom.activeZoom, '15', 'saved 15-minute zoom button remains active after reload');
    for (const button of reloadedZoom.buttons) {
        assert.equal(button.pressed, button.zoom === '15' ? 'true' : 'false', `reload: aria-pressed for ${button.zoom}`);
        assert.equal(button.active, button.zoom === '15', `reload: active class for ${button.zoom}`);
    }
    await assertBookingBlockVisible(page, bookingId);

    const readMetrics = () => page.evaluate(id => {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const visibleRect = (selector) => {
            const el = document.querySelector(selector);
            const rect = el?.getBoundingClientRect?.();
            const style = el ? getComputedStyle(el) : null;
            return {
                selector,
                exists: Boolean(el),
                visible: Boolean(
                    el
                    && rect
                    && rect.width > 0
                    && rect.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.left >= -1
                    && rect.right <= viewportWidth + 1
                ),
                width: rect ? Math.round(rect.width * 100) / 100 : 0,
                height: rect ? Math.round(rect.height * 100) / 100 : 0,
                top: rect ? Math.round(rect.top * 100) / 100 : 0,
                bottom: rect ? Math.round(rect.bottom * 100) / 100 : 0,
                left: rect ? Math.round(rect.left * 100) / 100 : 0,
                right: rect ? Math.round(rect.right * 100) / 100 : 0
            };
        };
        const anyVisible = (selector) => Array.from(document.querySelectorAll(selector)).some(el => {
            const rect = el.getBoundingClientRect?.();
            const style = getComputedStyle(el);
            return Boolean(
                rect
                && rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
            );
        });
        const criticalSelectors = [
            '#timelineViewPanelToggle',
            '.header .timeline-header-actions #logoutBtn'
        ];
        const critical = criticalSelectors.map(visibleRect);
        const hiddenControls = critical.filter(item => !item.visible);
        const panel = document.getElementById('timelineViewPanel');
        const filters = document.querySelector('.timeline-header-filters');
        const headerContent = document.querySelector('.header .header-content');
        const actions = document.querySelector('.header .timeline-header-actions');
        const history = document.getElementById('historyBtn');
        const logout = document.querySelector('.header .timeline-header-actions #logoutBtn');
        const themeToggle = document.querySelector('.header .timeline-header-actions #headerThemeToggle');
        const viewToggle = document.getElementById('timelineViewPanelToggle');
        const settings = document.querySelector('.header .timeline-header-actions #timelineConstructorBtn');
        const commandCenter = document.querySelector('.schedule-command-center.toolbarContainer');
        const utilityRow = document.querySelector('.schedule-command-row--utility');
        const dateControls = document.querySelector('.schedule-command-row--utility .date-controls');
        const typeSwitch = document.querySelector('.schedule-command-row--utility .timeline-visible-type-switch');
        const timelineContainer = document.querySelector('.timeline-container');
        const timeScale = document.querySelector('.timeline-container .time-scale');
        const timelineLines = document.querySelector('.timeline-container .timeline-lines');
        const dateInteractive = Array.from(document.querySelectorAll('.schedule-command-row--utility .date-controls button, .schedule-command-row--utility .date-controls input'));
        const dateInteractiveRects = dateInteractive.map(el => el.getBoundingClientRect?.()).filter(Boolean);
        const commandCenterRect = commandCenter?.getBoundingClientRect?.();
        const utilityRowRect = utilityRow?.getBoundingClientRect?.();
        const dateControlsRect = dateControls?.getBoundingClientRect?.();
        const typeSwitchRect = typeSwitch?.getBoundingClientRect?.();
        const timelineContainerRect = timelineContainer?.getBoundingClientRect?.();
        const timeScaleRect = timeScale?.getBoundingClientRect?.();
        const timelineLinesRect = timelineLines?.getBoundingClientRect?.();
        const panelRect = panel?.getBoundingClientRect?.();
        const filtersRect = filters?.getBoundingClientRect?.();
        const headerRect = headerContent?.getBoundingClientRect?.();
        const actionsRect = actions?.getBoundingClientRect?.();
        const historyRect = history?.getBoundingClientRect?.();
        const logoutRect = logout?.getBoundingClientRect?.();
        const themeToggleRect = themeToggle?.getBoundingClientRect?.();
        const viewToggleRect = viewToggle?.getBoundingClientRect?.();
        const settingsRect = settings?.getBoundingClientRect?.();
        const historyStyle = history ? getComputedStyle(history) : null;
        const settingsStyle = settings ? getComputedStyle(settings) : null;
        const settingsDividerStyle = settings ? getComputedStyle(settings, '::before') : null;
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const typeSwitchStyle = typeSwitch ? getComputedStyle(typeSwitch) : null;
        const actionsStyle = actions ? getComputedStyle(actions) : null;
        const historyVisible = Boolean(
            history
            && historyRect
            && historyRect.width > 0
            && historyRect.height > 0
            && historyStyle?.display !== 'none'
            && historyStyle?.visibility !== 'hidden'
            && !history.classList.contains('hidden')
        );
        const settingsVisible = Boolean(
            settings
            && settingsRect
            && settingsRect.width > 0
            && settingsRect.height > 0
            && settingsStyle?.display !== 'none'
            && settingsStyle?.visibility !== 'hidden'
            && settingsRect.left >= -1
            && settingsRect.right <= viewportWidth + 1
        );
        const settingsAllowed = Boolean(window.TimelineBusinessContext?.canUseAction?.('settings', window.AppState?.currentUser || null));
        const settingsDividerWidth = settingsDividerStyle ? Number.parseFloat(settingsDividerStyle.width) || 0 : 0;
        const settingsDividerHeight = settingsDividerStyle ? Number.parseFloat(settingsDividerStyle.height) || 0 : 0;
        const visibleTopbarControls = Array.from(actions?.children || []).filter(el => {
            const rect = el.getBoundingClientRect?.();
            const style = getComputedStyle(el);
            return Boolean(
                el.id
                && rect
                && rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && !el.classList.contains('hidden')
            );
        });
        const visibleTimelineControlIds = visibleTopbarControls
            .filter(el => ['timelineConstructorBtn', 'headerThemeToggle', 'logoutBtn'].includes(el.id))
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
            .map(el => el.id);
        const topbarRightmost = visibleTopbarControls.reduce((rightmost, el) => {
            if (!rightmost) return el;
            return el.getBoundingClientRect().right > rightmost.getBoundingClientRect().right ? el : rightmost;
        }, null);
        const visibleTimelineViewLabels = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(el => {
                const rect = el.getBoundingClientRect?.();
                const style = getComputedStyle(el);
                return Boolean(
                    rect
                    && rect.width > 0
                    && rect.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && !el.hidden
                );
            })
            .map(el => el.textContent.trim())
            .filter(Boolean);
        const filterOverflowX = filters ? Math.max(0, filters.scrollWidth - filters.clientWidth) : Number.NaN;
        const actionsOverflowX = actions ? Math.max(0, actions.scrollWidth - actions.clientWidth) : Number.NaN;
        const headerOverflowX = headerContent ? Math.max(0, headerContent.scrollWidth - headerContent.clientWidth) : Number.NaN;
        const dateControlsOverflowX = dateControls ? Math.max(0, dateControls.scrollWidth - dateControls.clientWidth) : Number.NaN;
        const bodyOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
        const previousScrollX = window.scrollX || window.pageXOffset || 0;
        const previousScrollY = window.scrollY || window.pageYOffset || 0;
        window.scrollTo(100000, previousScrollY);
        const pageScrollableX = Math.round(((window.scrollX || window.pageXOffset || 0)) * 100) / 100;
        window.scrollTo(previousScrollX, previousScrollY);
        const elementLabel = el => {
            if (!el) return '';
            const id = el.id ? `#${el.id}` : '';
            const classes = String(el.className || '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 4)
                .map(name => `.${name}`)
                .join('');
            return `${el.tagName?.toLowerCase?.() || 'node'}${id}${classes}`;
        };
        const isControlledOffCanvasSidebar = (el, rect) => {
            const sidebar = el?.closest?.('#sidebarNav');
            if (!sidebar) return false;
            const sidebarRect = sidebar.getBoundingClientRect?.();
            const sidebarStyle = getComputedStyle(sidebar);
            const documentFitsViewport = document.documentElement.scrollWidth <= viewportWidth + 1;
            const sidebarRailWidth = Math.max(48, Math.min(72, viewportWidth * 0.1));
            return Boolean(
                sidebarRect
                && sidebarRect.width > 0
                && sidebarRect.right <= sidebarRailWidth
                && sidebarRect.left < -1
                && documentFitsViewport
                && ['fixed', 'absolute', 'sticky'].includes(sidebarStyle.position)
            );
        };
        const allOverflowOffenders = Array.from(document.body?.querySelectorAll('*') || [])
            .map(el => {
                const rect = el.getBoundingClientRect?.();
                const style = getComputedStyle(el);
                if (!rect || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null;
                const overflowRight = Math.round((rect.right - viewportWidth) * 100) / 100;
                const overflowLeft = Math.round((0 - rect.left) * 100) / 100;
                if (overflowRight <= 1 && overflowLeft <= 1) return null;
                return {
                    selector: elementLabel(el),
                    right: Math.round(rect.right * 100) / 100,
                    left: Math.round(rect.left * 100) / 100,
                    width: Math.round(rect.width * 100) / 100,
                    overflowRight,
                    overflowLeft,
                    controlledTimelineScroll: Boolean(el.closest('.timeline-scroll')),
                    controlledOffCanvasSidebar: isControlledOffCanvasSidebar(el, rect)
                };
            })
            .filter(Boolean)
            .sort((a, b) => Math.max(b.overflowRight, b.overflowLeft) - Math.max(a.overflowRight, a.overflowLeft));
        const uncontrolledOverflowOffenders = allOverflowOffenders
            .filter(item => !item.controlledTimelineScroll && !item.controlledOffCanvasSidebar)
            .slice(0, 8);
        const controlledTimelineScrollOffenders = allOverflowOffenders
            .filter(item => item.controlledTimelineScroll)
            .slice(0, 8);
        const controlledOffCanvasSidebarOffenders = allOverflowOffenders
            .filter(item => item.controlledOffCanvasSidebar)
            .slice(0, 8);
        const uncontrolledOverflowX = uncontrolledOverflowOffenders.reduce(
            (max, item) => Math.max(max, item.overflowRight, item.overflowLeft),
            0
        );
        const overlaps = (a, b) => Boolean(
            a
            && b
            && a.right > b.left + 1
            && a.left < b.right - 1
            && a.bottom > b.top + 1
            && a.top < b.bottom - 1
        );
        const closedDateToTimelineGap = utilityRowRect && timelineContainerRect
            ? Math.round((timelineContainerRect.top - utilityRowRect.bottom) * 100) / 100
            : Number.NaN;
        const cell = document.querySelector('.line-grid .grid-cell');
        const block = document.querySelector(`.booking-block[data-booking-id="${CSS.escape(String(id))}"]:not(.status-hidden)`);
        return {
            viewportWidth,
            hiddenControls,
            searchVisible: anyVisible('.timeline-dashboard-page .header .btn-search, .timeline-dashboard-page .header #globalHeaderSearchBtn'),
            digestVisible: anyVisible('#digestBtn'),
            compactToggleVisible: anyVisible('#compactModeToggle, .timeline-header-filters .timeline-compact-toggle, .timeline-compact-toggle'),
            filterLabelVisible: anyVisible('.timeline-header-filters-label, .timeline-header-filter-icon--sliders'),
            viewPanelHidden: Boolean(panel?.hidden),
            viewToggleExpanded: viewToggle?.getAttribute('aria-expanded') || '',
            viewPanelLeft: panelRect ? Math.round(panelRect.left * 100) / 100 : Number.NaN,
            viewPanelRight: panelRect ? Math.round(panelRect.right * 100) / 100 : Number.NaN,
            viewPanelTop: panelRect ? Math.round(panelRect.top * 100) / 100 : Number.NaN,
            viewPanelBottom: panelRect ? Math.round(panelRect.bottom * 100) / 100 : Number.NaN,
            viewPanelWidth: panelRect ? Math.round(panelRect.width * 100) / 100 : 0,
            viewPanelHeight: panelRect ? Math.round(panelRect.height * 100) / 100 : 0,
            viewPanelLayoutVisible: Boolean(
                panel
                && panelRect
                && panelRect.width > 0
                && panelRect.height > 0
                && panelStyle?.display !== 'none'
                && panelStyle?.visibility !== 'hidden'
            ),
            viewPanelPosition: panelStyle?.position || '',
            viewPanelInCommandCenter: Boolean(panel?.closest('.schedule-command-center.toolbarContainer')),
            viewToggleInTopbar: Boolean(viewToggle?.closest('.timeline-header-actions')),
            viewToggleInDateRow: Boolean(viewToggle?.closest('.schedule-command-row--utility .date-controls')),
            historyExists: Boolean(history),
            historyInTopbar: Boolean(history?.closest('.timeline-header-actions')),
            historyInViewPanel: Boolean(history?.closest('#timelineViewPanel .timeline-view-panel-actions')),
            historyVisible,
            topbarRightmostId: topbarRightmost?.id || '',
            viewToggleLabel: viewToggle?.querySelector('.timeline-filter-label')?.textContent.trim() || viewToggle?.textContent.trim() || '',
            visibleTimelineViewLabels,
            commandCenterWidth: commandCenterRect ? Math.round(commandCenterRect.width * 100) / 100 : 0,
            commandCenterHeight: commandCenterRect ? Math.round(commandCenterRect.height * 100) / 100 : 0,
            utilityRowWidth: utilityRowRect ? Math.round(utilityRowRect.width * 100) / 100 : 0,
            utilityRowHeight: utilityRowRect ? Math.round(utilityRowRect.height * 100) / 100 : 0,
            utilityRowTop: utilityRowRect ? Math.round(utilityRowRect.top * 100) / 100 : Number.NaN,
            utilityRowBottom: utilityRowRect ? Math.round(utilityRowRect.bottom * 100) / 100 : Number.NaN,
            dateControlsWidth: dateControlsRect ? Math.round(dateControlsRect.width * 100) / 100 : 0,
            dateControlsHeight: dateControlsRect ? Math.round(dateControlsRect.height * 100) / 100 : 0,
            typeSwitchWidth: typeSwitchRect ? Math.round(typeSwitchRect.width * 100) / 100 : 0,
            typeSwitchHeight: typeSwitchRect ? Math.round(typeSwitchRect.height * 100) / 100 : 0,
            typeSwitchVisible: Boolean(
                typeSwitch
                && typeSwitchRect
                && typeSwitchRect.width > 0
                && typeSwitchRect.height > 0
                && typeSwitchStyle?.display !== 'none'
                && typeSwitchStyle?.visibility !== 'hidden'
            ),
            typeSwitchInViewPanel: Boolean(typeSwitch?.closest('#timelineViewPanel')),
            actionsWidth: actionsRect ? Math.round(actionsRect.width * 100) / 100 : 0,
            timelineTop: timelineContainerRect ? Math.round(timelineContainerRect.top * 100) / 100 : Number.NaN,
            timeScaleTop: timeScaleRect ? Math.round(timeScaleRect.top * 100) / 100 : Number.NaN,
            timelineLinesTop: timelineLinesRect ? Math.round(timelineLinesRect.top * 100) / 100 : Number.NaN,
            viewPanelCoversTimeline: overlaps(panelRect, timelineContainerRect),
            viewPanelCoversTimeScale: overlaps(panelRect, timeScaleRect),
            viewPanelCoversTimelineLines: overlaps(panelRect, timelineLinesRect),
            closedDateToTimelineGap,
            dateInteractiveIds: dateInteractive.map(el => el.id).join('|'),
            dateInteractiveNonzeroCount: dateInteractiveRects.filter(rect => rect.width > 0 && rect.height > 0).length,
            filterOverflowX,
            filtersHeight: filtersRect ? Math.round(filtersRect.height * 100) / 100 : 0,
            actionsOverflowX,
            headerOverflowX,
            actionsBorderLeftWidth: actionsStyle ? Number.parseFloat(actionsStyle.borderLeftWidth) || 0 : 0,
            dateControlsOverflowX,
            bodyOverflowX,
            pageScrollableX,
            uncontrolledOverflowX,
            overflowOffenders: allOverflowOffenders.slice(0, 8),
            uncontrolledOverflowOffenders,
            controlledTimelineScrollOffenders,
            controlledOffCanvasSidebarOffenders,
            configCellMinutes: Number(CONFIG?.TIMELINE?.CELL_MINUTES),
            activeZoom: document.querySelector('.timeline-header-filters .zoom-btn.active')?.dataset.zoom || '',
            headerLeft: headerRect ? Math.round(headerRect.left * 100) / 100 : Number.NaN,
            headerRight: headerRect ? Math.round(headerRect.right * 100) / 100 : Number.NaN,
            actionsRightGap: actionsRect ? Math.round((viewportWidth - actionsRect.right) * 100) / 100 : Number.NaN,
            actionsLeft: actionsRect ? Math.round(actionsRect.left * 100) / 100 : Number.NaN,
            filtersRight: filtersRect ? Math.round(filtersRect.right * 100) / 100 : Number.NaN,
            viewToggleRight: viewToggleRect ? Math.round(viewToggleRect.right * 100) / 100 : Number.NaN,
            settingsAllowed,
            settingsVisible,
            visibleTimelineControlIds: visibleTimelineControlIds.join('|'),
            settingsDividerVisible: Boolean(
                settingsVisible
                && settingsDividerStyle
                && settingsDividerStyle.content !== 'none'
                && settingsDividerStyle.display !== 'none'
                && settingsDividerWidth >= 1
                && settingsDividerHeight >= 12
            ),
            themeLeft: themeToggleRect ? Math.round(themeToggleRect.left * 100) / 100 : Number.NaN,
            themeRight: themeToggleRect ? Math.round(themeToggleRect.right * 100) / 100 : Number.NaN,
            settingsLeft: settingsRect ? Math.round(settingsRect.left * 100) / 100 : Number.NaN,
            settingsRight: settingsRect ? Math.round(settingsRect.right * 100) / 100 : Number.NaN,
            settingsTop: settingsRect ? Math.round(settingsRect.top * 100) / 100 : Number.NaN,
            settingsWidth: settingsRect ? Math.round(settingsRect.width * 100) / 100 : 0,
            logoutTop: logoutRect ? Math.round(logoutRect.top * 100) / 100 : Number.NaN,
            logoutLeft: logoutRect ? Math.round(logoutRect.left * 100) / 100 : Number.NaN,
            logoutWidth: logoutRect ? Math.round(logoutRect.width * 100) / 100 : Number.NaN,
            compactState: Boolean(AppState?.compactMode),
            compactStorage: localStorage.getItem('pzp_compact_mode'),
            htmlCompactClass: document.documentElement.classList.contains('timeline-compact-mode'),
            bodyCompactClass: document.body?.classList?.contains('timeline-compact-mode') || false,
            containerCompactClass: document.querySelector('.timeline-container')?.classList?.contains('compact') || false,
            timelineDensity: document.documentElement.style.getPropertyValue('--timeline-density'),
            fitScreen: document.querySelector('.timeline-container')?.dataset?.fitScreen || '',
            cellWidth: cell ? cell.getBoundingClientRect().width : 0,
            bookingWidth: block ? block.getBoundingClientRect().width : 0,
            bookingLeft: block ? block.getBoundingClientRect().left : 0
        };
    }, bookingId);

    async function assertHiddenSettingsDividerIsAbsent(label) {
        const dividerVisible = await page.evaluate(() => {
            const settings = document.querySelector('.header .timeline-header-actions #timelineConstructorBtn');
            if (!settings) return false;
            const wasHidden = settings.classList.contains('hidden');
            settings.classList.add('hidden');
            const rect = settings.getBoundingClientRect?.();
            const style = getComputedStyle(settings, '::before');
            const visible = Boolean(
                rect
                && rect.width > 0
                && rect.height > 0
                && style.content !== 'none'
                && style.display !== 'none'
                && (Number.parseFloat(style.width) || 0) >= 1
                && (Number.parseFloat(style.height) || 0) >= 12
            );
            if (!wasHidden) settings.classList.remove('hidden');
            return visible;
        });
        assert.equal(dividerVisible, false, `hidden settings gear leaves no orphan divider at ${label}`);
    }

    for (const viewport of desktopViewports) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => {
            const panel = document.getElementById('timelineViewPanel');
            const toggle = document.getElementById('timelineViewPanelToggle');
            if (panel && !panel.hidden) toggle?.click();
        });
        await page.waitForFunction(() => document.getElementById('timelineViewPanelToggle')?.getBoundingClientRect?.().width > 0);
        await waitForTimelineTypeSwitch(page, `timeline type switch after desktop viewport ${viewport.width}x${viewport.height}`);
        await waitForTimelineLayoutSettle(page, `closed desktop layout ${viewport.width}x${viewport.height}`);
        const metrics = await readMetrics();
        const label = `${viewport.width}x${viewport.height}`;

        assert.deepEqual(metrics.hiddenControls, [], `timeline topbar critical controls visible at ${label}: ${JSON.stringify(metrics.hiddenControls)}`);
        assert.equal(metrics.searchVisible, false, `timeline header search button is not visible at ${label}`);
        assert.equal(metrics.digestVisible, false, `timeline digest button is not rendered at ${label}`);
        assert.equal(metrics.compactToggleVisible, false, `timeline compact toggle is not visible at ${label}`);
        assert.equal(metrics.filterLabelVisible, false, `timeline filter label/sliders control is not visible at ${label}`);
        assert.equal(metrics.viewPanelHidden, true, `timeline view panel is hidden by default at ${label}`);
        assert.equal(metrics.viewPanelLayoutVisible, false, `hidden timeline view panel does not occupy layout space at ${label}`);
        assert.equal(metrics.viewToggleExpanded, 'false', `timeline view toggle is collapsed by default at ${label}`);
        assert.equal(metrics.viewToggleInTopbar, false, `view panel toggle is not mounted in the topbar at ${label}`);
        assert.equal(metrics.viewToggleInDateRow, true, `view panel toggle is mounted in the date utility row at ${label}`);
        assert.equal(metrics.typeSwitchVisible, true, `timeline type switch is visible in the utility row at ${label}`);
        assert.equal(metrics.typeSwitchInViewPanel, false, `timeline type switch is not duplicated in the filter shelf at ${label}`);
        assert.equal(metrics.historyExists, true, `history button exists at ${label}`);
        assert.equal(metrics.historyInTopbar, false, `history button is not mounted in the topbar at ${label}`);
        assert.equal(metrics.historyInViewPanel, true, `history button is mounted in the filter panel actions at ${label}`);
        assert.equal(metrics.historyVisible, false, `history button is hidden with the collapsed filter panel at ${label}`);
        assert.equal(metrics.topbarRightmostId, 'logoutBtn', `logout button is the rightmost visible topbar control at ${label}`);
        assert.equal(metrics.viewToggleLabel, 'Фільтри', `view trigger is renamed to filters at ${label}`);
        assert.equal(metrics.visibleTimelineViewLabels.includes('Вигляд'), false, `old view label is not visible at ${label}`);
        assert.equal(metrics.dateInteractiveIds, 'prevDay|timelineDate|todayBtn|nextDay|timelineViewPanelToggle', `date row contains date controls and the view trigger at ${label}`);
        assert.equal(metrics.dateInteractiveNonzeroCount, 5, `date row controls keep visible hit targets at ${label}`);
        assert.ok(metrics.utilityRowHeight <= 52, `date utility row stays compact at ${label}: ${metrics.utilityRowHeight}px`);
        assert.ok(metrics.dateControlsHeight <= 52, `date controls stay compact at ${label}: ${metrics.dateControlsHeight}px`);
        assert.ok(metrics.commandCenterHeight <= 96, `command center does not create a large empty band at ${label}: ${metrics.commandCenterHeight}px`);
        assert.ok(metrics.closedDateToTimelineGap >= 0 && metrics.closedDateToTimelineGap <= 64, `closed filters state keeps date row close to timeline at ${label}: ${metrics.closedDateToTimelineGap}px`);
        assert.ok(metrics.commandCenterWidth <= Math.max(metrics.dateControlsWidth + metrics.typeSwitchWidth + 24, metrics.actionsWidth) + 32, `command center shrink-wraps visible controls at ${label}: command=${metrics.commandCenterWidth}px date=${metrics.dateControlsWidth}px type=${metrics.typeSwitchWidth}px actions=${metrics.actionsWidth}px`);
        assert.ok(metrics.utilityRowWidth <= metrics.dateControlsWidth + metrics.typeSwitchWidth + 24, `utility row does not stretch beyond the date and type controls at ${label}: row=${metrics.utilityRowWidth}px date=${metrics.dateControlsWidth}px type=${metrics.typeSwitchWidth}px`);
        assert.ok(metrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX, `timeline page does not create uncontrolled horizontal overflow at ${label}: uncontrolled=${metrics.uncontrolledOverflowX}; body=${metrics.bodyOverflowX}; pageScroll=${metrics.pageScrollableX}; offenders=${JSON.stringify(metrics.uncontrolledOverflowOffenders)}; controlledTimelineScroll=${JSON.stringify(metrics.controlledTimelineScrollOffenders)}; controlledOffCanvasSidebar=${JSON.stringify(metrics.controlledOffCanvasSidebarOffenders)}`);
        assert.ok(metrics.actionsOverflowX <= 2, `timeline topbar action group does not overflow on desktop at ${label}: ${metrics.actionsOverflowX}`);
        assert.ok(metrics.headerOverflowX <= 2, `timeline header does not overflow on desktop at ${label}: ${metrics.headerOverflowX}`);
        assert.ok(metrics.actionsBorderLeftWidth >= 1, `main right control panel divider remains at ${label}: ${metrics.actionsBorderLeftWidth}px`);
        assert.ok(metrics.actionsRightGap >= 0 && metrics.actionsRightGap <= 96, `logout action zone stays pinned to the right at ${label}: ${metrics.actionsRightGap}px`);
        assert.ok(metrics.logoutTop >= 0 && metrics.logoutTop <= 120, `logout stays in the top header row at ${label}: ${metrics.logoutTop}px`);
        assert.ok(metrics.logoutWidth >= 72, `logout button stays visibly highlighted at ${label}: ${metrics.logoutWidth}px`);
        if (metrics.settingsAllowed) {
            assert.equal(metrics.settingsVisible, true, `settings gear is visible for settings-capable user at ${label}`);
            assert.equal(metrics.settingsDividerVisible, false, `settings gear has no local divider at ${label}`);
            assert.equal(metrics.visibleTimelineControlIds, 'timelineConstructorBtn|headerThemeToggle|logoutBtn', `timeline topbar controls are ordered settings, theme, logout at ${label}`);
            assert.ok(metrics.settingsWidth >= 32, `settings gear keeps usable hit target at ${label}: ${metrics.settingsWidth}px`);
            assert.ok(metrics.settingsRight <= metrics.themeLeft + 1, `settings gear stays before theme toggle at ${label}: ${metrics.settingsRight}px vs ${metrics.themeLeft}px`);
            assert.ok(metrics.themeRight <= metrics.logoutLeft + 1, `theme toggle stays before logout at ${label}: ${metrics.themeRight}px vs ${metrics.logoutLeft}px`);
            assert.ok(metrics.settingsRight <= metrics.logoutLeft + 1, `settings gear stays before logout at ${label}: ${metrics.settingsRight}px vs ${metrics.logoutLeft}px`);
            assert.ok(Math.abs(metrics.settingsTop - metrics.logoutTop) <= 16, `settings gear stays near logout vertically at ${label}: ${metrics.settingsTop}px vs ${metrics.logoutTop}px`);
        } else {
            assert.equal(metrics.settingsDividerVisible, false, `settings divider is not visible without settings access at ${label}`);
        }
        await assertHiddenSettingsDividerIsAbsent(label);
        assert.equal(metrics.configCellMinutes, 15, `15-minute zoom updates CONFIG.TIMELINE.CELL_MINUTES at ${label}`);
        assert.equal(metrics.activeZoom, '15', `15-minute zoom button is active after click at ${label}`);
        assert.equal(metrics.compactState, false, `legacy compact preference is ignored after render at ${label}`);
        assert.equal(metrics.compactStorage, null, `legacy compact preference is removed at ${label}`);
        assert.equal(metrics.htmlCompactClass, false, `html compact class is not applied at ${label}`);
        assert.equal(metrics.bodyCompactClass, false, `body compact class is not applied at ${label}`);
        assert.equal(metrics.containerCompactClass, false, `timeline container compact class is not applied at ${label}`);
        assert.equal(metrics.timelineDensity, 'regular', `timeline density remains regular at ${label}`);
        assert.equal(metrics.fitScreen, 'scroll', `timeline keeps normal scroll layout instead of compact fit-screen at ${label}`);
        assert.ok(metrics.cellWidth >= 48, `15-minute desktop grid cell stays readable at ${label}: ${metrics.cellWidth}px`);
        assert.ok(metrics.bookingWidth >= 150, `15-minute 60-minute booking block stays readable at ${label}: ${metrics.bookingWidth}px`);

        await setTimelineViewPanelOpen(page, true);
        await waitForTimelineLayoutSettle(page, `open desktop layout ${viewport.width}x${viewport.height}`);
        const openMetrics = await readMetrics();
        assert.equal(openMetrics.viewPanelHidden, false, `timeline view panel opens as a compact filter shelf at ${label}`);
        assert.equal(openMetrics.viewPanelLayoutVisible, true, `open timeline view panel is layout-visible at ${label}`);
        assert.equal(openMetrics.viewPanelInCommandCenter, true, `view panel is mounted inside the command center at ${label}`);
        assert.equal(openMetrics.viewPanelPosition, 'relative', `view panel is a normal-flow shelf, not a popover, at ${label}`);
        assert.ok(openMetrics.viewPanelTop >= openMetrics.utilityRowBottom - 1, `view panel opens below the date command line at ${label}: panel=${openMetrics.viewPanelTop}px row=${openMetrics.utilityRowBottom}px`);
        assert.ok(openMetrics.viewPanelTop <= openMetrics.utilityRowBottom + 18, `view panel stays attached to the filter trigger at ${label}: panel=${openMetrics.viewPanelTop}px row=${openMetrics.utilityRowBottom}px`);
        assert.ok(openMetrics.commandCenterHeight > metrics.commandCenterHeight + 8, `opening filters grows the command center as a shelf at ${label}: closed=${metrics.commandCenterHeight}px open=${openMetrics.commandCenterHeight}px`);
        assert.ok(openMetrics.timelineTop >= openMetrics.viewPanelBottom - 1, `timeline starts below the open filter shelf at ${label}: timeline=${openMetrics.timelineTop}px shelf=${openMetrics.viewPanelBottom}px`);
        assert.ok(openMetrics.timelineTop >= metrics.timelineTop, `opening filters does not overlay timeline at ${label}: closed=${metrics.timelineTop}px open=${openMetrics.timelineTop}px`);
        assert.equal(openMetrics.viewPanelCoversTimeline, false, `open filter shelf does not cover the timeline container at ${label}`);
        assert.equal(openMetrics.viewPanelCoversTimeScale, false, `open filter shelf does not cover timeline time labels at ${label}: shelf=${openMetrics.viewPanelBottom}px scale=${openMetrics.timeScaleTop}px`);
        assert.equal(openMetrics.viewPanelCoversTimelineLines, false, `open filter shelf does not cover timeline rows at ${label}: shelf=${openMetrics.viewPanelBottom}px lines=${openMetrics.timelineLinesTop}px`);
        assert.ok(openMetrics.viewPanelWidth <= Math.min(1040, openMetrics.viewportWidth) + 2, `open view panel stays shelf-width at ${label}: ${openMetrics.viewPanelWidth}px`);
        assert.ok(openMetrics.viewPanelHeight <= 220, `open view panel avoids a large blank area at ${label}: ${openMetrics.viewPanelHeight}px`);
        assert.ok(openMetrics.viewPanelRight <= openMetrics.viewportWidth + 1, `open view panel stays inside viewport at ${label}: ${openMetrics.viewPanelRight}px`);
        assert.ok(openMetrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX, `open attached view panel does not create uncontrolled body overflow at ${label}: uncontrolled=${openMetrics.uncontrolledOverflowX}; body=${openMetrics.bodyOverflowX}; pageScroll=${openMetrics.pageScrollableX}; offenders=${JSON.stringify(openMetrics.uncontrolledOverflowOffenders)}; controlledTimelineScroll=${JSON.stringify(openMetrics.controlledTimelineScrollOffenders)}; controlledOffCanvasSidebar=${JSON.stringify(openMetrics.controlledOffCanvasSidebarOffenders)}`);
        await setTimelineViewPanelOpen(page, false);
    }

    for (const viewport of narrowViewports) {
        await page.setViewportSize(viewport);
        await setTimelineViewPanelOpen(page, false);
        await waitForTimelineTypeSwitch(page, `timeline type switch after narrow viewport ${viewport.width}x${viewport.height}`);
        await waitForTimelineLayoutSettle(page, `closed narrow layout ${viewport.width}x${viewport.height}`);
        const metrics = await readMetrics();
        const label = `${viewport.width}x${viewport.height}`;

        assert.equal(metrics.searchVisible, false, `timeline header search button is not visible at narrow ${label}`);
        assert.equal(metrics.digestVisible, false, `timeline digest button is not rendered at narrow ${label}`);
        assert.equal(metrics.compactToggleVisible, false, `timeline compact toggle is not visible at narrow ${label}`);
        assert.equal(metrics.viewPanelHidden, true, `timeline view panel is hidden by default at narrow ${label}`);
        assert.equal(metrics.viewPanelLayoutVisible, false, `hidden timeline view panel does not occupy layout space at narrow ${label}`);
        assert.equal(metrics.viewToggleExpanded, 'false', `timeline view toggle is collapsed by default at narrow ${label}`);
        assert.equal(metrics.viewToggleInTopbar, false, `view panel toggle is not mounted in the topbar at narrow ${label}`);
        assert.equal(metrics.viewToggleInDateRow, true, `view panel toggle is mounted in the date utility row at narrow ${label}`);
        assert.equal(metrics.typeSwitchVisible, true, `timeline type switch is visible in the utility row at narrow ${label}`);
        assert.equal(metrics.typeSwitchInViewPanel, false, `timeline type switch is not duplicated in the filter shelf at narrow ${label}`);
        assert.equal(metrics.historyExists, true, `history button exists at narrow ${label}`);
        assert.equal(metrics.historyInTopbar, false, `history button is not mounted in the topbar at narrow ${label}`);
        assert.equal(metrics.historyInViewPanel, true, `history button is mounted in the filter panel actions at narrow ${label}`);
        assert.equal(metrics.historyVisible, false, `history button is hidden with the collapsed filter panel at narrow ${label}`);
        assert.equal(metrics.topbarRightmostId, 'logoutBtn', `logout button is the rightmost visible topbar control at narrow ${label}`);
        assert.equal(metrics.viewToggleLabel, 'Фільтри', `view trigger is renamed to filters at narrow ${label}`);
        assert.equal(metrics.visibleTimelineViewLabels.includes('Вигляд'), false, `old view label is not visible at narrow ${label}`);
        assert.equal(metrics.dateInteractiveIds, 'prevDay|timelineDate|todayBtn|nextDay|timelineViewPanelToggle', `date row contains date controls and the view trigger at narrow ${label}`);
        assert.equal(metrics.dateInteractiveNonzeroCount, 5, `date row controls keep visible hit targets at narrow ${label}`);
        assert.ok(metrics.utilityRowHeight <= 144, `date utility row wraps compactly at narrow ${label}: ${metrics.utilityRowHeight}px`);
        assert.ok(metrics.dateControlsHeight <= 104, `date controls wrap compactly at narrow ${label}: ${metrics.dateControlsHeight}px`);
        assert.ok(metrics.commandCenterHeight <= 156, `command center avoids a large empty band at narrow ${label}: ${metrics.commandCenterHeight}px`);
        assert.ok(metrics.closedDateToTimelineGap >= 0 && metrics.closedDateToTimelineGap <= 96, `closed filters state keeps date row close to timeline at narrow ${label}: ${metrics.closedDateToTimelineGap}px`);
        assert.ok(metrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX, `timeline page does not create uncontrolled horizontal overflow at narrow ${label}: uncontrolled=${metrics.uncontrolledOverflowX}; body=${metrics.bodyOverflowX}; pageScroll=${metrics.pageScrollableX}; offenders=${JSON.stringify(metrics.uncontrolledOverflowOffenders)}; controlledTimelineScroll=${JSON.stringify(metrics.controlledTimelineScrollOffenders)}; controlledOffCanvasSidebar=${JSON.stringify(metrics.controlledOffCanvasSidebarOffenders)}`);
        assert.ok(metrics.headerOverflowX <= 2, `timeline header does not leak horizontal overflow at narrow ${label}: ${metrics.headerOverflowX}`);
        assert.ok(metrics.actionsBorderLeftWidth >= 1, `main right control panel divider remains at narrow ${label}: ${metrics.actionsBorderLeftWidth}px`);
        assert.ok(metrics.headerLeft >= -1 && metrics.headerRight <= metrics.viewportWidth + 1, `timeline header remains within viewport at narrow ${label}: ${metrics.headerLeft}px..${metrics.headerRight}px`);
        if (metrics.settingsAllowed) {
            assert.equal(metrics.settingsVisible, true, `settings gear is visible for settings-capable user at narrow ${label}`);
            assert.equal(metrics.settingsDividerVisible, false, `settings gear has no local divider at narrow ${label}`);
            assert.equal(metrics.visibleTimelineControlIds, 'timelineConstructorBtn|headerThemeToggle|logoutBtn', `timeline topbar controls are ordered settings, theme, logout at narrow ${label}`);
            assert.ok(metrics.settingsRight <= metrics.themeLeft + 1, `settings gear stays before theme toggle at narrow ${label}: ${metrics.settingsRight}px vs ${metrics.themeLeft}px`);
            assert.ok(metrics.themeRight <= metrics.logoutLeft + 1, `theme toggle stays before logout at narrow ${label}: ${metrics.themeRight}px vs ${metrics.logoutLeft}px`);
            assert.ok(metrics.settingsRight <= metrics.logoutLeft + 1, `settings gear stays before logout at narrow ${label}: ${metrics.settingsRight}px vs ${metrics.logoutLeft}px`);
        } else {
            assert.equal(metrics.settingsDividerVisible, false, `settings divider is not visible without settings access at narrow ${label}`);
        }
        await assertHiddenSettingsDividerIsAbsent(`narrow ${label}`);

        await setTimelineViewPanelOpen(page, true);
        await waitForTimelineLayoutSettle(page, `open narrow layout ${viewport.width}x${viewport.height}`);
        const openMetrics = await readMetrics();
        assert.equal(openMetrics.viewPanelHidden, false, `timeline view panel opens at narrow ${label}`);
        assert.equal(openMetrics.viewPanelLayoutVisible, true, `open timeline view panel is layout-visible at narrow ${label}`);
        assert.equal(openMetrics.viewToggleExpanded, 'true', `timeline view toggle expands at narrow ${label}`);
        assert.equal(openMetrics.viewPanelInCommandCenter, true, `view panel is mounted inside the command center at narrow ${label}`);
        assert.equal(openMetrics.viewPanelPosition, 'relative', `view panel is a normal-flow shelf at narrow ${label}`);
        assert.ok(openMetrics.viewPanelTop >= openMetrics.utilityRowBottom - 1, `view panel opens below the command area at narrow ${label}: panel=${openMetrics.viewPanelTop}px row=${openMetrics.utilityRowBottom}px`);
        assert.ok(openMetrics.commandCenterHeight > metrics.commandCenterHeight + 8, `opening filters grows command center as a shelf at narrow ${label}: closed=${metrics.commandCenterHeight}px open=${openMetrics.commandCenterHeight}px`);
        assert.ok(openMetrics.timelineTop >= openMetrics.viewPanelBottom - 1, `timeline starts below the open filter shelf at narrow ${label}: timeline=${openMetrics.timelineTop}px shelf=${openMetrics.viewPanelBottom}px`);
        assert.ok(openMetrics.timelineTop >= metrics.timelineTop, `opening filters does not overlay timeline at narrow ${label}: closed=${metrics.timelineTop}px open=${openMetrics.timelineTop}px`);
        assert.equal(openMetrics.viewPanelCoversTimeline, false, `open filter shelf does not cover the timeline container at narrow ${label}`);
        assert.equal(openMetrics.viewPanelCoversTimeScale, false, `open filter shelf does not cover timeline time labels at narrow ${label}: shelf=${openMetrics.viewPanelBottom}px scale=${openMetrics.timeScaleTop}px`);
        assert.equal(openMetrics.viewPanelCoversTimelineLines, false, `open filter shelf does not cover timeline rows at narrow ${label}: shelf=${openMetrics.viewPanelBottom}px lines=${openMetrics.timelineLinesTop}px`);
        assert.ok(openMetrics.viewPanelHeight <= 320, `open view panel wraps without a huge blank area at narrow ${label}: ${openMetrics.viewPanelHeight}px`);
        assert.ok(openMetrics.uncontrolledOverflowX <= TIMELINE_SHELL_OVERFLOW_TOLERANCE_PX, `open view panel does not create uncontrolled body overflow at narrow ${label}: uncontrolled=${openMetrics.uncontrolledOverflowX}; body=${openMetrics.bodyOverflowX}; pageScroll=${openMetrics.pageScrollableX}; offenders=${JSON.stringify(openMetrics.uncontrolledOverflowOffenders)}; controlledTimelineScroll=${JSON.stringify(openMetrics.controlledTimelineScrollOffenders)}; controlledOffCanvasSidebar=${JSON.stringify(openMetrics.controlledOffCanvasSidebarOffenders)}`);
        assert.ok(openMetrics.viewPanelLeft >= -1, `open view panel stays inside the left viewport edge at narrow ${label}: ${openMetrics.viewPanelLeft}px`);
        assert.ok(openMetrics.viewPanelRight <= openMetrics.viewportWidth + 1, `open view panel stays inside the right viewport edge at narrow ${label}: ${openMetrics.viewPanelRight}px`);
        await setTimelineViewPanelOpen(page, false);
    }

    await page.setViewportSize({ width: 1440, height: 960 });
    await setTimelineViewPanelOpen(page, false);
    await waitForTimelineTypeSwitch(page, 'timeline type switch after geometry viewport reset');
    await waitForTimelineLayoutSettle(page, 'timeline layout after geometry viewport reset');
}

async function runRevealAction(page, date, kitchenId) {
    await renderTimelineView(page, date, 'rooms');
    await page.evaluate(async id => {
        await showBookingDetails(id);
        if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
    }, kitchenId);
    await page.getByRole('button', { name: /Показати в кімнатах/i }).click();
    await page.waitForFunction(() => window.TimelineView?.current?.() === 'rooms');
    await assertRoomMarkerVisible(page, kitchenId);
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or TIMELINE_BROWSER_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    if (!isLocalBase(base) && !ALLOW_NON_LOCAL) {
        fail(`refusing non-local browser smoke for ${base}; set TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION=true for an explicitly approved protected run`);
    }
    if (!isLocalBase(base) && !CLEANUP) {
        fail('refusing production timeline smoke with TIMELINE_BROWSER_SMOKE_CLEANUP=false; guarded QA cleanup is mandatory');
    }

    let playwright;
    try {
        playwright = requirePlaywright();
    } catch (err) {
        fail(`Playwright is not available. Run through: npx --yes --package playwright node tests/browser/timeline-browser-smoke.js ${base}`);
    }

    const session = await login(base);
    const token = session.token;
    const date = process.env.TIMELINE_BROWSER_SMOKE_DATE || futureDate();
    const secondDate = datePlus(date, 1);
    const room = DEFAULT_ROOM;
    const createdBookingIds = [];
    const createdCustomerIds = [];
    const createdBanquetCleanupTargets = [];
    let bookingTimeDate = date;

    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let context;
    let page;
    try {
        const animator = await firstAnimatorLine(base, token, date);
        const bookingTimeSlot = await findBookingTimeSmokeSlot(base, token, room);
        bookingTimeDate = bookingTimeSlot.date;
        const customerA = await createCustomer(base, token, 'activity-first');
        const customerB = await createCustomer(base, token, 'kitchen-first');
        createdCustomerIds.push(customerA.id, customerB.id);

        const activity = await createBooking(base, token, bookingPayload({
            date,
            time: '13:00',
            lineId: animator.id,
            lineName: animator.name,
            room,
            label: `Task37 activity first ${RUN_ID}`,
            programCode: 'TASK37-ACT',
            category: 'animation',
            duration: 60,
            price: 1000,
            customerId: customerA.id,
            customerName: customerA.name,
            customerPhone: customerA.phone,
            childName: customerA.childName,
            kidsCount: 4
        }));
        createdBookingIds.push(activity.id);

        ({ context, page } = await openAuthenticatedPage(browser, base, session));
        const bookingTimeCreate = await assertBookingTimeCreateDurability(
            page,
            bookingTimeDate,
            bookingTimeSlot.line,
            room,
            customerA
        );
        assert.ok(bookingTimeCreate?.id, 'booking time durability retry returned created booking');
        createdBookingIds.push(bookingTimeCreate.id);
        if (BOOKING_TIME_ONLY) {
            console.log(`Timeline booking-time smoke OK: ${base} date=${bookingTimeDate} room=${room}`);
            console.log('  OK booking start 12:15 -> 12:30, 409 draft durability, create payload, and responsive drawer');
            return;
        }
        await context.close();
        ({ context, page } = await openAuthenticatedPage(browser, base, session));
        await assertTimelineDeepLinkSwitching(page, base, date);
        await assertTimelineHeaderAnd15MinuteGeometry(page, date, activity.id);

        const activityFirstDrawer = await openRoomDrawer(page, date, room, '13:00');
        assertBridgeSelector(activityFirstDrawer, 'activity first -> kitchen');
        const kitchenFromActivity = await fillKitchenAndSubmit(page, activity);
        assert.ok(kitchenFromActivity?.id, 'kitchen booking created from activity source');
        createdBookingIds.push(kitchenFromActivity.id);
        const activitySnapshot = await banquetSnapshot(base, token, activity.id);
        assert.ok(groupId(activitySnapshot), 'activity-first banquet group exists');
        assert.equal(String(activitySnapshot.bookings?.primary?.id || activitySnapshot.group?.primaryBookingId), String(activity.id));
        const activityGroupId = groupId(activitySnapshot);
        createdBanquetCleanupTargets.push({
            groupId: activityGroupId,
            primaryBookingId: activity.id,
            bookingIds: [activity.id, kitchenFromActivity.id]
        });

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFromActivity.id);
        await assertKitchenHiddenFromAnimator(page, kitchenFromActivity.id);
        await renderTimelineView(page, date, 'animators');
        await assertBookingBlockVisible(page, activity.id);
        await runRevealAction(page, date, kitchenFromActivity.id);

        await renderTimelineView(page, secondDate, 'rooms');
        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFromActivity.id);

        const emptyCellDrawer = await openActiveBanquetEmptyCellDrawer(page, date, room, '17:00', activitySnapshot);
        assert.equal(emptyCellDrawer.ok, true, `active inspector -> empty cell opens drawer: ${emptyCellDrawer.error || ''}`);
        assert.equal(emptyCellDrawer.panelVisible, true, 'active inspector -> empty cell drawer visible');
        assert.equal(String(emptyCellDrawer.activeContext?.groupId || emptyCellDrawer.selectedGroupId), activityGroupId, 'active inspector context keeps the banquet group');
        assert.equal(emptyCellDrawer.activeBanquetIntent, 'add_to_existing', 'empty cell drawer has add-to-existing intent');
        assert.ok(emptyCellDrawer.hasStandaloneOverride, 'empty cell drawer exposes explicit standalone override');
        assert.ok(String(emptyCellDrawer.bannerText || '').trim(), 'empty cell drawer shows active banquet banner');
        const emptyCellKitchen = await submitActiveBanquetMemberFromEmptyCell(page, activityGroupId);
        assert.ok(emptyCellKitchen?.id, 'active inspector empty-cell kitchen booking created');
        createdBookingIds.push(emptyCellKitchen.id);
        const emptyCellSnapshot = await banquetSnapshot(base, token, emptyCellKitchen.id);
        assert.equal(groupId(emptyCellSnapshot), activityGroupId, 'empty cell grouped save reloads inside the same banquet group');
        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, emptyCellKitchen.id);

        const reused = await fetchJson(base, scopedPath('/api/banquets/from-source/member-booking'), {
            method: 'POST',
            token,
            body: {
                sourceBookingId: activity.id,
                role: 'kitchen',
                booking: bookingPayload({
                    date,
                    time: '15:00',
                    lineId: 'banquet-service',
                    room,
                    label: `Task37 reuse kitchen ${RUN_ID}`,
                    category: 'banquet',
                    duration: 60,
                    customerId: customerA.id,
                    customerName: customerA.name,
                    banquetGuests: 4,
                    bookingPackage: kitchenPackage('15:30')
                })
            }
        });
        assert.equal(reused.success, true, 'existing group reuse create succeeds');
        assert.equal(reused.createdGroup, false, 'existing group reuse does not create duplicate group');
        createdBookingIds.push(reused.booking?.id);
        const reuseSnapshot = await banquetSnapshot(base, token, reused.booking.id);
        assert.equal(groupId(reuseSnapshot), groupId(activitySnapshot), 'existing group id reused');

        const kitchenFirst = await createBooking(base, token, bookingPayload({
            date,
            time: '16:00',
            lineId: 'banquet-service',
            room,
            label: `Task37 kitchen first ${RUN_ID}`,
            category: 'banquet',
            duration: 90,
            price: 100,
            customerId: customerB.id,
            customerName: customerB.name,
            customerPhone: customerB.phone,
            childName: customerB.childName,
            banquetGuests: 5,
            bookingPackage: kitchenPackage('16:30')
        }));
        createdBookingIds.push(kitchenFirst.id);

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFirst.id);
        const kitchenFirstDrawer = await openActivityFromKitchenSource(page, date, kitchenFirst.id);
        assertBridgeSelector(kitchenFirstDrawer, 'kitchen first -> activity');
        const program = await chooseFirstActivityProgram(page);
        assert.ok(program?.id, 'activity program selected for kitchen-first bridge');
        const activityFromKitchen = await submitActivityFromKitchen(page);
        assert.ok(activityFromKitchen?.id, 'activity booking created from kitchen source');
        createdBookingIds.push(activityFromKitchen.id);
        const kitchenSnapshot = await banquetSnapshot(base, token, kitchenFirst.id);
        assert.ok(groupId(kitchenSnapshot), 'kitchen-first banquet group exists');
        createdBanquetCleanupTargets.push({
            groupId: groupId(kitchenSnapshot),
            primaryBookingId: kitchenFirst.id,
            bookingIds: [kitchenFirst.id, activityFromKitchen.id]
        });

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFirst.id);
        await renderTimelineView(page, date, 'animators');
        await assertBookingBlockVisible(page, activityFromKitchen.id);
        const kitchenFirstAnimatorVisible = await page.evaluate(id => {
            const escaped = CSS.escape(String(id));
            return Boolean(document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`));
        }, kitchenFirst.id);
        assert.equal(kitchenFirstAnimatorVisible, false, 'kitchen-first kitchen stays hidden from animator timeline');

        console.log(`Timeline browser smoke OK: ${base} date=${date} room=${room}`);
        console.log(`  OK booking start 12:15 -> 12:30, 409 draft durability, and responsive drawer on ${bookingTimeDate}`);
        console.log(`  OK activity first -> kitchen after, group ${groupId(activitySnapshot)}`);
        console.log(`  OK kitchen first -> activity after, group ${groupId(kitchenSnapshot)}`);
        console.log('  OK existing group reuse, visibility, reveal action, and cache view/date switch');
    } catch (error) {
        if (page && !page.isClosed()) {
            const diagnostic = await writeTimelineFailureDiagnostic(page, 'failure', error).catch(diagnosticError => ({
                jsonPath: '',
                pngPath: '',
                diagnostics: { diagnosticError: diagnosticError?.message || String(diagnosticError) }
            }));
            const artifactMessage = diagnostic?.jsonPath
                ? `\nTimeline smoke diagnostics: ${diagnostic.jsonPath}${diagnostic.pngPath ? `, ${diagnostic.pngPath}` : ''}`
                : `\nTimeline smoke diagnostics failed: ${JSON.stringify(diagnostic?.diagnostics || {})}`;
            throw new Error(`${error?.stack || error?.message || String(error)}${artifactMessage}`);
        }
        throw error;
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        if (CLEANUP) {
            const cleanedGroups = await cleanupBanquetGroups(
                base,
                token,
                createdBookingIds,
                createdBanquetCleanupTargets,
                date
            );
            const groupBookingIds = new Set(cleanedGroups.flatMap(target => target.bookingIds || []).map(String));
            for (const id of [...createdBookingIds].reverse().filter(Boolean)) {
                if (groupBookingIds.has(String(id))) continue;
                await deleteBooking(base, token, id);
            }
            const standaloneIds = createdBookingIds.filter(id => id && !groupBookingIds.has(String(id)));
            if (standaloneIds.length) {
                await verifyBookingsNotActiveInTimeline(base, token, bookingTimeDate, standaloneIds);
            }
            for (const id of [...createdCustomerIds].reverse().filter(Boolean)) {
                await deleteCustomer(base, token, id);
            }
        } else {
            console.warn(`TIMELINE_BROWSER_SMOKE_CLEANUP=false; created booking ids: ${createdBookingIds.filter(Boolean).join(', ')}`);
        }
    }
}

run().catch(err => fail(err?.stack || err?.message || String(err)));
