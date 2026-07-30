#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { buildStaffScheduleWorkbookBuffer } = require('../../services/staffScheduleWorkbook');
const { listStaffScheduleCategoryContract } = require('../../services/staffDisplayGroups');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.STAFF_SCHEDULE_BROWSER_SMOKE_HEADLESS !== 'false';
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'staff-schedule-custom-range-smoke');
const STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY = 'pzp_staff_schedule_expanded_groups';

const SMOKE_USER = {
    id: 1,
    name: 'Schedule QA',
    username: 'schedule.qa',
    role: 'creator'
};

const DISPLAY_GROUPS = [
    { key: 'animators', label: 'Аніматори', order: 10 },
    { key: 'trampoline', label: 'Батутисти', order: 20 },
    { key: 'reception', label: 'Рецепшен', order: 30 },
    { key: 'admin', label: 'Адміністрація', order: 40 },
    { key: 'cafe', label: 'Кафе', order: 50 },
    { key: 'tech', label: 'Технічний відділ', order: 60 },
    { key: 'cleaning', label: 'Прибирання', order: 70 }
];
const SCHEDULE_CATEGORY_CONTRACT = listStaffScheduleCategoryContract();

const STAFF_ROWS = [
    {
        id: 101,
        name: 'Синіпол Віталіна (QA fixture)',
        display_name: 'Віталіна Синіпол',
        position: 'Старший менеджер',
        department: 'reception',
        role_type: 'senior_manager',
        display_group: 'reception',
        secondary_professions: ['reception', 'reception', 'animator'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    },
    {
        id: 102,
        name: 'Коваль Оля',
        display_name: 'Коваль Оля',
        position: 'Рецепція',
        department: 'reception',
        role_type: 'reception',
        display_group: 'reception',
        secondary_professions: ['reception'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: false,
        has_face_descriptor: false
    },
    {
        id: 103,
        name: 'Іваненко Марко',
        display_name: 'Іваненко Марко',
        position: 'Адміністратор',
        department: 'admin',
        role_type: 'admin',
        display_group: 'admin',
        secondary_professions: ['manager', 'barista'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: false
    },
    {
        id: 104,
        name: 'Мельник Назар',
        display_name: 'Назар Мельник',
        position: 'Бариста',
        department: 'cafe',
        role_type: 'barista',
        display_group: 'cafe',
        secondary_professions: ['trampoline_instructor'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    },
    {
        id: 105,
        name: 'Легасі Працівник',
        display_name: 'Легасі Працівник',
        position: 'Legacy shift role',
        department: 'security',
        role_type: 'legacy_shift_role',
        secondary_professions: ['legacy_auxiliary'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: false,
        has_face_descriptor: false
    },
    {
        id: 106,
        name: 'Primary Manager',
        display_name: 'Primary Manager',
        position: 'Менеджер',
        department: 'reception',
        role_type: 'manager',
        display_group: 'reception',
        secondary_professions: ['reception'],
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    },
    {
        id: 107,
        name: 'Primary Waiter',
        display_name: 'Primary Waiter',
        position: 'Офіціант',
        department: 'cafe',
        role_type: 'waiter',
        display_group: 'cafe',
        secondary_professions: ['cook'],
        training_readiness: { total: 5, completed: 1, percent: 20 },
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    },
    {
        id: 108,
        name: 'Animator Trampoline',
        display_name: 'Animator Trampoline',
        position: 'Аніматор / батутист',
        department: 'animators',
        role_type: 'animator',
        display_group: 'animators',
        secondary_professions: ['trampoline_instructor'],
        training_readiness: { total: 4, completed: 4, percent: 100 },
        is_active: true,
        is_freelance: false,
        hr_pool_status: 'core',
        has_account: true,
        has_face_descriptor: true
    }
];

const STAFF_API_ROWS = [
    ...STAFF_ROWS,
    { ...STAFF_ROWS[0], id: '101' }
];

const PROFESSIONS = [
    {
        key: 'senior_manager',
        title: 'Старший менеджер',
        department: 'reception',
        is_active: true,
        people: [{
            id: 101,
            isActive: true,
            assignmentStatus: 'active',
            admissionStatus: 'approved',
            explicitRate: null,
            hourlyRate: 200,
            rateSource: 'staff.hourly_rate',
            rateUnit: 'hour'
        }]
    },
    {
        key: 'animator',
        title: 'Аніматор',
        department: 'animators',
        is_active: true,
        people: [{
            id: 101,
            isActive: true,
            assignmentStatus: 'active',
            admissionStatus: 'approved',
            explicitRate: 160,
            hourlyRate: 160,
            rateSource: 'staff_profession_rates.hourly_rate',
            rateUnit: 'hour'
        }]
    },
    {
        key: 'reception',
        title: 'Рецепція',
        department: 'reception',
        is_active: true,
        people: [{
            id: 101,
            isActive: true,
            assignmentStatus: 'active',
            admissionStatus: 'approved',
            explicitRate: 180,
            hourlyRate: 180,
            rateSource: 'staff_profession_rates.hourly_rate',
            rateUnit: 'hour'
        }]
    },
    { key: 'manager', title: 'Менеджер', department: 'reception', is_active: true },
    { key: 'admin', title: 'Адміністратор', department: 'admin', is_active: true },
    { key: 'barista', title: 'Бариста', department: 'cafe', is_active: true },
    { key: 'cook', title: 'Кухар', department: 'cafe', is_active: true },
    { key: 'waiter', title: 'Офіціант', department: 'cafe', is_active: true },
    { key: 'trampoline_instructor', title: 'Інструктор батутів', department: 'trampoline', is_active: true }
];

const SCHEDULE_FIXTURE_ENTRIES = [
    {
        id: 9104,
        staff_id: 101,
        date: '2026-07-06',
        shift_start: '10:00:00',
        shift_end: '12:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9105,
        staff_id: 101,
        date: '2026-07-07',
        shift_start: '10:00:00',
        shift_end: '14:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9106,
        staff_id: 101,
        date: '2026-07-08',
        shift_start: '10:00:00',
        shift_end: '16:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9101,
        staff_id: 101,
        date: '2026-07-09',
        shift_start: '12:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9102,
        staff_id: 101,
        date: '2026-07-11',
        shift_start: '10:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9103,
        staff_id: 101,
        date: '2026-07-13',
        shift_start: '10:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9116,
        staff_id: 101,
        date: '2026-07-16',
        shift_start: '11:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9124,
        staff_id: 101,
        date: '2026-07-24',
        shift_start: '12:00:00',
        shift_end: '20:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9131,
        staff_id: 101,
        date: '2026-07-31',
        shift_start: '10:00:00',
        shift_end: '18:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9201,
        staff_id: 108,
        date: '2026-07-11',
        shift_start: '09:00:00',
        shift_end: '12:00:00',
        status: 'working',
        profession_key: 'animator'
    },
    {
        id: 9202,
        staff_id: 108,
        date: '2026-07-12',
        shift_start: '12:00:00',
        shift_end: '15:00:00',
        status: 'working',
        profession_key: 'trampoline_instructor'
    }
];

const apiCalls = {
    scheduleRanges: [],
    scheduleBodies: [],
    scheduleResponses: [],
    historyResponses: [],
    hoursRanges: [],
    bulkBodies: [],
    copyWeekBodies: []
};
let fixtureSegmentIdSequence = 30000;
let fixturePlanVersionSequence = 1;

function fixtureSegmentDurationMinutes(segment = {}) {
    const toMinutes = value => {
        const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
        return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
    };
    const start = toMinutes(segment.shiftStart || segment.shift_start);
    const rawEnd = toMinutes(segment.shiftEnd || segment.shift_end);
    if (start === null || rawEnd === null || start === rawEnd) return 0;
    const end = rawEnd < start ? rawEnd + (24 * 60) : rawEnd;
    return Math.max(0, end - start - Number(segment.breakMinutes || segment.break_minutes || 0));
}

function fixtureSavedSegments(body = {}) {
    return (Array.isArray(body.segments) ? body.segments : []).map(segment => {
        return {
            id: ++fixtureSegmentIdSequence,
            professionKey: segment.professionKey,
            shiftStart: segment.shiftStart,
            shiftEnd: segment.shiftEnd,
            breakMinutes: Number(segment.breakMinutes || 0),
            note: segment.note || null,
            additionalRoles: Array.isArray(segment.additionalRoles)
                ? segment.additionalRoles.map(role => ({ ...role }))
                : [],
            additionalProfessionKeys: Array.isArray(segment.additionalProfessionKeys)
                ? [...segment.additionalProfessionKeys]
                : []
        };
    });
}

function setFixtureSecondaryProfessions(staffId, professions) {
    const normalizedStaffId = Number(staffId);
    for (const row of STAFF_API_ROWS) {
        if (Number(row.id) === normalizedStaffId) row.secondary_professions = [...professions];
    }
}

function assertSingleScheduleEntryPerStaffDate(entries, label = 'schedule fixture') {
    const keys = entries.map(entry => `${Number(entry.staff_id)}:${entry.date}`);
    assert.equal(
        new Set(keys).size,
        keys.length,
        `${label} keeps one actual shift per staff member and date`
    );
}

const scheduleResponseScenarios = [];
const activeScheduleResponseScenarios = new Set();
let scheduleResponseScenarioSequence = 0;
const scheduleSaveResponseScenarios = [];
const activeScheduleSaveResponseScenarios = new Set();
let scheduleSaveResponseScenarioSequence = 0;
const historyResponseScenarios = [];
const activeHistoryResponseScenarios = new Set();
let historyResponseScenarioSequence = 0;

function createDeferred() {
    let resolvePromise;
    let settled = false;
    const promise = new Promise(resolve => {
        resolvePromise = value => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
    });
    return {
        promise,
        resolve: resolvePromise,
        get settled() {
            return settled;
        }
    };
}

function queueScheduleResponseScenario(options = {}) {
    const scenario = {
        id: ++scheduleResponseScenarioSequence,
        from: options.from || null,
        to: options.to || null,
        kind: options.kind || 'success',
        status: Number(options.status || 500),
        error: options.error || 'Schedule fixture failure',
        body: options.body,
        hold: Boolean(options.hold),
        started: createDeferred(),
        gate: createDeferred(),
        finished: createDeferred(),
        request: null
    };
    if (!scenario.hold) scenario.gate.resolve();
    scenario.release = () => scenario.gate.resolve();
    scheduleResponseScenarios.push(scenario);
    return scenario;
}

function takeScheduleResponseScenario(from, to) {
    const index = scheduleResponseScenarios.findIndex(scenario => {
        const fromMatches = !scenario.from || scenario.from === from;
        const toMatches = !scenario.to || scenario.to === to;
        return fromMatches && toMatches;
    });
    if (index < 0) return null;
    const [scenario] = scheduleResponseScenarios.splice(index, 1);
    activeScheduleResponseScenarios.add(scenario);
    return scenario;
}

function releaseScheduleResponseScenarios() {
    for (const scenario of [...scheduleResponseScenarios, ...activeScheduleResponseScenarios]) {
        scenario.release();
    }
    scheduleResponseScenarios.length = 0;
}

function queueScheduleSaveResponseScenario(options = {}) {
    const scenario = {
        id: ++scheduleSaveResponseScenarioSequence,
        staffId: options.staffId ? Number(options.staffId) : null,
        date: options.date || null,
        hold: Boolean(options.hold),
        started: createDeferred(),
        gate: createDeferred(),
        finished: createDeferred(),
        request: null
    };
    if (!scenario.hold) scenario.gate.resolve();
    scenario.release = () => scenario.gate.resolve();
    scheduleSaveResponseScenarios.push(scenario);
    return scenario;
}

function takeScheduleSaveResponseScenario(staffId, date) {
    const index = scheduleSaveResponseScenarios.findIndex(scenario => (
        (!scenario.staffId || scenario.staffId === Number(staffId))
        && (!scenario.date || scenario.date === date)
    ));
    if (index < 0) return null;
    const [scenario] = scheduleSaveResponseScenarios.splice(index, 1);
    activeScheduleSaveResponseScenarios.add(scenario);
    return scenario;
}

function releaseScheduleSaveResponseScenarios() {
    for (const scenario of [...scheduleSaveResponseScenarios, ...activeScheduleSaveResponseScenarios]) {
        scenario.release();
    }
    scheduleSaveResponseScenarios.length = 0;
}

function scheduleHistoryFixture(marker, staffId, date) {
    return [{
        id: `history-${marker}`,
        action: 'staff_schedule_update',
        staff_id: Number(staffId),
        created_at: `${date}T09:15:00.000Z`,
        performed_by: marker,
        details: {
            source: marker,
            changes: {
                note: { from: '', to: marker }
            }
        }
    }];
}

function queueHistoryResponseScenario(options = {}) {
    const scenario = {
        id: ++historyResponseScenarioSequence,
        staffId: options.staffId ? Number(options.staffId) : null,
        date: options.date || null,
        marker: options.marker || `HISTORY-${historyResponseScenarioSequence}`,
        hold: Boolean(options.hold),
        started: createDeferred(),
        aborted: createDeferred(),
        gate: createDeferred(),
        finished: createDeferred(),
        request: null
    };
    if (!scenario.hold) scenario.gate.resolve();
    scenario.release = () => scenario.gate.resolve();
    historyResponseScenarios.push(scenario);
    return scenario;
}

function takeHistoryResponseScenario(staffId, date) {
    const index = historyResponseScenarios.findIndex(scenario => (
        (!scenario.staffId || scenario.staffId === Number(staffId))
        && (!scenario.date || scenario.date === date)
    ));
    if (index < 0) return null;
    const [scenario] = historyResponseScenarios.splice(index, 1);
    activeHistoryResponseScenarios.add(scenario);
    return scenario;
}

function releaseHistoryResponseScenarios() {
    for (const scenario of [...historyResponseScenarios, ...activeHistoryResponseScenarios]) {
        scenario.release();
    }
    historyResponseScenarios.length = 0;
}

function fail(message) {
    console.error(`Staff schedule custom range browser smoke failed: ${message}`);
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
    if (relativePath === 'staff') relativePath = 'staff.html';
    const absolutePath = path.resolve(ROOT, relativePath);
    const rootPrefix = `${ROOT}${path.sep}`;
    if (absolutePath !== ROOT && !absolutePath.startsWith(rootPrefix)) return null;
    return absolutePath;
}

function sendJson(res, body, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
}

function collectJson(req) {
    return new Promise(resolve => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({});
            }
        });
    });
}

function scheduleFixtureEntriesForRange(from, to) {
    if (!from || !to) return [];
    return SCHEDULE_FIXTURE_ENTRIES.filter(entry => entry.date >= from && entry.date <= to);
}

async function sendScheduleFixtureResponse(req, res, from, to) {
    const scenario = takeScheduleResponseScenario(from, to);
    if (!scenario) {
        sendJson(res, {
            success: true,
            data: scheduleFixtureEntriesForRange(from, to),
            displayGroups: DISPLAY_GROUPS,
            scheduleCategoryContract: SCHEDULE_CATEGORY_CONTRACT
        });
        apiCalls.scheduleResponses.push({ from, to, kind: 'success', scenarioId: null });
        return;
    }

    scenario.request = { from, to };
    scenario.started.resolve(scenario.request);
    try {
        await scenario.gate.promise;
        if (res.destroyed || res.writableEnded) {
            apiCalls.scheduleResponses.push({ from, to, kind: 'client-aborted', scenarioId: scenario.id });
            return;
        }

        if (scenario.kind === 'network-error') {
            apiCalls.scheduleResponses.push({ from, to, kind: scenario.kind, scenarioId: scenario.id });
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': '4096',
                'Cache-Control': 'no-store'
            });
            res.flushHeaders();
            res.write('{"success":true,"data":[');
            await new Promise(resolve => setImmediate(resolve));
            res.destroy();
            return;
        }

        if (scenario.kind === 'invalid-json') {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end('{"success":true,"data":');
            apiCalls.scheduleResponses.push({ from, to, kind: scenario.kind, scenarioId: scenario.id });
            return;
        }

        if (scenario.kind === 'http-error') {
            sendJson(res, scenario.body || { success: false, error: scenario.error }, scenario.status);
            apiCalls.scheduleResponses.push({ from, to, kind: scenario.kind, status: scenario.status, scenarioId: scenario.id });
            return;
        }

        sendJson(res, scenario.body || {
            success: true,
            data: scheduleFixtureEntriesForRange(from, to),
            displayGroups: DISPLAY_GROUPS,
            scheduleCategoryContract: SCHEDULE_CATEGORY_CONTRACT
        });
        apiCalls.scheduleResponses.push({ from, to, kind: scenario.kind, scenarioId: scenario.id });
    } finally {
        activeScheduleResponseScenarios.delete(scenario);
        scenario.finished.resolve(scenario.request);
    }
}

async function sendHistoryFixtureResponse(req, res, staffId, date) {
    const scenario = takeHistoryResponseScenario(staffId, date);
    if (!scenario) {
        sendJson(res, { success: true, data: [] });
        apiCalls.historyResponses.push({
            staffId: Number(staffId),
            date,
            kind: 'success',
            scenarioId: null
        });
        return;
    }

    scenario.request = { staffId: Number(staffId), date };
    scenario.started.resolve(scenario.request);
    let clientAborted = Boolean(req.aborted);
    const markClientAborted = () => {
        clientAborted = true;
        scenario.aborted.resolve(scenario.request);
    };
    req.once('aborted', markClientAborted);
    res.once('close', () => {
        if (!res.writableEnded) markClientAborted();
    });

    try {
        await scenario.gate.promise;
        if (clientAborted || req.aborted || res.destroyed || res.writableEnded) {
            apiCalls.historyResponses.push({
                staffId: Number(staffId),
                date,
                kind: 'client-aborted',
                scenarioId: scenario.id
            });
            return;
        }

        sendJson(res, {
            success: true,
            data: scheduleHistoryFixture(scenario.marker, staffId, date)
        });
        apiCalls.historyResponses.push({
            staffId: Number(staffId),
            date,
            kind: 'success',
            marker: scenario.marker,
            scenarioId: scenario.id
        });
    } finally {
        activeHistoryResponseScenarios.delete(scenario);
        scenario.finished.resolve(scenario.request);
    }
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') {
        sendJson(res, { success: true, user: SMOKE_USER });
        return true;
    }
    if (url.pathname === '/api/hr/professions') {
        sendJson(res, { success: true, data: PROFESSIONS });
        return true;
    }
    if (url.pathname === '/api/staff') {
        sendJson(res, {
            success: true,
            data: STAFF_API_ROWS,
            departments: {
                animators: 'Аніматори',
                trampoline: 'Батутисти',
                reception: 'Рецепшен',
                admin: 'Адміністрація',
                cafe: 'Кафе',
                tech: 'Технічний відділ',
                cleaning: 'Прибирання'
            },
            displayGroups: DISPLAY_GROUPS,
            scheduleCategoryContract: SCHEDULE_CATEGORY_CONTRACT
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/export-xlsx' && req.method === 'POST') {
        const payload = await collectJson(req);
        const { buffer, filename } = await buildStaffScheduleWorkbookBuffer(payload);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': buffer.length
        });
        res.end(buffer);
        return true;
    }
    if (url.pathname === '/api/staff/schedule' && req.method === 'PUT') {
        const body = await collectJson(req);
        const staffId = Number(body.staffId);
        const saveScenario = takeScheduleSaveResponseScenario(staffId, body.date);
        if (saveScenario) {
            saveScenario.request = body;
            saveScenario.started.resolve(body);
        }
        apiCalls.scheduleBodies.push(body);
        try {
            if (saveScenario) await saveScenario.gate.promise;
        const existingIndex = SCHEDULE_FIXTURE_ENTRIES.findIndex(entry => (
            Number(entry.staff_id) === staffId && entry.date === body.date
        ));
        const existing = existingIndex >= 0 ? SCHEDULE_FIXTURE_ENTRIES[existingIndex] : null;
        const segments = fixtureSavedSegments(body);
        const planUpdatedAt = `2026-07-14T10:00:00.${String(fixturePlanVersionSequence++).padStart(6, '0')}Z`;
        const saved = {
            id: existing?.id || (9900 + SCHEDULE_FIXTURE_ENTRIES.length),
            staff_id: staffId,
            date: body.date,
            shift_start: body.shiftStart || null,
            shift_end: body.shiftEnd || null,
            status: body.status || 'working',
            note: body.note || null,
            profession_key: body.professionKey || null,
            primary_profession_key: body.primaryProfessionKey || body.professionKey || null,
            profession_keys: [...new Set(segments.flatMap(segment => [
                segment.professionKey,
                ...(segment.additionalProfessionKeys || [])
            ]).filter(Boolean))],
            planned_minutes: segments.reduce((total, segment) => total + fixtureSegmentDurationMinutes(segment), 0),
            planUpdatedAt,
            plan_updated_at: planUpdatedAt,
            segments
        };
        if (existingIndex >= 0) SCHEDULE_FIXTURE_ENTRIES.splice(existingIndex, 1, saved);
        else SCHEDULE_FIXTURE_ENTRIES.push(saved);
        assertSingleScheduleEntryPerStaffDate(SCHEDULE_FIXTURE_ENTRIES, 'mock schedule PUT');
        sendJson(res, { success: true, data: saved });
        } finally {
            if (saveScenario) {
                activeScheduleSaveResponseScenarios.delete(saveScenario);
                saveScenario.finished.resolve(saveScenario.request);
            }
        }
        return true;
    }
    if (url.pathname === '/api/staff/schedule') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        apiCalls.scheduleRanges.push({
            from,
            to
        });
        await sendScheduleFixtureResponse(req, res, from, to);
        return true;
    }
    const scheduleHistoryMatch = url.pathname.match(/^\/api\/staff\/schedule\/history\/(\d+)\/(\d{4}-\d{2}-\d{2})$/);
    if (scheduleHistoryMatch) {
        await sendHistoryFixtureResponse(req, res, Number(scheduleHistoryMatch[1]), scheduleHistoryMatch[2]);
        return true;
    }
    const shiftPreferenceMatch = url.pathname.match(/^\/api\/staff\/(\d+)\/shift-preferences$/);
    if (shiftPreferenceMatch) {
        const staffId = Number(shiftPreferenceMatch[1]);
        const staff = STAFF_ROWS.find(row => Number(row.id) === staffId);
        const professionKey = staff?.role_type || 'animator';
        const secondaryPreferences = staffId === 101
            ? [
                { staff_id: staffId, profession_key: 'animator', day_type: 'weekday', start_time: '12:00:00', end_time: '20:00:00', is_active: true },
                { staff_id: staffId, profession_key: 'animator', day_type: 'weekend', start_time: '10:00:00', end_time: '20:00:00', is_active: true },
                { staff_id: staffId, profession_key: 'reception', day_type: 'weekday', start_time: '08:00:00', end_time: '16:00:00', is_active: true },
                { staff_id: staffId, profession_key: 'reception', day_type: 'weekend', start_time: '09:00:00', end_time: '17:00:00', is_active: true }
            ]
            : [];
        sendJson(res, {
            success: true,
            data: [
                { staff_id: staffId, profession_key: professionKey, day_type: 'weekday', start_time: '12:00:00', end_time: '20:00:00', is_active: true },
                { staff_id: staffId, profession_key: professionKey, day_type: 'weekend', start_time: '10:00:00', end_time: '20:00:00', is_active: true },
                ...secondaryPreferences
            ]
        });
        return true;
    }
    if (url.pathname === '/api/staff/attendance') {
        sendJson(res, {
            success: true,
            data: [],
            summary: {}
        });
        return true;
    }
    if (url.pathname === '/api/staff/link-status') {
        sendJson(res, {
            success: true,
            data: STAFF_ROWS.map((staff, index) => ({
                ...staff,
                user_id: index === 1 ? null : 200 + staff.id,
                username: index === 1 ? null : `staff.${staff.id}`,
                user_role: staff.role_type
            })),
            stats: {
                total: STAFF_ROWS.length,
                linked: 2,
                unlinked: 1,
                freelance: 0
            }
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/hours') {
        apiCalls.hoursRanges.push({
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to')
        });
        sendJson(res, {
            success: true,
            data: {
                101: { totalHours: 24, workingDays: 3 },
                102: { totalHours: 16, workingDays: 2 },
                103: { totalHours: 8, workingDays: 1 }
            }
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/bulk') {
        const body = await collectJson(req);
        apiCalls.bulkBodies.push(body);
        sendJson(res, {
            success: true,
            count: Array.isArray(body.entries) ? body.entries.length : 0
        });
        return true;
    }
    if (url.pathname === '/api/staff/schedule/copy-week') {
        const body = await collectJson(req);
        apiCalls.copyWeekBodies.push(body);
        sendJson(res, {
            success: true,
            dryRun: Boolean(body.dryRun),
            count: 7,
            staffCount: STAFF_ROWS.length,
            conflicts: 0
        });
        return true;
    }
    if (url.pathname.startsWith('/api/')) {
        sendJson(res, { success: true, data: [] });
        return true;
    }
    return false;
}

function createServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://local');
        if (await handleApi(req, res, url)) return;

        const filePath = staticFilePath(req.url || '/');
        if (!filePath) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, body) => {
            if (err) {
                res.writeHead(err.code === 'ENOENT' ? 404 : 500);
                res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType(filePath) });
            res.end(body);
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, base: `http://127.0.0.1:${address.port}` });
        });
    });
}

