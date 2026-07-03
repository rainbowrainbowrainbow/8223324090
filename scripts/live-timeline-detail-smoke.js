#!/usr/bin/env node
'use strict';

/**
 * Read-only live smoke for the timeline booking detail path.
 *
 * Usage:
 *   npm run smoke:timeline-detail -- https://example.up.railway.app
 *   LIVE_SMOKE_TOKEN=<jwt> npm run smoke:timeline-detail -- https://example.up.railway.app
 *   LIVE_SMOKE_USER=codex.qa LIVE_SMOKE_PASS=... npm run smoke:timeline-detail -- https://example.up.railway.app
 *   LIVE_TIMELINE_DETAIL_BOOKING_IDS=BK-2026-0528,BK-2026-0529 npm run smoke:timeline-detail -- <url>
 */

const pkg = require('../package.json');

function fail(message) {
    console.error(`Live timeline detail smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        throw new Error(`invalid URL "${url || ''}"`);
    }
}

function authHeaders(token = null) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readResponse(res) {
    const text = await res.text();
    try {
        return { text, body: text ? JSON.parse(text) : null };
    } catch {
        return { text, body: text };
    }
}

async function fetchText(url, options = {}) {
    const res = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            Accept: options.accept || 'text/html,application/javascript,application/json,text/plain,*/*',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const { text, body } = await readResponse(res);
    if (!res.ok) {
        const detail = body?.error || body?.message || text || `HTTP ${res.status}`;
        throw new Error(`${url} returned HTTP ${res.status}: ${detail}`);
    }
    return { text, body, status: res.status, url: res.url };
}

async function fetchJson(base, path, options = {}) {
    const { body } = await fetchText(`${base}${path}`, {
        ...options,
        accept: 'application/json'
    });
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${path} did not return a JSON object`);
    }
    return body;
}

function contextPath(path, businessContext) {
    const url = new URL(path, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', businessContext);
    }
    return `${url.pathname}${url.search}`;
}

async function login(base, options = {}) {
    const token = options.token || process.env.LIVE_TIMELINE_DETAIL_TOKEN || process.env.LIVE_SMOKE_TOKEN;
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified };
    }
    const username = options.username || process.env.LIVE_TIMELINE_DETAIL_USER || process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = options.password || process.env.LIVE_TIMELINE_DETAIL_PASS || process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) {
        throw new Error('set LIVE_TIMELINE_DETAIL_TOKEN or LIVE_TIMELINE_DETAIL_USER/LIVE_TIMELINE_DETAIL_PASS');
    }
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = body.accessToken || body.token;
    if (!accessToken) throw new Error('/api/auth/login did not return an access token');
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        user: body.user || null
    };
}

