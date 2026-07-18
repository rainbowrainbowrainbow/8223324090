#!/usr/bin/env node
'use strict';

/**
 * Destructive-but-contained live acceptance runner for the normalized HR day plan.
 * It creates one marker-bound disposable staff member, never creates bookings or
 * finance transactions, reads payroll preview only, and always invokes the
 * server-side transactional cleanup helper from finally.
 */

const assert = require('node:assert/strict');
const {
    LIVE_MULTI_SEGMENT_QA_CONFIRMATION,
    liveQaMarker,
    normalizeLiveQaRunId
} = require('../services/liveMultiSegmentQa');

const PRIMARY_PROFESSION = 'wardrobe';
const ADDITIONAL_PROFESSION = 'cleaner';
const REQUIRED_PROFESSIONS = [PRIMARY_PROFESSION, ADDITIONAL_PROFESSION];
const REQUEST_TIMEOUT_MS = Number(env('LIVE_MULTI_SEGMENT_QA_TIMEOUT_MS') || 30000);
const CLEANUP_TIMEOUT_MS = Number(env('LIVE_MULTI_SEGMENT_QA_CLEANUP_TIMEOUT_MS') || 60000);
const OVERALL_TIMEOUT_MS = Number(env('LIVE_MULTI_SEGMENT_QA_OVERALL_TIMEOUT_MS') || 240000);
const BUSINESS_CONTEXT = env('LIVE_MULTI_SEGMENT_QA_BUSINESS_CONTEXT') || 'event_genix';
const PAYROLL_SCHEME = env('LIVE_MULTI_SEGMENT_QA_SCHEME') || 'hourly';
const PAYROLL_SCHEMES = Object.freeze({
    hourly: { rateUnit: 'hour', baseRate: 100, baseAmount: 900, totalAmount: 2600 },
    per_shift: { rateUnit: 'day', baseRate: 900, baseAmount: 900, totalAmount: 2600 },
    monthly_fixed: { rateUnit: 'month', baseRate: 30000, baseAmount: 30000, totalAmount: 31700 }
});
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg)) || env('LIVE_MULTI_SEGMENT_QA_URL');
const RUN_ID = normalizeLiveQaRunId(env('LIVE_MULTI_SEGMENT_QA_RUN_ID'));
const SOURCE_MONDAY = env('LIVE_MULTI_SEGMENT_QA_SOURCE_MONDAY') || defaultFutureMonday();
const MARKER = RUN_ID ? liveQaMarker(RUN_ID) : '';
const runController = new AbortController();

function env(...names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function normalizeBase(value) {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) throw new Error('unsupported protocol');
        return url.origin;
    } catch {
        throw new Error('LIVE_MULTI_SEGMENT_QA_URL or an HTTP(S) command argument is required');
    }
}

function dateParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === value ? date : null;
}

function addDateDays(value, days) {
    const date = dateParts(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
}

function kyivToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
}

function defaultFutureMonday() {
    const seed = addDateDays(kyivToday(), 120);
    const date = dateParts(seed);
    const offset = (8 - date.getUTCDay()) % 7;
    return addDateDays(seed, offset);
}

function dateDistance(left, right) {
    return Math.round((dateParts(right) - dateParts(left)) / 86400000);
}

function assertConfigured() {
    normalizeBase(TARGET_URL);
    if (env('LIVE_MULTI_SEGMENT_QA_CONFIRM') !== LIVE_MULTI_SEGMENT_QA_CONFIRMATION) {
        throw new Error(`set LIVE_MULTI_SEGMENT_QA_CONFIRM=${LIVE_MULTI_SEGMENT_QA_CONFIRMATION}`);
    }
    if (!RUN_ID) throw new Error('set a unique LIVE_MULTI_SEGMENT_QA_RUN_ID (8-64 letters, digits, _ or -)');
    if (!PAYROLL_SCHEMES[PAYROLL_SCHEME]) {
        throw new Error('LIVE_MULTI_SEGMENT_QA_SCHEME must be hourly, per_shift, or monthly_fixed');
    }
    const hasToken = Boolean(env('LIVE_MULTI_SEGMENT_QA_TOKEN'));
    const hasLogin = Boolean(env('LIVE_MULTI_SEGMENT_QA_USER') && env('LIVE_MULTI_SEGMENT_QA_PASS'));
    if (!hasToken && !hasLogin) {
        throw new Error('provide LIVE_MULTI_SEGMENT_QA_TOKEN or LIVE_MULTI_SEGMENT_QA_USER/LIVE_MULTI_SEGMENT_QA_PASS');
    }
    if (!Number.isFinite(REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS < 1000
        || !Number.isFinite(CLEANUP_TIMEOUT_MS) || CLEANUP_TIMEOUT_MS < REQUEST_TIMEOUT_MS
        || !Number.isFinite(OVERALL_TIMEOUT_MS) || OVERALL_TIMEOUT_MS < CLEANUP_TIMEOUT_MS) {
        throw new Error('QA timeouts are invalid or cleanup/overall timeout is too small');
    }
    const source = dateParts(SOURCE_MONDAY);
    if (!source || source.getUTCDay() !== 1) throw new Error('LIVE_MULTI_SEGMENT_QA_SOURCE_MONDAY must be a valid Monday');
    const distance = dateDistance(kyivToday(), SOURCE_MONDAY);
    if (distance < 30 || distance > 400) throw new Error('source Monday must be 30-400 days in the future');
}

async function readResponse(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
}

function detail(body) {
    return body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '');
}

