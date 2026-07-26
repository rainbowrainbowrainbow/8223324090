#!/usr/bin/env node
'use strict';

/**
 * Opt-in live ZRS write smoke.
 *
 * It creates two tiny salary_adjustments(type=advance) for an explicitly configured
 * QA staff record, verifies aggregation, and voids both records in finally.
 * No write happens unless LIVE_ZRS_WRITE_CONFIRM is set to the exact token below.
 */

const assert = require('node:assert/strict');
const pkg = require('../package.json');

const CONFIRM_TOKEN = 'I_CONFIRM_ZRS_QA_WRITES';
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg)) || env('LIVE_ZRS_WRITE_URL', 'LIVE_SMOKE_URL', 'TEST_URL');
const QA_STAFF_ID = positiveInt(env('LIVE_ZRS_QA_STAFF_ID'));
const PAYROLL_MONTH = normalizeMonth(env('LIVE_ZRS_QA_MONTH')) || new Date().toISOString().slice(0, 7);
const BUSINESS_CONTEXT = env('LIVE_ZRS_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix';
const AMOUNTS = parseAmounts(env('LIVE_ZRS_QA_AMOUNTS'));
const RUN_ID = `zrs-write-${Date.now()}`;
const QA_NAME_PATTERN = new RegExp(env('LIVE_ZRS_QA_STAFF_PATTERN') || '\\b(QA|Codex|Test|Smoke|Тест)\\b', 'iu');

function env(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function fail(message) {
    console.error(`Live ZRS write smoke failed: ${message}`);
    process.exit(1);
}

function positiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeMonth(value) {
    const month = String(value || '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

function parseAmounts(value) {
    const amounts = String(value || '1,2')
        .split(',')
        .map(item => positiveInt(item))
        .filter(Boolean);
    return amounts.length >= 2 ? amounts.slice(0, 2) : [1, 2];
}

function normalizeBase(value) {
    try {
        return new URL(value).origin;
    } catch {
        throw new Error('set a valid LIVE_ZRS_WRITE_URL or LIVE_SMOKE_URL');
    }
}

function assertConfigured() {
    if (env('LIVE_ZRS_WRITE_CONFIRM') !== CONFIRM_TOKEN) {
        throw new Error(`set LIVE_ZRS_WRITE_CONFIRM=${CONFIRM_TOKEN}`);
    }
    if (!TARGET_URL) throw new Error('set LIVE_ZRS_WRITE_URL or LIVE_SMOKE_URL');
    if (!QA_STAFF_ID) throw new Error('set LIVE_ZRS_QA_STAFF_ID');
}

async function readBody(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function fetchJson(base, route, options = {}) {
    const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    const response = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: hasBody ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(response);
    if (!response.ok) {
        const detail = body?.code || body?.error || body?.message || `HTTP ${response.status}`;
        const err = new Error(`${route} returned ${response.status}: ${detail}`);
        err.statusCode = response.status;
        err.body = body;
        throw err;
    }
    return body;
}

async function login(base) {
    const existing = env('LIVE_ZRS_WRITE_TOKEN', 'LIVE_SMOKE_TOKEN');
    if (existing) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: existing });
        return { token: existing, user: verified.user || verified };
    }
    const username = env('LIVE_ZRS_WRITE_USER', 'LIVE_SMOKE_USER', 'TEST_USER');
    const password = env('LIVE_ZRS_WRITE_PASS', 'LIVE_SMOKE_PASS', 'TEST_PASS');
    if (!username || !password) throw new Error('provide LIVE_ZRS_WRITE_TOKEN or LIVE_ZRS_WRITE_USER/LIVE_ZRS_WRITE_PASS');
    const body = await fetchJson(base, '/api/auth/login', { method: 'POST', body: { username, password } });
    const token = body.accessToken || body.access_token || body.token;
    if (!token) throw new Error('/api/auth/login did not return an access token');
    return { token, user: body.user || null };
}

async function loadStaff(base, token) {
    const body = await fetchJson(base, `/api/hr/staff/${QA_STAFF_ID}`, { token });
    assert.equal(body?.success, true, 'staff endpoint returns success');
    const staff = body.data || null;
    assert.ok(staff, 'staff payload exists');
    if (staff.is_active === false) throw new Error(`staff #${QA_STAFF_ID} is inactive`);
    const searchable = [staff.name, staff.display_name, staff.username, staff.role_type, staff.department]
        .filter(Boolean)
        .join(' ');
    if (process.env.LIVE_ZRS_ALLOW_NON_QA_STAFF !== 'true' && !QA_NAME_PATTERN.test(searchable)) {
        throw new Error(`staff #${QA_STAFF_ID} is not visibly marked as QA/Test/Codex; refusing write`);
    }
    return staff;
}

function zrsJournalPath(params) {
    const query = new URLSearchParams({
        month: PAYROLL_MONTH,
        type: 'advance',
        limit: '100',
        offset: '0',
        include_periods: '0',
        ...params
    });
    return `/api/hr/salary/adjustments?${query.toString()}`;
}

async function loadStaffJournal(base, token, status = 'active') {
    const body = await fetchJson(base, zrsJournalPath({ staff_id: String(QA_STAFF_ID), status }), { token });
    assert.equal(body?.success, true, 'journal endpoint returns success');
    return body;
}

function activeState(journal) {
    const rows = Array.isArray(journal.summary_rows) ? journal.summary_rows : [];
    const row = rows.find(item => Number(item.staff_id) === QA_STAFF_ID) || {};
    return {
        amount: Number(row.zrs_amount || 0),
        count: Number(row.active_entry_count || 0)
    };
}

function assertOpenPeriod(journal) {
    const lock = journal?.period_lock;
    if (!lock) throw new Error(`period lock state is unavailable for ${PAYROLL_MONTH}`);
    if (lock.is_locked) throw new Error(`period ${PAYROLL_MONTH} is locked`);
}

async function createZrs(base, token, amount, index) {
    const reason = `QA ZRS smoke ${RUN_ID} #${index}`;
    const body = await fetchJson(base, '/api/hr/salary/adjustment', {
        method: 'POST',
        token,
        body: {
            staff_id: QA_STAFF_ID,
            month: PAYROLL_MONTH,
            type: 'advance',
            amount,
            reason
        }
    });
    assert.equal(body?.success, true, 'create ZRS returns success');
    const id = Number(body.data?.id || body.data?.adjustment_id || 0);
    if (!id) throw new Error('create ZRS response is missing adjustment id');
    return { id, amount, reason };
}

async function voidZrs(base, token, record) {
    const reason = `QA cleanup ${RUN_ID}`;
    const body = await fetchJson(base, `/api/hr/salary/adjustment/${record.id}/void`, {
        method: 'PUT',
        token,
        body: { reason }
    });
    assert.equal(body?.success, true, `void ZRS #${record.id} returns success`);
    return body;
}

async function assertCreatedRowsAreVoided(base, token, created) {
    const body = await fetchJson(base, zrsJournalPath({ search: RUN_ID, status: 'all' }), { token });
    const rows = Array.isArray(body.data) ? body.data : [];
    const byId = new Map(rows.map(row => [Number(row.adjustment_id || row.id), row]));
    for (const record of created) {
        const row = byId.get(record.id);
        assert.ok(row, `journal keeps ZRS #${record.id}`);
        assert.equal(String(row.status || '').toLowerCase(), 'voided', `ZRS #${record.id} is voided`);
        assert.match(String(row.void_reason || ''), new RegExp(RUN_ID), `ZRS #${record.id} has cleanup reason`);
    }
}

async function runLiveZrsWriteSmoke() {
    assertConfigured();
    const base = normalizeBase(TARGET_URL);
    const session = await login(base);
    const version = await fetchJson(base, '/api/version');
    if (version.version !== pkg.version) throw new Error(`/api/version is ${version.version}, expected ${pkg.version}`);
    const staff = await loadStaff(base, session.token);

    const created = [];
    let cleanupError = null;
    try {
        const beforeJournal = await loadStaffJournal(base, session.token, 'active');
        assertOpenPeriod(beforeJournal);
        const before = activeState(beforeJournal);

        for (let index = 0; index < AMOUNTS.length; index += 1) {
            created.push(await createZrs(base, session.token, AMOUNTS[index], index + 1));
        }

        const expectedIncrease = AMOUNTS.reduce((sum, value) => sum + value, 0);
        const afterCreate = activeState(await loadStaffJournal(base, session.token, 'active'));
        assert.equal(afterCreate.amount, before.amount + expectedIncrease, 'active ZRS amount increases by created total');
        assert.equal(afterCreate.count, before.count + AMOUNTS.length, 'active ZRS count increases by created count');

        return { base, version: version.version, month: PAYROLL_MONTH, staff: { id: staff.id, name: staff.name }, before, created };
    } finally {
        for (const record of created) {
            try {
                await voidZrs(base, session.token, record);
            } catch (err) {
                cleanupError = cleanupError || err;
            }
        }
        if (!cleanupError && created.length) {
            await assertCreatedRowsAreVoided(base, session.token, created);
        }
        if (cleanupError) throw cleanupError;
    }
}

async function main() {
    const result = await runLiveZrsWriteSmoke();
    console.log(JSON.stringify({
        success: true,
        base: result.base,
        version: result.version,
        month: result.month,
        staff: result.staff,
        created_adjustment_ids: result.created.map(item => item.id),
        cleanup: 'voided'
    }, null, 2));
}

if (require.main === module) {
    main().catch(err => fail(err.message || String(err)));
}

module.exports = {
    CONFIRM_TOKEN,
    runLiveZrsWriteSmoke
};