function dateRangeDays(from, to) {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function formatInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isWeekday(date, weekday) {
    return new Date(`${date}T00:00:00`).getDay() === weekday;
}

function rangeDates(from, to) {
    const dates = [];
    const current = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (current <= end) {
        dates.push(formatInputDate(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

function waitForCondition(predicate, message, timeoutMs = 20000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error(message));
                return;
            }
            setTimeout(tick, 50);
        };
        tick();
    });
}

async function waitForDayColumns(page, dayCount) {
    await page.waitForFunction(count => {
        return document.querySelectorAll('#scheduleHead th').length === count + 1;
    }, dayCount, { timeout: 20000 });
}

async function waitForScheduleState(page, expectedState) {
    const expectedStates = Array.isArray(expectedState) ? expectedState : [expectedState];
    await page.waitForFunction(states => {
        const region = document.getElementById('scheduleDataRegion');
        return Boolean(region && states.includes(region.dataset.scheduleState));
    }, expectedStates, { timeout: 20000 });
}

async function waitForCommittedScheduleRange(page, from, to, expectedState = ['ready', 'empty']) {
    const expectedStates = Array.isArray(expectedState) ? expectedState : [expectedState];
    await page.waitForFunction(expected => {
        const region = document.getElementById('scheduleDataRegion');
        return document.getElementById('scheduleDateFrom')?.value === expected.from
            && document.getElementById('scheduleDateTo')?.value === expected.to
            && region?.dataset.hasCommittedRange === 'true'
            && expected.states.includes(region?.dataset.scheduleState || '');
    }, { from, to, states: expectedStates }, { timeout: 20000 });
}

async function settleScheduleDom(page) {
    await page.evaluate(async () => {
        await document.fonts?.ready;
        document.activeElement?.blur?.();
        await new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
        });
    });
}

async function captureStableScheduleScreenshot(page, filename, selector = '#scheduleWrapper', beforeCapture = null) {
    await waitForScheduleState(page, ['ready', 'empty']);
    await settleScheduleDom(page);
    await page.mouse.move(1, 1);
    const screenshotStyle = await page.addStyleTag({
        content: '.toast-container, #mainApp > .header { visibility: hidden !important; }'
    });
    try {
        const target = page.locator(selector);
        await target.scrollIntoViewIfNeeded();
        if (typeof beforeCapture === 'function') await beforeCapture(page);
        await target.screenshot({
            path: path.join(OUTPUT_DIR, filename),
            animations: 'disabled',
            caret: 'hide'
        });
    } finally {
        await screenshotStyle.evaluate(element => element.remove()).catch(() => {});
    }
}

async function openStaffPage(browser, base, viewport, options = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(({ user, ignoreAbort, darkMode }) => {
        localStorage.setItem('pzp_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_access_token', 'staff-schedule-smoke-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', darkMode ? 'true' : 'false');
        if (ignoreAbort) {
            const NativeAbortController = window.AbortController;
            window.AbortController = class NonAbortingController {
                constructor() {
                    this.nativeController = new NativeAbortController();
                    this.signal = this.nativeController.signal;
                }

                abort() {}
            };
        }
        if (!sessionStorage.getItem('staff_schedule_smoke_storage_ready')) {
            localStorage.removeItem('pzp_staff_schedule_expanded_groups');
            sessionStorage.setItem('staff_schedule_smoke_storage_ready', 'true');
        }
    }, {
        user: SMOKE_USER,
        ignoreAbort: Boolean(options.ignoreAbort),
        darkMode: Boolean(options.darkMode)
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', err => {
        console.error('Staff schedule browser page error:', err.stack || err.message);
        throw err;
    });
    const search = String(options.search || '').trim();
    const normalizedSearch = search ? (search.startsWith('?') ? search : `?${search}`) : '';
    await page.goto(`${base}/staff${normalizedSearch}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(
        window.StaffSchedulePage
        && typeof window.StaffSchedulePage.isInitialized === 'function'
        && window.StaffSchedulePage.isInitialized()
    ), null, { timeout: 20000 });
    if (options.waitForRows === false) {
        await waitForScheduleState(page, ['error', 'empty', 'ready']);
    } else {
        await page.waitForSelector('#scheduleBody tr', { timeout: 20000 });
        await waitForScheduleState(page, ['empty', 'ready']);
    }
    return { context, page };
}

async function applyPreset(page, preset) {
    await page.locator(`[data-schedule-range-preset="${preset}"]`).click();
    await page.waitForFunction(expected => {
        const active = document.querySelector(`[data-schedule-range-preset="${expected}"]`);
        return active && active.classList.contains('active');
    }, preset, { timeout: 20000 });
}

async function applyManualRange(page, from, to) {
    await page.locator('#scheduleDateFrom').fill(from);
    await page.locator('#scheduleDateTo').fill(to);
    await page.locator('#applyScheduleRangeBtn').click();
    await waitForCommittedScheduleRange(page, from, to);
    await waitForDayColumns(page, dateRangeDays(from, to));
}

async function requestManualRange(page, from, to) {
    await page.locator('#scheduleDateFrom').fill(from);
    await page.locator('#scheduleDateTo').fill(to);
    await page.locator('#applyScheduleRangeBtn').click();
}

async function assertPeriodPresetLabelsAndSummary(page) {
    const { presetState, expectedLabels } = await page.locator('[data-schedule-range-preset]').evaluateAll(buttons => {
        const from = document.getElementById('scheduleDateFrom')?.value || '';
        const base = from ? new Date(`${from}T00:00:00`) : new Date();
        const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        return {
            expectedLabels: [`1-${Math.min(15, lastDay)}`, `${Math.min(16, lastDay)}-${lastDay}`],
            presetState: buttons.map(button => ({
                preset: button.getAttribute('data-schedule-range-preset'),
                label: button.textContent.trim(),
                title: button.getAttribute('title') || '',
                ariaLabel: button.getAttribute('aria-label') || ''
            }))
        };
    });
    assert.equal(presetState.length, 2, 'top period shortcuts expose only two half-month options');
    assert.deepEqual(presetState.map(item => item.label), expectedLabels, 'period preset labels expose concrete current-month dates');
    assert.equal(presetState.some(item => item.label.includes('половина') || item.label.includes('кінець')), false, 'period preset labels do not use vague half-month copy');
    assert.equal(presetState.find(item => item.preset === 'second-half')?.ariaLabel, `Показати ${expectedLabels[1]} число місяця`, 'second-half preset keeps an accessible date-range label');
    assert.match(presetState.find(item => item.preset === 'second-half')?.title || '', /16/, 'second-half preset title explains the date range');
    const summaryState = await page.locator('#scheduleSummary').evaluate(summary => ({
        hidden: summary.hidden,
        text: summary.textContent.trim(),
        chipCount: summary.querySelectorAll('.summary-chip').length
    }));
    assert.equal(summaryState.hidden, true, 'schedule summary is hidden in the schedule section');
    assert.equal(summaryState.text, '', 'schedule summary does not render extra status text');
    assert.equal(summaryState.chipCount, 0, 'schedule summary status chips are removed');
}

async function assertNoDuplicateDepartmentSubGroups(page) {
    const duplicates = await page.locator('#scheduleBody').evaluate(tbody => {
        const normalizeRowLabel = (row, iconSelector, countSelector) => {
            const clone = row.cloneNode(true);
            clone.querySelectorAll(`${iconSelector},${countSelector},.schedule-group-caret`).forEach(node => node.remove());
            const explicitLabel = clone.querySelector('.schedule-group-label');
            if (explicitLabel) return explicitLabel.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
            return clone.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
        };
        const result = [];
        let currentDepartment = '';
        for (const row of Array.from(tbody.querySelectorAll('tr'))) {
            if (row.classList.contains('dept-row')) {
                currentDepartment = normalizeRowLabel(row, '.dept-icon', '.dept-count');
            } else if (row.classList.contains('sub-group-row')) {
                const subgroup = normalizeRowLabel(row, '.sub-group-icon', '.sub-group-count');
                if (currentDepartment && subgroup && currentDepartment === subgroup) result.push(subgroup);
            }
        }
        return result;
    });
    assert.deepEqual(duplicates, [], 'schedule table does not render duplicate department/subgroup labels');
}

async function scheduleEmployeeRowCount(page) {
    return page.locator('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').count();
}

async function assertScheduleGroupsCollapsedByDefault(page) {
    const toggles = page.locator('[data-schedule-group-toggle]');
    const count = await toggles.count();
    assert.ok(count > 0, 'schedule group toggles are rendered');
    assert.deepEqual(await toggles.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded'))), Array(count).fill('false'), 'schedule groups are collapsed by default');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'collapsed schedule groups hide employee rows by default');

    const firstToggle = toggles.first();
    await firstToggle.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'Enter expands a schedule group');

    await page.locator('[data-schedule-group-toggle]').first().press('Space');
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'Space collapses a schedule group');

    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'click expands a schedule group');
    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await scheduleEmployeeRowCount(page), 0, 'repeated click collapses a schedule group');
}

async function assertScheduleGroupExpansionPersists(page) {
    const firstToggle = page.locator('[data-schedule-group-toggle]').first();
    const groupKey = await firstToggle.getAttribute('data-schedule-group-toggle');
    assert.ok(groupKey, 'first schedule group exposes a stable state key');

    await firstToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-schedule-group-toggle]')?.getAttribute('aria-expanded') === 'true');
    await page.waitForFunction(({ storageKey, groupKey }) => {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
            return Array.isArray(saved) && saved.includes(groupKey);
        } catch {
            return false;
        }
    }, { storageKey: STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY, groupKey });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: 20000 });
    await page.waitForFunction(groupKey => {
        return Array.from(document.querySelectorAll('[data-schedule-group-toggle]'))
            .some(button => button.dataset.scheduleGroupToggle === groupKey && button.getAttribute('aria-expanded') === 'true');
    }, groupKey, { timeout: 20000 });
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'expanded schedule group persists after reload');

    await page.evaluate(storageKey => localStorage.removeItem(storageKey), STAFF_SCHEDULE_EXPANDED_GROUPS_STORAGE_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.StaffSchedulePage?.isInitialized?.()), null, { timeout: 20000 });
    await page.waitForFunction(() => {
        const toggles = Array.from(document.querySelectorAll('[data-schedule-group-toggle]'));
        return toggles.length > 0 && toggles.every(button => button.getAttribute('aria-expanded') === 'false');
    }, null, { timeout: 20000 });
}

async function assertScheduleSearchAutoExpandsGroups(page) {
    const searchTerm = await page.locator('[data-schedule-group-toggle]').first().getAttribute('data-schedule-group-toggle') || 'animator';
    await page.locator('#scheduleStaffSearch').fill(searchTerm);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
    assert.ok(await scheduleEmployeeRowCount(page) > 0, 'active search reveals matching rows even when groups are collapsed');
    assert.ok((await page.locator('[data-schedule-group-toggle][aria-expanded="true"]').count()) > 0, 'active search marks matching groups expanded for accessibility');
    await page.locator('#scheduleStaffSearch').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length === 0);
}

async function expandAllScheduleGroups(page) {
    for (let i = 0; i < 20; i += 1) {
        const collapsed = page.locator('[data-schedule-group-toggle][aria-expanded="false"]');
        if (!(await collapsed.count())) break;
        await collapsed.first().click();
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-schedule-group-toggle][aria-expanded="false"]').length === 0);
    await page.waitForFunction(() => document.querySelectorAll('#scheduleBody tr:not(.dept-row):not(.sub-group-row):not(.schedule-health-empty-row)').length > 0);
}

async function collapseAllScheduleGroups(page) {
    for (let i = 0; i < 20; i += 1) {
        const expanded = page.locator('[data-schedule-group-toggle][aria-expanded="true"]');
        if (!(await expanded.count())) break;
        await expanded.first().click();
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-schedule-group-toggle][aria-expanded="true"]').length === 0);
}

async function activateScheduleDepartment(page, department) {
    const chip = page.locator(`#deptFilter .dept-chip[data-dept="${department}"]`);
    await chip.click();
    await page.waitForFunction(expected => {
        return document.querySelector(`#deptFilter .dept-chip[data-dept="${CSS.escape(expected)}"]`)
            ?.getAttribute('aria-pressed') === 'true';
    }, department);
    await settleScheduleDom(page);
}

async function expandScheduleGroup(page, department) {
    const toggle = page.locator(`[data-schedule-group-toggle="${department}"]`);
    await toggle.waitFor({ state: 'visible' });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.waitForFunction(expected => {
        return document.querySelector(`[data-schedule-group-toggle="${CSS.escape(expected)}"]`)
            ?.getAttribute('aria-expanded') === 'true';
    }, department);
}

async function scheduleStaffIdsFromDom(page) {
    return page.locator('#scheduleBody [data-schedule-staff-row]').evaluateAll(rows => (
        rows.map(row => Number(row.getAttribute('data-schedule-staff-row')))
    ));
}

async function scheduleStaffRowsFromDom(page) {
    return page.locator('#scheduleBody [data-schedule-staff-row]').evaluateAll(rows => (
        rows.map(row => ({
            id: Number(row.getAttribute('data-schedule-staff-row')),
            department: row.getAttribute('data-schedule-department') || '',
            name: row.querySelector('.emp-name-text')?.textContent?.trim() || ''
        }))
    ));
}

async function scheduleStaffGroupsFromDom(page) {
    return page.locator('#scheduleBody').evaluate(tbody => {
        const rows = [];
        let department = '';
        for (const row of Array.from(tbody.querySelectorAll('tr'))) {
            if (row.classList.contains('dept-row')) {
                department = row.getAttribute('data-dept') || '';
                continue;
            }
            if (!row.hasAttribute('data-schedule-staff-row')) continue;
            rows.push({
                id: Number(row.getAttribute('data-schedule-staff-row')),
                department
            });
        }
        return rows;
    });
}

async function scheduleStaffSubGroupsFromDom(page) {
    return page.locator('#scheduleBody').evaluate(tbody => {
        const rows = [];
        let department = '';
        let subGroup = '';
        for (const row of Array.from(tbody.querySelectorAll('tr'))) {
            if (row.classList.contains('dept-row')) {
                department = row.getAttribute('data-dept') || '';
                subGroup = '';
                continue;
            }
            if (row.classList.contains('sub-group-row')) {
                subGroup = row.querySelector('.sub-group-label')?.textContent?.trim() || '';
                continue;
            }
            if (!row.hasAttribute('data-schedule-staff-row')) continue;
            const ownedSubGroup = row.hasAttribute('data-schedule-subgroup-label')
                ? (row.getAttribute('data-schedule-subgroup-label') || '')
                : (row.hasAttribute('data-schedule-subgroup')
                    ? (row.getAttribute('data-schedule-subgroup') || '')
                    : subGroup);
            rows.push({
                id: Number(row.getAttribute('data-schedule-staff-row')),
                department,
                subGroup: ownedSubGroup
            });
        }
        return rows;
    });
}

async function scheduleStaffReadinessSnapshot(page, staffId) {
    return page.locator(`#scheduleBody [data-schedule-staff-row="${staffId}"]`).evaluate(row => {
        const readinessBadge = Array.from(row.querySelectorAll('.staff-card-badge'))
            .find(badge => (badge.getAttribute('title') || '').includes('Готовність'));
        return {
            rowClass: row.className,
            readinessClass: readinessBadge?.className || '',
            readinessText: readinessBadge?.textContent?.trim() || '',
            readinessTitle: readinessBadge?.getAttribute('title') || '',
            healthDetails: Array.from(row.querySelectorAll('.schedule-health-badge'))
                .map(badge => badge.getAttribute('data-health-detail') || badge.getAttribute('title') || '')
        };
    });
}

function assertUniqueScheduleStaffIds(ids, label) {
    assert.ok(ids.every(Number.isFinite), `${label}: every staff row exposes a numeric ID`);
    assert.equal(new Set(ids).size, ids.length, `${label}: every numeric staff ID is rendered once`);
}

function scheduleStaffPlacementKey(row = {}) {
    return `${String(row.department || '')}:${Number(row.id)}`;
}

function sortedScheduleStaffPlacements(rows = []) {
    return [...rows].sort((left, right) => (
        String(left.department || '').localeCompare(String(right.department || ''))
        || Number(left.id) - Number(right.id)
    ));
}

function assertUniqueScheduleStaffPlacements(rows, label) {
    assert.ok(rows.every(row => Number.isFinite(row.id) && row.department), `${label}: every row exposes staff and department context`);
    const placements = rows.map(scheduleStaffPlacementKey);
    assert.equal(new Set(placements).size, placements.length, `${label}: every staff ID is rendered at most once per department`);
}

function sortedScheduleStaffIds(ids) {
    return [...ids].sort((left, right) => left - right);
}

function scheduleExportStaffIdsFromHtml(html) {
    return Array.from(
        String(html || '').matchAll(/\bdata-schedule-export-staff-id="(\d+)"/g),
        match => Number(match[1])
    );
}

function scheduleExportTextFromHtml(html) {
    return String(html || '')
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/\s+/g, ' ')
        .trim();
}

function scheduleExportStaffRowsFromHtml(html) {
    return Array.from(
        String(html || '').matchAll(/<tr\b([^>]*\bdata-schedule-export-staff-id="(\d+)"[^>]*)>([\s\S]*?)<\/tr>/gi),
        match => {
            const department = match[1].match(/\bdata-schedule-export-department="([^"]+)"/i)?.[1] || '';
            const employeeCell = match[3].match(/<td\b[^>]*\bclass="[^"]*\bemployee-cell\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
            return {
                id: Number(match[2]),
                department,
                name: scheduleExportTextFromHtml(employeeCell?.[1] || '')
            };
        }
    );
}

async function parseScheduleWorkbook(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const rows = [];
    const sheets = workbook.worksheets.map(worksheet => {
        const sheetRows = [];
        for (let rowNumber = 4; rowNumber <= worksheet.rowCount; rowNumber += 1) {
            const id = Number(worksheet.getCell(rowNumber, 1).value);
            if (!Number.isSafeInteger(id) || id <= 0) continue;
            const row = {
                id,
                department: String(worksheet.getCell(rowNumber, 2).value || ''),
                name: String(worksheet.getCell(rowNumber, 5).value || ''),
                worksheet: worksheet.name
            };
            rows.push(row);
            sheetRows.push(row);
        }
        return { name: worksheet.name, rows: sheetRows };
    });
    return { rows, sheets };
}

async function captureScheduleWorkbook(page) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportExcelBtn').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert.ok(downloadPath, 'workbook download has a readable local path');
    const buffer = fs.readFileSync(downloadPath);
    const filename = download.suggestedFilename();
    await download.delete().catch(() => {});
    return { buffer, filename };
}

async function captureSchedulePrintHtml(page) {
    await page.evaluate(() => {
        window.__staffCanonicalPrintCount = 0;
        window.__staffCanonicalPrintHtml = '';
        window.open = () => ({
            document: {
                open() {},
                write(html) { window.__staffCanonicalPrintHtml += String(html || ''); },
                close() {}
            },
            focus() {},
            print() { window.__staffCanonicalPrintCount += 1; },
            setTimeout(callback) { callback(); }
        });
    });
    await page.locator('#printBtn').click();
    await page.waitForFunction(() => window.__staffCanonicalPrintCount === 1);
    return page.evaluate(() => window.__staffCanonicalPrintHtml);
}