function splitIds(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function bookingIdentitySummary(booking = {}) {
    return {
        id: booking.id || null,
        linkedTo: booking.linkedTo || booking.linked_to || null,
        lineId: booking.lineId || booking.line_id || null,
        resourceId: booking.resourceId || booking.resource_id || null,
        room: booking.room || null,
        date: booking.date || null,
        time: booking.time || null,
        status: booking.status || null
    };
}

function assertBookingIdentity(booking = {}, expectedId = '') {
    const id = String(booking.id || '').trim();
    if (!id) throw new Error('detail booking is missing id');
    if (expectedId && id !== expectedId) throw new Error(`detail returned booking ${id}, expected ${expectedId}`);
    if (!booking.date) throw new Error(`${id}: detail booking is missing date`);
    if (!booking.time) throw new Error(`${id}: detail booking is missing time`);
    if (!booking.lineId && !booking.line_id && !booking.resourceId && !booking.resource_id && !booking.room) {
        throw new Error(`${id}: detail booking is missing line/resource/room identity`);
    }
}

function assertAsset(text, asset, required, forbidden = []) {
    for (const needle of required) {
        if (!text.includes(needle)) throw new Error(`${asset} missing "${needle}"`);
    }
    for (const needle of forbidden) {
        if (text.includes(needle)) throw new Error(`${asset} contains forbidden "${needle}"`);
    }
}

async function pickBookingIds(base, token, date, businessContext, explicitIds = []) {
    if (explicitIds.length) return explicitIds;
    const bookings = await fetchJson(base, contextPath(`/api/bookings/${encodeURIComponent(date)}`, businessContext), { token });
    const rows = Array.isArray(bookings) ? bookings : [];
    const candidates = rows
        .filter(booking => booking?.id && String(booking.status || '').toLowerCase() !== 'cancelled')
        .sort((a, b) => String(a.linkedTo || a.linked_to || '').localeCompare(String(b.linkedTo || b.linked_to || '')));
    if (!candidates.length) {
        throw new Error(`/api/bookings/${date} returned no active bookings; set LIVE_TIMELINE_DETAIL_BOOKING_IDS`);
    }
    const primary = candidates.find(booking => !String(booking.linkedTo || booking.linked_to || '').trim()) || candidates[0];
    const linked = candidates.find(booking => String(booking.linkedTo || booking.linked_to || '').trim());
    return [...new Set([primary?.id, linked?.id].filter(Boolean).map(String))];
}

async function runLiveTimelineDetailSmoke(target, options = {}) {
    const base = normalizeBase(target || process.env.LIVE_TIMELINE_DETAIL_URL || process.env.LIVE_SMOKE_URL || process.env.TEST_URL);
    const expectedVersion = options.version || pkg.version;
    const businessContext = options.businessContext || process.env.LIVE_TIMELINE_DETAIL_BUSINESS_CONTEXT || process.env.LIVE_SMOKE_BUSINESS_CONTEXT || 'event_genix';
    const date = options.date || process.env.LIVE_TIMELINE_DETAIL_DATE || process.env.LIVE_SMOKE_DATE || new Date().toISOString().slice(0, 10);
    const explicitIds = options.bookingIds || splitIds(process.env.LIVE_TIMELINE_DETAIL_BOOKING_IDS);
    const session = await login(base, options);

    const version = await fetchJson(base, '/api/version');
    if (version.version !== expectedVersion) {
        throw new Error(`/api/version is ${version.version}, expected ${expectedVersion}`);
    }

    const bookingIds = await pickBookingIds(base, session.token, date, businessContext, explicitIds);
    const details = [];
    for (const id of bookingIds) {
        const detail = await fetchJson(base, contextPath(`/api/bookings/detail/${encodeURIComponent(id)}`, businessContext), { token: session.token });
        if (detail.success !== true || !detail.booking) {
            throw new Error(`/api/bookings/detail/${id} did not return { success: true, booking }`);
        }
        assertBookingIdentity(detail.booking, id);
        details.push(bookingIdentitySummary(detail.booking));
    }

    const bookingJs = await fetchText(`${base}/js/booking.js?v=${encodeURIComponent(expectedVersion)}`);
    assertAsset(bookingJs.text, 'js/booking.js', [
        'function bookingDetailSafeRender',
        "bookingDetailSafeRender('full-banquet-detail'",
        'async function showBookingDetails'
    ]);

    const timelineJs = await fetchText(`${base}/js/timeline.js?v=${encodeURIComponent(expectedVersion)}`);
    assertAsset(timelineJs.text, 'js/timeline.js', [
        'async function openTimelineBookingDetailsFromBlock',
        'TL-BK-DETAIL-OK-OPEN-FAILED',
        'timelineProbeBookingOpenDiagnostic'
    ], [
        'TL-BK-DETAIL-RECOVERY-OPENED',
        'Recovery \u043f\u0456\u0441\u043b\u044f detail API'
    ]);

    return {
        base,
        version: expectedVersion,
        businessContext,
        date,
        user: session.user ? {
            username: session.user.username,
            role: session.user.role,
            defaultBusinessContext: session.user.defaultBusinessContext || session.user.default_business_context || null
        } : null,
        bookingIds,
        details
    };
}

async function main() {
    const target = process.argv.find(arg => /^https?:\/\//i.test(arg))
        || process.env.LIVE_TIMELINE_DETAIL_URL
        || process.env.LIVE_SMOKE_URL
        || process.env.TEST_URL;
    if (!target) fail('provide URL or LIVE_TIMELINE_DETAIL_URL/LIVE_SMOKE_URL/TEST_URL');
    const report = await runLiveTimelineDetailSmoke(target);
    console.log(`Live timeline detail smoke OK: ${report.base} -> v${report.version}`);
    console.log(`  OK auth: ${report.user?.username || 'token'} (${report.user?.role || 'unknown role'})`);
    console.log(`  OK bookings ${report.date}: ${report.bookingIds.join(', ')}`);
    for (const detail of report.details) {
        console.log(`  OK detail ${detail.id}: line=${detail.lineId || '-'} resource=${detail.resourceId || '-'} room=${detail.room || '-'} linkedTo=${detail.linkedTo || '-'}`);
    }
    console.log('  OK live assets: js/booking.js, js/timeline.js');
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    runLiveTimelineDetailSmoke
};