async function api(base, route, options = {}) {
    const timeoutSignal = AbortSignal.timeout(options.cleanup ? CLEANUP_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const signal = options.cleanup
        ? timeoutSignal
        : AbortSignal.any([timeoutSignal, runController.signal]);
    const response = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(Object.prototype.hasOwnProperty.call(options, 'body') ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.confirm ? { 'x-eventgenix-live-qa-confirmation': LIVE_MULTI_SEGMENT_QA_CONFIRMATION } : {})
        },
        body: Object.prototype.hasOwnProperty.call(options, 'body') ? JSON.stringify(options.body) : undefined,
        signal
    });
    const body = await readResponse(response);
    const accepted = options.acceptStatuses || [];
    if (!response.ok && !accepted.includes(response.status)) {
        const error = new Error(`${route} returned ${response.status}${detail(body) ? `: ${detail(body)}` : ''}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }
    return { status: response.status, body };
}

async function login(base) {
    const suppliedToken = env('LIVE_MULTI_SEGMENT_QA_TOKEN');
    if (suppliedToken) {
        const verified = await api(base, '/api/auth/verify', { token: suppliedToken });
        return { token: suppliedToken, user: verified.body?.user || verified.body };
    }
    const response = await api(base, '/api/auth/login', {
        method: 'POST',
        body: {
            username: env('LIVE_MULTI_SEGMENT_QA_USER'),
            password: env('LIVE_MULTI_SEGMENT_QA_PASS')
        }
    });
    const token = response.body?.accessToken || response.body?.access_token || response.body?.token;
    if (!token) throw new Error('login did not return an access token');
    return { token, user: response.body?.user || null };
}

function assertQaOperator(session) {
    const roles = [session.user?.role, ...(session.user?.extra_roles || [])].filter(Boolean);
    assert.ok(roles.some(role => ['creator', 'director'].includes(role)), 'live QA requires creator or director credentials');
}

function time5(value) {
    const match = String(value || '').match(/^(\d{2}:\d{2})/);
    return match ? match[1] : '';
}

function planVersion(entry = {}) {
    return String(entry.planUpdatedAt ?? entry.plan_updated_at ?? entry.hr_plan_updated_at ?? '').trim();
}

function normalizedSegments(entry = {}) {
    return (Array.isArray(entry.segments) ? entry.segments : []).map(segment => ({
        id: Number(segment.id),
        professionKey: String(segment.professionKey ?? segment.profession_key ?? ''),
        shiftStart: time5(segment.shiftStart ?? segment.shift_start ?? segment.planned_start),
        shiftEnd: time5(segment.shiftEnd ?? segment.shift_end ?? segment.planned_end),
        breakMinutes: Number(segment.breakMinutes ?? segment.break_minutes ?? 0),
        note: segment.note ?? segment.notes ?? null,
        additionalProfessionKeys: [...(segment.additionalProfessionKeys ?? segment.additional_profession_keys ?? [])].map(String).sort(),
        additionalRoles: [...(segment.additionalRoles ?? segment.additional_roles ?? [])]
            .map(role => {
                const compensationMode = String(role.compensationMode ?? role.compensation_mode ?? 'unpaid');
                return {
                    professionKey: String(role.professionKey ?? role.profession_key ?? ''),
                    compensationMode,
                    payMultiplier: compensationMode === 'paid_hourly'
                        ? Number(role.payMultiplier ?? role.pay_multiplier ?? 1)
                        : null,
                    policyVersion: role.policyVersion ?? role.policy_version ?? null
                };
            })
            .sort((left, right) => left.professionKey.localeCompare(right.professionKey))
    }));
}

function plannedMinutes(entry = {}) {
    return Number(entry.planned_minutes ?? entry.plannedMinutes ?? 0);
}

async function loadScheduleEntry(base, token, staffId, date, options = {}) {
    const response = await api(base, `/api/staff/schedule?from=${date}&to=${date}`, { token, ...options });
    return (response.body?.data || []).find(row => Number(row.staff_id) === Number(staffId)) || null;
}

function schedulePayload(staffId, date, entry = null) {
    const segments = entry ? normalizedSegments(entry) : [
        {
            professionKey: PRIMARY_PROFESSION, shiftStart: '11:00', shiftEnd: '11:30', breakMinutes: 0,
            note: MARKER,
            additionalProfessionKeys: [],
            additionalRoles: []
        },
        {
            professionKey: PRIMARY_PROFESSION, shiftStart: '11:30', shiftEnd: '20:00', breakMinutes: 0,
            note: MARKER,
            additionalProfessionKeys: [ADDITIONAL_PROFESSION],
            additionalRoles: [{
                professionKey: ADDITIONAL_PROFESSION,
                compensationMode: 'paid_hourly',
                payMultiplier: 1,
                policyVersion: null
            }]
        }
    ];
    return {
        staffId: Number(staffId),
        date,
        status: 'working',
        note: MARKER,
        professionKey: PRIMARY_PROFESSION,
        primaryProfessionKey: PRIMARY_PROFESSION,
        shiftStart: '11:00',
        shiftEnd: '20:00',
        segments,
        ...(entry ? { expectedUpdatedAt: planVersion(entry) } : {})
    };
}

function assertPlan(entry, expectedDate, label) {
    assert.ok(entry, `${label}: schedule entry exists`);
    assert.equal(String(entry.date).slice(0, 10), expectedDate, `${label}: exact date`);
    assert.equal(plannedMinutes(entry), 540, `${label}: nine non-overlapping physical hours`);
    const segments = normalizedSegments(entry);
    assert.equal(segments.length, 2, `${label}: two segments`);
    assert.ok(segments.every(segment => Number.isInteger(segment.id) && segment.id > 0), `${label}: stable segment IDs`);
    assert.deepEqual(segments.map(segment => [segment.professionKey, segment.shiftStart, segment.shiftEnd, segment.breakMinutes]), [
        [PRIMARY_PROFESSION, '11:00', '11:30', 0],
        [PRIMARY_PROFESSION, '11:30', '20:00', 0]
    ], `${label}: role/time windows`);
    assert.deepEqual(segments[0].additionalRoles, [], `${label}: first physical segment has no additional pay`);
    assert.deepEqual(
        segments[1].additionalRoles.map(role => [role.professionKey, role.compensationMode, role.payMultiplier]),
        [[ADDITIONAL_PROFESSION, 'paid_hourly', 1]],
        `${label}: paid hall attendant is explicit only for the simultaneous interval`
    );
    assert.ok(planVersion(entry), `${label}: optimistic version token`);
    return segments;
}

async function createDisposableStaff(base, token) {
    const response = await api(base, '/api/staff', {
        method: 'POST', token,
        body: {
            name: `Disposable QA Multi Segment ${RUN_ID}`,
            department: 'qa',
            position: 'Disposable QA',
            role_type: PRIMARY_PROFESSION,
            secondaryProfessions: [ADDITIONAL_PROFESSION]
        }
    });
    const staff = response.body?.data;
    assert.ok(Number(staff?.id) > 0, 'disposable staff was created');
    return staff;
}

async function recoverDisposableStaffId(base, token) {
    const response = await api(base, '/api/hr/staff?active=true&include_freelance=true', { token, cleanup: true });
    const expectedName = `Disposable QA Multi Segment ${RUN_ID}`;
    const matches = (response.body?.data || []).filter(staff => String(staff.name || '') === expectedName);
    if (matches.length > 1) throw new Error(`cleanup recovery found ${matches.length} disposable staff rows for runId`);
    return Number(matches[0]?.id) || 0;
}

async function readCleanupStatus(base, token, staffId) {
    const verification = await api(
        base,
        `/api/hr/qa/multi-segment/${encodeURIComponent(RUN_ID)}?staffId=${Number(staffId)}`,
        { token, cleanup: true }
    );
    return verification.body?.data || null;
}

async function cleanup(base, token, staffId) {
    const response = await api(base, `/api/hr/qa/multi-segment/${encodeURIComponent(RUN_ID)}`, {
        method: 'DELETE', token, confirm: true, cleanup: true,
        body: { staffId: Number(staffId), confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION }
    });
    const after = response.body?.data?.after;
    assert.equal(after?.confirmedClean, true, 'server cleanup is confirmed');
    const verification = await readCleanupStatus(base, token, staffId);
    assert.equal(verification?.confirmedClean, true, 'independent read-only cleanup verification');
    return {
        runId: RUN_ID,
        staffId: Number(staffId),
        before: response.body?.data?.before?.counts || {},
        fixtureIds: response.body?.data?.before?.fixtureIds || {},
        after: verification?.counts || {},
        archived: verification?.archived === true,
        confirmedClean: true
    };
}

async function run() {
    assertConfigured();
    const base = normalizeBase(TARGET_URL);
    const watchdog = setTimeout(() => runController.abort(new Error('live QA overall timeout')), OVERALL_TIMEOUT_MS);
    let session = null;
    let staffId = 0;
    let cleanupReport = null;
    let mainError = null;
    let cleanupError = null;
    const results = [];
    try {
        session = await login(base);
        assertQaOperator(session);
        const capabilities = await api(base, '/api/hr/qa/multi-segment/capabilities', { token: session.token });
        assert.equal(capabilities.body?.fixtureVersion, 1, 'live QA helper version');
        assert.equal(capabilities.body?.createsBookings, false, 'helper never creates bookings');
        assert.equal(capabilities.body?.createsFinanceTransactions, false, 'helper never creates finance transactions');

        const catalog = await api(base, '/api/hr/professions', { token: session.token });
        const activeKeys = new Set((catalog.body?.data || []).filter(row => row.is_active !== false).map(row => row.key));
        REQUIRED_PROFESSIONS.forEach(key => assert.ok(activeKeys.has(key), `active HR profession required: ${key}`));
        const existingStaff = await api(base, '/api/hr/staff?include_freelance=true', { token: session.token });
        const fixtureName = `Disposable QA Multi Segment ${RUN_ID}`;
        assert.equal(
            (existingStaff.body?.data || []).some(staff => String(staff.name || '') === fixtureName),
            false,
            'runId must be unique across existing staff fixtures'
        );
        results.push('preflight');

        const staff = await createDisposableStaff(base, session.token);
        staffId = Number(staff.id);
        const payrollScheme = PAYROLL_SCHEMES[PAYROLL_SCHEME];
        await api(base, `/api/hr/staff/${staffId}`, {
            method: 'PUT', token: session.token,
            body: {
                role_type: PRIMARY_PROFESSION,
                secondary_professions: [ADDITIONAL_PROFESSION],
                hourly_rate: payrollScheme.baseRate,
                rate_unit: payrollScheme.rateUnit,
                profession_rates: [
                    { profession_key: PRIMARY_PROFESSION, hourly_rate: payrollScheme.baseRate },
                    { profession_key: ADDITIONAL_PROFESSION, hourly_rate: 200 }
                ],
                notes: MARKER
            }
        });
        const roleAssignments = await api(base, `/api/hr/staff/${staffId}/role-assignments`, {
            method: 'PUT', token: session.token,
            body: {
                primary_role: PRIMARY_PROFESSION,
                assignments: [
                    {
                        profession_key: PRIMARY_PROFESSION,
                        is_primary: true,
                        status: 'active',
                        admission_status: 'approved',
                        internship_status: 'none',
                        hourly_rate: payrollScheme.baseRate,
                        notes: MARKER
                    },
                    {
                        profession_key: ADDITIONAL_PROFESSION,
                        is_primary: false,
                        status: 'active',
                        admission_status: 'approved',
                        internship_status: 'none',
                        hourly_rate: 200,
                        notes: MARKER
                    }
                ]
            }
        });
        assert.deepEqual(
            (roleAssignments.body?.data || [])
                .map(row => [row.profession_key, row.status, row.admission_status])
                .sort((left, right) => left[0].localeCompare(right[0])),
            [
                [ADDITIONAL_PROFESSION, 'active', 'approved'],
                [PRIMARY_PROFESSION, 'active', 'approved']
            ].sort((left, right) => left[0].localeCompare(right[0])),
            'disposable staff roles are explicitly active and approved'
        );
        results.push('disposable_staff');

        const created = await api(base, '/api/staff/schedule', {
            method: 'PUT', token: session.token, body: schedulePayload(staffId, SOURCE_MONDAY)
        });
        const firstEntry = created.body?.data;
        const originalSegments = assertPlan(firstEntry, SOURCE_MONDAY, 'initial save');
        const refreshed = await loadScheduleEntry(base, session.token, staffId, SOURCE_MONDAY);
        assert.deepEqual(normalizedSegments(refreshed), originalSegments, 'refresh preserves segment data and IDs');
        const sourceRows = [refreshed].filter(Boolean);
        assert.equal(new Set(sourceRows.map(row => Number(row.staff_id))).size, 1, 'headcount is one distinct staff member');
        results.push('schedule_refresh_headcount');

        const attendanceCreated = await api(base, '/api/hr/qa/multi-segment/attendance', {
            method: 'POST', token: session.token, confirm: true,
            body: {
                runId: RUN_ID,
                staffId,
                date: SOURCE_MONDAY,
                clockInTime: '11:00',
                clockOutTime: '20:00',
                confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION
            }
        });
        assert.equal(attendanceCreated.body?.data?.allocation_source, 'clock_interval', 'attendance allocation uses clock interval');
        assert.equal(Number(attendanceCreated.body?.data?.actual_minutes), 540, 'attendance keeps nine physical hours');
        const attendanceRead = await api(base, `/api/staff/attendance?from=${SOURCE_MONDAY}&to=${SOURCE_MONDAY}`, { token: session.token });
        const attendanceRows = (attendanceRead.body?.data || []).filter(row => Number(row.staff_id) === staffId);
        assert.equal(attendanceRows.length, 1, 'one daily attendance record');
        const allocations = attendanceRows[0].segment_allocations || attendanceRows[0].segmentAllocations || [];
        assert.deepEqual(allocations.map(row => [row.professionKey, Number(row.actualMinutes)]), [
            [PRIMARY_PROFESSION, 30], [PRIMARY_PROFESSION, 510]
        ], 'attendance allocates adjacent physical segments without duplicating minutes');
        const compensationSnapshot = attendanceRows[0].compensation_snapshot || attendanceRows[0].compensationSnapshot || {};
        const snapshotAllocations = compensationSnapshot.compensationAllocations
            || compensationSnapshot.compensation_allocations
            || attendanceRows[0].compensation_allocations
            || attendanceRows[0].compensationAllocations
            || [];
        console.log(`Attendance compensation summary: ${JSON.stringify({
            state: compensationSnapshot.state || null,
            manualReview: compensationSnapshot.manualReview === true,
            allocations: snapshotAllocations.map(row => ({
                allocationType: row.allocationType || row.allocation_type || null,
                professionKey: row.professionKey || row.profession_key || null,
                actualMinutes: Number(row.actualMinutes ?? row.actual_minutes ?? 0),
                compensationMode: row.compensationMode || row.compensation_mode || null,
                rateUnit: row.rateUnit || row.rate_unit || null,
                policyVersion: row.policyVersion || row.policy_version || null
            })),
            issueCodes: (compensationSnapshot.issues || attendanceRows[0].compensation_issues || [])
                .map(issue => issue.code || null)
                .filter(Boolean)
        })}`);
        const paidAdditionalAllocation = snapshotAllocations.find(row =>
            (row.allocationType || row.allocation_type) === 'simultaneous_additional'
            && (row.professionKey || row.profession_key) === ADDITIONAL_PROFESSION);
        assert.equal(Number(paidAdditionalAllocation?.actualMinutes ?? paidAdditionalAllocation?.actual_minutes), 510, 'attendance snapshot stores 8.5 paid hall-attendant hours');
        assert.equal(Number(paidAdditionalAllocation?.rate), 200, 'attendance snapshot freezes the hall-attendant profession rate');
        results.push('attendance');

        const month = SOURCE_MONDAY.slice(0, 7);
        const payrollPreview = await api(base, `/api/payroll/preview?staffId=${staffId}&month=${month}`, { token: session.token });
        const preview = payrollPreview.body?.preview;
        assert.equal(Number(preview?.daysWorked), 1, `${PAYROLL_SCHEME} payroll counts one day worked`);
        assert.equal(Number(preview?.physicalMinutes), 540, 'payroll preview keeps nine physical hours');
        const previewRows = (preview?.professionRateSummary || []);
        const baseRows = previewRows.filter(row => row.kind === 'base');
        const additionalRows = previewRows.filter(row => row.kind === 'simultaneous_additional');
        assert.equal(baseRows.length, 1, `${PAYROLL_SCHEME} payroll has one base line`);
        assert.equal(baseRows[0].profession_key, PRIMARY_PROFESSION, 'base line keeps the primary profession');
        assert.equal(Number(baseRows[0].rate), payrollScheme.baseRate, 'base line keeps the explicit primary scheme rate');
        assert.deepEqual(additionalRows.map(row => [row.profession_key, Number(row.actual_minutes), Number(row.rate), Number(row.amount)]), [
            [ADDITIONAL_PROFESSION, 510, 200, 1700]
        ], `${PAYROLL_SCHEME} payroll pays 8.5 simultaneous hall-attendant hours at its profession rate`);
        assert.equal(Number(preview?.baseAmount), payrollScheme.baseAmount, 'base role amount is not duplicated');
        assert.equal(Number(preview?.additionalAmount), 1700, 'paid additional role has a separate allocation amount');
        assert.equal(Number(preview?.netAmount), payrollScheme.totalAmount, 'preview totals base and additional pay without changing physical hours');
        assert.equal(Number(preview?.payrollTransparency?.physicalHours), 9, 'preview exposes nine physical hours');
        assert.equal(Number(preview?.payrollTransparency?.baseRoleHours), 9, 'preview exposes nine base-role hours');
        assert.equal(Number(preview?.payrollTransparency?.additionalRoleHours), 8.5, 'preview exposes 8.5 additional role hours');
        assert.equal(
            (preview?.payrollBlockingIssues || []).some(
                issue => issue.code === 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            ),
            false,
            `${PAYROLL_SCHEME} preview is supported`
        );
        results.push(`payroll_preview_${PAYROLL_SCHEME}`);

        const reportHours = await api(base, `/api/staff/schedule/hours?from=${SOURCE_MONDAY}&to=${SOURCE_MONDAY}`, { token: session.token });
        const reportRow = reportHours.body?.data?.[String(staffId)] || reportHours.body?.data?.[staffId];
        assert.equal(Number(reportRow?.totalHours), plannedMinutes(refreshed) / 60, 'Reports-compatible planned hours match Staff Schedule');
        assert.equal(Number(reportRow?.totalHours), 9, 'Reports-compatible hours remain physical and single-counted');
        results.push('reports_planned_hours');

        console.log(`Live multi-segment QA assertions passed: ${results.join(', ')}`);
    } catch (error) {
        mainError = error;
    } finally {
        clearTimeout(watchdog);
        if (session?.token) {
            try {
                if (!staffId) staffId = await recoverDisposableStaffId(base, session.token);
                if (staffId) cleanupReport = await cleanup(base, session.token, staffId);
            } catch (error) {
                let status = error?.body?.data || null;
                if (staffId) {
                    try { status = await readCleanupStatus(base, session.token, staffId); } catch { /* report the original cleanup failure */ }
                }
                if (status?.confirmedClean === true) {
                    cleanupReport = {
                        runId: RUN_ID,
                        staffId,
                        confirmedClean: true,
                        fixtureIds: status.fixtureIds || {},
                        after: status.counts || {},
                        archived: status.archived === true,
                        note: 'cleanup response was interrupted; read-only verification confirmed the final state'
                    };
                } else {
                    cleanupError = error;
                    cleanupReport = {
                        runId: RUN_ID,
                        staffId: staffId || null,
                        confirmedClean: false,
                        fixtureIds: status?.fixtureIds || {},
                        counts: status?.counts || {},
                        error: error?.message || String(error)
                    };
                }
            }
        }
        console.log(`Cleanup report: ${JSON.stringify(cleanupReport || {
            runId: RUN_ID,
            staffId: staffId || null,
            confirmedClean: staffId === 0,
            note: staffId ? 'cleanup was not available' : 'no fixture staff id was observed'
        })}`);
    }
    if (cleanupError) {
        const error = new Error(`live QA cleanup failed: ${cleanupError.message || cleanupError}`);
        error.cause = mainError || cleanupError;
        throw error;
    }
    if (mainError) throw mainError;
    assert.equal(cleanupReport?.confirmedClean, true, 'cleanup must be confirmed after successful QA');
}

if (require.main === module) {
    run().catch(error => {
        console.error(`Live multi-segment QA failed: ${error.message || error}`);
        process.exitCode = 1;
    });
}

module.exports = {
    addDateDays,
    assertConfigured,
    defaultFutureMonday,
    normalizedSegments,
    run,
    schedulePayload
};