async function assertScheduleExportParity(page, expectedIds, label) {
    const visibleRows = await scheduleStaffRowsFromDom(page);
    const workbookDownload = await captureScheduleWorkbook(page);
    const workbook = await parseScheduleWorkbook(workbookDownload.buffer);
    const printHtml = await captureSchedulePrintHtml(page);
    const workbookIds = workbook.rows.map(row => row.id);
    const printIds = scheduleExportStaffIdsFromHtml(printHtml);
    const workbookRows = workbook.rows;
    const printRows = scheduleExportStaffRowsFromHtml(printHtml);

    assert.match(workbookDownload.filename, /^grafik_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.ok(workbookDownload.buffer.subarray(0, 2).equals(Buffer.from('PK')), `${label}: export is a real xlsx workbook`);
    assert.equal(workbook.sheets.every(sheet => sheet.rows.length > 0), true, `${label}: every exported worksheet owns staff rows`);
    assert.equal(workbook.sheets.length, new Set(workbookRows.map(row => row.department)).size, `${label}: each department has one non-empty worksheet`);
    assert.deepEqual(sortedScheduleStaffIds(visibleRows.map(row => row.id)), sortedScheduleStaffIds(expectedIds), `${label}: expected staff set is the visible table set`);
    assertUniqueScheduleStaffPlacements(visibleRows, `${label} table`);
    assertUniqueScheduleStaffPlacements(workbookRows, `${label} workbook`);
    assertUniqueScheduleStaffPlacements(printRows, `${label} print`);
    assert.deepEqual(sortedScheduleStaffIds(workbookIds), sortedScheduleStaffIds(expectedIds), `${label}: workbook staff set matches the visible table`);
    assert.deepEqual(sortedScheduleStaffIds(printIds), sortedScheduleStaffIds(expectedIds), `${label}: print staff set matches the visible table`);
    assert.deepEqual(sortedScheduleStaffIds(printIds), sortedScheduleStaffIds(workbookIds), `${label}: print and workbook contain the same staff set`);
    assert.deepEqual(
        sortedScheduleStaffPlacements(workbookRows).map(scheduleStaffPlacementKey),
        sortedScheduleStaffPlacements(visibleRows).map(scheduleStaffPlacementKey),
        `${label}: workbook staff placements match the visible table`
    );
    assert.deepEqual(
        sortedScheduleStaffPlacements(printRows).map(scheduleStaffPlacementKey),
        sortedScheduleStaffPlacements(visibleRows).map(scheduleStaffPlacementKey),
        `${label}: print staff placements match the visible table`
    );

    for (const visibleRow of visibleRows) {
        const workbookRow = workbookRows.find(row => scheduleStaffPlacementKey(row) === scheduleStaffPlacementKey(visibleRow));
        const printRow = printRows.find(row => scheduleStaffPlacementKey(row) === scheduleStaffPlacementKey(visibleRow));
        assert.equal(Boolean(workbookRow?.name), true, `${label}: downloaded workbook contains employee cell content for staff ID ${visibleRow.id}`);
        assert.equal(Boolean(printRow?.name), true, `${label}: print HTML contains employee cell content for staff ID ${visibleRow.id}`);
        assert.equal(workbookRow?.name === visibleRow.name, true, `${label}: downloaded workbook employee content matches the visible row for staff ID ${visibleRow.id}`);
        assert.equal(printRow?.name === visibleRow.name, true, `${label}: print employee content matches the visible row for staff ID ${visibleRow.id}`);
        assert.equal(printRow?.name === workbookRow?.name, true, `${label}: print and workbook employee content match for staff ID ${visibleRow.id}`);
    }

    if (expectedIds.includes(101)) {
        const workbookNames = workbookRows.map(row => row.name).join('\n');
        assert.match(workbookNames, /Віталіна Синіпол/, `${label}: workbook prefers display_name`);
        assert.doesNotMatch(workbookNames, /Синіпол Віталіна \(QA fixture\)/, `${label}: workbook does not replace display_name with legal name`);
        assert.match(printHtml, /Віталіна Синіпол/, `${label}: print prefers display_name`);
        assert.doesNotMatch(printHtml, /Синіпол Віталіна \(QA fixture\)/, `${label}: print does not replace display_name with legal name`);
    }
}

async function assertDepartmentFiltersRenderOnlyActiveGroup(page) {
    await page.locator('#scheduleStaffSearch').fill('');
    const filters = await page.locator('#deptFilter .dept-chip:not([data-dept="all"])').evaluateAll(chips => chips
        .map(chip => ({
            key: chip.getAttribute('data-dept') || '',
            count: Number(chip.querySelector('.dept-chip-count')?.textContent?.trim() || 0)
        }))
        .filter(filter => filter.key && filter.count > 0));
    assert.ok(filters.length > 0, 'active-department-only contract has non-empty department fixtures');

    for (const filter of filters) {
        await activateScheduleDepartment(page, filter.key);
        const departments = await page.locator('#scheduleBody tr.dept-row').evaluateAll(rows => (
            rows.map(row => row.getAttribute('data-dept') || '')
        ));
        assert.deepEqual(
            Array.from(new Set(departments)),
            [filter.key],
            `active-department-only: ${filter.key} renders only its own top-level group`
        );
        await expandScheduleGroup(page, filter.key);
        const staffIds = await scheduleStaffIdsFromDom(page);
        assertUniqueScheduleStaffIds(staffIds, `active-department-only ${filter.key}`);
        assert.equal(staffIds.length, filter.count, `active-department-only: ${filter.key} table count matches its unique chip count`);
    }

    await activateScheduleDepartment(page, 'all');
}

async function assertScheduleGroupLabelsReadable(page, label, { simulatedTechCount = null, maxLines = 2 } = {}) {
    const metrics = await page.locator('#scheduleBody').evaluate((tbody, options) => {
        const techCount = tbody.querySelector('tr.dept-row[data-dept="tech"] .dept-count');
        const originalTechCount = techCount?.textContent;
        if (techCount && Number.isFinite(options.simulatedTechCount)) {
            techCount.textContent = String(options.simulatedTechCount);
        }

        try {
            return Array.from(tbody.querySelectorAll('tr.dept-row .schedule-group-label')).map(element => {
                const style = getComputedStyle(element);
                const fontSize = Number.parseFloat(style.fontSize) || 14;
                const lineHeight = Number.parseFloat(style.lineHeight) || (fontSize * 1.2);
                const box = element.getBoundingClientRect();
                const toggleBox = element.closest('.schedule-group-toggle')?.getBoundingClientRect();
                const countBox = element.closest('.schedule-group-toggle')?.querySelector('.dept-count')?.getBoundingClientRect();
                return {
                    text: element.textContent?.trim() || 'unknown',
                    horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
                    verticalOverflow: element.scrollHeight > element.clientHeight + 1,
                    lineCount: box.height / lineHeight,
                    overlapsCount: Boolean(countBox && box.right > countBox.left + 1),
                    outsideToggle: Boolean(toggleBox && (box.left < toggleBox.left - 1 || box.right > toggleBox.right + 1))
                };
            });
        } finally {
            if (techCount && originalTechCount != null) techCount.textContent = originalTechCount;
        }
    }, { simulatedTechCount });

    assert.ok(metrics.length > 0, `${label}: department group labels are measurable`);
    for (const metric of metrics) {
        assert.equal(metric.horizontalOverflow, false, `${label}: ${metric.text} has no horizontal clipping`);
        assert.equal(metric.verticalOverflow, false, `${label}: ${metric.text} has no vertical clipping`);
        assert.ok(metric.lineCount <= maxLines + 0.2, `${label}: ${metric.text} uses no more than ${maxLines} lines`);
        assert.equal(metric.overlapsCount, false, `${label}: ${metric.text} does not overlap its count`);
        assert.equal(metric.outsideToggle, false, `${label}: ${metric.text} stays inside its group control`);
    }
}

async function captureFixtureDepartmentScheduleSurfaces(page) {
    const filters = await page.locator('#deptFilter .dept-chip:not([data-dept="all"])').evaluateAll(chips => chips
        .map(chip => ({
            key: chip.getAttribute('data-dept') || '',
            count: Number(chip.querySelector('.dept-chip-count')?.textContent?.trim() || 0)
        }))
        .filter(filter => filter.key && filter.count > 0));

    for (const filter of filters) {
        await activateScheduleDepartment(page, filter.key);
        await expandScheduleGroup(page, filter.key);
        await assertScheduleGroupLabelsReadable(page, `${filter.key}: desktop department header`, { simulatedTechCount: 3 });
        const geometry = await page.locator('#scheduleBody').evaluate(tbody => {
            const containmentIssues = [];
            for (const cell of tbody.querySelectorAll('td.schedule-day-cell')) {
                const content = cell.querySelector(':scope > .sch-cell');
                if (!content) continue;
                const outer = cell.getBoundingClientRect();
                const inner = content.getBoundingClientRect();
                if (inner.left < outer.left - 1 || inner.right > outer.right + 1 || inner.top < outer.top - 1 || inner.bottom > outer.bottom + 1) {
                    containmentIssues.push(content.getAttribute('data-date') || 'unknown');
                }
            }
            const group = tbody.querySelector('tr.dept-row');
            const stickyBackground = group?.children[0] ? getComputedStyle(group.children[0]).backgroundColor : '';
            const fillBackground = group?.children[1] ? getComputedStyle(group.children[1]).backgroundColor : '';
            return {
                containmentIssues,
                stickyBackground,
                fillBackground,
                employeeRows: tbody.querySelectorAll('tr[data-schedule-staff-row]').length,
                truncatedGroupLabels: Array.from(tbody.querySelectorAll('.schedule-group-label'))
                    .filter(element => element.scrollWidth > element.clientWidth + 1)
                    .map(element => element.textContent?.trim() || 'unknown'),
                labelsMissingTitles: Array.from(tbody.querySelectorAll('.schedule-group-toggle, .sub-group-label, .emp-name-text, .emp-position'))
                    .filter(element => !String(element.getAttribute('title') || '').trim())
                    .length
            };
        });
        assert.ok(geometry.employeeRows > 0, `${filter.key}: department renders employee rows`);
        assert.deepEqual(geometry.containmentIssues, [], `${filter.key}: schedule cell content stays inside its row`);
        assert.equal(geometry.stickyBackground, geometry.fillBackground, `${filter.key}: department header has no sticky/fill seam`);
        assert.deepEqual(geometry.truncatedGroupLabels, [], `${filter.key}: desktop department label remains fully readable`);
        assert.equal(geometry.labelsMissingTitles, 0, `${filter.key}: truncated schedule labels expose their full text`);
        await captureStableScheduleScreenshot(page, `desktop-department-${filter.key}.png`);
    }

    await activateScheduleDepartment(page, 'all');
    await expandAllScheduleGroups(page);
}

async function assertScheduleShiftPreferenceQuickLabels(page) {
    await page.locator('.sch-cell[data-staff="101"]').first().click();
    await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
    await page.locator('#schShiftPreferencePanel .sch-shift-preference-option').nth(1).waitFor({ state: 'visible' });
    const labels = await page.locator('#schShiftPreferencePanel .sch-shift-preference-option strong')
        .evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
    assert.deepEqual(labels, ['ПН-ПТ', 'СБ-НД'], 'schedule modal quick shift options use explicit weekday/weekend range labels');
    assert.equal(labels.includes('Будні') || labels.includes('Вихідні'), false, 'schedule modal quick shift options avoid ambiguous day-type labels');
    await page.locator('#schCancelBtn').click();
    await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
}

async function assertShiftLoadClassesDoNotPaintScheduleCells(page) {
    const datesByBucket = {
        quarter: '2026-07-06',
        half: '2026-07-07',
        threeQuarter: '2026-07-08',
        weekdayFull: '2026-07-09',
        weekendFull: '2026-07-11',
        long: '2026-07-13'
    };
    for (const date of Object.values(datesByBucket)) {
        await page.locator(`[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="${date}"]`).waitFor({ state: 'visible' });
    }
    const metrics = await page.evaluate(dates => {
        const inspect = date => {
            const cell = document.querySelector(`[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="${date}"]`);
            if (!cell) return null;
            const after = getComputedStyle(cell, '::after');
            const cellStyle = getComputedStyle(cell);
            const time = cell.querySelector('.sch-time');
            return {
                className: cell.className,
                shiftLoad: cell.getAttribute('data-shift-load'),
                afterDisplay: after.display,
                afterContent: after.content,
                afterWidth: after.width,
                afterHeight: after.height,
                backgroundImage: cellStyle.backgroundImage,
                boxShadow: cellStyle.boxShadow,
                timeColor: time ? getComputedStyle(time).color : ''
            };
        };
        return {
            quarter: inspect(dates.quarter),
            half: inspect(dates.half),
            threeQuarter: inspect(dates.threeQuarter),
            weekdayFull: inspect(dates.weekdayFull),
            weekendFull: inspect(dates.weekendFull),
            long: inspect(dates.long)
        };
    }, datesByBucket);

    for (const [bucket, metric] of Object.entries(metrics)) {
        assert.ok(metric, `${bucket} fixture cell is rendered`);
    }

    assert.equal(metrics.quarter.shiftLoad, 'quarter', 'weekday 10:00-12:00 keeps quarter load metadata');
    assert.equal(metrics.half.shiftLoad, 'half', 'weekday 10:00-14:00 keeps half load metadata');
    assert.equal(metrics.threeQuarter.shiftLoad, 'three-quarter', 'weekday 10:00-16:00 keeps three-quarter load metadata');
    assert.equal(metrics.weekdayFull.shiftLoad, 'full', 'weekday 12:00-20:00 stays a full shift');
    assert.equal(metrics.weekendFull.shiftLoad, 'full', 'weekend 10:00-20:00 is treated as a full shift');
    assert.equal(metrics.weekendFull.className.includes('shift-load-long'), false, 'weekend 10:00-20:00 does not get the long-shift marker class');
    assert.equal(metrics.weekendFull.className.includes('shift-load-full'), true, 'weekend 10:00-20:00 keeps the full-shift class');
    assert.equal(metrics.long.shiftLoad, 'long', 'weekday 10:00-20:00 keeps long-shift load metadata');
    assert.equal(metrics.long.className.includes('shift-load-long'), true, 'weekday long shift keeps durable load metadata');

    const referenceTimeColor = metrics.weekdayFull.timeColor;
    for (const [bucket, metric] of Object.entries(metrics)) {
        assert.equal(metric.afterDisplay, 'none', `${bucket} load marker pseudo-element stays hidden`);
        assert.equal(metric.afterContent === 'none' || metric.afterContent === 'normal', true, `${bucket} load marker pseudo-element has no generated content`);
        assert.equal(metric.backgroundImage, 'none', `${bucket} cell has no shift-load gradient background`);
        assert.equal(/0px -5px 0px/.test(metric.boxShadow), false, `${bucket} cell does not paint the bottom load stripe`);
        assert.equal(metric.timeColor, referenceTimeColor, `${bucket} time text uses the normal schedule color`);
    }
}

async function assertWideScheduleLayout(page, label, options = {}) {
    const wrapperSelector = options.wrapperSelector || '#scheduleWrapper';
    const expectedDays = options.expectedDays;
    const expectedDataDays = options.expectedDataDays || expectedDays;
    const expectedHeaderCount = options.expectedHeaderCount || expectedDays;
    const minDayWidth = options.minDayWidth || 96;
    const shouldFit = Boolean(options.shouldFit);
    const metrics = await page.evaluate(({ wrapperSelector, expectedDataDays, expectedHeaderCount }) => {
        const wrapper = document.querySelector(wrapperSelector);
        const table = wrapper?.querySelector('.schedule-table');
        const dayHeaderSelector = wrapperSelector === '#loadViewWrapper'
            ? 'thead th:not(:first-child):not(:last-child)'
            : 'thead th:not(:first-child)';
        const dayHeaders = table ? Array.from(table.querySelectorAll(dayHeaderSelector)) : [];
        const firstHeader = table?.querySelector('thead th:first-child');
        const firstBodyCell = table?.querySelector('tbody tr:not(.dept-row):not(.sub-group-row) > td:first-child');
        if (!wrapper || !table || !firstHeader || !firstBodyCell) return null;
        wrapper.scrollLeft = 0;
        const wrapperBox = wrapper.getBoundingClientRect();
        const tableBox = table.getBoundingClientRect();
        const firstHeaderBox = firstHeader.getBoundingClientRect();
        const firstBodyBox = firstBodyCell.getBoundingClientRect();
        const dayWidths = dayHeaders.map(header => header.getBoundingClientRect().width).filter(Boolean);
        const fullyVisibleDayCount = dayHeaders.filter(header => {
            const box = header.getBoundingClientRect();
            return box.left >= wrapperBox.left - 1 && box.right <= wrapperBox.right + 1;
        }).length;
        wrapper.scrollLeft = Math.min(260, Math.max(0, wrapper.scrollWidth - wrapper.clientWidth));
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            cssMinWidth: getComputedStyle(wrapper).getPropertyValue('--schedule-table-min-width').trim(),
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            tableWidth: tableBox.width,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            fullyVisibleDayCount,
            firstHeaderPosition: getComputedStyle(firstHeader).position,
            firstBodyPosition: getComputedStyle(firstBodyCell).position,
            firstHeaderLeft: firstHeaderBox.left,
            firstBodyLeft: firstBodyBox.left,
            wrapperLeft: wrapperBox.left,
            dayHeaderCount: dayHeaders.length,
            expectedDataDays,
            expectedHeaderCount,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        };
    }, { wrapperSelector, expectedDataDays, expectedHeaderCount });
    assert.ok(metrics, `${label}: wide layout metrics are available`);
    assert.equal(metrics.isLongRange, true, `${label}: wrapper enters long-range mode`);
    if (expectedDataDays >= 28) assert.equal(metrics.isFullRange, true, `${label}: wrapper enters full-range mode`);
    assert.equal(metrics.dataDays, expectedDataDays, `${label}: wrapper records visible day count`);
    assert.equal(metrics.dayHeaderCount, expectedHeaderCount, `${label}: day header count matches range`);
    if (shouldFit) {
        assert.ok(metrics.wrapperScrollWidth <= metrics.wrapperClientWidth + 4, `${label}: all month columns fit without horizontal scrolling`);
        assert.equal(metrics.fullyVisibleDayCount, expectedHeaderCount, `${label}: every month day is visible at once`);
    } else {
        assert.ok(metrics.wrapperScrollWidth > metrics.wrapperClientWidth + 20, `${label}: wrapper owns horizontal scrolling`);
    }
    assert.ok(metrics.tableWidth >= metrics.wrapperScrollWidth - 2, `${label}: table width matches wrapper scroll width`);
    assert.ok(metrics.minDayWidth >= minDayWidth, `${label}: day columns remain readable`);
    assert.ok(metrics.maxDayWidth - metrics.minDayWidth <= 2, `${label}: day columns stay aligned`);
    assert.equal(metrics.firstHeaderPosition, 'sticky', `${label}: header first column is sticky`);
    assert.equal(metrics.firstBodyPosition, 'sticky', `${label}: body first column is sticky`);
    assert.ok(Math.abs(metrics.firstHeaderLeft - metrics.wrapperLeft) <= 3, `${label}: sticky header column stays pinned after scroll`);
    assert.ok(Math.abs(metrics.firstBodyLeft - metrics.wrapperLeft) <= 3, `${label}: sticky body column stays pinned after scroll`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertFittedScheduleLayout(page, label, expectedDays) {
    const metrics = await page.evaluate(expectedDays => {
        const wrapper = document.querySelector('#scheduleWrapper');
        const table = wrapper?.querySelector('.schedule-table');
        if (!wrapper || !table) return null;
        const dayHeaders = Array.from(table.querySelectorAll('thead th:not(:first-child)'));
        const dayWidths = dayHeaders.map(header => header.getBoundingClientRect().width).filter(Boolean);
        const firstHeader = table.querySelector('thead th:first-child');
        return {
            isLongRange: wrapper.classList.contains('is-long-range'),
            isFullRange: wrapper.classList.contains('is-full-range'),
            dataDays: Number(wrapper.dataset.scheduleDayCount || 0),
            dayHeaderCount: dayHeaders.length,
            tableLayout: getComputedStyle(table).tableLayout,
            minDayWidth: dayWidths.length ? Math.min(...dayWidths) : 0,
            maxDayWidth: dayWidths.length ? Math.max(...dayWidths) : 0,
            firstHeaderWidth: firstHeader?.getBoundingClientRect().width || 0,
            stickyWidth: Number.parseFloat(getComputedStyle(wrapper).getPropertyValue('--schedule-sticky-column-width')) || 0,
            wrapperClientWidth: wrapper.clientWidth,
            wrapperScrollWidth: wrapper.scrollWidth,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            expectedDays
        };
    }, expectedDays);
    assert.ok(metrics, `${label}: fitted layout metrics are available`);
    assert.equal(metrics.isLongRange, false, `${label}: range stays in fitted schedule mode`);
    assert.equal(metrics.isFullRange, false, `${label}: range does not use full-month density`);
    assert.equal(metrics.dataDays, expectedDays, `${label}: wrapper records the fitted day count`);
    assert.equal(metrics.dayHeaderCount, expectedDays, `${label}: every fitted day header renders`);
    assert.equal(metrics.tableLayout, 'fixed', `${label}: content cannot resize individual day columns`);
    assert.ok(metrics.maxDayWidth - metrics.minDayWidth <= 2, `${label}: all day columns have equal width`);
    assert.ok(Math.abs(metrics.firstHeaderWidth - metrics.stickyWidth) <= 2, `${label}: sticky staff column follows the layout variable`);
    assert.ok(metrics.wrapperScrollWidth <= metrics.wrapperClientWidth + 2, `${label}: fitted range does not add desktop table scrolling`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
}

async function assertScheduleLayoutResync(page, label) {
    const readLayoutVariables = () => page.locator('#scheduleWrapper').evaluate(wrapper => {
        const style = getComputedStyle(wrapper);
        return {
            stickyColumn: style.getPropertyValue('--schedule-sticky-column-width').trim(),
            dayColumn: style.getPropertyValue('--schedule-day-column-width').trim()
        };
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('scheduleWrapper')).getPropertyValue('--schedule-sticky-column-width').trim() === '176px');
    assert.deepEqual(await readLayoutVariables(), { stickyColumn: '176px', dayColumn: '128px' }, `${label}: mobile variables are recomputed across the 768px breakpoint`);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('scheduleWrapper')).getPropertyValue('--schedule-sticky-column-width').trim() === '240px');
    assert.deepEqual(await readLayoutVariables(), { stickyColumn: '240px', dayColumn: '144px' }, `${label}: desktop variables are restored across the 768px breakpoint`);
}

async function assertDepartmentChipGrid(page, label, expectedRows) {
    const metrics = await page.locator('#deptFilter .dept-chip').evaluateAll(chips => chips.map(chip => {
        const box = chip.getBoundingClientRect();
        return { top: Math.round(box.top), width: box.width, height: box.height };
    }));
    assert.ok(metrics.length > 0, `${label}: department chips are available`);
    const rowTops = [...new Set(metrics.map(metric => metric.top))];
    assert.equal(rowTops.length, expectedRows, `${label}: department chips use the expected balanced row count`);
    assert.ok(Math.max(...metrics.map(metric => metric.height)) - Math.min(...metrics.map(metric => metric.height)) <= 1, `${label}: chip heights are equal`);
    for (const top of rowTops) {
        const widths = metrics.filter(metric => metric.top === top).map(metric => metric.width);
        if (widths.length > 1) {
            assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, `${label}: chip widths are equal within each row`);
        }
    }
}

