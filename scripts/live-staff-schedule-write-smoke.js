#!/usr/bin/env node
'use strict';

/**
 * Controlled live/staging write acceptance smoke for the staff schedule.
 *
 * Safety contract:
 * - Requires LIVE_STAFF_SCHEDULE_WRITE_CONFIRM=I_CONFIRM_STAFF_SCHEDULE_QA_WRITES.
 * - Requires explicit QA staff id and QA date.
 * - Refuses non-QA-looking staff names unless LIVE_STAFF_SCHEDULE_ALLOW_NON_QA_STAFF=true.
 * - Requires an existing schedule entry for the primary QA staff/date, so restore
 *   can use the previous state without a destructive delete endpoint.
 * - Restores the primary QA staff/date in a finally block.
 *
 * Usage:
 *   LIVE_STAFF_SCHEDULE_WRITE_CONFIRM=I_CONFIRM_STAFF_SCHEDULE_QA_WRITES \
 *   LIVE_STAFF_SCHEDULE_QA_STAFF_ID=123 \
 *   LIVE_STAFF_SCHEDULE_QA_DATE=2026-07-20 \
 *   npm run smoke:staff-schedule:write -- https://example.up.railway.app
 *
 * Optional replacement coverage:
 *   LIVE_STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID=456
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || readEnv('LIVE_STAFF_SCHEDULE_WRITE_URL', 'LIVE_STAFF_SCHEDULE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const BUSINESS_CONTEXT = readEnv('LIVE_STAFF_SCHEDULE_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const HEADLESS = readEnv('LIVE_STAFF_SCHEDULE_WRITE_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false';
const TIMEOUT_MS = Number(readEnv('LIVE_STAFF_SCHEDULE_WRITE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 30000);
const CONFIRM_TOKEN = 'I_CONFIRM_STAFF_SCHEDULE_QA_WRITES';
const QA_STAFF_ID = parsePositiveInt(readEnv('LIVE_STAFF_SCHEDULE_QA_STAFF_ID', 'STAFF_SCHEDULE_QA_STAFF_ID'));
const QA_REPLACEMENT_STAFF_ID = parsePositiveInt(readEnv('LIVE_STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID', 'STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID'));
const QA_DATE = normalizeDate(readEnv('LIVE_STAFF_SCHEDULE_QA_DATE', 'STAFF_SCHEDULE_QA_DATE'));
const QA_NAME_PATTERN = readEnv('LIVE_STAFF_SCHEDULE_QA_NAME_PATTERN', 'STAFF_SCHEDULE_QA_NAME_PATTERN') || '\\b(QA|Codex|Test|Smoke)\\b';
const ALLOW_NON_QA_STAFF = readEnv('LIVE_STAFF_SCHEDULE_ALLOW_NON_QA_STAFF') === 'true';
const RUN_ID = `staff-schedule-write-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'live-staff-schedule-write-smoke', RUN_ID);

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeDate(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function fail(message) {
    console.error(`Live staff schedule write smoke failed: ${message}`);
    process.exit(1);
}

function assertConfigured() {
    if (!TARGET_URL) fail('provide target URL or LIVE_STAFF_SCHEDULE_WRITE_URL/LIVE_SMOKE_URL/TEST_URL');
    if (readEnv('LIVE_STAFF_SCHEDULE_WRITE_CONFIRM') !== CONFIRM_TOKEN) {
        fail(`set LIVE_STAFF_SCHEDULE_WRITE_CONFIRM=${CONFIRM_TOKEN}`);
    }
    if (!QA_STAFF_ID) fail('set LIVE_STAFF_SCHEDULE_QA_STAFF_ID to an explicit QA staff id');
    if (!QA_DATE) fail('set LIVE_STAFF_SCHEDULE_QA_DATE as YYYY-MM-DD');
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
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
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
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
    const token = readEnv('LIVE_STAFF_SCHEDULE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token });
        return { token, user: verified.user || verified, source: 'token' };
    }

    const username = readEnv('LIVE_STAFF_SCHEDULE_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv('LIVE_STAFF_SCHEDULE_PASS', 'LIVE_STAFF_SCHEDULE_PASSWORD', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) {
        throw new Error('provide LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS or TEST_USER/TEST_PASS');
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

function staffUrl(base) {
    const url = new URL('/staff', base);
    url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    url.searchParams.set('smoke', RUN_ID);
    return url.toString();
}

async function openAuthenticatedContext(browser, session, viewport) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user, businessContext }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_crm_business_context', businessContext);
        localStorage.setItem('pzp_dark_mode', 'true');
        localStorage.removeItem('pzp_staff_schedule_expanded_groups');
    }, {
        token: session.token,
        refreshToken: session.refreshToken || '',
        refreshExpiresAt: session.refreshExpiresAt || '',
        user: session.user || null,
        businessContext: BUSINESS_CONTEXT
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return { context, page };
}

async function loadStaff(base, token) {
    const data = await fetchJson(base, '/api/staff?active=true&include_freelance=true', { token });
    return Array.isArray(data.data) ? data.data : [];
}

function staffName(staff = {}) {
    return String(staff.display_name || staff.name || staff.username || '').trim();
}

function assertQaStaff(staff, label) {
    assert.ok(staff, `${label}: QA staff was found`);
    if (ALLOW_NON_QA_STAFF) return;
    const haystack = [
        staff.name,
        staff.display_name,
        staff.username,
        staff.position,
        staff.role_type
    ].filter(Boolean).join(' ');
    const pattern = new RegExp(QA_NAME_PATTERN, 'i');
    assert.match(haystack, pattern, `${label}: staff name/metadata must match QA pattern ${QA_NAME_PATTERN}`);
}

function time5(value) {
    if (value === null || value === undefined) return null;
    const match = String(value).match(/^(\d{2}:\d{2})/);
    return match ? match[1] : String(value).slice(0, 5);
}

function normalizeStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (raw === 'day_off') return 'dayoff';
    return raw || 'working';
}

function firstProfessionKey(staff = {}) {
    if (Array.isArray(staff.professions)) {
        const found = staff.professions.find(item => item && (item.key || item.profession_key));
        if (found) return String(found.key || found.profession_key);
    }
    try {
        const secondary = typeof staff.secondary_professions === 'string'
            ? JSON.parse(staff.secondary_professions)
            : staff.secondary_professions;
        if (Array.isArray(secondary) && secondary[0]) return String(secondary[0].key || secondary[0]);
    } catch {
        // ignore malformed legacy metadata
    }
    return String(staff.role_type || staff.position || 'animator');
}

function schedulePayloadFromEntry(entry, staff) {
    const status = normalizeStatus(entry.status);
    const workLike = status === 'working' || status === 'remote';
    return {
        staffId: Number(entry.staff_id),
        date: normalizeDate(String(entry.date || '').slice(0, 10)),
        status,
        shiftStart: workLike ? time5(entry.shift_start) : null,
        shiftEnd: workLike ? time5(entry.shift_end) : null,
        note: entry.note || null,
        professionKey: workLike ? (entry.profession_key || firstProfessionKey(staff)) : null
    };
}

function schedulePayloadForWrite(staff, date, options = {}) {
    return {
        staffId: Number(staff.id),
        date,
        status: options.status || 'working',
        shiftStart: options.shiftStart || '09:15',
        shiftEnd: options.shiftEnd || '18:45',
        note: options.note || `Codex staff schedule write smoke ${RUN_ID}`,
        professionKey: options.professionKey || firstProfessionKey(staff)
    };
}

function assertScheduleMatches(entry, payload, label) {
    assert.ok(entry, `${label}: schedule entry exists`);
    assert.equal(Number(entry.staff_id), Number(payload.staffId), `${label}: staff id matches`);
    assert.equal(String(entry.date).slice(0, 10), payload.date, `${label}: date matches`);
    assert.equal(normalizeStatus(entry.status), normalizeStatus(payload.status), `${label}: status matches`);
    if (['working', 'remote'].includes(normalizeStatus(payload.status))) {
        assert.equal(time5(entry.shift_start), payload.shiftStart, `${label}: shift start matches`);
        assert.equal(time5(entry.shift_end), payload.shiftEnd, `${label}: shift end matches`);
        assert.equal(String(entry.profession_key || ''), String(payload.professionKey || ''), `${label}: profession matches`);
    }
    assert.equal(entry.note || null, payload.note || null, `${label}: note matches`);
}

async function getScheduleEntry(base, token, staffId, date) {
    const data = await fetchJson(base, `/api/staff/schedule?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`, { token });
    const rows = Array.isArray(data.data) ? data.data : [];
    return rows.find(row => Number(row.staff_id) === Number(staffId) && String(row.date).slice(0, 10) === date) || null;
}

async function putSchedule(base, token, payload) {
    const data = await fetchJson(base, '/api/staff/schedule', {
        method: 'PUT',
        token,
        body: payload
    });
    if (!data.success) throw new Error(data.error || 'schedule PUT failed');
    return data.data;
}

async function fetchHistory(base, token, staffId, date) {
    const data = await fetchJson(base, `/api/staff/schedule/history/${encodeURIComponent(staffId)}/${encodeURIComponent(date)}?limit=20`, { token });
    return Array.isArray(data.data) ? data.data : [];
}

function historyIds(rows = []) {
    return new Set(rows.map(row => Number(row.id)).filter(Number.isFinite));
}

function assertNewHistoryAction(beforeRows, afterRows, expectedAction, label) {
    const before = historyIds(beforeRows);
    const added = afterRows.filter(row => !before.has(Number(row.id)));
    assert.ok(added.some(row => row.action === expectedAction), `${label}: new ${expectedAction} audit row exists`);
}

async function applyRange(page, date) {
    await page.locator('#scheduleDateFrom').fill(date);
    await page.locator('#scheduleDateTo').fill(date);
    await page.locator('#applyScheduleRangeBtn').click();
    await page.waitForFunction(expected => {
        return document.getElementById('scheduleDateFrom')?.value === expected
            && document.getElementById('scheduleDateTo')?.value === expected
            && document.querySelectorAll('#scheduleHead th').length === 2;
    }, date);
}

async function openStaffPage(page, base) {
    await page.goto(staffUrl(base), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: TIMEOUT_MS });
    await page.waitForSelector('#scheduleBody tr', { timeout: TIMEOUT_MS });
}

async function saveScheduleViaUi(page, base, staff, payload) {
    await openStaffPage(page, base);
    await applyRange(page, payload.date);

    const query = staffName(staff) || String(staff.id);
    await page.locator('#scheduleStaffSearch').fill(query);
    await page.waitForFunction(staffId => {
        return Boolean(document.querySelector(`.sch-cell[data-staff="${staffId}"]`));
    }, String(staff.id));

    const cell = page.locator(`.sch-cell[data-staff="${staff.id}"][data-date="${payload.date}"]`).first();
    await cell.click();
    await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
    await page.locator('#schStatus').selectOption(payload.status);

    let professionKey = payload.professionKey;
    if (payload.status === 'working' || payload.status === 'remote') {
        await page.locator('#schStart').fill(payload.shiftStart);
        await page.locator('#schEnd').fill(payload.shiftEnd);
        const optionValues = await page.locator('#schProfession option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
        if (!optionValues.includes(professionKey)) {
            professionKey = optionValues[0] || professionKey;
            payload.professionKey = professionKey;
        }
        if (professionKey) await page.locator('#schProfession').selectOption(professionKey);
    }
    await page.locator('#schNote').fill(payload.note || '');
    await page.locator('#schSaveBtn').click();
    await page.locator('#schModalOverlay.visible').waitFor({ state: 'hidden' });
    await page.waitForFunction(expected => {
        const cell = document.querySelector(`.sch-cell[data-staff="${expected.staffId}"][data-date="${expected.date}"]`);
        if (!cell) return false;
        const text = cell.textContent || '';
        return expected.status === 'dayoff'
            ? /dayoff|Р’РёС…/i.test(text)
            : text.includes(expected.shiftStart) && text.includes(expected.shiftEnd);
    }, { ...payload, staffId: String(staff.id) });
}

async function runReplacementCoverage(base, token, primaryStaff, replacementStaff, previousPayload) {
    assertQaStaff(replacementStaff, 'replacement');
    assert.notEqual(Number(primaryStaff.id), Number(replacementStaff.id), 'replacement: staff ids are different');
    assert.ok(['working', 'remote'].includes(previousPayload.status), 'replacement: primary entry must be working/remote');
    assert.ok(previousPayload.shiftStart && previousPayload.shiftEnd, 'replacement: primary entry has shift times');

    const replacementExisting = await getScheduleEntry(base, token, replacementStaff.id, QA_DATE);
    assert.equal(replacementExisting, null, 'replacement: replacement QA staff/date must start without a schedule entry');

    const originalBeforeHistory = await fetchHistory(base, token, primaryStaff.id, QA_DATE);
    const replacementBeforeHistory = await fetchHistory(base, token, replacementStaff.id, QA_DATE);
    const currentOriginal = await getScheduleEntry(base, token, primaryStaff.id, QA_DATE);
    assertScheduleMatches(currentOriginal, previousPayload, 'replacement setup');

    const reason = `Codex replacement smoke ${RUN_ID}`;
    const replace = await fetchJson(base, `/api/staff/schedule/${currentOriginal.id}/replace`, {
        method: 'POST',
        token,
        body: { replacement_staff_id: replacementStaff.id, reason }
    });
    assert.equal(replace.success, true, 'replacement: replace route succeeds');
    assert.ok(replace.data?.id, 'replacement: replacement schedule row returned');

    const originalAfterReplace = await getScheduleEntry(base, token, primaryStaff.id, QA_DATE);
    const replacementAfterReplace = await getScheduleEntry(base, token, replacementStaff.id, QA_DATE);
    assert.equal(originalAfterReplace, null, 'replacement: original row is removed while replacement is active');
    assert.ok(replacementAfterReplace?.original_staff_id, 'replacement: replacement row carries original staff id');

    const clear = await fetchJson(base, `/api/staff/schedule/${replacementAfterReplace.id}/replacement-clear`, {
        method: 'POST',
        token
    });
    assert.equal(clear.success, true, 'replacement: clear route succeeds');

    const originalAfterClear = await getScheduleEntry(base, token, primaryStaff.id, QA_DATE);
    const replacementAfterClear = await getScheduleEntry(base, token, replacementStaff.id, QA_DATE);
    assertScheduleMatches(originalAfterClear, previousPayload, 'replacement clear');
    assert.equal(replacementAfterClear, null, 'replacement: replacement row is removed after clear');

    const originalAfterHistory = await fetchHistory(base, token, primaryStaff.id, QA_DATE);
    const replacementAfterHistory = await fetchHistory(base, token, replacementStaff.id, QA_DATE);
    assertNewHistoryAction(originalBeforeHistory, originalAfterHistory, 'staff_schedule_replacement_restored', 'replacement original history');
    assertNewHistoryAction(replacementBeforeHistory, replacementAfterHistory, 'staff_schedule_replacement_set', 'replacement staff history');
}

async function clearActiveReplacementIfPresent(base, token, replacementStaffId, date) {
    if (!replacementStaffId) return false;
    const replacementEntry = await getScheduleEntry(base, token, replacementStaffId, date);
    if (!replacementEntry?.id || !replacementEntry.original_staff_id) return false;
    const clear = await fetchJson(base, `/api/staff/schedule/${replacementEntry.id}/replacement-clear`, {
        method: 'POST',
        token
    });
    return clear.success === true;
}

async function runBulkCoverage(base, token, staff, previousPayload) {
    const beforeHistory = await fetchHistory(base, token, staff.id, QA_DATE);
    const bulkPayload = schedulePayloadForWrite(staff, QA_DATE, {
        shiftStart: previousPayload.shiftStart === '09:30' ? '10:30' : '09:30',
        shiftEnd: previousPayload.shiftEnd === '18:30' ? '19:30' : '18:30',
        professionKey: previousPayload.professionKey,
        note: `Codex bulk schedule smoke ${RUN_ID}`
    });
    const bulk = await fetchJson(base, '/api/staff/schedule/bulk', {
        method: 'POST',
        token,
        body: { entries: [bulkPayload] }
    });
    assert.equal(bulk.success, true, 'bulk: route succeeds');
    assert.equal(bulk.count, 1, 'bulk: one entry updated');
    const afterBulk = await getScheduleEntry(base, token, staff.id, QA_DATE);
    assertScheduleMatches(afterBulk, bulkPayload, 'bulk');
    const afterHistory = await fetchHistory(base, token, staff.id, QA_DATE);
    assertNewHistoryAction(beforeHistory, afterHistory, 'staff_schedule_bulk_update', 'bulk history');
}

async function runDryRunCopyWeekCoverage(base, token, staff) {
    const date = new Date(`${QA_DATE}T00:00:00Z`);
    const day = date.getUTCDay();
    const monday = new Date(date.getTime());
    monday.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
    const nextMonday = new Date(monday.getTime());
    nextMonday.setUTCDate(monday.getUTCDate() + 7);
    const body = {
        fromMonday: monday.toISOString().slice(0, 10),
        toMonday: nextMonday.toISOString().slice(0, 10),
        staffIds: [Number(staff.id)],
        displayGroup: 'qa-write-smoke',
        dryRun: true
    };
    const copy = await fetchJson(base, '/api/staff/schedule/copy-week', {
        method: 'POST',
        token,
        body
    });
    assert.equal(copy.success, true, 'copy-week dry run: route succeeds');
    assert.equal(copy.dryRun, true, 'copy-week dry run: no write mode');
    assert.equal(copy.copyMode, 'explicit_staff_ids', 'copy-week dry run: explicit staff mode');
}

async function runAttendanceReadCoverage(base, token) {
    const attendance = await fetchJson(base, `/api/staff/attendance?from=${encodeURIComponent(QA_DATE)}&to=${encodeURIComponent(QA_DATE)}`, { token });
    assert.equal(attendance.success, true, 'attendance: route succeeds for current smoke role');
    assert.ok(Array.isArray(attendance.data), 'attendance: data array returned');
    assert.ok(attendance.summary && typeof attendance.summary === 'object', 'attendance: summary returned');
}

(async () => {
    assertConfigured();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const base = normalizeBase(TARGET_URL);
    const { chromium } = requirePlaywright();
    let browser;
    let context;
    let restored = false;
    let previousPayload = null;
    let primaryStaff = null;

    try {
        const session = await login(base);
        const staffRows = await loadStaff(base, session.token);
        primaryStaff = staffRows.find(row => Number(row.id) === QA_STAFF_ID);
        assertQaStaff(primaryStaff, 'primary');

        const previousEntry = await getScheduleEntry(base, session.token, QA_STAFF_ID, QA_DATE);
        assert.ok(previousEntry, 'primary: existing schedule entry is required for safe restore');
        previousPayload = schedulePayloadFromEntry(previousEntry, primaryStaff);
        assert.equal(previousPayload.date, QA_DATE, 'primary: previous payload date is valid');

        browser = await chromium.launch({ headless: HEADLESS });
        const opened = await openAuthenticatedContext(browser, session, { width: 1440, height: 900 });
        context = opened.context;
        const page = opened.page;

        const beforeUpdateHistory = await fetchHistory(base, session.token, QA_STAFF_ID, QA_DATE);
        const uiPayload = schedulePayloadForWrite(primaryStaff, QA_DATE, {
            shiftStart: previousPayload.shiftStart === '09:15' ? '10:15' : '09:15',
            shiftEnd: previousPayload.shiftEnd === '18:45' ? '19:45' : '18:45',
            professionKey: previousPayload.professionKey,
            note: `Codex UI schedule smoke ${RUN_ID}`
        });
        await saveScheduleViaUi(page, base, primaryStaff, uiPayload);
        const afterUiEntry = await getScheduleEntry(base, session.token, QA_STAFF_ID, QA_DATE);
        assertScheduleMatches(afterUiEntry, uiPayload, 'UI save');
        const afterUpdateHistory = await fetchHistory(base, session.token, QA_STAFF_ID, QA_DATE);
        assertNewHistoryAction(beforeUpdateHistory, afterUpdateHistory, 'staff_schedule_update', 'UI save history');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'after-ui-save.png'), fullPage: true });

        await putSchedule(base, session.token, previousPayload);
        restored = true;
        assertScheduleMatches(await getScheduleEntry(base, session.token, QA_STAFF_ID, QA_DATE), previousPayload, 'restore after UI save');

        await runBulkCoverage(base, session.token, primaryStaff, previousPayload);
        await putSchedule(base, session.token, previousPayload);
        assertScheduleMatches(await getScheduleEntry(base, session.token, QA_STAFF_ID, QA_DATE), previousPayload, 'restore after bulk');

        await runDryRunCopyWeekCoverage(base, session.token, primaryStaff);
        await runAttendanceReadCoverage(base, session.token);

        if (QA_REPLACEMENT_STAFF_ID) {
            const replacementStaff = staffRows.find(row => Number(row.id) === QA_REPLACEMENT_STAFF_ID);
            await runReplacementCoverage(base, session.token, primaryStaff, replacementStaff, previousPayload);
            await putSchedule(base, session.token, previousPayload);
            assertScheduleMatches(await getScheduleEntry(base, session.token, QA_STAFF_ID, QA_DATE), previousPayload, 'restore after replacement');
        }

        console.log(`Live staff schedule write smoke OK: ${base}`);
        console.log(`  OK primary QA staff: #${primaryStaff.id} ${staffName(primaryStaff)}`);
        console.log(`  OK date: ${QA_DATE}`);
        console.log('  OK UI save -> API persistence -> audit history -> restore');
        console.log('  OK bulk route -> audit history -> restore');
        console.log('  OK copy-week dry run guard');
        console.log('  OK attendance read contract');
        console.log(QA_REPLACEMENT_STAFF_ID ? '  OK replacement set/clear -> restore' : '  SKIP replacement: LIVE_STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID not set');
        console.log(`  OK screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } catch (err) {
        if (previousPayload) {
            try {
                const base = normalizeBase(TARGET_URL);
                const session = await login(base);
                await clearActiveReplacementIfPresent(base, session.token, QA_REPLACEMENT_STAFF_ID, QA_DATE);
                await putSchedule(base, session.token, previousPayload);
                restored = true;
                console.error('Restore attempted after failure: OK');
            } catch (restoreErr) {
                console.error(`Restore attempted after failure: FAILED (${restoreErr.message})`);
            }
        }
        fail(err.stack || err.message || String(err));
    } finally {
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
        if (previousPayload && !restored) {
            console.error('WARNING: previous schedule state may need manual verification.');
        }
    }
})();