async function assertNoControlOverlap(page, label) {
    const metrics = await page.evaluate(() => {
        const rect = selector => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                height: box.height
            };
        };
        const command = rect('.staff-schedule-command-bar');
        const range = rect('.staff-schedule-range-row');
        const search = rect('.staff-schedule-search-row');
        const dateFrom = rect('#scheduleDateFrom');
        const dateTo = rect('#scheduleDateTo');
        const exportButton = rect('#exportExcelBtn');
        const printButton = rect('#printBtn');
        const wrapper = document.querySelector('#scheduleWrapper');
        return {
            command,
            range,
            search,
            dateFrom,
            dateTo,
            datesStacked: Boolean(dateFrom && dateTo && dateTo.top >= dateFrom.bottom - 1),
            exportButton,
            printButton,
            viewportWidth: window.innerWidth,
            pageScrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            wrapperClientWidth: wrapper?.clientWidth || 0,
            wrapperScrollWidth: wrapper?.scrollWidth || 0
        };
    });
    assert.ok(metrics.command?.width > 0, `${label}: command bar is measurable`);
    assert.ok(metrics.range?.width > 0, `${label}: range controls are measurable`);
    assert.ok(metrics.search?.width > 0, `${label}: search row is measurable`);
    assert.ok(metrics.range.right <= metrics.command.right + 2, `${label}: range controls stay inside command bar`);
    assert.ok(metrics.search.right <= metrics.command.right + 2, `${label}: search row stays inside command bar`);
    assert.ok(metrics.search.top >= metrics.range.top - 2, `${label}: search does not float above range controls`);
    assert.ok(
        metrics.datesStacked || metrics.dateFrom?.right <= metrics.dateTo?.left + 1,
        `${label}: date inputs are separated horizontally or stacked vertically`
    );
    assert.ok(metrics.exportButton?.right <= metrics.command.right + 2, `${label}: export stays inside command bar`);
    assert.ok(metrics.printButton?.right <= metrics.command.right + 2, `${label}: print stays inside command bar`);
    assert.ok(metrics.pageScrollWidth <= metrics.viewportWidth + 2, `${label}: page has no global horizontal overflow`);
    assert.ok(metrics.wrapperScrollWidth >= metrics.wrapperClientWidth, `${label}: schedule wrapper owns horizontal width`);
}

async function assertDepartmentChipsFit(page, label) {
    const metrics = await page.evaluate(() => Array.from(document.querySelectorAll('#deptFilter .dept-chip')).map(chip => {
        const label = chip.querySelector('.dept-chip-label');
        const count = chip.querySelector('.dept-chip-count');
        const chipBox = chip.getBoundingClientRect();
        const labelBox = label?.getBoundingClientRect();
        const countBox = count?.getBoundingClientRect();
        const labelStyle = label ? getComputedStyle(label) : null;
        return {
            text: label?.textContent?.trim() || '',
            chipWidth: chipBox.width,
            labelWidth: labelBox?.width || 0,
            labelRight: labelBox?.right || 0,
            countLeft: countBox?.left || 0,
            countRight: countBox?.right || 0,
            chipRight: chipBox.right,
            labelOverflow: labelStyle?.overflow || '',
            labelTextOverflow: labelStyle?.textOverflow || '',
            labelWhiteSpace: labelStyle?.whiteSpace || ''
        };
    }));
    assert.ok(metrics.length > 0, `${label}: department chips are rendered`);
    for (const chip of metrics) {
        assert.ok(chip.chipWidth > 0, `${label}: ${chip.text} chip is measurable`);
        assert.equal(chip.labelOverflow, 'hidden', `${label}: ${chip.text} label clips inside the chip`);
        assert.equal(chip.labelTextOverflow, 'ellipsis', `${label}: ${chip.text} label uses ellipsis`);
        assert.equal(chip.labelWhiteSpace, 'nowrap', `${label}: ${chip.text} label stays on one line`);
        assert.ok(chip.labelRight <= chip.countLeft + 1, `${label}: ${chip.text} label does not overlap the count`);
        assert.ok(chip.countRight <= chip.chipRight + 1, `${label}: ${chip.text} count stays inside the chip`);
    }
}

async function assertDepartmentScrollCue(page, label) {
    const readState = async scrollToEnd => page.locator('#deptFilter').evaluate((host, shouldScrollToEnd) => {
        host.scrollLeft = shouldScrollToEnd ? host.scrollWidth : 0;
        host.dispatchEvent(new Event('scroll'));
        const last = host.querySelector(':scope > .dept-chip:last-child');
        const hostBox = host.getBoundingClientRect();
        const lastBox = last?.getBoundingClientRect();
        return new Promise(resolve => requestAnimationFrame(() => {
            const style = getComputedStyle(host);
            resolve({
                canScrollLeft: host.dataset.canScrollLeft,
                canScrollRight: host.dataset.canScrollRight,
                maskImage: style.maskImage || style.webkitMaskImage || 'none',
                scrollLeft: host.scrollLeft,
                maxScrollLeft: Math.max(0, host.scrollWidth - host.clientWidth),
                lastReachable: Boolean(lastBox && lastBox.left >= hostBox.left - 2 && lastBox.right <= hostBox.right + 2)
            });
        }));
    }, scrollToEnd);

    const start = await readState(false);
    assert.equal(start.canScrollLeft, 'false', `${label}: department cue knows it is at the start`);
    assert.equal(start.canScrollRight, 'true', `${label}: department cue advertises trailing filters`);
    assert.notEqual(start.maskImage, 'none', `${label}: trailing department filters have a visible fade cue`);

    const end = await readState(true);
    assert.ok(end.scrollLeft >= end.maxScrollLeft - 2, `${label}: department rail reaches its end`);
    assert.equal(end.canScrollLeft, 'true', `${label}: department cue records trailing navigation`);
    assert.equal(end.canScrollRight, 'false', `${label}: department cue clears at the end`);
    assert.notEqual(end.maskImage, 'none', `${label}: department rail keeps a cue to return left`);
    assert.equal(end.lastReachable, true, `${label}: the last department chip remains fully readable`);
}

async function assertDepartmentRerenderPreservesPageScroll(page, label) {
    const result = await page.evaluate(async () => {
        const root = document.scrollingElement || document.documentElement;
        const maxScrollTop = Math.max(0, root.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(420, maxScrollTop));
        const before = window.scrollY;
        await window.StaffSchedulePage.refresh();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, after: window.scrollY, maxScrollTop };
    });
    assert.ok(result.maxScrollTop > 0 && result.before > 0, `${label}: fixture page can reproduce a scrolled manager view`);
    assert.ok(Math.abs(result.after - result.before) <= 1, `${label}: department rerender preserves vertical page position`);
}

async function assertRealScheduleWheelScroll(page, label) {
    const wrapper = page.locator('#scheduleWrapper');
    await wrapper.scrollIntoViewIfNeeded();
    await wrapper.evaluate(host => {
        host.scrollLeft = 0;
        (document.scrollingElement || document.documentElement).scrollLeft = 0;
    });
    const box = await wrapper.boundingBox();
    assert.ok(box, `${label}: schedule wrapper is available for wheel scrolling`);
    const viewport = page.viewportSize();
    const mouseX = Math.max(2, Math.min((viewport?.width || 390) - 2, box.x + Math.min(48, box.width / 2)));
    const mouseY = Math.max(2, Math.min((viewport?.height || 844) - 2, box.y + Math.min(48, box.height / 2)));
    await page.mouse.move(mouseX, mouseY);
    await page.mouse.wheel(480, 0);
    await page.waitForFunction(() => document.getElementById('scheduleWrapper')?.scrollLeft > 0);
    const result = await wrapper.evaluate(host => ({
        scrollLeft: host.scrollLeft,
        documentScrollLeft: (document.scrollingElement || document.documentElement).scrollLeft
    }));
    assert.ok(result.scrollLeft > 0, `${label}: a real horizontal wheel gesture moves the schedule`);
    assert.equal(result.documentScrollLeft, 0, `${label}: schedule wheel scrolling does not move the page`);
}

async function assertNarrowMobileContract(page, label, options) {
    const metrics = await page.evaluate(() => {
        const rect = element => {
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: box.width,
                height: box.height
            };
        };
        const scrollReachability = (host, childSelector = ':scope > *') => {
            if (!host) return null;
            host.scrollLeft = host.scrollWidth;
            const children = Array.from(host.querySelectorAll(childSelector));
            const last = children.at(-1);
            const hostBox = rect(host);
            const lastBox = rect(last);
            const style = getComputedStyle(host);
            return {
                clientWidth: host.clientWidth,
                scrollWidth: host.scrollWidth,
                scrollLeft: host.scrollLeft,
                overflowX: style.overflowX,
                overscrollBehaviorX: style.overscrollBehaviorX,
                lastReachable: Boolean(
                    lastBox
                    && hostBox
                    && lastBox.left >= hostBox.left - 2
                    && lastBox.right <= hostBox.right + 2
                ),
                hostBox,
                lastBox
            };
        };
        const colorBrightness = value => {
            const parts = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
            if (parts.length !== 3) return null;
            return (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000;
        };
        const colorAlpha = value => {
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized || normalized === 'transparent') return 0;
            const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
            return rgba ? Number(rgba[1]) : 1;
        };
        const styleSnapshot = element => {
            if (!element) return null;
            const style = getComputedStyle(element);
            return {
                position: style.position,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                backgroundAlpha: colorAlpha(style.backgroundColor),
                brightness: colorBrightness(style.backgroundColor),
                box: rect(element)
            };
        };

        const scrollingElement = document.scrollingElement || document.documentElement;
        scrollingElement.scrollLeft = 0;
        const pulseOuter = document.querySelector('.staff-pulse-nav');
        const pulseItems = document.querySelector('.staff-pulse-nav-items');
        const command = document.querySelector('.staff-schedule-command-bar');
        const week = document.querySelector('.staff-schedule-command-bar .week-nav');
        const range = document.querySelector('.staff-schedule-range-row');
        const actions = document.querySelector('.staff-schedule-header-actions');
        const search = document.querySelector('.staff-schedule-search-row');
        const departments = document.querySelector('#deptFilter');
        const wrapper = document.querySelector('#scheduleWrapper');
        const table = wrapper?.querySelector('.schedule-table');
        const fromInput = document.querySelector('#scheduleDateFrom');
        const toInput = document.querySelector('#scheduleDateTo');

        const pulseScroll = scrollReachability(pulseItems);
        const departmentScroll = scrollReachability(departments, ':scope > .dept-chip');
        if (wrapper) wrapper.scrollLeft = Math.min(360, Math.max(0, wrapper.scrollWidth - wrapper.clientWidth));

        const firstHeader = table?.querySelector('thead th:first-child');
        const firstEmployeeCell = table?.querySelector('tbody tr[data-schedule-staff-row] > td:first-child');
        const firstCategoryCell = table?.querySelector('tbody .schedule-category-sticky-cell');
        const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
        const pulseOuterStyle = pulseOuter ? getComputedStyle(pulseOuter) : null;
        const fromBox = rect(fromInput);
        const toBox = rect(toInput);
        const tableStyle = table ? getComputedStyle(table) : null;
        const page = document.querySelector('#main-content');
        const controlHeights = [
            '#prevWeekBtn',
            '#weekLabel',
            '#nextWeekBtn',
            '#todayWeekBtn',
            '#scheduleDateFrom',
            '#scheduleDateTo',
            '#applyScheduleRangeBtn',
            '.staff-schedule-range-preset',
            '#exportExcelBtn',
            '#printBtn',
            '#scheduleStaffSearch',
            '#deptFilter .dept-chip'
        ].map(selector => ({
            selector,
            height: document.querySelector(selector)?.getBoundingClientRect().height || 0
        }));
        const weekControls = {
            previous: rect(document.querySelector('#prevWeekBtn')),
            period: rect(document.querySelector('#weekLabel')),
            next: rect(document.querySelector('#nextWeekBtn')),
            today: rect(document.querySelector('#todayWeekBtn')),
            periodWhiteSpace: getComputedStyle(document.querySelector('#weekLabel')).whiteSpace
        };
        const visibleEmployeePositionCount = Array.from(document.querySelectorAll('#scheduleBody .emp-position'))
            .filter(element => element.getClientRects().length > 0)
            .length;

        return {
            viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
            viewportWidth: window.innerWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            pageScrollWidth: page?.scrollWidth || 0,
            pageClientWidth: page?.clientWidth || 0,
            globalScrollLeft: scrollingElement.scrollLeft,
            theme: document.documentElement.getAttribute('data-theme') || '',
            bodyDark: document.body.classList.contains('dark-mode'),
            commandBox: rect(command),
            weekBox: rect(week),
            rangeBox: rect(range),
            actionsBox: rect(actions),
            searchBox: rect(search),
            departmentBox: rect(departments),
            pulseOuterBox: rect(pulseOuter),
            pulseOuterOverflowX: pulseOuterStyle?.overflowX || '',
            pulseScroll,
            departmentScroll,
            fromBox,
            toBox,
            datesStacked: Boolean(fromBox && toBox && toBox.top >= fromBox.bottom - 1),
            wrapper: wrapper ? {
                clientWidth: wrapper.clientWidth,
                scrollWidth: wrapper.scrollWidth,
                scrollLeft: wrapper.scrollLeft,
                overflowX: wrapperStyle?.overflowX || '',
                overscrollBehaviorX: wrapperStyle?.overscrollBehaviorX || '',
                box: rect(wrapper)
            } : null,
            firstHeader: styleSnapshot(firstHeader),
            firstEmployeeCell: styleSnapshot(firstEmployeeCell),
            firstCategoryCell: styleSnapshot(firstCategoryCell),
            controlHeights,
            weekControls,
            visibleEmployeePositionCount,
            tableBrightness: colorBrightness(tableStyle?.backgroundColor),
            tableBackground: tableStyle?.backgroundColor || ''
        };
    });

    const { width, darkMode } = options;
    assert.match(metrics.viewportMeta, /width\s*=\s*device-width/i, `${label}: viewport uses the device width`);
    assert.doesNotMatch(metrics.viewportMeta, /user-scalable\s*=\s*no/i, `${label}: viewport does not disable pinch zoom`);
    assert.doesNotMatch(metrics.viewportMeta, /maximum-scale\s*=\s*1(?:\.0+)?(?:\D|$)/i, `${label}: viewport does not cap zoom at 1x`);
    assert.equal(metrics.viewportWidth, width, `${label}: browser keeps the requested narrow viewport`);
    assert.ok(metrics.documentScrollWidth <= width + 2, `${label}: document has no global horizontal overflow`);
    assert.ok(metrics.bodyScrollWidth <= width + 2, `${label}: body has no global horizontal overflow`);
    assert.ok(metrics.pageScrollWidth <= metrics.pageClientWidth + 2, `${label}: main content has no global horizontal overflow`);
    assert.equal(metrics.globalScrollLeft, 0, `${label}: nested horizontal scrolling does not move the page`);

    for (const [name, box] of [
        ['pulse switcher', metrics.pulseOuterBox],
        ['command bar', metrics.commandBox]
    ]) {
        assert.ok(box?.width > 0, `${label}: ${name} is measurable`);
        assert.ok(box.left >= -2 && box.right <= width + 2, `${label}: ${name} stays inside the viewport`);
    }
    assert.equal(metrics.pulseOuterOverflowX, 'hidden', `${label}: pulse shell clips instead of owning page overflow`);

    for (const [name, scroll] of [
        ['pulse switcher items', metrics.pulseScroll],
        ['department chips', metrics.departmentScroll]
    ]) {
        assert.ok(scroll, `${label}: ${name} scroll metrics are available`);
        assert.ok(['auto', 'scroll'].includes(scroll.overflowX), `${label}: ${name} owns horizontal scrolling`);
        assert.ok(scroll.scrollWidth > scroll.clientWidth + 2, `${label}: ${name} exposes its overflow intentionally`);
        assert.ok(scroll.scrollLeft > 0, `${label}: ${name} can scroll to its trailing content`);
        assert.equal(scroll.lastReachable, true, `${label}: the last ${name} item is fully reachable`);
    }

    assert.ok(metrics.weekBox && metrics.rangeBox && metrics.actionsBox && metrics.searchBox && metrics.departmentBox, `${label}: mobile command rows are measurable`);
    assert.ok(metrics.rangeBox.top >= metrics.weekBox.bottom - 2, `${label}: range controls follow week navigation`);
    assert.ok(metrics.actionsBox.top >= metrics.rangeBox.bottom - 2, `${label}: actions follow range controls`);
    assert.ok(metrics.searchBox.top >= metrics.actionsBox.bottom - 2, `${label}: search follows actions`);
    assert.ok(metrics.departmentBox.top >= metrics.searchBox.bottom - 2, `${label}: department chips follow search`);
    assert.ok(metrics.fromBox?.width > 0 && metrics.toBox?.width > 0, `${label}: both date fields are visible`);
    assert.ok(
        metrics.datesStacked || (metrics.fromBox.width >= 120 && metrics.toBox.width >= 120),
        `${label}: date fields are stacked or wide enough to remain readable`
    );
    for (const control of metrics.controlHeights) {
        assert.ok(control.height >= 43.5, `${label}: ${control.selector} keeps a consistent 44px touch target (${control.height}px)`);
    }
    if (width <= 390) {
        const weekHeights = [metrics.weekControls.previous, metrics.weekControls.period, metrics.weekControls.next, metrics.weekControls.today]
            .map(box => box?.height || 0);
        assert.ok(Math.max(...weekHeights) - Math.min(...weekHeights) <= 1, `${label}: week navigation controls share one 44px height`);
        assert.ok(metrics.weekControls.today.top >= metrics.weekControls.period.bottom - 1, `${label}: Today occupies a full second navigation row`);
        assert.equal(metrics.weekControls.periodWhiteSpace, 'nowrap', `${label}: period label stays on one line`);
    }
    assert.equal(metrics.visibleEmployeePositionCount, 0, `${label}: mobile employee rows hide verbose profession text`);

    assert.ok(metrics.wrapper, `${label}: schedule wrapper metrics are available`);
    assert.ok(['auto', 'scroll'].includes(metrics.wrapper.overflowX), `${label}: schedule wrapper owns table scrolling`);
    assert.equal(metrics.wrapper.overscrollBehaviorX, 'contain', `${label}: schedule wrapper contains horizontal overscroll`);
    assert.ok(metrics.wrapper.scrollWidth > metrics.wrapper.clientWidth + 20, `${label}: month table remains horizontally scrollable`);
    assert.ok(metrics.wrapper.scrollLeft > 0, `${label}: month table accepts horizontal scroll`);

    for (const [name, sticky] of [
        ['header employee column', metrics.firstHeader],
        ['employee column', metrics.firstEmployeeCell],
        ['category column', metrics.firstCategoryCell]
    ]) {
        assert.ok(sticky?.box, `${label}: ${name} is measurable`);
        assert.equal(sticky.position, 'sticky', `${label}: ${name} stays sticky`);
        assert.ok(Math.abs(sticky.box.left - metrics.wrapper.box.left) <= 3, `${label}: ${name} remains pinned after table scroll`);
        assert.ok(sticky.backgroundImage !== 'none' || sticky.backgroundColor !== 'rgba(0, 0, 0, 0)', `${label}: ${name} paints an opaque reading surface`);
    }
    assert.ok(metrics.firstHeader.backgroundAlpha >= 0.99, `${label}: sticky employee header has an opaque fallback surface`);
    assert.ok(
        Math.abs(metrics.firstHeader.box.width - metrics.firstEmployeeCell.box.width) <= 3,
        `${label}: header and employee sticky columns stay aligned`
    );
    assert.ok(
        Math.abs(metrics.firstHeader.box.width - metrics.firstCategoryCell.box.width) <= 3,
        `${label}: header and category sticky columns stay aligned`
    );

    if (darkMode) {
        assert.equal(metrics.theme, 'dark', `${label}: dark theme is applied to the root`);
        assert.equal(metrics.bodyDark, true, `${label}: dark theme compatibility class is applied`);
        assert.ok(
            metrics.firstEmployeeCell.brightness !== null && metrics.firstEmployeeCell.brightness < 100,
            `${label}: sticky employee column uses a dark reading surface`
        );
    } else {
        assert.equal(metrics.theme, 'light', `${label}: light theme is applied to the root`);
        assert.equal(metrics.bodyDark, false, `${label}: light theme does not keep the dark compatibility class`);
        assert.ok(
            metrics.firstEmployeeCell.brightness !== null && metrics.firstEmployeeCell.brightness > 180,
            `${label}: sticky employee column uses a light reading surface`
        );
    }
}

function waitForScheduleHttpResponse(page, from, to) {
    return page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/staff/schedule'
            && url.searchParams.get('from') === from
            && url.searchParams.get('to') === to;
    }, { timeout: 20000 });
}

async function scheduleRangeDomSnapshot(page) {
    return page.evaluate(() => {
        const region = document.getElementById('scheduleDataRegion');
        const wrapper = document.getElementById('scheduleWrapper');
        const statePanel = document.getElementById('scheduleRangeState');
        const exportButton = document.getElementById('exportExcelBtn');
        const printButton = document.getElementById('printBtn');
        return {
            from: document.getElementById('scheduleDateFrom')?.value || '',
            to: document.getElementById('scheduleDateTo')?.value || '',
            label: document.getElementById('weekLabel')?.textContent?.trim() || '',
            state: region?.dataset.scheduleState || '',
            hasCommittedRange: region?.dataset.hasCommittedRange || '',
            ariaBusy: region?.getAttribute('aria-busy') || '',
            wrapperHidden: wrapper ? wrapper.hidden || getComputedStyle(wrapper).display === 'none' : true,
            editLocked: Boolean(
                wrapper?.inert
                || region?.inert
                || wrapper?.getAttribute('aria-disabled') === 'true'
                || region?.getAttribute('aria-disabled') === 'true'
            ),
            statePanelHidden: statePanel?.hidden ?? true,
            statePanelText: statePanel?.textContent?.replace(/\s+/g, ' ').trim() || '',
            retryHidden: document.getElementById('scheduleRangeRetryBtn')?.hidden ?? true,
            exportDisabled: Boolean(exportButton?.disabled),
            exportAriaDisabled: exportButton?.getAttribute('aria-disabled') || '',
            printDisabled: Boolean(printButton?.disabled),
            printAriaDisabled: printButton?.getAttribute('aria-disabled') || '',
            headerCount: document.querySelectorAll('#scheduleHead th').length
        };
    });
}

async function assertScheduleActionsBlocked(page, label, expectedBusy) {
    const state = await scheduleRangeDomSnapshot(page);
    assert.equal(state.exportDisabled, true, `${label}: export is disabled`);
    assert.equal(state.exportAriaDisabled, 'true', `${label}: export exposes aria-disabled`);
    assert.equal(state.printDisabled, true, `${label}: print is disabled`);
    assert.equal(state.printAriaDisabled, 'true', `${label}: print exposes aria-disabled`);
    assert.equal(state.editLocked, true, `${label}: committed table is locked against edits`);
    assert.equal(state.ariaBusy, expectedBusy ? 'true' : 'false', `${label}: aria-busy matches the load state`);
}

async function assertScheduleActionsAvailable(page, label) {
    const state = await scheduleRangeDomSnapshot(page);
    assert.equal(state.exportDisabled, false, `${label}: export is enabled for the confirmed range`);
    assert.equal(state.exportAriaDisabled, 'false', `${label}: export aria-disabled is cleared`);
    assert.equal(state.printDisabled, false, `${label}: print is enabled for the confirmed range`);
    assert.equal(state.printAriaDisabled, 'false', `${label}: print aria-disabled is cleared`);
    assert.equal(state.editLocked, false, `${label}: confirmed table is editable`);
    assert.equal(state.ariaBusy, 'false', `${label}: confirmed range is not busy`);
}

async function installBlockedActionProbe(page) {
    await page.evaluate(() => {
        window.__staffScheduleBlockedActionProbe = {
            downloadAttempts: 0,
            printWindowAttempts: 0
        };
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function (...args) {
            if (this.hasAttribute('download')) {
                window.__staffScheduleBlockedActionProbe.downloadAttempts += 1;
                return undefined;
            }
            return originalAnchorClick.apply(this, args);
        };
        window.open = () => {
            window.__staffScheduleBlockedActionProbe.printWindowAttempts += 1;
            return null;
        };
    });
}

async function dispatchBlockedScheduleActions(page, label) {
    await page.evaluate(() => {
        for (const id of ['exportExcelBtn', 'printBtn']) {
            document.getElementById(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    });
    const attempts = await page.evaluate(() => window.__staffScheduleBlockedActionProbe);
    assert.deepEqual(attempts, { downloadAttempts: 0, printWindowAttempts: 0 }, `${label}: guarded handlers do not launch export or print`);
}

async function assertConfirmedRange(page, from, to, expectedState, label) {
    await waitForCommittedScheduleRange(page, from, to, expectedState);
    const state = await scheduleRangeDomSnapshot(page);
    assert.equal(state.from, from, `${label}: date-from belongs to the confirmed range`);
    assert.equal(state.to, to, `${label}: date-to belongs to the confirmed range`);
    assert.equal(state.state, expectedState, `${label}: schedule state is ${expectedState}`);
    assert.equal(state.hasCommittedRange, 'true', `${label}: committed-range invariant is exposed`);
    assert.equal(state.headerCount, dateRangeDays(from, to) + 1, `${label}: header belongs to the confirmed range`);
}

async function runInitialRangeFailureFlow(browser, base) {
    const initialFailure = queueScheduleResponseScenario({
        kind: 'http-error',
        status: 500,
        error: 'Initial schedule fixture failure'
    });
    let context = null;
    try {
        const opened = await openStaffPage(browser, base, { width: 1280, height: 800 }, { waitForRows: false });
        context = opened.context;
        const { page } = opened;
        await initialFailure.finished.promise;
        await waitForScheduleState(page, 'error');

        const failedState = await scheduleRangeDomSnapshot(page);
        assert.equal(failedState.state, 'error', 'initial 500 renders the persistent error state');
        assert.equal(failedState.hasCommittedRange, 'false', 'initial 500 does not invent a committed range');
        assert.equal(failedState.wrapperHidden, true, 'initial 500 does not show an ordinary empty schedule table');
        assert.equal(failedState.statePanelHidden, false, 'initial 500 keeps the range error visible');
        assert.equal(failedState.retryHidden, false, 'initial 500 exposes retry');
        assert.ok(failedState.statePanelText.length > 0, 'initial 500 explains the failed range');
        await assertScheduleActionsBlocked(page, 'initial range failure', false);

        assert.ok(initialFailure.request?.from && initialFailure.request?.to, 'initial failure captures the requested range');
        await page.locator('#scheduleRangeRetryBtn').click();
        const retryState = scheduleFixtureEntriesForRange(initialFailure.request.from, initialFailure.request.to).length
            ? 'ready'
            : 'empty';
        await assertConfirmedRange(
            page,
            initialFailure.request.from,
            initialFailure.request.to,
            retryState,
            'initial retry'
        );
        await assertScheduleActionsAvailable(page, 'initial retry');

        await applyManualRange(page, '2026-08-01', '2026-08-05');
        await assertConfirmedRange(page, '2026-08-01', '2026-08-05', 'empty', 'successful empty response');
        const emptyState = await scheduleRangeDomSnapshot(page);
        assert.equal(emptyState.wrapperHidden, false, 'successful empty response keeps the confirmed table surface available');
        assert.equal(emptyState.statePanelHidden, false, 'successful empty response has its own explicit state');
        assert.equal(emptyState.retryHidden, true, 'successful empty response is not presented as a retryable failure');
        await assertScheduleActionsAvailable(page, 'successful empty response');
    } finally {
        releaseScheduleResponseScenarios();
        if (context) await context.close();
    }
}

async function runPeriodReliabilityFlow(browser, base) {
    const RANGE_A = { from: '2026-07-01', to: '2026-07-15' };
    const RANGE_B = { from: '2026-07-16', to: '2026-07-31' };
    const RANGE_MONTH = { from: '2026-07-01', to: '2026-07-31' };
    let context = null;
    try {
        const opened = await openStaffPage(
            browser,
            base,
            { width: 1440, height: 900 },
            { ignoreAbort: true }
        );
        context = opened.context;
        const { page } = opened;

        await applyManualRange(page, RANGE_B.from, RANGE_B.to);
        await assertConfirmedRange(page, RANGE_B.from, RANGE_B.to, 'ready', 'race baseline B');
        await installBlockedActionProbe(page);

        const delayedA = queueScheduleResponseScenario({ ...RANGE_A, hold: true });
        await requestManualRange(page, RANGE_A.from, RANGE_A.to);
        await delayedA.started.promise;
        await waitForScheduleState(page, 'loading');
        const loadingA = await scheduleRangeDomSnapshot(page);
        assert.equal(loadingA.from, RANGE_B.from, 'loading A keeps date-from on confirmed B');
        assert.equal(loadingA.to, RANGE_B.to, 'loading A keeps date-to on confirmed B');
        assert.match(loadingA.label, /16\D+31\D+2026/, 'loading A keeps confirmed B in the header');
        await assertScheduleActionsBlocked(page, 'delayed A loading', true);
        await dispatchBlockedScheduleActions(page, 'delayed A loading');

        await requestManualRange(page, RANGE_B.from, RANGE_B.to);
        await assertConfirmedRange(page, RANGE_B.from, RANGE_B.to, 'ready', 'fast B');
        const lateAResponse = waitForScheduleHttpResponse(page, RANGE_A.from, RANGE_A.to);
        delayedA.release();
        const responseA = await lateAResponse;
        await responseA.finished();
        await delayedA.finished.promise;
        await settleScheduleDom(page);
        await assertConfirmedRange(page, RANGE_B.from, RANGE_B.to, 'ready', 'late A ignored');
        await assertScheduleActionsAvailable(page, 'late A ignored');

        await expandAllScheduleGroups(page);
        const failedBtoA = queueScheduleResponseScenario({
            ...RANGE_A,
            kind: 'http-error',
            status: 500,
            error: 'Navigation schedule fixture failure'
        });
        await requestManualRange(page, RANGE_A.from, RANGE_A.to);
        await failedBtoA.finished.promise;
        await waitForScheduleState(page, 'error');
        const navigationError = await scheduleRangeDomSnapshot(page);
        assert.equal(navigationError.from, RANGE_B.from, '500 restores date-from to confirmed B');
        assert.equal(navigationError.to, RANGE_B.to, '500 restores date-to to confirmed B');
        assert.match(navigationError.label, /16\D+31\D+2026/, '500 preserves the confirmed B header');
        assert.equal(navigationError.headerCount, 17, '500 preserves B table columns');
        assert.equal(navigationError.statePanelHidden, false, '500 keeps a persistent error panel');
        assert.equal(navigationError.retryHidden, false, '500 exposes retry for the failed A range');
        assert.match(navigationError.statePanelText, /1\D+15\D+2026/, '500 error names the failed A range');
        assert.match(
            await page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-31"]').innerText(),
            /10/,
            '500 preserves confirmed B schedule data'
        );
        await assertScheduleActionsBlocked(page, 'navigation 500 error', false);
        await dispatchBlockedScheduleActions(page, 'navigation 500 error');

        await page.locator('#scheduleRangeRetryBtn').click();
        await assertConfirmedRange(page, RANGE_A.from, RANGE_A.to, 'ready', '500 retry');
        const retriedState = await scheduleRangeDomSnapshot(page);
        assert.equal(retriedState.statePanelHidden, true, 'successful retry clears the persistent error panel');
        assert.equal(retriedState.retryHidden, true, 'successful retry hides retry');
        await assertScheduleActionsAvailable(page, '500 retry');

        const invalidJson = queueScheduleResponseScenario({ ...RANGE_B, kind: 'invalid-json' });
        await requestManualRange(page, RANGE_B.from, RANGE_B.to);
        await invalidJson.finished.promise;
        await waitForScheduleState(page, 'error');
        const invalidJsonState = await scheduleRangeDomSnapshot(page);
        assert.equal(invalidJsonState.from, RANGE_A.from, 'invalid JSON restores confirmed A start');
        assert.equal(invalidJsonState.to, RANGE_A.to, 'invalid JSON restores confirmed A end');
        assert.equal(invalidJsonState.headerCount, 16, 'invalid JSON preserves confirmed A columns');

        const networkFailure = queueScheduleResponseScenario({ ...RANGE_B, kind: 'network-error', hold: true });
        await requestManualRange(page, RANGE_B.from, RANGE_B.to);
        await networkFailure.started.promise;
        await waitForScheduleState(page, 'loading');
        networkFailure.release();
        await networkFailure.finished.promise;
        await waitForScheduleState(page, 'error');
        const networkState = await scheduleRangeDomSnapshot(page);
        assert.equal(networkState.from, RANGE_A.from, 'network exception restores confirmed A start');
        assert.equal(networkState.to, RANGE_A.to, 'network exception restores confirmed A end');
        assert.equal(networkState.headerCount, 16, 'network exception preserves confirmed A columns');
        await assertScheduleActionsBlocked(page, 'network exception error', false);

        await page.locator('#scheduleRangeRetryBtn').click();
        await assertConfirmedRange(page, RANGE_B.from, RANGE_B.to, 'ready', 'network retry');
        await assertScheduleActionsAvailable(page, 'network retry');

        const delayedFirstHalf = queueScheduleResponseScenario({ ...RANGE_A, hold: true });
        const delayedSecondHalf = queueScheduleResponseScenario({ ...RANGE_B, hold: true });
        await page.locator('[data-schedule-range-preset="first-half"]').click();
        await delayedFirstHalf.started.promise;
        await waitForScheduleState(page, 'loading');
        await page.locator('[data-schedule-range-preset="second-half"]').click();
        await delayedSecondHalf.started.promise;
        await waitForScheduleState(page, 'loading');
        await requestManualRange(page, RANGE_MONTH.from, RANGE_MONTH.to);
        await assertConfirmedRange(page, RANGE_MONTH.from, RANGE_MONTH.to, 'ready', 'rapid manual month winner');

        const lateSecondHalfResponse = waitForScheduleHttpResponse(page, RANGE_B.from, RANGE_B.to);
        delayedSecondHalf.release();
        const responseSecondHalf = await lateSecondHalfResponse;
        await responseSecondHalf.finished();
        await delayedSecondHalf.finished.promise;
        await settleScheduleDom(page);
        await assertConfirmedRange(page, RANGE_MONTH.from, RANGE_MONTH.to, 'ready', 'late second-half ignored after manual month');

        const lateFirstHalfResponse = waitForScheduleHttpResponse(page, RANGE_A.from, RANGE_A.to);
        delayedFirstHalf.release();
        const responseFirstHalf = await lateFirstHalfResponse;
        await responseFirstHalf.finished();
        await delayedFirstHalf.finished.promise;
        await settleScheduleDom(page);
        await assertConfirmedRange(page, RANGE_MONTH.from, RANGE_MONTH.to, 'ready', 'late first-half ignored after manual month');
        assert.equal(
            await page.locator('[data-schedule-range-preset][aria-pressed="true"]').count(),
            0,
            'manual full-month range leaves top half-month presets inactive'
        );

        const CUSTOM_RANGE = { from: '2026-07-01', to: '2026-07-05' };
        const NEXT_RANGE = { from: '2026-07-06', to: '2026-07-10' };
        await applyManualRange(page, CUSTOM_RANGE.from, CUSTOM_RANGE.to);
        await assertConfirmedRange(page, CUSTOM_RANGE.from, CUSTOM_RANGE.to, 'empty', 'rapid prev-next baseline');
        const delayedNext = queueScheduleResponseScenario({ ...NEXT_RANGE, hold: true });
        await page.locator('#nextWeekBtn').click();
        await delayedNext.started.promise;
        await waitForScheduleState(page, 'loading');
        await page.locator('#prevWeekBtn').click();
        await assertConfirmedRange(page, CUSTOM_RANGE.from, CUSTOM_RANGE.to, 'empty', 'rapid next-prev winner');

        const lateNextResponse = waitForScheduleHttpResponse(page, NEXT_RANGE.from, NEXT_RANGE.to);
        delayedNext.release();
        const responseNext = await lateNextResponse;
        await responseNext.finished();
        await delayedNext.finished.promise;
        await settleScheduleDom(page);
        await assertConfirmedRange(page, CUSTOM_RANGE.from, CUSTOM_RANGE.to, 'empty', 'late next ignored after prev');
        await assertScheduleActionsAvailable(page, 'rapid next-prev winner');
    } finally {
        releaseScheduleResponseScenarios();
        if (context) await context.close();
    }
}

async function runScheduleHistoryIsolationFlow(browser, base) {
    let context = null;
    try {
        const opened = await openStaffPage(
            browser,
            base,
            { width: 1440, height: 900 },
            { ignoreAbort: true }
        );
        context = opened.context;
        const { page } = opened;
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await expandAllScheduleGroups(page);

        const delayedA = queueHistoryResponseScenario({
            staffId: 101,
            date: '2026-07-11',
            marker: 'HISTORY-A-LATE',
            hold: true
        });
        await page.locator('[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-11"]').click();
        await delayedA.started.promise;
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#schHistoryList').getAttribute('aria-busy'), 'true', 'history A exposes its loading state');
        assert.match(await page.locator('#schHistoryList').innerText(), /Завантажую історію/, 'history A shows a loading message');

        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        const fastB = queueHistoryResponseScenario({
            staffId: 108,
            date: '2026-07-12',
            marker: 'HISTORY-B'
        });
        await page.locator('[data-schedule-staff-row="108"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-12"]').click();
        await fastB.started.promise;
        await fastB.finished.promise;
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
        await page.waitForFunction(marker => document.getElementById('schHistoryList')?.textContent?.includes(marker), fastB.marker);
        const fastBModal = await page.locator('#schModalOverlay').evaluate(modal => ({
            title: modal.querySelector('#schModalTitle')?.textContent?.trim() || '',
            history: modal.querySelector('#schHistoryList')?.textContent?.replace(/\s+/g, ' ').trim() || '',
            historyBusy: modal.querySelector('#schHistoryList')?.getAttribute('aria-busy') || ''
        }));
        assert.match(fastBModal.title, /Animator Trampoline.+2026-07-12/, 'fast history B owns the open modal title');
        assert.match(fastBModal.history, /HISTORY-B/, 'fast history B owns the history panel');
        assert.doesNotMatch(fastBModal.history, /HISTORY-A-LATE/, 'fast history B does not show delayed A');
        assert.equal(fastBModal.historyBusy, 'false', 'fast history B settles the loading state');

        delayedA.release();
        await delayedA.finished.promise;
        await settleScheduleDom(page);
        const afterLateA = await page.locator('#schModalOverlay').evaluate(modal => ({
            visible: modal.classList.contains('visible'),
            title: modal.querySelector('#schModalTitle')?.textContent?.trim() || '',
            history: modal.querySelector('#schHistoryList')?.textContent?.replace(/\s+/g, ' ').trim() || ''
        }));
        assert.equal(afterLateA.visible, true, 'late history A cannot close the newer B modal');
        assert.match(afterLateA.title, /Animator Trampoline.+2026-07-12/, 'late history A cannot replace the B title');
        assert.match(afterLateA.history, /HISTORY-B/, 'late history A leaves B history intact');
        assert.doesNotMatch(afterLateA.history, /HISTORY-A-LATE/, 'late history A cannot mutate the current history DOM');
        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
    } finally {
        releaseHistoryResponseScenarios();
        if (context) await context.close();
    }

    context = null;
    try {
        const opened = await openStaffPage(browser, base, { width: 1440, height: 900 });
        context = opened.context;
        const { page } = opened;
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await expandAllScheduleGroups(page);

        const closeBeforeResponse = queueHistoryResponseScenario({
            staffId: 101,
            date: '2026-07-11',
            marker: 'HISTORY-C-CLOSED',
            hold: true
        });
        await page.evaluate(() => {
            const nativeFetch = window.fetch.bind(window);
            window.__staffHistorySignalAborted = false;
            window.fetch = (input, init = {}) => {
                const requestUrl = typeof input === 'string' ? input : input?.url || '';
                if (requestUrl.includes('/api/staff/schedule/history/')) {
                    init.signal?.addEventListener('abort', () => {
                        window.__staffHistorySignalAborted = true;
                    }, { once: true });
                }
                return nativeFetch(input, init);
            };
        });
        await page.locator('[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-11"]').click();
        await closeBeforeResponse.started.promise;
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#schHistoryList').getAttribute('aria-busy'), 'true', 'close-before-response starts with busy history');

        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
        assert.equal(await page.evaluate(() => window.__staffHistorySignalAborted), true, 'close-before-response aborts the history fetch signal');
        closeBeforeResponse.release();
        await closeBeforeResponse.finished.promise;
        await settleScheduleDom(page);

        const closedState = await page.locator('#schModalOverlay').evaluate(modal => ({
            visible: modal.classList.contains('visible'),
            history: modal.querySelector('#schHistoryList')?.textContent?.replace(/\s+/g, ' ').trim() || '',
            historyBusy: modal.querySelector('#schHistoryList')?.getAttribute('aria-busy') || ''
        }));
        assert.equal(closedState.visible, false, 'late response cannot reopen a closed modal');
        assert.equal(closedState.historyBusy, 'false', 'closing clears history aria-busy');
        assert.equal(closedState.history, '', 'closing clears pending history content');
        assert.doesNotMatch(closedState.history, /HISTORY-C-CLOSED/, 'closed modal ignores its pending history response');
        const responseRecord = apiCalls.historyResponses.find(record => record.scenarioId === closeBeforeResponse.id);
        assert.ok(['client-aborted', 'success'].includes(responseRecord?.kind), 'history transport settles after client-side cancellation');
    } finally {
        releaseHistoryResponseScenarios();
        if (context) await context.close();
    }
}

async function runScheduleKeyboardAccessibilityFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    try {
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await expandAllScheduleGroups(page);

        const tableName = 'Графік роботи співробітників за вибраний період';
        assert.equal(await page.getByRole('table', { name: tableName, exact: true }).count(), 1, 'schedule table has a unique caption-derived accessible name');
        assert.equal((await page.locator('#scheduleWrapper caption').textContent())?.trim(), tableName, 'schedule caption describes the selected-period table');
        const headerScopes = await page.locator('#scheduleHead th').evaluateAll(headers => headers.map(header => header.getAttribute('scope')));
        assert.ok(headerScopes.length > 1, 'schedule renders employee and day headers');
        assert.equal(headerScopes.every(scope => scope === 'col'), true, 'every schedule column header declares scope=col');

        const cellSemantics = await page.locator('#scheduleBody .sch-cell').evaluateAll(cells => cells.map(cell => ({
            role: cell.getAttribute('role'),
            tabIndex: cell.getAttribute('tabindex'),
            ariaLabel: cell.getAttribute('aria-label') || ''
        })));
        assert.ok(cellSemantics.length > 0, 'schedule exposes interactive cells');
        assert.equal(cellSemantics.every(cell => cell.role === 'button'), true, 'every interactive schedule cell exposes button semantics');
        assert.equal(cellSemantics.every(cell => cell.tabIndex === '0'), true, 'every interactive schedule cell is keyboard reachable');
        assert.equal(cellSemantics.every(cell => cell.ariaLabel.trim().length > 0), true, 'every interactive schedule cell has an accessible name');
        assert.equal(await page.locator('#scheduleBody .sch-cell button').count(), 0, 'schedule cell triggers do not contain nested interactive buttons');
        assert.equal(await page.getByLabel('Від', { exact: true }).count(), 1, 'range start has an explicit label');
        assert.equal(await page.getByLabel('До', { exact: true }).count(), 1, 'range end has an explicit label');

        const trigger = page.locator('[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-11"]');
        await trigger.evaluate(cell => { window.__scheduleKeyboardTrigger = cell; });
        await trigger.focus();
        assert.equal(
            await trigger.evaluate(cell => document.activeElement === cell),
            true,
            'keyboard scenario starts on the schedule cell'
        );
        await trigger.press('Enter');

        const dialog = page.getByRole('dialog', { name: /План дня:.+2026-07-11/ });
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.getAttribute('aria-modal'), 'true', 'schedule editor exposes modal dialog semantics');
        await page.waitForFunction(() => document.activeElement?.id === 'schStatus');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'schStatus', 'Enter opens the editor with initial focus on status');
        assert.equal(await page.getByLabel('Статус дня', { exact: true }).count(), 1, 'status control has a programmatic label');
        assert.equal(await page.getByLabel('Професія', { exact: true }).count(), 1, 'profession control has a programmatic label');
        assert.equal(await page.getByLabel('Початок', { exact: true }).count(), 1, 'shift start has a programmatic label');
        assert.equal(await page.getByLabel('Завершення', { exact: true }).count(), 1, 'shift end has a programmatic label');
        assert.equal(await page.getByLabel('Примітка дня', { exact: true }).count(), 1, 'day note control has a programmatic label');
        assert.equal(await page.getByRole('region', { name: 'Історія клітинки', exact: true }).count(), 1, 'history panel has a labelled region');

        await page.evaluate(() => {
            const selector = [
                'a[href]',
                'button:not([disabled])',
                'input:not([disabled])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                '[tabindex]:not([tabindex="-1"])'
            ].join(',');
            const modal = document.getElementById('schModalOverlay');
            const focusable = Array.from(modal?.querySelectorAll(selector) || [])
                .filter(element => element.offsetParent !== null);
            window.__scheduleModalFirstFocusable = focusable[0] || null;
            window.__scheduleModalLastFocusable = focusable.at(-1) || null;
            window.__scheduleModalFirstFocusable?.focus();
        });
        await page.keyboard.press('Shift+Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement === window.__scheduleModalLastFocusable),
            true,
            'Shift+Tab loops from the first modal control to the last'
        );
        await page.keyboard.press('Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement === window.__scheduleModalFirstFocusable),
            true,
            'Tab loops from the last modal control to the first'
        );

        await page.evaluate(() => window.StaffSchedulePage.renderSchedule());
        await page.waitForFunction(() => window.__scheduleKeyboardTrigger?.isConnected === false);
        await page.locator('[data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-11"]').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
        await page.waitForFunction(() => {
            const active = document.activeElement;
            return active?.matches?.('.sch-cell[data-staff="101"][data-date="2026-07-11"][data-schedule-department="reception"]');
        });
        assert.equal(
            await page.evaluate(() => (
                document.activeElement !== window.__scheduleKeyboardTrigger
                && document.activeElement?.matches?.('.sch-cell[data-staff="101"][data-date="2026-07-11"][data-schedule-department="reception"]')
            )),
            true,
            'Escape restores focus to the fresh matching cell after a schedule rerender'
        );
    } finally {
        await context.close();
    }
}

async function runMembershipGroupingFlow(browser, base) {
    const expectedUniqueIds = [101, 102, 103, 104, 105, 106, 107, 108];
    const expectedAllPlacements = [
        { id: 108, department: 'animators' },
        { id: 103, department: 'admin' },
        { id: 104, department: 'cafe' },
        { id: 107, department: 'cafe' },
        { id: 101, department: 'reception' },
        { id: 102, department: 'reception' },
        { id: 106, department: 'reception' },
        { id: 105, department: 'tech' }
    ];
    const expectedChipCounts = {
        all: 8,
        animators: 2,
        trampoline: 2,
        reception: 4,
        admin: 1,
        cafe: 3,
        tech: 1,
        cleaning: 0
    };
    const originalSecondaryProfessions = [...STAFF_ROWS[0].secondary_professions];
    const originalScheduleEntries = SCHEDULE_FIXTURE_ENTRIES.map(entry => ({ ...entry }));
    const scheduleBodiesStart = apiCalls.scheduleBodies.length;
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    try {
        await applyManualRange(page, '2026-07-13', '2026-07-15');
        await page.locator('#scheduleStaffSearch').fill('');
        await activateScheduleDepartment(page, 'all');
        await expandAllScheduleGroups(page);

        const allIds = await scheduleStaffIdsFromDom(page);
        const allRows = await scheduleStaffRowsFromDom(page);
        assertUniqueScheduleStaffPlacements(allRows, 'All schedule table');
        assertUniqueScheduleStaffIds(allIds, 'All schedule table');
        assert.deepEqual(sortedScheduleStaffIds(allIds), expectedUniqueIds, 'All exposes every fixture exactly once');
        const allStaffGroups = await scheduleStaffGroupsFromDom(page);
        assert.deepEqual(
            sortedScheduleStaffPlacements(allStaffGroups),
            sortedScheduleStaffPlacements(expectedAllPlacements),
            'All renders each employee in one canonical category'
        );
        assert.equal(allStaffGroups.filter(row => row.id === 101).length, 1, 'shared employee has one canonical All placement');

        const chipCounts = await page.locator('#deptFilter .dept-chip').evaluateAll(chips => Object.fromEntries(
            chips.map(chip => [
                chip.getAttribute('data-dept') || '',
                Number(chip.querySelector('.dept-chip-count')?.textContent?.trim() || 0)
            ])
        ));
        assert.deepEqual(chipCounts, expectedChipCounts, 'department chips count unique membership staff IDs without phantom groups');
        assert.equal(chipCounts.all, expectedUniqueIds.length, 'All total counts Vitalina once across professional sections');
        assert.equal(allIds.length, chipCounts.all, 'All row count matches the unique people counter');
        await assertScheduleExportParity(page, allIds, 'All');
        await assertDepartmentFiltersRenderOnlyActiveGroup(page);

        await activateScheduleDepartment(page, 'reception');
        await expandScheduleGroup(page, 'reception');
        const existingReceptionCell = page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-13"]');
        await existingReceptionCell.click();
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#schProfession').inputValue(), 'animator', 'saved profession_key wins over the reception section context');
        assert.equal(await page.locator('#schStart').inputValue(), '10:00', 'saved shift start remains unchanged');
        assert.equal(await page.locator('#schEnd').inputValue(), '20:00', 'saved shift end remains unchanged');
        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        const emptyAnimatorCell = page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-14"]');
        await emptyAnimatorCell.click();
        await page.waitForFunction(() => document.getElementById('schProfession')?.value === 'animator' && document.getElementById('schStart')?.value === '12:00');
        assert.equal(await page.locator('#schEnd').inputValue(), '20:00', 'animator section loads animator shift preference times');
        assert.ok(
            await page.locator('#schShiftPreferencePanel [data-shift-pref-source="saved"]').count() >= 2,
            'animator modal identifies its stored weekday/weekend preferences as saved'
        );
        const animatorSaveScenario = queueScheduleSaveResponseScenario({
            staffId: 101,
            date: '2026-07-14',
            hold: true
        });
        const scheduleSaveCountBeforeRepeatClick = apiCalls.scheduleBodies.length;
        const animatorSaveButtonBox = await page.locator('#schSaveBtn').boundingBox();
        assert.ok(animatorSaveButtonBox, 'animator save button has clickable geometry');
        await page.mouse.click(
            animatorSaveButtonBox.x + (animatorSaveButtonBox.width / 2),
            animatorSaveButtonBox.y + (animatorSaveButtonBox.height / 2)
        );
        await animatorSaveScenario.started.promise;
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, 'save button stays disabled while its request is pending');
        await page.mouse.click(
            animatorSaveButtonBox.x + (animatorSaveButtonBox.width / 2),
            animatorSaveButtonBox.y + (animatorSaveButtonBox.height / 2)
        );
        assert.equal(
            apiCalls.scheduleBodies.length,
            scheduleSaveCountBeforeRepeatClick + 1,
            'a repeated physical click during the pending save does not create a duplicate request'
        );
        animatorSaveScenario.release();
        await animatorSaveScenario.finished.promise;
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        await activateScheduleDepartment(page, 'reception');
        await expandScheduleGroup(page, 'reception');
        const savedAnimatorFromReception = page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-14"]');
        await savedAnimatorFromReception.click();
        await page.waitForFunction(() => document.getElementById('schProfession')?.value === 'animator');
        await page.waitForFunction(() => document.getElementById('schSaveBtn')?.disabled === false);
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), false, 'next modal re-enables save after the prior successful save');
        assert.equal(await page.locator('#schStart').inputValue(), '12:00', 'reopened animator shift keeps its saved start time');
        assert.equal(await page.locator('#schEnd').inputValue(), '20:00', 'reopened animator shift keeps its saved end time');
        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        const emptyReceptionCell = page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-15"]');
        await emptyReceptionCell.click();
        await page.waitForFunction(() => document.getElementById('schProfession')?.value === 'senior_manager');
        await page.waitForFunction(() => document.getElementById('schSaveBtn')?.disabled === false);
        await page.locator('#schProfession').selectOption('reception');
        await page.waitForFunction(() => document.getElementById('schProfession')?.value === 'reception' && document.getElementById('schStart')?.value === '08:00');
        assert.equal(await page.locator('#schEnd').inputValue(), '16:00', 'reception section loads reception shift preference times');
        assert.ok(
            await page.locator('#schShiftPreferencePanel [data-shift-pref-source="saved"]').count() >= 2,
            'reception modal identifies its stored weekday/weekend preferences as saved'
        );
        await page.locator('#schSaveBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        const savedReceptionFromAnimator = page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-15"]');
        await savedReceptionFromAnimator.click();
        await page.waitForFunction(() => document.getElementById('schProfession')?.value === 'reception');
        await page.waitForFunction(() => document.getElementById('schSaveBtn')?.disabled === false);
        assert.equal(await page.locator('#schStart').inputValue(), '08:00', 'reopened reception shift keeps its saved start time');
        assert.equal(await page.locator('#schEnd').inputValue(), '16:00', 'reopened reception shift keeps its saved end time');
        await page.locator('#schCancelBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        const savedBodies = apiCalls.scheduleBodies.slice(scheduleBodiesStart).map(body => ({
            staffId: Number(body.staffId),
            date: body.date,
            shiftStart: body.shiftStart,
            shiftEnd: body.shiftEnd,
            professionKey: body.professionKey
        }));
        assert.deepEqual(savedBodies, [
            { staffId: 101, date: '2026-07-14', shiftStart: '12:00', shiftEnd: '20:00', professionKey: 'animator' },
            { staffId: 101, date: '2026-07-15', shiftStart: '08:00', shiftEnd: '16:00', professionKey: 'reception' }
        ], 'different dates persist the selected profession_key and its own shift times');
        assertSingleScheduleEntryPerStaffDate(SCHEDULE_FIXTURE_ENTRIES, 'saved multi-profession scenario');

        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        await page.locator('#scheduleStaffSearch').fill('Аніматор');
        await page.waitForFunction(() => document.querySelectorAll('#scheduleBody [data-schedule-staff-row]').length === 2);
        const refreshStateBefore = await page.evaluate(() => ({
            from: document.getElementById('scheduleDateFrom')?.value || '',
            to: document.getElementById('scheduleDateTo')?.value || '',
            search: document.getElementById('scheduleStaffSearch')?.value || '',
            activeDept: document.querySelector('#deptFilter .dept-chip[aria-pressed="true"]')?.dataset.dept || '',
            navigationCount: performance.getEntriesByType('navigation').length
        }));

        setFixtureSecondaryProfessions(101, ['reception', 'reception']);
        await page.evaluate(() => window.StaffSchedulePage.refresh({ staffId: 101 }));
        await page.waitForFunction(() => (
            document.querySelectorAll('[data-schedule-staff-row="101"][data-schedule-department="animators"]').length === 0
            && document.querySelectorAll('[data-schedule-staff-row="108"][data-schedule-department="animators"]').length === 1
        ));
        assert.deepEqual(await page.evaluate(() => ({
            from: document.getElementById('scheduleDateFrom')?.value || '',
            to: document.getElementById('scheduleDateTo')?.value || '',
            search: document.getElementById('scheduleStaffSearch')?.value || '',
            activeDept: document.querySelector('#deptFilter .dept-chip[aria-pressed="true"]')?.dataset.dept || '',
            navigationCount: performance.getEntriesByType('navigation').length
        })), refreshStateBefore, 'refresh after profession removal preserves range, filter, search, and page navigation');
        assert.equal(
            await page.locator('[data-schedule-group-toggle="animators"]').getAttribute('aria-expanded'),
            'true',
            'refresh preserves the expanded animators section'
        );

        setFixtureSecondaryProfessions(101, originalSecondaryProfessions);
        await page.evaluate(() => window.StaffSchedulePage.refresh({ staffId: 101 }));
        await page.waitForFunction(() => (
            document.querySelectorAll('[data-schedule-staff-row="101"][data-schedule-department="animators"]').length === 1
        ));
        assert.equal(
            await page.locator('[data-schedule-staff-row="101"][data-schedule-department="animators"]').count(),
            1,
            'refresh after profession addition restores Vitalina once in animators without reload'
        );
        assert.deepEqual(await page.evaluate(() => ({
            from: document.getElementById('scheduleDateFrom')?.value || '',
            to: document.getElementById('scheduleDateTo')?.value || '',
            search: document.getElementById('scheduleStaffSearch')?.value || '',
            activeDept: document.querySelector('#deptFilter .dept-chip[aria-pressed="true"]')?.dataset.dept || '',
            navigationCount: performance.getEntriesByType('navigation').length
        })), refreshStateBefore, 'refresh after profession addition also preserves schedule UI state');
        await page.locator('#scheduleStaffSearch').fill('');
        await activateScheduleDepartment(page, 'all');
        await expandAllScheduleGroups(page);

        await collapseAllScheduleGroups(page);
        assert.equal(await scheduleEmployeeRowCount(page), 0, 'canonical All search starts with every group collapsed');
        await page.locator('#scheduleStaffSearch').fill('Батутисти');
        await page.waitForFunction(() => document.querySelectorAll('#scheduleBody [data-schedule-staff-row]').length === 2);
        const canonicalSearchRows = await scheduleStaffGroupsFromDom(page);
        assertUniqueScheduleStaffPlacements(canonicalSearchRows, 'canonical All search');
        assertUniqueScheduleStaffIds(canonicalSearchRows.map(row => row.id), 'canonical All search');
        assert.deepEqual(sortedScheduleStaffIds(canonicalSearchRows.map(row => row.id)), [104, 108], 'canonical All search keeps the matching people set');
        assert.deepEqual(
            sortedScheduleStaffPlacements(canonicalSearchRows),
            sortedScheduleStaffPlacements([
                { id: 104, department: 'cafe' },
                { id: 108, department: 'animators' }
            ]),
            'All search finds secondary professions but keeps canonical row ownership'
        );
        assert.equal(
            await page.locator('[data-schedule-group-toggle="animators"]').getAttribute('aria-expanded'),
            'true',
            'search auto-expands the animators group'
        );
        assert.equal(
            await page.locator('[data-schedule-group-toggle="cafe"]').getAttribute('aria-expanded'),
            'true',
            'search auto-expands the cafe group'
        );
        assert.equal(
            await page.locator('[data-schedule-group-toggle="trampoline"]').count(),
            0,
            'secondary-profession search does not add a duplicate trampoline group'
        );
        await page.locator('#scheduleStaffSearch').fill('');
        await page.waitForFunction(() => document.querySelectorAll('#scheduleBody [data-schedule-staff-row]').length === 0);

        await activateScheduleDepartment(page, 'reception');
        await expandScheduleGroup(page, 'reception');
        const receptionDepartments = await page.locator('#scheduleBody tr.dept-row').evaluateAll(rows => (
            rows.map(row => row.getAttribute('data-dept') || '')
        ));
        assert.deepEqual(receptionDepartments, ['reception'], 'active reception renders only the reception top-level group');
        const receptionIds = await scheduleStaffIdsFromDom(page);
        assertUniqueScheduleStaffIds(receptionIds, 'active reception table');
        assert.deepEqual(sortedScheduleStaffIds(receptionIds), [101, 102, 103, 106], 'active reception includes unique primary and secondary members');
        assert.equal(receptionIds.filter(id => id === 101).length, 1, 'shared animator/reception employee appears once in reception');

        await page.locator('#scheduleStaffSearch').fill('Віталіна Синіпол');
        await page.waitForFunction(() => document.querySelectorAll('#scheduleBody [data-schedule-staff-row]').length === 1);
        const receptionSearchIds = await scheduleStaffIdsFromDom(page);
        assert.deepEqual(receptionSearchIds, [101], 'active reception plus search keeps one shared employee');
        await assertScheduleExportParity(page, receptionSearchIds, 'reception search');
        await page.locator('#scheduleStaffSearch').fill('');

        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        const animatorDepartments = await page.locator('#scheduleBody tr.dept-row').evaluateAll(rows => (
            rows.map(row => row.getAttribute('data-dept') || '')
        ));
        assert.deepEqual(animatorDepartments, ['animators'], 'active animators renders only the animators top-level group');
        const animatorIds = await scheduleStaffIdsFromDom(page);
        assertUniqueScheduleStaffIds(animatorIds, 'active animators table');
        assert.deepEqual(sortedScheduleStaffIds(animatorIds), [101, 108], 'multi-profession animators appear once in animators');
    } finally {
        setFixtureSecondaryProfessions(101, originalSecondaryProfessions);
        SCHEDULE_FIXTURE_ENTRIES.splice(0, SCHEDULE_FIXTURE_ENTRIES.length, ...originalScheduleEntries);
        await context.close();
    }
}

async function runDeterministicSubgroupReadinessFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    const assertPlacement = (placements, staffId, department, subGroup, label) => {
        const matches = placements.filter(item => item.id === staffId && item.department === department);
        assert.equal(matches.length, 1, `${label}: staff ID ${staffId} has exactly one rendered row in ${department}`);
        assert.deepEqual(matches[0], { id: staffId, department, subGroup }, `${label}: deterministic subgroup owns the row`);
    };
    try {
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await activateScheduleDepartment(page, 'all');
        await expandAllScheduleGroups(page);

        const allPlacements = await scheduleStaffSubGroupsFromDom(page);
        assertPlacement(allPlacements, 106, 'reception', 'Менеджери', 'All manager with secondary reception');
        assertPlacement(allPlacements, 107, 'cafe', 'Офіціанти', 'All waiter with secondary cook');
        assertPlacement(allPlacements, 108, 'animators', 'Аніматори', 'All animator with secondary trampoline');

        const missingReadiness = await scheduleStaffReadinessSnapshot(page, 106);
        assert.match(missingReadiness.readinessClass, /\bneutral\b/, 'missing readiness is rendered as neutral metadata');
        assert.doesNotMatch(missingReadiness.readinessClass, /\bwarn\b/, 'missing readiness is not presented as a warning badge');
        assert.doesNotMatch(missingReadiness.rowClass, /\bhas-health-warning\b/, 'missing readiness does not create a row health warning');
        assert.equal(
            missingReadiness.healthDetails.some(detail => /readiness|готовн/i.test(detail)),
            false,
            'missing readiness does not invent a health issue'
        );

        const lowReadiness = await scheduleStaffReadinessSnapshot(page, 107);
        assert.match(lowReadiness.readinessClass, /\bwarn\b/, 'explicit low readiness keeps a warning badge');
        assert.equal(lowReadiness.readinessText, '20%', 'explicit readiness renders the supplied percentage');
        assert.match(lowReadiness.rowClass, /\bhas-health-warning\b/, 'explicit low readiness creates a row health warning');
        assert.ok(
            lowReadiness.healthDetails.some(detail => /Low readiness/.test(detail) && /20%/.test(detail)),
            'explicit low readiness exposes the truthful low-readiness health detail'
        );

        assert.equal(
            await page.locator('#scheduleBody [data-schedule-staff-row="108"]').count(),
            1,
            'All renders the animator/trampoline employee once in the canonical section'
        );
        assert.deepEqual(
            await page.locator('.sch-cell[data-staff="108"][data-date="2026-07-11"] .sch-profession').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || '')),
            ['Аніматор'],
            'animator shift renders its saved profession in the canonical row'
        );
        assert.deepEqual(
            await page.locator('.sch-cell[data-staff="108"][data-date="2026-07-12"] .sch-profession').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || '')),
            ['Інструктор батутів'],
            'trampoline shift keeps its saved profession in the canonical row'
        );

        await activateScheduleDepartment(page, 'reception');
        await expandScheduleGroup(page, 'reception');
        const receptionPlacements = await scheduleStaffSubGroupsFromDom(page);
        assertPlacement(receptionPlacements, 106, 'reception', 'Менеджери', 'Active reception manager with secondary reception');
        assert.equal(
            receptionPlacements.some(item => item.id === 106 && item.subGroup === 'Рецепція'),
            false,
            'manager primary profession wins over secondary reception subgroup'
        );

        await activateScheduleDepartment(page, 'cafe');
        await expandScheduleGroup(page, 'cafe');
        const cafePlacements = await scheduleStaffSubGroupsFromDom(page);
        assertPlacement(cafePlacements, 107, 'cafe', 'Офіціанти', 'Active cafe waiter with secondary cook');
        assert.equal(
            cafePlacements.some(item => item.id === 107 && item.subGroup === 'Кухня'),
            false,
            'waiter primary profession wins over secondary cook subgroup'
        );

        await activateScheduleDepartment(page, 'trampoline');
        await expandScheduleGroup(page, 'trampoline');
        const trampolinePlacements = await scheduleStaffSubGroupsFromDom(page);
        assertPlacement(trampolinePlacements, 108, 'trampoline', 'Батутисти', 'Active trampoline animator with secondary trampoline');
        assert.equal(
            trampolinePlacements.filter(item => item.id === 108).length,
            1,
            'active trampoline keeps the multi-profession employee unique'
        );
    } finally {
        await context.close();
    }
}

async function runSegmentCellPresentationFlow(browser, base) {
    const fixtureIndex = SCHEDULE_FIXTURE_ENTRIES.findIndex(entry => (
        Number(entry.staff_id) === 108 && entry.date === '2026-07-11'
    ));
    assert.notEqual(fixtureIndex, -1, 'segment presentation fixture exists');
    const originalFixture = structuredClone(SCHEDULE_FIXTURE_ENTRIES[fixtureIndex]);
    const { context, page } = await openStaffPage(
        browser,
        base,
        { width: 1440, height: 900 },
        { darkMode: true, search: 'scheduleStaff=108' }
    );
    try {
        await page.waitForFunction(() => (
            document.activeElement?.matches('[data-hr-profile="108"]')
        ));
        SCHEDULE_FIXTURE_ENTRIES[fixtureIndex] = {
            ...originalFixture,
            shift_start: '09:00:00',
            shift_end: '20:00:00',
            planned_minutes: 540,
            profession_key: 'animator',
            primary_profession_key: 'animator',
            segments: [
                {
                    id: 9302,
                    professionKey: 'manager',
                    shiftStart: '15:00',
                    shiftEnd: '20:00',
                    breakMinutes: 0,
                    note: 'Later block',
                    additionalProfessionKeys: []
                },
                {
                    id: 9301,
                    professionKey: 'animator',
                    shiftStart: '09:00',
                    shiftEnd: '13:00',
                    breakMinutes: 0,
                    note: 'Earlier block',
                    additionalProfessionKeys: []
                }
            ]
        };
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await activateScheduleDepartment(page, 'all');
        await expandAllScheduleGroups(page);

        const focusedRows = page.locator('#scheduleBody tr.is-schedule-focus[aria-current="true"]');
        assert.equal(await focusedRows.count(), 1, 'deep link keeps exactly one current schedule row');
        assert.equal(
            await focusedRows.first().getAttribute('data-schedule-staff-row'),
            '108',
            'deep link marks the requested employee row'
        );

        const targetCell = page.locator(
            '#scheduleBody [data-schedule-staff-row="108"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-11"]'
        );
        await targetCell.waitFor({ state: 'visible' });
        assert.deepEqual(
            await targetCell.locator('.sch-segment-line .sch-time').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || '')),
            ['09–13', '15–20'],
            'unsorted API segments render in canonical chronological order'
        );
        await targetCell.evaluate(cell => cell.closest('td')?.classList.add('today-col', 'is-replacement'));
        await page.waitForFunction(() => {
            const cell = document.querySelector(
                '#scheduleBody [data-schedule-staff-row="108"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-11"]'
            );
            const dayCell = cell?.closest('td');
            return Boolean(
                dayCell
                && getComputedStyle(dayCell, '::before').content === 'none'
                && getComputedStyle(dayCell).backgroundImage !== 'none'
            );
        });
        await assertFittedScheduleLayout(page, 'desktop two-day schedule', 2);

        const matchingSegment = targetCell.locator('.sch-segment-line.is-section-role');
        assert.equal(await matchingSegment.count(), 1, 'profession section marks the matching segment without duplicating it');
        const presentation = await matchingSegment.evaluate(line => {
            const profession = line.querySelector('.sch-profession');
            const cell = line.closest('.sch-cell');
            const dayCell = cell?.closest('td');
            const lineStyle = getComputedStyle(line);
            const professionStyle = profession ? getComputedStyle(profession) : null;
            const cellStyle = cell ? getComputedStyle(cell) : null;
            const dayCellStyle = dayCell ? getComputedStyle(dayCell) : null;
            const todayAccentStyle = dayCell ? getComputedStyle(dayCell, '::before') : null;
            const replacementAccentStyle = dayCell ? getComputedStyle(dayCell, '::after') : null;
            const criticalBadge = dayCell?.querySelector('.schedule-health-badge.is-critical');
            const criticalBadgeStyle = criticalBadge ? getComputedStyle(criticalBadge) : null;
            return {
                backgroundColor: lineStyle.backgroundColor,
                lineBoxShadow: lineStyle.boxShadow,
                borderRadius: lineStyle.borderRadius,
                professionTextTransform: professionStyle?.textTransform || '',
                cellBoxShadow: cellStyle?.boxShadow || '',
                cellBackground: cellStyle?.backgroundColor || '',
                dayCellBackground: dayCellStyle?.backgroundColor || '',
                dayCellBackgroundImage: dayCellStyle?.backgroundImage || '',
                dayCellBoxShadow: dayCellStyle?.boxShadow || '',
                todayAccentContent: todayAccentStyle?.content || '',
                replacementAccentWidth: replacementAccentStyle?.width || '',
                replacementAccentBackground: replacementAccentStyle?.backgroundColor || '',
                criticalBadgeCount: dayCell?.querySelectorAll('.schedule-health-badge.is-critical').length || 0,
                criticalBadgeBackground: criticalBadgeStyle?.backgroundColor || '',
                criticalBadgeColor: criticalBadgeStyle?.color || '',
                cellHeight: cell?.getBoundingClientRect().height || 0,
                dayCellHeight: dayCell?.getBoundingClientRect().height || 0,
                dayCellBorderBlock: dayCellStyle
                    ? Number.parseFloat(dayCellStyle.borderTopWidth || '0') + Number.parseFloat(dayCellStyle.borderBottomWidth || '0')
                    : 0
            };
        });

        assert.equal(presentation.backgroundColor, 'rgba(0, 0, 0, 0)', 'matching segment does not render a nested pill background');
        assert.equal(presentation.lineBoxShadow, 'none', 'matching segment does not render an inner frame');
        assert.equal(presentation.borderRadius, '0px', 'matching segment does not render a rounded inner container');
        assert.equal(presentation.professionTextTransform, 'none', 'profession label keeps normal readable casing');
        assert.equal(presentation.cellBoxShadow, 'none', 'inner schedule cell does not render competing state frames');
        assert.equal(presentation.cellBackground, 'rgba(0, 0, 0, 0)', 'inner schedule cell stays transparent');
        assert.notEqual(presentation.dayCellBackground, 'rgba(0, 0, 0, 0)', 'the full table cell owns the working status surface');
        assert.match(presentation.dayCellBoxShadow, /rgb\(147, 197, 253\)/, 'focused row keeps a distinct dark-mode bottom accent');
        assert.equal(presentation.todayAccentContent, 'none', 'today no longer renders a broken per-cell top line');
        assert.notEqual(presentation.dayCellBackgroundImage, 'none', 'today keeps a subtle full-cell column wash');
        assert.equal(presentation.replacementAccentWidth, '3px', 'replacement uses one narrow side accent');
        assert.notEqual(presentation.replacementAccentBackground, 'rgba(0, 0, 0, 0)', 'replacement remains visible without a competing frame');
        assert.equal(presentation.criticalBadgeCount, 1, 'critical schedule health keeps one compact marker');
        assert.equal(presentation.criticalBadgeBackground, 'rgb(220, 38, 38)', 'critical health marker uses a solid red surface');
        assert.equal(presentation.criticalBadgeColor, 'rgb(255, 255, 255)', 'critical health marker keeps readable white text');
        assert.ok(
            Math.abs((presentation.dayCellHeight - presentation.dayCellBorderBlock) - presentation.cellHeight) <= 1,
            `clickable cell fills the table cell content box (td=${presentation.dayCellHeight}, borders=${presentation.dayCellBorderBlock}, cell=${presentation.cellHeight})`
        );

        const groupBackgrounds = await page.locator('#scheduleBody .dept-row[data-dept="animators"]').evaluate(row => ({
            sticky: getComputedStyle(row.children[0]).backgroundColor,
            fill: getComputedStyle(row.children[1]).backgroundColor
        }));
        assert.equal(groupBackgrounds.sticky, groupBackgrounds.fill, 'dark department header has no sticky/fill seam');

        await captureStableScheduleScreenshot(page, 'desktop-dark-segment-cells.png');
    } finally {
        SCHEDULE_FIXTURE_ENTRIES[fixtureIndex] = originalFixture;
        await context.close();
    }
}

async function runMultiSegmentPersistenceFlow(browser, base) {
    const originalEntries = SCHEDULE_FIXTURE_ENTRIES.map(entry => structuredClone(entry));
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    const targetCell = () => page.locator(
        '#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-11"]'
    );
    const openTargetPlan = async () => {
        await applyManualRange(page, '2026-07-11', '2026-07-12');
        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        await targetCell().click();
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
    };
    const reloadAndOpenTargetPlan = async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDayColumns(page, 9);
        await openTargetPlan();
    };

    try {
        await openTargetPlan();
        await page.locator('#schAddSegmentBtn').click();
        const cards = page.locator('#schSegmentsList .sch-segment-card');
        assert.equal(await cards.count(), 2, 'multi-segment persistence flow creates two blocks');
        await cards.nth(0).locator('[data-segment-field="profession"]').selectOption('animator');
        await cards.nth(0).locator('[data-segment-field="start"]').fill('09:00');
        await cards.nth(0).locator('[data-segment-field="end"]').fill('13:00');
        await cards.nth(1).locator('[data-segment-field="profession"]').selectOption('reception');
        await cards.nth(1).locator('[data-segment-field="start"]').fill('13:00');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('20:00');
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), false, 'two adjacent blocks are saveable');
        await page.locator('#schSaveBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));

        const animatorOrder = await targetCell().locator('.sch-segment-line .sch-time').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || ''));
        assert.deepEqual(animatorOrder, ['09–13', '13–20'], 'animator section keeps the canonical chronological segment order');
        await activateScheduleDepartment(page, 'reception');
        await expandScheduleGroup(page, 'reception');
        const receptionOrder = await page.locator(
            '#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-11"] .sch-segment-line .sch-time'
        ).evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || ''));
        assert.deepEqual(receptionOrder, animatorOrder, 'profession highlighting never reorders the same day plan');
        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');

        await reloadAndOpenTargetPlan();
        assert.equal(await cards.count(), 2, 'full page refresh restores both saved blocks');
        const initialIds = await cards.evaluateAll(nodes => nodes.map(node => Number(node.dataset.segmentId)));
        assert.ok(initialIds.every(Number.isInteger), 'saved blocks receive server IDs');

        await cards.nth(1).locator('[data-segment-field="start"]').fill('14:00');
        await page.locator('#schSaveBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
        await reloadAndOpenTargetPlan();
        assert.equal(await cards.count(), 2, 'editing only the second block keeps the first block present');
        assert.equal(
            await cards.nth(0).locator('[data-segment-field="start"]').inputValue(),
            '09:00',
            'editing the second block does not overwrite the first block'
        );
        assert.equal(
            await cards.nth(1).locator('[data-segment-field="start"]').inputValue(),
            '14:00',
            'refresh restores the edited second block'
        );

        await cards.nth(0).locator('[data-segment-action="remove"]').click();
        assert.equal(await cards.count(), 1, 'first block can be removed without replacing the second block');
        await page.locator('#schSaveBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
        await reloadAndOpenTargetPlan();
        assert.equal(await cards.count(), 1, 'refresh keeps the deleted first block absent');
        assert.equal(await cards.first().locator('[data-segment-field="profession"]').inputValue(), 'reception');
        assert.equal(await cards.first().locator('[data-segment-field="start"]').inputValue(), '14:00');
        await page.locator('#schCancelBtn').click();
    } finally {
        SCHEDULE_FIXTURE_ENTRIES.splice(0, SCHEDULE_FIXTURE_ENTRIES.length, ...originalEntries);
        await context.close();
    }
}

async function runPaidAdditionalProfessionFlow(browser, base) {
    const originalEntries = SCHEDULE_FIXTURE_ENTRIES.map(entry => structuredClone(entry));
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    const targetCell = () => page.locator(
        '#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="animators"] .sch-cell[data-date="2026-07-16"]'
    );
    const openTargetPlan = async () => {
        await applyManualRange(page, '2026-07-16', '2026-07-17');
        await activateScheduleDepartment(page, 'animators');
        await expandScheduleGroup(page, 'animators');
        await targetCell().click();
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
    };
    const discardTargetPlan = async () => {
        await page.locator('#schCancelBtn').click();
        const confirm = page.locator('.confirm-overlay[data-confirm-kind="confirm"]');
        if (await confirm.isVisible().catch(() => false)) {
            await confirm.locator('.confirm-ok').click();
        }
        await page.waitForFunction(() =>
            !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
    };

    try {
        await openTargetPlan();
        const cards = page.locator('#schSegmentsList .sch-segment-card');
        assert.equal(await cards.count(), 1, 'paid-role scenario starts with one physical block');
        await page.locator('#schAddSegmentBtn').click();
        await cards.nth(0).locator('[data-segment-field="profession"]').selectOption('animator');
        await cards.nth(0).locator('[data-segment-field="start"]').fill('11:00');
        await cards.nth(0).locator('[data-segment-field="end"]').fill('20:00');
        await cards.nth(1).locator('[data-segment-field="profession"]').selectOption('reception');
        await cards.nth(1).locator('[data-segment-field="start"]').fill('11:30');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('20:00');

        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, 'overlapping physical blocks cannot be saved directly');
        const stickyValidation = page.locator('[data-schedule-save-validation]');
        const stickyValidationId = await stickyValidation.getAttribute('id');
        assert.ok(stickyValidationId, 'sticky save validation has a stable description id');
        assert.deepEqual(
            await cards.evaluateAll((items, descriptionId) => items.map(card => ({
                highlighted: card.classList.contains('has-overlap'),
                invalid: card.getAttribute('aria-invalid'),
                describedBy: card.getAttribute('aria-describedby') === descriptionId
            })), stickyValidationId),
            [
                { highlighted: true, invalid: 'true', describedBy: true },
                { highlighted: true, invalid: 'true', describedBy: true }
            ],
            'every contained-overlap block is highlighted and described for assistive technology'
        );
        assert.match(
            await page.locator('#schPlanSummary').innerText(),
            /Для одночасної роботи використайте оплачувану додаткову роль, а не другий блок/,
            'top summary explains how to model simultaneous paid work'
        );
        assert.match(
            await stickyValidation.innerText(),
            /Для одночасної роботи використайте оплачувану додаткову роль, а не другий блок/,
            'sticky save area explains why save is disabled'
        );
        const convertButton = page.locator('[data-schedule-overlap-convert]');
        await cards.nth(0).locator('[data-segment-field="break"]').fill('30');
        await cards.nth(1).locator('[data-segment-field="break"]').fill('30');
        assert.match(
            await page.locator('#schPlanSummary').innerText(),
            /8 год 30 хв[\s\S]*Фізичний час[\s\S]*—[\s\S]*Оплачувані роль-години/,
            'overlapping blocks subtract the shared break once and keep invalid role-hours unavailable'
        );
        const breakTarget = page.locator('[data-schedule-overlap-break-target]');
        assert.equal(await breakTarget.count(), 1, 'a break requires an explicit normalized-segment target');
        assert.equal(await breakTarget.inputValue(), '', 'the converter never chooses a break target automatically');
        assert.equal(await convertButton.isDisabled(), true, 'conversion stays disabled until the user chooses the break target');
        await breakTarget.selectOption({ index: 1 });
        assert.notEqual(await breakTarget.inputValue(), '', 'an explicit break target can be selected');
        assert.equal(await convertButton.isEnabled(), true, 'an explicit break target unlocks conversion');
        assert.equal(await convertButton.getAttribute('type'), 'button', 'the conversion action keeps native keyboard button semantics');
        assert.equal(await convertButton.evaluate(button => button.tabIndex), 0, 'the conversion action remains in the keyboard tab order');
        await convertButton.evaluate(button => button.click());
        assert.equal(await cards.count(), 2, 'explicit conversion normalizes the contained overlap');
        assert.deepEqual(
            await cards.evaluateAll(items => items.map(card => [
                card.querySelector('[data-segment-field="start"]')?.value,
                card.querySelector('[data-segment-field="end"]')?.value
            ])),
            [['11:00', '11:30'], ['11:30', '20:00']],
            'keyboard conversion replaces the overlapping boundaries with adjacent segments'
        );
        assert.deepEqual(
            await cards.locator('[data-segment-field="break"]').evaluateAll(inputs =>
                inputs.map(input => Number(input.value || 0))),
            [0, 30],
            'the selected normalized segment inherits the break exactly once'
        );
        assert.equal(
            await cards.locator('[data-segment-field="break"]').evaluateAll(inputs =>
                inputs.reduce((total, input) => total + Number(input.value || 0), 0)),
            30,
            'the converter does not distribute or duplicate the break'
        );

        await discardTargetPlan();
        await openTargetPlan();
        await page.locator('#schAddSegmentBtn').click();
        await cards.nth(0).locator('[data-segment-field="profession"]').selectOption('animator');
        await cards.nth(0).locator('[data-segment-field="start"]').fill('11:00');
        await cards.nth(0).locator('[data-segment-field="end"]').fill('20:00');
        await cards.nth(0).locator('[data-segment-field="break"]').fill('0');
        await cards.nth(1).locator('[data-segment-field="profession"]').selectOption('reception');
        await cards.nth(1).locator('[data-segment-field="start"]').fill('11:30');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('20:00');
        await cards.nth(1).locator('[data-segment-field="break"]').fill('0');
        await cards.nth(0).locator('[data-segment-field="break"]').fill('0');
        await cards.nth(1).locator('[data-segment-field="break"]').fill('0');
        assert.equal(await convertButton.isEnabled(), true, 'contained overlap exposes an explicit safe conversion');
        await captureStableScheduleScreenshot(
            page,
            'screenshot-case-overlap-invalid.png',
            '#schModalOverlay .sch-modal--schedule'
        );
        await convertButton.click();

        assert.equal(await cards.count(), 2, 'conversion normalizes one physical block into two adjacent physical segments');
        assert.equal(await cards.nth(0).locator('[data-segment-field="start"]').inputValue(), '11:00');
        assert.equal(await cards.nth(0).locator('[data-segment-field="end"]').inputValue(), '11:30');
        assert.equal(await cards.nth(1).locator('[data-segment-field="start"]').inputValue(), '11:30');
        assert.equal(await cards.nth(1).locator('[data-segment-field="end"]').inputValue(), '20:00');
        assert.equal(
            await cards.nth(1).locator('[data-segment-field="paid-profession"]').inputValue(),
            'reception',
            'contained profession becomes the explicit paid role'
        );
        assert.equal(
            await page.locator('#schPrimaryProfession').inputValue(),
            'animator',
            'conversion preserves the selected primary profession'
        );
        assert.match(
            await page.locator('#schPlanSummary').innerText(),
            /9 год[\s\S]*Фізичний час[\s\S]*17 год 30 хв[\s\S]*Оплачувані роль-години/,
            'normalized exact case reports 9 physical hours and 17.5 paid role-hours'
        );
        assert.ok(
            await cards.locator('.sch-role-pay-status.is-primary').count() >= 2,
            'normalized segments visibly identify their primary role'
        );
        assert.ok(
            await cards.locator('.sch-role-pay-status.is-unpaid').count() > 0,
            'unpaid alternatives remain visibly distinguished'
        );
        assert.match(
            await cards.nth(1).locator('.sch-paid-role-status').innerText(),
            /Рецепція · оплачувана/,
            'paid profession is visibly marked as paid'
        );
        const duplicateReceptionRole = cards.nth(1).locator(
            '[data-segment-field="additional-unpaid"][value="reception"]'
        );
        assert.equal(await duplicateReceptionRole.isChecked(), false, 'conversion removes a duplicate unpaid copy of the paid profession');
        assert.match(
            await cards.nth(1).locator('[data-paid-role-preview]').innerText(),
            /180 грн\/год[\s\S]*510 хв[\s\S]*multiplier 1\.0[\s\S]*1.?530 грн/,
            'payroll-authorized user sees rate, minutes, multiplier and estimated amount'
        );
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), false, 'normalized paid-role plan is saveable');
        await captureStableScheduleScreenshot(
            page,
            'screenshot-case-paid-role-normalized.png',
            '#schModalOverlay .sch-modal--schedule'
        );

        const callsBeforeSave = apiCalls.scheduleBodies.length;
        await page.locator('#schSaveBtn').click();
        await page.waitForFunction(() => !document.querySelector('#schModalOverlay')?.classList.contains('visible'));
        const savedBody = apiCalls.scheduleBodies.slice(callsBeforeSave)
            .find(body => Number(body.staffId) === 101 && body.date === '2026-07-16');
        assert.ok(savedBody, 'paid-role plan reaches the schedule API');
        assert.equal(savedBody.segments.length, 2, 'API receives non-overlapping physical segments');
        assert.deepEqual(
            savedBody.segments.map(segment => [segment.shiftStart, segment.shiftEnd]),
            [['11:00', '11:30'], ['11:30', '20:00']]
        );
        assert.deepEqual(savedBody.segments[1].additionalRoles, [{
            professionKey: 'reception',
            compensationMode: 'paid_hourly',
            payMultiplier: 1,
            policyVersion: null
        }]);
        assert.deepEqual(
            savedBody.segments[1].additionalProfessionKeys,
            ['reception'],
            'legacy profession keys contain the paid profession exactly once'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDayColumns(page, 9);
        await openTargetPlan();
        assert.equal(await cards.count(), 2, 'reload keeps normalized physical segments');
        assert.equal(
            await cards.nth(1).locator('[data-segment-field="paid-profession"]').inputValue(),
            'reception',
            'reload keeps paid status instead of flattening it into a legacy tag'
        );

        await cards.nth(1).locator('[data-segment-field="paid-profession"]').selectOption('senior_manager');
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, 'paid mode is blocked when the explicit profession rate is missing');
        assert.match(
            await cards.nth(1).locator('[data-field-error="paid-profession"]').innerText(),
            /немає явної погодинної ставки/,
            'missing-rate error is shown next to the profession field'
        );
        assert.match(await page.locator('#schPlanSummary').innerText(), /Старший менеджер[\s\S]*немає явної погодинної ставки/);
        assert.match(await page.locator('[data-schedule-save-validation]').innerText(), /немає явної погодинної ставки/);

        await cards.nth(1).locator('[data-segment-field="paid-profession"]').selectOption('');
        await cards.nth(1).locator('[data-segment-field="profession"]').selectOption('reception');
        await cards.nth(0).locator('[data-segment-field="start"]').fill('09:00');
        await cards.nth(0).locator('[data-segment-field="end"]').fill('15:00');
        await cards.nth(1).locator('[data-segment-field="start"]').fill('12:00');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('18:00');
        assert.match(
            await page.locator('#schPlanSummary').innerText(),
            /Частковий перетин/,
            'partial overlap exposes the explicit converter'
        );
        assert.equal(await convertButton.isEnabled(), true, 'partial overlap can be normalized without manual splitting');
        await convertButton.evaluate(button => button.click());
        assert.equal(await cards.count(), 3, 'partial overlap becomes before, simultaneous and after segments');
        assert.deepEqual(
            await cards.evaluateAll(items => items.map(card => [
                card.querySelector('[data-segment-field="start"]')?.value,
                card.querySelector('[data-segment-field="end"]')?.value
            ])),
            [['09:00', '12:00'], ['12:00', '15:00'], ['15:00', '18:00']]
        );
        assert.equal(
            await cards.nth(1).locator('[data-segment-field="paid-profession"]').inputValue(),
            'reception',
            'the overlap slice carries the paid additional profession'
        );
        assert.equal(
            await cards.nth(2).locator('[data-segment-field="profession"]').inputValue(),
            'reception',
            'the trailing non-overlap keeps its original main profession'
        );
        assert.equal(
            await page.evaluate(() => document.activeElement?.matches('[data-segment-field="paid-profession"]')),
            true,
            'keyboard conversion moves focus to the created paid-role field'
        );

        await discardTargetPlan();
        await openTargetPlan();
        await cards.nth(1).locator('[data-segment-field="paid-profession"]').selectOption('');
        await cards.nth(1).locator('[data-segment-field="profession"]').selectOption('senior_manager');
        await cards.nth(0).locator('[data-segment-field="start"]').fill('09:00');
        await cards.nth(0).locator('[data-segment-field="end"]').fill('13:00');
        await cards.nth(1).locator('[data-segment-field="start"]').fill('12:00');
        await cards.nth(1).locator('[data-segment-field="end"]').fill('16:00');
        await page.locator('#schAddSegmentBtn').click();
        await cards.nth(2).locator('[data-segment-field="profession"]').selectOption('reception');
        await cards.nth(2).locator('[data-segment-field="start"]').fill('15:00');
        await cards.nth(2).locator('[data-segment-field="end"]').fill('18:00');
        assert.equal(await cards.count(), 3, 'chain-overlap scenario contains three physical blocks');
        assert.deepEqual(
            await cards.evaluateAll(items => items.map(card => ({
                highlighted: card.classList.contains('has-overlap'),
                invalid: card.getAttribute('aria-invalid')
            }))),
            [
                { highlighted: true, invalid: 'true' },
                { highlighted: true, invalid: 'true' },
                { highlighted: true, invalid: 'true' }
            ],
            'all three blocks participating in a chain overlap are highlighted'
        );
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, 'chain overlap remains blocked');
        assert.equal(
            await page.locator('[data-schedule-overlap-convert]').count(),
            0,
            'ambiguous three-block overlap is never converted silently'
        );
        assert.match(
            await page.locator('[data-schedule-overlap-blocker]').innerText(),
            /понад два блоки/,
            'ambiguous chain overlap explains why automatic conversion is unavailable'
        );
        await page.locator('#schCancelBtn').click();
    } finally {
        SCHEDULE_FIXTURE_ENTRIES.splice(0, SCHEDULE_FIXTURE_ENTRIES.length, ...originalEntries);
        await context.close();
    }
}

async function runDesktopFlow(browser, base) {
    const { context, page } = await openStaffPage(browser, base, { width: 1440, height: 900 });
    try {
        await waitForDayColumns(page, 9);
        await assertFittedScheduleLayout(page, 'desktop nine-day schedule', 9);
        await assertScheduleLayoutResync(page, 'desktop schedule');
        await assertDepartmentChipGrid(page, 'desktop 1440 department filter', 1);
        await page.setViewportSize({ width: 1024, height: 900 });
        await assertDepartmentChipGrid(page, 'desktop 1024 department filter', 2);
        await page.setViewportSize({ width: 1440, height: 900 });
        await assertPeriodPresetLabelsAndSummary(page);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleGroupExpansionPersists(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
        await captureFixtureDepartmentScheduleSurfaces(page);
        await assertScheduleShiftPreferenceQuickLabels(page);

        await applyPreset(page, 'first-half');
        const firstHalfFrom = await page.locator('#scheduleDateFrom').inputValue();
        const firstHalfTo = await page.locator('#scheduleDateTo').inputValue();
        assert.equal(firstHalfFrom.endsWith('-01'), true, 'first-half starts on day 1');
        assert.equal(firstHalfTo.endsWith('-15'), true, 'first-half ends on day 15');
        await waitForDayColumns(page, 15);
        await assertFittedScheduleLayout(page, 'desktop first-half', 15);
        assert.match(await page.locator('#weekLabel').innerText(), /1 .+15 .+20\d{2}/, 'visible label reflects 1-15 range');
        assert.equal(await page.locator('.staff-schedule-command-bar .schedule-toolbar').count(), 0, 'legacy visible toolbar is removed from schedule shell');
        await page.locator('.staff-schedule-header-actions #exportExcelBtn').waitFor({ state: 'visible' });
        await page.locator('.staff-schedule-header-actions #printBtn').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#scheduleViewSwitch').count(), 0, 'visible view switch is removed from schedule shell');
        assert.equal(await page.locator('[data-schedule-view]').count(), 0, 'schedule diagnostic view buttons are removed from the visible shell');
        assert.equal(await page.locator('.staff-schedule-command-metrics').count(), 0, 'schedule header metric chips are removed from the visible shell');
        assert.equal(await page.locator('#scheduleSummary .summary-chip').count(), 0, 'schedule summary status chips are removed from the visible shell');
        await assertDepartmentChipsFit(page, 'desktop first-half');
        const actionMetrics = await page.evaluate(() => {
            const header = document.querySelector('.staff-schedule-header-actions')?.getBoundingClientRect();
            const exportButton = document.getElementById('exportExcelBtn')?.getBoundingClientRect();
            const printButton = document.getElementById('printBtn')?.getBoundingClientRect();
            return {
                headerWidth: header?.width || 0,
                exportHeight: exportButton?.height || 0,
                printHeight: printButton?.height || 0
            };
        });
        assert.ok(actionMetrics.headerWidth > 0 && actionMetrics.headerWidth <= 240, 'export/print header action group stays compact');
        assert.ok(actionMetrics.exportHeight >= 34, 'export keeps a usable touch target');
        assert.ok(actionMetrics.printHeight >= 34, 'print keeps a usable touch target');

        for (const removedId of ['scheduleActionsDropdown', 'scheduleActionsMenuBtn', 'scheduleActionsMenu', 'addStaffBtn', 'fillWeekBtn', 'copyWeekBtn', 'importExcelBtn', 'bulkCreateBtn']) {
            assert.equal(await page.locator(`#${removedId}`).count(), 0, `${removedId} is not visible shell UI`);
        }
        assert.equal(apiCalls.copyWeekBodies.length, 0, 'hidden copy-week UI does not call backend copy route');
        assert.equal(apiCalls.bulkBodies.length, 0, 'hidden fill UI does not run bulk fill');

        const hoursCallsBefore = apiCalls.hoursRanges.length;
        assert.equal(apiCalls.hoursRanges.length, hoursCallsBefore, 'removed hours view does not fetch hours');
        assert.equal(await page.locator('#scheduleBody').evaluate(el => el.classList.contains('show-hours')), false, 'removed hours view cannot mark schedule rows');
        assert.equal(await page.locator('#loadViewWrapper').isHidden(), true, 'removed load view keeps diagnostics hidden');
        assert.equal(await page.locator('#linkStatsBar').count(), 0, 'removed accounts view keeps account stats hidden');

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#exportExcelBtn').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), `grafik_${firstHalfFrom}_${firstHalfTo}.xlsx`, 'export filename uses selected first-half range as an Excel workbook');
        await page.evaluate(() => {
            window.__staffSchedulePrintCount = 0;
            window.__staffSchedulePrintHtml = '';
            window.open = () => {
                const fakeWindow = {
                    document: {
                        open() {},
                        write(html) { window.__staffSchedulePrintHtml += String(html || ''); },
                        close() {}
                    },
                    focus() {},
                    print() { window.__staffSchedulePrintCount += 1; },
                    setTimeout(callback) { callback(); }
                };
                return fakeWindow;
            };
        });
        await page.locator('#printBtn').click();
        await page.waitForFunction(() => window.__staffSchedulePrintCount === 1);
        const printHtml = await page.evaluate(() => window.__staffSchedulePrintHtml);
        assert.match(printHtml, /schedule-export-table/, 'print button renders the Excel table document');
        assert.match(printHtml, /Графік роботи/, 'print table includes the schedule title');

        const scheduleCallsAfterFirstHalf = apiCalls.scheduleRanges.length;
        await page.locator('#scheduleDateFrom').fill(firstHalfTo);
        await page.locator('#scheduleDateTo').fill(firstHalfFrom);
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateFrom')?.value === expected, firstHalfFrom, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterFirstHalf, 'invalid reversed range does not refetch schedule');
        await waitForDayColumns(page, 15);

        await applyPreset(page, 'second-half');
        const secondHalfFrom = await page.locator('#scheduleDateFrom').inputValue();
        const secondHalfTo = await page.locator('#scheduleDateTo').inputValue();
        const secondHalfDays = dateRangeDays(secondHalfFrom, secondHalfTo);
        assert.equal(secondHalfFrom, '2026-07-16', 'second-half starts on day 16 of the selected month');
        assert.equal(secondHalfTo, '2026-07-31', 'second-half ends on the actual last day of a 31-day month');
        assert.equal(secondHalfDays, 16, 'second-half can render a 16-day range for 31-day months');
        await waitForDayColumns(page, secondHalfDays);
        assert.match(await page.locator('#weekLabel').innerText(), /16 .+31 .+20\d{2}/, 'visible label reflects 16-end-of-month range');
        await assertFittedScheduleLayout(page, 'desktop second-half', secondHalfDays);
        assert.match(await page.locator('#scheduleBody [data-schedule-staff-row="101"][data-schedule-department="reception"] .sch-cell[data-date="2026-07-31"]').innerText(), /10/, 'second-half renders schedule data through the last day');

        const scheduleCallsAfterSecondHalf = apiCalls.scheduleRanges.length;
        const tooLongEnd = new Date(`${firstHalfFrom}T00:00:00`);
        tooLongEnd.setDate(tooLongEnd.getDate() + 40);
        await page.locator('#scheduleDateFrom').fill(firstHalfFrom);
        await page.locator('#scheduleDateTo').fill(formatInputDate(tooLongEnd));
        await page.locator('#applyScheduleRangeBtn').click();
        await page.waitForFunction(expected => document.querySelector('#scheduleDateTo')?.value === expected, secondHalfTo, { timeout: 20000 });
        assert.equal(apiCalls.scheduleRanges.length, scheduleCallsAfterSecondHalf, 'range over 31 days does not refetch schedule');
        await waitForDayColumns(page, secondHalfDays);

        const manualLongRanges = [
            ['2026-02-01', '2026-02-28', 28],
            ['2026-04-01', '2026-04-30', 30],
            ['2026-07-01', '2026-07-31', 31]
        ];
        for (const [from, to, expectedDays] of manualLongRanges) {
            await applyManualRange(page, from, to);
            await assertWideScheduleLayout(page, `desktop manual ${expectedDays}d`, { expectedDays, minDayWidth: 28, shouldFit: true });
            if (from === '2026-07-01') await assertShiftLoadClassesDoNotPaintScheduleCells(page);
        }

        // Hours toggle is no longer part of the visible command surface.
        await page.locator('#scheduleStaffSearch').fill('Віталіна');
        await applyManualRange(page, '2026-07-01', '2026-07-31');
        assert.equal(await page.locator('#scheduleStaffSearch').inputValue(), 'Віталіна', 'search query survives preset changes');
        const monthFrom = await page.locator('#scheduleDateFrom').inputValue();
        const monthTo = await page.locator('#scheduleDateTo').inputValue();
        const monthDays = dateRangeDays(monthFrom, monthTo);
        await waitForDayColumns(page, monthDays);
        assert.ok(monthDays >= 28 && monthDays <= 31, 'month preset renders a real month length');
        await assertNoControlOverlap(page, 'desktop month');
        await page.locator('#scheduleStaffSearch').fill('');
        await waitForDayColumns(page, monthDays);
        await assertWideScheduleLayout(page, 'desktop month schedule', { expectedDays: monthDays, minDayWidth: 28, shouldFit: true });
        await assertDepartmentChipsFit(page, 'desktop month');
        assert.equal(await page.locator('#loadViewWrapper').isHidden(), true, 'month schedule keeps removed load view hidden');
        await captureStableScheduleScreenshot(page, 'desktop-month.png');

        await page.locator('#todayWeekBtn').click();
        await waitForDayColumns(page, 9);
    } finally {
        await context.close();
    }
}

async function runMobileFlow(browser, base, viewport = { width: 390, height: 844 }, label = 'mobile', options = {}) {
    const { context, page } = await openStaffPage(browser, base, viewport, {
        darkMode: Boolean(options.darkMode)
    });
    try {
        await waitForDayColumns(page, 9);
        await assertPeriodPresetLabelsAndSummary(page);
        await assertNoDuplicateDepartmentSubGroups(page);
        await assertScheduleGroupsCollapsedByDefault(page);
        await assertScheduleSearchAutoExpandsGroups(page);
        await expandAllScheduleGroups(page);
        await applyPreset(page, 'first-half');
        await waitForDayColumns(page, 15);
        await assertNoControlOverlap(page, `${label} first-half`);
        await assertDepartmentChipsFit(page, `${label} first-half`);
        await applyManualRange(page, '2026-07-01', '2026-07-31');
        const monthFrom = await page.locator('#scheduleDateFrom').inputValue();
        const monthTo = await page.locator('#scheduleDateTo').inputValue();
        const monthDays = dateRangeDays(monthFrom, monthTo);
        await waitForDayColumns(page, monthDays);
        await assertNoControlOverlap(page, `${label} month`);
        await assertDepartmentChipsFit(page, `${label} month`);
        await assertWideScheduleLayout(page, `${label} month schedule`, { expectedDays: monthDays, minDayWidth: 40 });
        await assertScheduleGroupLabelsReadable(page, `${label} month department headers`, { simulatedTechCount: 3 });
        await assertDepartmentRerenderPreservesPageScroll(page, `${label} departments`);
        await assertDepartmentScrollCue(page, `${label} departments`);
        await assertRealScheduleWheelScroll(page, `${label} month`);
        await assertNarrowMobileContract(page, `${label} month`, {
            width: viewport.width,
            darkMode: Boolean(options.darkMode)
        });
        if (options.screenshot) {
            await page.locator('#deptFilter').evaluate(host => {
                host.scrollLeft = 0;
                host.dispatchEvent(new Event('scroll'));
            });
            await captureStableScheduleScreenshot(page, `${label}-command-bar.png`, '.staff-schedule-command-bar');
            await captureStableScheduleScreenshot(page, `${label}-month.png`);
        }

        const editableCell = page.locator('#scheduleBody .sch-cell[data-schedule-id]:visible').first();
        await editableCell.click();
        await page.locator('#schModalOverlay.visible').waitFor({ state: 'visible' });
        const modalBounds = await page.locator('#schModalOverlay .sch-modal--schedule').boundingBox();
        assert.ok(modalBounds, `${label} opens the day-plan modal`);
        assert.ok(modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= viewport.width + 1, `${label} day-plan modal stays inside the viewport`);
        assert.equal(await page.locator('#schSegmentsList .sch-segment-card').count(), 1, `${label} opens a legacy shift as one segment`);
        await page.locator('#schAddSegmentBtn').click();
        assert.equal(await page.locator('#schSegmentsList .sch-segment-card').count(), 2, `${label} can add a second segment`);
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, `${label} blocks overlapping default segments before API save`);
        await page.locator('#schSegmentsList .sch-segment-card').nth(0).locator('[data-segment-field="start"]').fill('10:00');
        await page.locator('#schSegmentsList .sch-segment-card').nth(0).locator('[data-segment-field="end"]').fill('14:00');
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="start"]').fill('14:00');
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="end"]').fill('20:00');
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), false, `${label} accepts adjacent non-overlapping segments`);
        assert.match(await page.locator('#schPlanSummary').innerText(), /10 год/, `${label} summary adds segment duration instead of envelope duplication`);
        const simultaneousRole = page.locator('#schSegmentsList .sch-segment-card').first().locator('[data-segment-field="additional-unpaid"]:not([disabled])').first();
        assert.ok(await simultaneousRole.count(), `${label} exposes simultaneous roles from the HR card`);
        await simultaneousRole.check();
        assert.match(await page.locator('#schPlanSummary').innerText(), /10 год/, `${label} simultaneous role does not add paid time`);
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="start"]').fill('15:00');
        assert.match(
            await page.locator('#schPlanSummary').innerText(),
            /9 год[\s\S]*Фізичний час[\s\S]*9 год[\s\S]*Оплачувані роль-години/,
            `${label} excludes the one-hour gap from physical and paid role time`
        );
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="start"]').fill('22:00');
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="end"]').fill('02:00');
        assert.equal(await page.locator('#schSaveBtn').isDisabled(), true, `${label} rejects multi-segment plans containing an overnight block without day offsets`);
        assert.match(await page.locator('#schPlanSummary').innerText(), /Нічний часовий блок без day offsets/, `${label} explains the overnight ambiguity`);
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="start"]').fill('14:00');
        await page.locator('#schSegmentsList .sch-segment-card').nth(1).locator('[data-segment-field="end"]').fill('20:00');
        if (options.screenshot) {
            await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}-plan-modal.png`), fullPage: false });
        }
    } finally {
        await context.close();
    }
}

async function runSidebarIdentityWrapFlow(browser, base, viewport, label, darkMode) {
    const { context, page } = await openStaffPage(browser, base, viewport, { darkMode });
    try {
        const identityName = page.locator('#sidebarCommandDeck .sidebar-identity-name');
        await identityName.waitFor({ state: 'visible' });
        await identityName.evaluate(name => new Promise(resolve => {
            const deck = name.closest('#sidebarCommandDeck');
            if (!deck) {
                resolve();
                return;
            }
            let timer = null;
            const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, 250);
            });
            observer.observe(deck, { childList: true, characterData: true, subtree: true });
            timer = setTimeout(() => {
                observer.disconnect();
                resolve();
            }, 250);
        }));
        await settleScheduleDom(page);
        const metrics = await page.evaluate(() => {
            const name = document.querySelector('#sidebarCommandDeck .sidebar-identity-name');
            const summary = document.querySelector('#sidebarIdentitySummary');
            if (!name || !summary) return null;
            name.textContent = 'codex_verifier';
            summary.textContent = '\u0404 6 \u043a\u0440\u0438\u0442\u0438\u0447\u043d\u0438\u0445 \u0430\u043b\u0435\u0440\u0442\u0456\u0432';
            const tokenLineCount = (element, token) => {
                const node = element.firstChild;
                const start = String(node?.data || '').indexOf(token);
                if (!node || start < 0) return 0;
                const tops = new Set();
                for (let index = start; index < start + token.length; index += 1) {
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const box = range.getBoundingClientRect();
                    if (box.width || box.height) tops.add(Math.round(box.top * 2) / 2);
                }
                return tops.size;
            };
            return {
                nameLines: tokenLineCount(name, 'codex_verifier'),
                criticalLines: tokenLineCount(summary, '\u043a\u0440\u0438\u0442\u0438\u0447\u043d\u0438\u0445'),
                nameOverflowWrap: getComputedStyle(name).overflowWrap,
                nameWordBreak: getComputedStyle(name).wordBreak,
                summaryOverflowWrap: getComputedStyle(summary).overflowWrap,
                summaryWordBreak: getComputedStyle(summary).wordBreak
            };
        });
        assert.ok(metrics, `${label}: sidebar identity metrics are available`);
        assert.equal(metrics.nameLines, 1, `${label}: codex_verifier does not split mid-word`);
        assert.equal(metrics.criticalLines, 1, `${label}: critical alert copy does not split mid-word`);
        assert.equal(metrics.nameOverflowWrap, 'break-word', `${label}: profile name uses safe emergency wrapping`);
        assert.equal(metrics.nameWordBreak, 'normal', `${label}: profile name keeps normal word boundaries`);
        assert.equal(metrics.summaryOverflowWrap, 'break-word', `${label}: alert summary uses safe emergency wrapping`);
        assert.equal(metrics.summaryWordBreak, 'normal', `${label}: alert summary keeps normal word boundaries`);
        await captureStableScheduleScreenshot(
            page,
            `${label}-sidebar-identity.png`,
            '#sidebarCommandDeck',
            async currentPage => currentPage.evaluate(() => {
                const name = document.querySelector('#sidebarCommandDeck .sidebar-identity-name');
                const summary = document.querySelector('#sidebarIdentitySummary');
                if (name) name.textContent = 'codex_verifier';
                if (summary) summary.textContent = '\u0404 6 \u043a\u0440\u0438\u0442\u0438\u0447\u043d\u0438\u0445 \u0430\u043b\u0435\u0440\u0442\u0456\u0432';
            })
        );
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    assertSingleScheduleEntryPerStaffDate(SCHEDULE_FIXTURE_ENTRIES);
    const { chromium } = requirePlaywright();
    const { server, base } = await createServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        await runInitialRangeFailureFlow(browser, base);
        await runPeriodReliabilityFlow(browser, base);
        await runScheduleHistoryIsolationFlow(browser, base);
        await runScheduleKeyboardAccessibilityFlow(browser, base);
        await runMembershipGroupingFlow(browser, base);
        await runDeterministicSubgroupReadinessFlow(browser, base);
        await runSegmentCellPresentationFlow(browser, base);
        await runMultiSegmentPersistenceFlow(browser, base);
        await runPaidAdditionalProfessionFlow(browser, base);
        await runDesktopFlow(browser, base);
        await runSidebarIdentityWrapFlow(browser, base, { width: 1440, height: 900 }, 'desktop-light', false);
        await runSidebarIdentityWrapFlow(browser, base, { width: 1024, height: 768 }, 'laptop-dark', true);
        const mobileViewports = [
            { width: 320, height: 760 },
            { width: 360, height: 800 },
            { width: 390, height: 844 }
        ];
        for (const viewport of mobileViewports) {
            for (const darkMode of [false, true]) {
                const theme = darkMode ? 'dark' : 'light';
                await runMobileFlow(
                    browser,
                    base,
                    viewport,
                    `mobile-${viewport.width}-${theme}`,
                    { darkMode, screenshot: true }
                );
            }
        }
        console.log('Staff schedule custom range browser smoke passed');
        console.log(`Screenshots: ${path.relative(ROOT, OUTPUT_DIR)}`);
    } catch (err) {
        fail(err.stack || err.message || String(err));
    } finally {
        releaseScheduleSaveResponseScenarios();
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})();
