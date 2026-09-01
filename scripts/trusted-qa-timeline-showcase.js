#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pool } = require('../db');
const {
    checkRoomConflict,
    checkServerConflicts,
    checkServerDuplicate,
    getAnimatorTimelineLines,
    TAKEAWAY_ROOM_ID,
    TAKEAWAY_ROOM_LABEL,
    timeToMinutes
} = require('../services/booking');
const {
    cleanupTrustedQaRun,
    createTrustedQaRun,
    markTrustedQaRunCleanupPending,
    sha256
} = require('../services/trustedQaRuns');

const APPLY_CONFIRMATION = 'CREATE_EXACT_TIMELINE_SHOWCASE';
const CLEANUP_CONFIRMATION = 'CLEANUP_EXACT_TIMELINE_SHOWCASE';
const SHOWCASE_SOURCE = 'trusted_timeline_showcase';
const SHOWCASE_ENDPOINT = 'POST /api/bookings';
const STATE_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const MAX_FIXTURES = 60;
const MAX_FIXTURE_DURATION = 8 * 60;
const MAX_HTTP_READ_RETRIES = 3;
const HTTP_TIMEOUT_MS = 30_000;
const PREPARE_FROM = '12:00';
const PREPARE_TO = '20:00';
const PREPARE_LINE_NAMES = Object.freeze([
    'Аніматор 1',
    'Аніматор 2',
    'Аніматор 3',
    'Аніматор 4',
    'Аніматор 5'
]);
const OPERATOR_ROLES = new Set(['creator', 'director', 'senior_manager']);
const FIXTURE_STATUSES = new Set(['confirmed', 'preliminary']);
const SAFE_PINATA_MODES = new Set(['none', 'park', 'client']);
const DEFAULT_SECRET_FILE = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
const REPOSITORY_ROOT = path.resolve(__dirname, '..');

class TimelineShowcaseError extends Error {
    constructor(message, code = 'TIMELINE_SHOWCASE_FAILED', details = {}) {
        super(message);
        this.name = 'TimelineShowcaseError';
        this.code = code;
        this.details = details;
    }
}

function fail(condition, message, code, details) {
    if (!condition) throw new TimelineShowcaseError(message, code, details);
}

function argValue(args, name, fallback = null) {
    const exact = args.find(value => String(value).startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] && !String(args[index + 1]).startsWith('--')
        ? args[index + 1]
        : fallback;
}

function cleanText(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

function cleanId(value, max = 120) {
    return cleanText(value, max);
}

function integer(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function dateOnly(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        const year = String(value.getFullYear()).padStart(4, '0');
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

function timeOnly(value) {
    const match = String(value || '').trim().match(/^(\d{2}:\d{2})/);
    return match ? match[1] : '';
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
    }, {});
}

function manifestHash(manifest) {
    return crypto.createHash('sha256').update(JSON.stringify(stableValue(manifest))).digest('hex');
}

function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(String(value || ''));
    } catch {
        throw new TimelineShowcaseError('Showcase liveUrl is invalid', 'SHOWCASE_LIVE_URL_INVALID');
    }
    fail(parsed.protocol === 'https:', 'Showcase liveUrl must use HTTPS', 'SHOWCASE_LIVE_URL_NOT_HTTPS');
    fail(parsed.username === '' && parsed.password === '', 'Showcase liveUrl must not contain credentials', 'SHOWCASE_LIVE_URL_HAS_CREDENTIALS');
    return parsed.origin;
}

function validIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
    return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function requestIdForFixture(runId, index, fixture) {
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(stableValue({
        index,
        key: fixture.key,
        programId: fixture.programId,
        lineId: fixture.lineId,
        lineName: fixture.lineName,
        secondAnimatorLineId: fixture.secondAnimatorLineId || null,
        roomResourceId: fixture.roomResourceId,
        date: fixture.date,
        time: fixture.time,
        duration: fixture.duration
    }))).digest('hex').slice(0, 16);
    return `${runId}:${String(index + 1).padStart(2, '0')}:${fingerprint}`.slice(0, 160);
}

function fixtureSource(raw = {}) {
    const booking = raw.booking && typeof raw.booking === 'object' && !Array.isArray(raw.booking)
        ? raw.booking
        : {};
    const payload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
        ? raw.payload
        : {};
    return { ...booking, ...payload, ...raw };
}

function optionalBoundedText(source, key, max) {
    if (source[key] === undefined || source[key] === null) return undefined;
    const value = String(source[key]).trim();
    fail(value.length <= max, `${key} exceeds the showcase bound`, 'SHOWCASE_FIXTURE_TEXT_OUT_OF_BOUNDS', { key });
    return value || undefined;
}

function optionalBoundedInteger(source, key, min, max) {
    if (source[key] === undefined || source[key] === null || source[key] === '') return undefined;
    const value = integer(source[key]);
    fail(value !== null && value >= min && value <= max, `${key} is outside the showcase bound`, 'SHOWCASE_FIXTURE_NUMBER_OUT_OF_BOUNDS', { key });
    return value;
}

function normalizeBookingOverrides(source) {
    const overrides = {};
    for (const [key, max] of [
        ['programCode', 20],
        ['programName', 100],
        ['label', 100],
        ['category', 50],
        ['pinataNumber', 80]
    ]) {
        const value = optionalBoundedText(source, key, max);
        if (value !== undefined) overrides[key] = value;
    }
    for (const [key, min, max] of [
        ['hosts', 0, 10]
    ]) {
        const value = optionalBoundedInteger(source, key, min, max);
        if (value !== undefined) overrides[key] = value;
    }
    if (source.pinataMode !== undefined && source.pinataMode !== null && source.pinataMode !== '') {
        const value = cleanText(source.pinataMode, 30).toLowerCase();
        fail(SAFE_PINATA_MODES.has(value), 'pinataMode is unsupported', 'SHOWCASE_FIXTURE_PINATA_MODE_INVALID');
        overrides.pinataMode = value;
    }
    for (const field of ['programCode', 'programName', 'label', 'category', 'hosts', 'pinataMode']) {
        fail(overrides[field] !== undefined,
            `Exact showcase fixture requires ${field}`, 'SHOWCASE_FIXTURE_DISPLAY_SNAPSHOT_INCOMPLETE', { field });
    }
    return overrides;
}

function normalizeFixture(raw, index, defaults) {
    fail(raw && typeof raw === 'object' && !Array.isArray(raw), 'Each showcase fixture must be an object', 'SHOWCASE_FIXTURE_INVALID', { index });
    const source = fixtureSource(raw);
    const key = cleanId(source.key || source.fixtureKey || source.fixture_id || source.slotId || `fixture-${index + 1}`, 80);
    const programId = cleanId(source.programId || source.program_id || source.productId || source.product_id);
    const productId = cleanId(source.productId || source.product_id || programId);
    const lineId = cleanId(source.lineId || source.line_id || source.resourceId || source.resource_id);
    const lineName = cleanText(source.lineName || source.line_name, 100);
    const secondAnimatorLineId = cleanId(source.secondAnimatorLineId || source.second_animator_line_id) || null;
    const roomResourceId = cleanId(
        source.roomResourceId
        || source.room_resource_id
        || defaults.roomResourceId
    );
    const room = cleanText(source.room || defaults.room, 100);
    const secondAnimator = cleanText(source.secondAnimator || source.second_animator, 100) || null;
    const date = dateOnly(source.date || defaults.date);
    const time = timeOnly(source.time || source.startTime || source.start_time);
    const duration = integer(source.duration);
    const status = cleanText(source.status || 'confirmed', 30).toLowerCase();
    fail(Boolean(key) && Boolean(programId) && Boolean(productId) && Boolean(lineId) && Boolean(lineName) && Boolean(roomResourceId) && Boolean(room),
        'Showcase fixture is missing exact key/product/line/room identity', 'SHOWCASE_FIXTURE_IDENTITY_INCOMPLETE', { index });
    fail(programId === productId, 'programId and productId must identify the same product', 'SHOWCASE_FIXTURE_PRODUCT_MISMATCH', { key });
    fail(validIsoDate(date) && validTime(time), 'Showcase fixture has invalid date/time', 'SHOWCASE_FIXTURE_TIME_INVALID', { key });
    fail(duration !== null && duration >= 1 && duration <= MAX_FIXTURE_DURATION,
        'Showcase fixture duration is outside the bounded range', 'SHOWCASE_FIXTURE_DURATION_INVALID', { key });
    fail(FIXTURE_STATUSES.has(status), 'Showcase fixture status is unsupported', 'SHOWCASE_FIXTURE_STATUS_INVALID', { key });
    fail(!secondAnimatorLineId || secondAnimatorLineId !== lineId,
        'Second animator line must differ from the primary line', 'SHOWCASE_FIXTURE_SECOND_LINE_INVALID', { key });
    fail(PREPARE_LINE_NAMES.includes(lineName)
        && (!secondAnimator || PREPARE_LINE_NAMES.includes(secondAnimator)),
    'Showcase animator display snapshots must be exact approved names',
    'SHOWCASE_FIXTURE_LINE_NAME_INVALID', { key });
    fail(secondAnimatorLineId ? Boolean(secondAnimator) : !secondAnimator,
        'secondAnimator display name must be present exactly when secondAnimatorLineId is present',
        'SHOWCASE_FIXTURE_SECOND_ANIMATOR_SNAPSHOT_INVALID', { key });

    const fixture = {
        key,
        requestId: cleanText(source.requestId || source.request_id, 160),
        programId,
        productId,
        lineId,
        lineName,
        secondAnimatorLineId,
        secondAnimator,
        roomResourceId,
        room,
        date,
        time,
        duration,
        status,
        booking: normalizeBookingOverrides(source)
    };
    fail(fixture.secondAnimatorLineId ? fixture.booking.hosts === 2 : fixture.booking.hosts === 1,
        'Showcase topology requires exactly two hosts with a second animator and one host otherwise',
        'SHOWCASE_FIXTURE_HOST_TOPOLOGY_INVALID', { key });
    fail(fixture.booking.pinataMode !== 'none' || fixture.booking.pinataNumber === undefined,
        'pinataNumber is incompatible with pinataMode=none', 'SHOWCASE_FIXTURE_PINATA_NUMBER_INVALID', { key });
    if (!fixture.requestId) fixture.requestId = requestIdForFixture(defaults.runId, index, fixture);
    fail(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(fixture.requestId),
        'Showcase requestId must be 8-160 safe characters', 'SHOWCASE_FIXTURE_REQUEST_ID_INVALID', { key });
    return fixture;
}

function exactFixtureEnvelope(fixture) {
    const exact = {
        requestId: fixture.requestId,
        programId: fixture.programId,
        productId: fixture.productId,
        lineId: fixture.lineId,
        roomResourceId: fixture.roomResourceId,
        room: fixture.room,
        date: fixture.date,
        time: fixture.time,
        duration: fixture.duration,
        status: fixture.status,
        programCode: fixture.booking.programCode,
        programName: fixture.booking.programName,
        label: fixture.booking.label,
        category: fixture.booking.category,
        hosts: fixture.booking.hosts,
        pinataMode: fixture.booking.pinataMode
    };
    if (fixture.secondAnimatorLineId) {
        exact.secondAnimatorLineId = fixture.secondAnimatorLineId;
        exact.secondAnimator = fixture.secondAnimator;
    }
    if (fixture.booking.pinataNumber !== undefined) exact.pinataNumber = fixture.booking.pinataNumber;
    return exact;
}

function intervalOverlap(left, right) {
    const leftStart = timeToMinutes(left.time);
    const rightStart = timeToMinutes(right.time);
    return leftStart < rightStart + right.duration && leftStart + left.duration > rightStart;
}

function fixtureLineIds(fixture) {
    return [fixture.lineId, fixture.secondAnimatorLineId].filter(Boolean);
}

function assertInternalFixtureCollisions(fixtures, productById = {}) {
    for (let leftIndex = 0; leftIndex < fixtures.length; leftIndex += 1) {
        const left = fixtures[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < fixtures.length; rightIndex += 1) {
            const right = fixtures[rightIndex];
            if (left.date !== right.date || !intervalOverlap(left, right)) continue;
            const sharedLines = fixtureLineIds(left).filter(value => fixtureLineIds(right).includes(value));
            fail(sharedLines.length === 0, 'Showcase fixtures collide on an animator line', 'SHOWCASE_FIXTURE_LINE_COLLISION', {
                fixtures: [left.key, right.key],
                lineId: sharedLines[0]
            });
            const physicalRoom = left.roomResourceId !== TAKEAWAY_ROOM_ID && right.roomResourceId !== TAKEAWAY_ROOM_ID;
            fail(!(physicalRoom && left.roomResourceId === right.roomResourceId),
                'Showcase fixtures collide on a physical room', 'SHOWCASE_FIXTURE_ROOM_COLLISION', {
                    fixtures: [left.key, right.key],
                    roomResourceId: left.roomResourceId
                });
            const category = cleanText(productById[left.productId]?.category || left.booking.category, 80).toLowerCase();
            const duplicateBlocks = left.productId === right.productId
                && left.productId !== 'custom'
                && !['animation', 'custom'].includes(category);
            fail(!duplicateBlocks, 'Showcase fixtures trigger the booking product duplicate guard', 'SHOWCASE_FIXTURE_PRODUCT_COLLISION', {
                fixtures: [left.key, right.key],
                productId: left.productId
            });
        }
    }
}

function assertUniqueFixtureFields(fixtures) {
    for (const [field, code] of [
        ['key', 'SHOWCASE_FIXTURE_KEY_DUPLICATE'],
        ['requestId', 'SHOWCASE_FIXTURE_REQUEST_ID_DUPLICATE']
    ]) {
        const values = fixtures.map(fixture => fixture[field]);
        fail(new Set(values).size === values.length, `Showcase fixture ${field} values must be unique`, code);
    }
}

function normalizeManifest(parsed) {
    fail(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Showcase manifest must be an object', 'SHOWCASE_MANIFEST_INVALID');
    const runId = cleanId(parsed.runId || parsed.run_id, 100);
    const timeWindow = parsed.timeWindow || parsed.time_window || {};
    const date = dateOnly(parsed.date || timeWindow.date);
    const from = timeOnly(timeWindow.from || parsed.from);
    const to = timeOnly(timeWindow.to || parsed.to);
    const carrier = parsed.carrierResource || parsed.carrier_resource || parsed.takeawayResource || {};
    const resourcePolicy = cleanText(
        parsed.resourcePolicy
        || parsed.roomPolicy
        || (parsed.allowPhysicalRooms === true ? 'explicit_rooms' : 'takeaway_only'),
        40
    ).toLowerCase();
    fail(resourcePolicy === 'takeaway_only',
        'This showcase runner permits only the takeaway carrier resource', 'SHOWCASE_RESOURCE_POLICY_INVALID');
    const defaultRoomResourceId = cleanId(
        carrier.resourceId
        || carrier.resource_id
        || parsed.roomResourceId
        || parsed.room_resource_id
        || TAKEAWAY_ROOM_ID
    );
    const defaultRoom = cleanText(
        carrier.name || parsed.room || (defaultRoomResourceId === TAKEAWAY_ROOM_ID ? TAKEAWAY_ROOM_LABEL : ''),
        100
    );
    const rawFixtures = parsed.bookingFixtures || parsed.booking_fixtures || parsed.bookings || parsed.fixtures;
    fail(Array.isArray(rawFixtures) && rawFixtures.length >= 1 && rawFixtures.length <= MAX_FIXTURES,
        `Showcase requires 1-${MAX_FIXTURES} exact booking fixtures`, 'SHOWCASE_FIXTURE_COUNT_INVALID');
    fail(Boolean(runId) && /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(runId),
        'Showcase runId must be 8-100 safe characters', 'SHOWCASE_RUN_ID_INVALID');
    fail(validIsoDate(date) && validTime(from) && validTime(to) && timeToMinutes(from) < timeToMinutes(to),
        'Showcase timeWindow is invalid', 'SHOWCASE_TIME_WINDOW_INVALID');

    const fixtures = rawFixtures.map((fixture, index) => normalizeFixture(fixture, index, {
        runId,
        date,
        roomResourceId: defaultRoomResourceId,
        room: defaultRoom
    }));
    assertUniqueFixtureFields(fixtures);
    for (const fixture of fixtures) {
        const start = timeToMinutes(fixture.time);
        fail(fixture.date === date && start >= timeToMinutes(from) && start + fixture.duration <= timeToMinutes(to),
            'Showcase fixture is outside the exact manifest date/window', 'SHOWCASE_FIXTURE_OUTSIDE_WINDOW', { key: fixture.key });
        if (resourcePolicy === 'takeaway_only') {
            fail(fixture.roomResourceId === TAKEAWAY_ROOM_ID,
                'Animator-only showcase must use the takeaway carrier resource', 'SHOWCASE_TAKEAWAY_REQUIRED', { key: fixture.key });
            fail(fixture.room === TAKEAWAY_ROOM_LABEL,
                'Animator-only showcase must use the canonical takeaway room label',
                'SHOWCASE_TAKEAWAY_ROOM_LABEL_INVALID', { key: fixture.key });
        }
    }
    fail(new Set(fixtures.map(fixture => fixture.roomResourceId)).size === 1,
        'Showcase must use one exact carrier resource', 'SHOWCASE_CARRIER_RESOURCE_NOT_SINGLE');
    assertInternalFixtureCollisions(fixtures);

    const expectedEntityCount = fixtures.length + fixtures.filter(fixture => fixture.secondAnimatorLineId).length;
    const defaultMaxEntities = expectedEntityCount;
    const maxEntityCount = integer(parsed.maxEntityCount ?? parsed.max_entity_count ?? defaultMaxEntities);
    fail(maxEntityCount === expectedEntityCount,
    'Showcase maxEntityCount must equal the exact booking graph', 'SHOWCASE_ENTITY_BOUND_INVALID', {
        expectedEntityCount,
        maxEntityCount
    });
    const ttlMinutes = integer(parsed.ttlMinutes ?? parsed.ttl_minutes ?? 60);
    fail(ttlMinutes !== null && ttlMinutes >= 5 && ttlMinutes <= 240,
        'Showcase ttlMinutes must be 5-240', 'SHOWCASE_TTL_INVALID');
    const testAccountId = integer(parsed.testAccountId ?? parsed.test_account_id);
    const operatorUserId = integer(parsed.operatorUserId ?? parsed.operator_user_id ?? testAccountId);
    const customerId = integer(parsed.customerId ?? parsed.customer_id);
    fail(testAccountId > 0 && operatorUserId > 0 && customerId > 0 && operatorUserId === testAccountId,
        'Showcase exact test/operator/customer IDs are invalid', 'SHOWCASE_ACCOUNT_BOUNDARY_INVALID');

    const allowedEndpoints = [...new Set((parsed.allowedEndpoints || parsed.allowed_endpoints || [SHOWCASE_ENDPOINT]).map(String))].sort();
    fail(allowedEndpoints.length === 1 && allowedEndpoints[0] === SHOWCASE_ENDPOINT,
        'Showcase runner permits only POST /api/bookings', 'SHOWCASE_ENDPOINT_BOUNDARY_INVALID');
    const sourceCommit = String(parsed.sourceCommit || parsed.source_commit || '').trim().toLowerCase();
    const sourceBranch = String(parsed.sourceBranch || parsed.source_branch || '').trim();
    fail(/^[a-f0-9]{40}$/.test(sourceCommit)
        && sourceBranch.length >= 1
        && sourceBranch.length <= 200
        && !/[\u0000-\u001f\u007f]/.test(sourceBranch),
        'Showcase source commit/branch proof is required', 'SHOWCASE_RELEASE_PROOF_INVALID');
    const businessContext = cleanText(parsed.businessContext || parsed.business_context || 'event_genix', 80);
    fail(businessContext === 'event_genix', 'Timeline showcase runner is limited to event_genix', 'SHOWCASE_CONTEXT_INVALID');

    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        sourceCommit,
        sourceBranch,
        liveUrl: normalizeBaseUrl(parsed.liveUrl || parsed.live_url),
        runId,
        businessContext,
        testAccountId,
        operatorUserId,
        customerId,
        timeWindow: { date, from, to },
        ttlMinutes,
        maxEntityCount,
        expectedEntityCount,
        resourcePolicy,
        carrierResource: {
            selector: resourcePolicy === 'takeaway_only' ? 'takeaway' : 'explicit',
            resourceId: defaultRoomResourceId,
            name: defaultRoom || null
        },
        allowedEndpoints,
        expectedEntityTypes: ['booking'],
        bookingFixtures: fixtures,
        cleanupPolicy: 'exact_registered_entities_v1'
    };
}

function normalizePreparationFixture(raw, index) {
    fail(raw && typeof raw === 'object' && !Array.isArray(raw),
        'Each preparation blueprint fixture must be an object', 'SHOWCASE_PREPARE_FIXTURE_INVALID', { index });
    const source = fixtureSource(raw);
    for (const field of [
        'requestId', 'request_id', 'lineId', 'line_id', 'secondAnimatorLineId',
        'second_animator_line_id', 'roomResourceId', 'room_resource_id', 'programCode',
        'programName', 'label', 'category', 'extraData', 'extra_data'
    ]) {
        fail(source[field] === undefined,
            `Preparation blueprint must not provide derived field ${field}`,
            'SHOWCASE_PREPARE_DERIVED_FIELD_FORBIDDEN', { index, field });
    }
    const key = cleanId(source.key || source.fixtureKey || source.slotId || `fixture-${index + 1}`, 80);
    const programId = cleanId(source.productId || source.product_id || source.programId || source.program_id);
    const alternateProgramId = cleanId(source.programId || source.program_id);
    const lineName = cleanText(
        source.lineName || source.line_name || source.animatorName || source.animator_name || source.animator,
        100
    );
    const secondAnimatorLineName = cleanText(
        source.secondAnimatorLineName
        || source.second_animator_line_name
        || source.secondAnimatorName
        || source.second_animator_name
        || source.secondAnimator,
        100
    ) || null;
    const time = timeOnly(source.time || source.startTime || source.start_time);
    const duration = source.duration === undefined || source.duration === null || source.duration === ''
        ? null
        : integer(source.duration);
    const hosts = source.hosts === undefined || source.hosts === null || source.hosts === ''
        ? null
        : integer(source.hosts);
    const status = cleanText(source.status || 'confirmed', 30).toLowerCase();
    const pinataMode = cleanText(source.pinataMode || source.pinata_mode || 'none', 20).toLowerCase();
    const pinataNumber = optionalBoundedText({ pinataNumber: source.pinataNumber ?? source.pinata_number }, 'pinataNumber', 80);

    fail(Boolean(key) && Boolean(programId) && Boolean(lineName),
        'Preparation fixture requires key, exact productId, and exact lineName',
        'SHOWCASE_PREPARE_FIXTURE_IDENTITY_INCOMPLETE', { index });
    fail(!alternateProgramId || alternateProgramId === programId,
        'Preparation productId/programId aliases disagree', 'SHOWCASE_PREPARE_PRODUCT_ALIAS_MISMATCH', { key });
    fail(PREPARE_LINE_NAMES.includes(lineName)
        && (!secondAnimatorLineName || PREPARE_LINE_NAMES.includes(secondAnimatorLineName)),
    'Preparation line names must be exact approved animator display names',
    'SHOWCASE_PREPARE_LINE_NAME_INVALID', { key });
    fail(!secondAnimatorLineName || secondAnimatorLineName !== lineName,
        'Preparation second animator must differ from primary animator',
        'SHOWCASE_PREPARE_SECOND_LINE_INVALID', { key });
    fail(validTime(time), 'Preparation fixture time is invalid', 'SHOWCASE_PREPARE_TIME_INVALID', { key });
    fail(duration === null || (duration >= 1 && duration <= MAX_FIXTURE_DURATION),
        'Preparation duration assertion is invalid', 'SHOWCASE_PREPARE_DURATION_INVALID', { key });
    fail(hosts === null || (hosts >= 0 && hosts <= 10),
        'Preparation hosts assertion is invalid', 'SHOWCASE_PREPARE_HOSTS_INVALID', { key });
    fail(FIXTURE_STATUSES.has(status), 'Preparation fixture status is unsupported',
        'SHOWCASE_PREPARE_STATUS_INVALID', { key });
    fail(SAFE_PINATA_MODES.has(pinataMode), 'Preparation pinataMode is unsupported',
        'SHOWCASE_PREPARE_PINATA_MODE_INVALID', { key });
    fail(pinataMode !== 'none' || pinataNumber === undefined,
        'Preparation pinataNumber is incompatible with pinataMode=none',
        'SHOWCASE_PREPARE_PINATA_NUMBER_INVALID', { key });

    return {
        key,
        productId: programId,
        lineName,
        secondAnimatorLineName,
        time,
        duration,
        hosts,
        status,
        pinataMode,
        ...(pinataNumber !== undefined ? { pinataNumber } : {})
    };
}

function normalizePreparationBlueprint(parsed) {
    fail(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
        'Preparation blueprint must be an object', 'SHOWCASE_PREPARE_BLUEPRINT_INVALID');
    for (const field of ['sourceCommit', 'source_commit', 'sourceBranch', 'source_branch', 'operatorUserId', 'operator_user_id']) {
        fail(parsed[field] === undefined,
            `Preparation blueprint must not provide live-derived field ${field}`,
            'SHOWCASE_PREPARE_DERIVED_FIELD_FORBIDDEN', { field });
    }
    const runId = cleanId(parsed.runId || parsed.run_id, 100);
    const timeWindow = parsed.timeWindow || parsed.time_window || {};
    const hasExplicitDate = Object.prototype.hasOwnProperty.call(parsed, 'date');
    const hasWindowDate = Object.prototype.hasOwnProperty.call(timeWindow, 'date');
    const explicitDateText = String(parsed.date ?? '').trim();
    const windowDateText = String(timeWindow.date ?? '').trim();
    const explicitDate = dateOnly(parsed.date);
    const windowDate = dateOnly(timeWindow.date);
    const date = explicitDate || windowDate;
    const from = timeOnly(timeWindow.from || parsed.from || PREPARE_FROM);
    const to = timeOnly(timeWindow.to || parsed.to || PREPARE_TO);
    const businessContext = cleanText(parsed.businessContext || parsed.business_context || 'event_genix', 80);
    const rawFixtures = parsed.bookingBlueprints
        || parsed.booking_blueprints
        || parsed.bookingFixtures
        || parsed.booking_fixtures
        || parsed.bookings
        || parsed.fixtures;
    fail(Boolean(runId) && /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(runId),
        'Preparation runId must be 8-100 safe characters', 'SHOWCASE_PREPARE_RUN_ID_INVALID');
    fail((!hasExplicitDate || validIsoDate(explicitDateText))
        && (!hasWindowDate || validIsoDate(windowDateText))
        && validIsoDate(date)
        && (!explicitDate || !windowDate || explicitDate === windowDate)
        && from === PREPARE_FROM
        && to === PREPARE_TO,
        `Preparation requires an exact date bounded to ${PREPARE_FROM}-${PREPARE_TO}`,
        'SHOWCASE_PREPARE_WINDOW_INVALID');
    fail(businessContext === 'event_genix',
        'Preparation is limited to event_genix', 'SHOWCASE_PREPARE_CONTEXT_INVALID');
    fail(Array.isArray(rawFixtures) && rawFixtures.length >= 1 && rawFixtures.length <= MAX_FIXTURES,
        `Preparation requires 1-${MAX_FIXTURES} blueprint fixtures`,
        'SHOWCASE_PREPARE_FIXTURE_COUNT_INVALID');

    const bookingBlueprints = rawFixtures.map(normalizePreparationFixture);
    for (const fixture of bookingBlueprints) {
        fail(PREPARE_LINE_NAMES.includes(fixture.lineName)
            && (!fixture.secondAnimatorLineName || PREPARE_LINE_NAMES.includes(fixture.secondAnimatorLineName)),
        'Preparation animator names exceed the trusted animator allowlist',
        'SHOWCASE_PREPARE_LINE_PROFILE_INVALID', { key: fixture.key, date });
    }
    const keys = bookingBlueprints.map(fixture => fixture.key);
    fail(new Set(keys).size === keys.length,
        'Preparation fixture keys must be unique', 'SHOWCASE_PREPARE_FIXTURE_KEY_DUPLICATE');
    const testAccountId = integer(parsed.testAccountId ?? parsed.test_account_id);
    const customerId = integer(parsed.customerId ?? parsed.customer_id);
    fail(testAccountId > 0,
        'Preparation requires an explicit exact Creator testAccountId',
        'SHOWCASE_PREPARE_TEST_ACCOUNT_ID_REQUIRED');
    fail(customerId === 219,
        'Preparation is bound to the explicit approved QA customerId 219',
        'SHOWCASE_PREPARE_CUSTOMER_ID_INVALID');
    const ttlMinutes = integer(parsed.ttlMinutes ?? parsed.ttl_minutes ?? 60);
    fail(ttlMinutes !== null && ttlMinutes >= 5 && ttlMinutes <= 240,
        'Preparation ttlMinutes must be 5-240', 'SHOWCASE_PREPARE_TTL_INVALID');
    const maxEntityCount = parsed.maxEntityCount === undefined && parsed.max_entity_count === undefined
        ? null
        : integer(parsed.maxEntityCount ?? parsed.max_entity_count);

    return {
        liveUrl: normalizeBaseUrl(parsed.liveUrl || parsed.live_url),
        runId,
        businessContext,
        date,
        timeWindow: { date, from, to },
        testAccountId,
        customerId,
        ttlMinutes,
        maxEntityCount,
        bookingBlueprints
    };
}

function readPreparationBlueprint(filePath) {
    fail(Boolean(filePath), '--blueprint-file is required for prepare mode',
        'SHOWCASE_PREPARE_BLUEPRINT_FILE_REQUIRED');
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    } catch (error) {
        throw new TimelineShowcaseError('Unable to read preparation blueprint JSON',
            'SHOWCASE_PREPARE_BLUEPRINT_READ_FAILED', { reason: error?.code || 'invalid_json' });
    }
    return normalizePreparationBlueprint(parsed);
}

function readManifest(filePath) {
    fail(Boolean(filePath), '--manifest-file is required', 'SHOWCASE_MANIFEST_FILE_REQUIRED');
    const resolved = path.resolve(filePath);
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
        throw new TimelineShowcaseError('Unable to read showcase manifest JSON', 'SHOWCASE_MANIFEST_READ_FAILED', {
            reason: error?.code || 'invalid_json'
        });
    }
    return normalizeManifest(parsed);
}

function pathIsInside(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertOperatorFilePath(filePath, label, { mustExist = false } = {}) {
    fail(path.isAbsolute(String(filePath || '')), `${label} must be an absolute path`, 'SHOWCASE_OPERATOR_PATH_NOT_ABSOLUTE', { label });
    const resolved = path.resolve(filePath);
    fail(!pathIsInside(REPOSITORY_ROOT, resolved), `${label} must stay outside the repository`, 'SHOWCASE_OPERATOR_PATH_IN_REPOSITORY', { label });
    fail(fs.existsSync(path.dirname(resolved)), `${label} parent directory does not exist`, 'SHOWCASE_OPERATOR_PATH_PARENT_MISSING', { label });
    if (mustExist) fail(fs.existsSync(resolved), `${label} does not exist`, 'SHOWCASE_OPERATOR_FILE_MISSING', { label });
    return resolved;
}

function gitOutput(args) {
    try {
        return childProcess.execFileSync('git', args, {
            cwd: REPOSITORY_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch {
        throw new TimelineShowcaseError('Unable to prove the local Git checkout',
            'SHOWCASE_LOCAL_CHECKOUT_UNVERIFIED');
    }
}

function assertCheckoutFacts({ commit, branch, dirty }, manifest) {
    fail(commit === manifest.sourceCommit && branch === manifest.sourceBranch,
        'Local checkout identity differs from the live-approved manifest',
        'SHOWCASE_LOCAL_CHECKOUT_IDENTITY_MISMATCH', { commitMatches: commit === manifest.sourceCommit, branchMatches: branch === manifest.sourceBranch });
    fail(dirty === '',
        'Local checkout must be completely clean before Trusted QA database mutation',
        'SHOWCASE_LOCAL_CHECKOUT_DIRTY', { dirtyEntryCount: dirty ? dirty.split(/\r?\n/).length : 0 });
    return { commit, branch, clean: true };
}

function assertLocalCheckoutProof(manifest) {
    return assertCheckoutFacts({
        commit: gitOutput(['rev-parse', 'HEAD']).toLowerCase(),
        branch: gitOutput(['branch', '--show-current']),
        dirty: gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])
    }, manifest);
}

function writeJsonAtomic(filePath, value) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
}

function writeJsonAtomicExclusive(filePath, value) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        fs.linkSync(temporary, filePath);
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new TimelineShowcaseError('Preparation output file already exists',
                'SHOWCASE_PREPARE_OUTPUT_EXISTS');
        }
        throw error;
    } finally {
        try { fs.unlinkSync(temporary); } catch {}
    }
}

function readState(filePath, manifest) {
    if (!fs.existsSync(filePath)) return null;
    let state;
    try {
        state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw new TimelineShowcaseError('Showcase recovery state is unreadable', 'SHOWCASE_STATE_READ_FAILED');
    }
    fail(state?.schemaVersion === STATE_SCHEMA_VERSION
        && state.runId === manifest.runId
        && state.manifestHash === manifestHash(manifest)
        && state.liveUrl === manifest.liveUrl,
    'Showcase recovery state does not match the approved manifest', 'SHOWCASE_STATE_MANIFEST_MISMATCH');
    fail(!Object.prototype.hasOwnProperty.call(state, 'token') && !Object.prototype.hasOwnProperty.call(state, 'qaToken'),
        'Showcase state must never contain the QA token', 'SHOWCASE_STATE_CONTAINS_SECRET');
    return state;
}

function initialState(manifest, hash, tokenFile) {
    return {
        schemaVersion: STATE_SCHEMA_VERSION,
        runId: manifest.runId,
        manifestHash: hash,
        liveUrl: manifest.liveUrl,
        businessContext: manifest.businessContext,
        date: manifest.timeWindow.date,
        tokenFile,
        tokenHash: null,
        runDatabaseId: null,
        expiresAt: null,
        phase: 'preflight_pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fixtures: manifest.bookingFixtures.map(fixture => ({
            key: fixture.key,
            requestId: fixture.requestId,
            status: 'pending',
            bookingIds: [],
            primaryBookingId: null,
            lastErrorCode: null
        })),
        cleanup: null
    };
}

function persistState(filePath, state) {
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(filePath, state);
}

function parseSecretAssignments(source) {
    const values = Object.create(null);
    const pattern = /^\s*\$env:(LIVE_SMOKE_URL|LIVE_SMOKE_USER|LIVE_SMOKE_PASS|LIVE_CREATOR_USER|LIVE_CREATOR_PASS)\s*=\s*(['"])(.*?)\2\s*$/gm;
    for (const match of String(source || '').matchAll(pattern)) values[match[1]] = match[3];
    return values;
}

function loadCredentials(secretFile = DEFAULT_SECRET_FILE) {
    fail(fs.existsSync(secretFile), 'EventGenix QA secret file is unavailable', 'SHOWCASE_SECRET_FILE_MISSING');
    const values = parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'));
    fail(Boolean(values.LIVE_SMOKE_URL
        && ((values.LIVE_CREATOR_USER && values.LIVE_CREATOR_PASS)
            || (values.LIVE_SMOKE_USER && values.LIVE_SMOKE_PASS))),
        'EventGenix QA secret assignments are incomplete', 'SHOWCASE_SECRET_ASSIGNMENTS_MISSING');
    return values;
}

function scopedRoute(route, manifest, query = {}) {
    const url = new URL(route, manifest.liveUrl);
    url.searchParams.set('businessContext', manifest.businessContext);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return `${url.pathname}${url.search}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(base, route, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const attempts = method === 'GET' ? MAX_HTTP_READ_RETRIES : 1;
    const headers = {
        Accept: 'application/json',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.qaToken ? { 'X-QA-Run-Token': options.qaToken } : {}),
        ...(options.requestId ? {
            'X-QA-Run-Request-Id': options.requestId,
            'Idempotency-Key': options.requestId,
            'X-Request-ID': options.requestId
        } : {})
    };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
        try {
            const response = await fetch(`${base}${route}`, {
                method,
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal
            });
            let body = null;
            try { body = await response.json(); } catch {}
            if (!response.ok) {
                throw new TimelineShowcaseError('Live showcase API request failed', 'SHOWCASE_HTTP_FAILED', {
                    method,
                    path: new URL(`${base}${route}`).pathname,
                    status: response.status,
                    responseCode: cleanText(body?.code, 100) || null
                });
            }
            fail(body && typeof body === 'object', 'Live showcase API returned invalid JSON', 'SHOWCASE_HTTP_JSON_INVALID', {
                method,
                path: new URL(`${base}${route}`).pathname
            });
            return body;
        } catch (error) {
            if (error instanceof TimelineShowcaseError) throw error;
            if (attempt + 1 >= attempts) {
                throw new TimelineShowcaseError('Live showcase network request failed', 'SHOWCASE_NETWORK_FAILED', {
                    method,
                    path: new URL(`${base}${route}`).pathname,
                    reason: error?.name === 'AbortError' ? 'timeout' : 'transport'
                });
            }
            await sleep(300 * (attempt + 1));
        } finally {
            clearTimeout(timer);
        }
    }
    throw new TimelineShowcaseError('Live showcase request exhausted retries', 'SHOWCASE_NETWORK_RETRIES_EXHAUSTED');
}

function accessTokenFromLogin(payload) {
    const token = payload?.accessToken || payload?.token;
    fail(typeof token === 'string' && token.length > 20, 'QA login did not return an access token', 'SHOWCASE_LOGIN_TOKEN_MISSING');
    return token;
}

async function authenticate(manifest, options = {}) {
    if (options.accessToken) {
        const verify = await fetchJson(manifest.liveUrl, '/api/auth/verify', { accessToken: options.accessToken });
        const user = verify.user || verify.data?.user;
        fail(Number(user?.id) === manifest.testAccountId, 'Authenticated QA account does not match manifest', 'SHOWCASE_TEST_ACCOUNT_MISMATCH');
        return { accessToken: options.accessToken, user };
    }
    const credentials = loadCredentials(options.secretFile || DEFAULT_SECRET_FILE);
    const profile = cleanText(options.credentialProfile || 'creator', 20).toLowerCase();
    fail(['creator', 'smoke'].includes(profile), 'Unsupported QA credential profile', 'SHOWCASE_CREDENTIAL_PROFILE_INVALID');
    const username = profile === 'creator' ? credentials.LIVE_CREATOR_USER : credentials.LIVE_SMOKE_USER;
    const password = profile === 'creator' ? credentials.LIVE_CREATOR_PASS : credentials.LIVE_SMOKE_PASS;
    fail(Boolean(username && password), `QA ${profile} credential profile is unavailable`, 'SHOWCASE_CREDENTIAL_PROFILE_MISSING');
    fail(normalizeBaseUrl(credentials.LIVE_SMOKE_URL) === manifest.liveUrl,
        'QA credentials target does not match manifest liveUrl', 'SHOWCASE_CREDENTIAL_TARGET_MISMATCH');
    const login = await fetchJson(manifest.liveUrl, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const accessToken = accessTokenFromLogin(login);
    const verify = await fetchJson(manifest.liveUrl, '/api/auth/verify', { accessToken });
    const user = verify.user || verify.data?.user;
    fail(Number(user?.id) === manifest.testAccountId, 'Authenticated QA account does not match manifest', 'SHOWCASE_TEST_ACCOUNT_MISMATCH');
    return { accessToken, user };
}

async function authenticatePreparation(blueprint, options = {}) {
    let accessToken = options.accessToken || null;
    if (!accessToken) {
        const credentials = loadCredentials(options.secretFile || DEFAULT_SECRET_FILE);
        fail(normalizeBaseUrl(credentials.LIVE_SMOKE_URL) === blueprint.liveUrl,
            'QA credentials target does not match blueprint liveUrl',
            'SHOWCASE_CREDENTIAL_TARGET_MISMATCH');
        fail(Boolean(credentials.LIVE_CREATOR_USER && credentials.LIVE_CREATOR_PASS),
            'Creator QA credential profile is unavailable',
            'SHOWCASE_CREDENTIAL_PROFILE_MISSING');
        const login = await fetchJson(blueprint.liveUrl, '/api/auth/login', {
            method: 'POST',
            body: {
                username: credentials.LIVE_CREATOR_USER,
                password: credentials.LIVE_CREATOR_PASS
            }
        });
        accessToken = accessTokenFromLogin(login);
    }
    const verify = await fetchJson(blueprint.liveUrl, '/api/auth/verify', { accessToken });
    const user = verify.user || verify.data?.user;
    fail(integer(user?.id) === blueprint.testAccountId
        && cleanText(user?.role, 80).toLowerCase() === 'creator',
        'Preparation requires the authenticated active Creator test account',
        'SHOWCASE_PREPARE_CREATOR_REQUIRED');
    return { accessToken, user };
}

function exactDisplayName(row = {}) {
    return cleanText(row.name || row.displayName || row.display_name, 100);
}

async function readPreparationCatalog(blueprint, session) {
    const requiredLineNames = [...new Set(blueprint.bookingBlueprints.flatMap(item => [
        item.lineName,
        item.secondAnimatorLineName
    ].filter(Boolean)))];
    const [version, animatorLines, productsPayload] = await Promise.all([
        fetchJson(blueprint.liveUrl, '/api/version'),
        fetchJson(
            blueprint.liveUrl,
            scopedRoute(`/api/lines/${encodeURIComponent(blueprint.date)}`, blueprint, { timelineView: 'animators' }),
            { accessToken: session.accessToken }
        ),
        fetchJson(
            blueprint.liveUrl,
            scopedRoute('/api/products', blueprint, { active: 'true' }),
            { accessToken: session.accessToken }
        )
    ]);
    const release = releaseIdentity(version);
    fail(/^[a-f0-9]{40}$/.test(release.commit) && Boolean(release.branch),
        'Live /api/version did not provide exact commit/branch proof',
        'SHOWCASE_PREPARE_RELEASE_PROOF_INVALID');
    fail(Array.isArray(animatorLines),
        'Preparation animator line catalog is invalid', 'SHOWCASE_PREPARE_LINES_INVALID');
    const lineByName = {};
    for (const name of requiredLineNames) {
        const matches = animatorLines.filter(line => exactDisplayName(line) === name);
        fail(matches.length === 1,
            matches.length ? 'Preparation animator display name is ambiguous' : 'Preparation animator display name is missing',
            matches.length ? 'SHOWCASE_PREPARE_LINE_AMBIGUOUS' : 'SHOWCASE_PREPARE_LINE_MISSING',
            { lineName: name, matchCount: matches.length });
        const line = matches[0];
        fail(Boolean(lineIdentity(line)) && line.assignmentAllowed !== false && line.isUnavailable !== true,
            'Preparation animator line is unavailable', 'SHOWCASE_PREPARE_LINE_UNAVAILABLE', { lineName: name });
        lineByName[name] = line;
    }
    fail(new Set(Object.values(lineByName).map(lineIdentity)).size === requiredLineNames.length,
        'Preparation animator display names do not resolve to distinct line IDs',
        'SHOWCASE_PREPARE_LINE_ID_COLLISION');

    const products = Array.isArray(productsPayload) ? productsPayload : (productsPayload?.products || []);
    fail(Array.isArray(products),
        'Preparation product catalog is invalid', 'SHOWCASE_PREPARE_PRODUCTS_INVALID');
    const productById = {};
    for (const productId of new Set(blueprint.bookingBlueprints.map(fixture => fixture.productId))) {
        const matches = products.filter(product => productIdentity(product) === productId);
        fail(matches.length === 1,
            matches.length ? 'Preparation product ID is ambiguous' : 'Preparation product ID is missing',
            matches.length ? 'SHOWCASE_PREPARE_PRODUCT_AMBIGUOUS' : 'SHOWCASE_PREPARE_PRODUCT_MISSING',
            { productId, matchCount: matches.length });
        const product = matches[0];
        fail(product.isActive !== false && product.is_active !== false,
            'Preparation product is inactive', 'SHOWCASE_PREPARE_PRODUCT_INACTIVE', { productId });
        productById[productId] = product;
    }
    return { release, lineByName, productById };
}

function resolveExactQaCustomerId(rows, explicitCustomerId = null) {
    const candidates = Array.isArray(rows) ? rows : [];
    if (explicitCustomerId) {
        fail(candidates.length === 1 && Number(candidates[0].id) === Number(explicitCustomerId),
            'Explicit customer is not a strong QA candidate',
            'SHOWCASE_PREPARE_CUSTOMER_UNAVAILABLE');
        return Number(explicitCustomerId);
    }
    fail(candidates.length !== 0,
        'No strong QA customer candidate exists', 'SHOWCASE_PREPARE_CUSTOMER_MISSING');
    fail(candidates.length === 1,
        'Strong QA customer candidate is ambiguous',
        'SHOWCASE_PREPARE_CUSTOMER_AMBIGUOUS', { candidateCount: candidates.length });
    return Number(candidates[0].id);
}

async function resolvePreparationCustomer(blueprint, session) {
    const userId = integer(session.user?.id);
    fail(userId === blueprint.testAccountId,
        'Authenticated Creator ID differs from the exact blueprint testAccountId',
        'SHOWCASE_PREPARE_CREATOR_REQUIRED');
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const user = await client.query(
            `SELECT id, role, COALESCE(is_active, true) AS is_active
               FROM users WHERE id = $1`,
            [userId]
        );
        const userRow = user.rows?.[0];
        fail(Boolean(userRow) && userRow.is_active === true && cleanText(userRow.role, 80).toLowerCase() === 'creator',
            'Authenticated Creator test account is unavailable in database',
            'SHOWCASE_PREPARE_CREATOR_REQUIRED');
        const customers = await client.query(
            `SELECT id FROM customers
              WHERE id = $1
                AND COALESCE(business_context, 'event_genix') = $2
                AND (LOWER(COALESCE(notes, '')) LIKE '%codex%qa%'
                  OR LOWER(BTRIM(COALESCE(source, ''))) IN ('codex_qa', 'trusted_qa'))`,
            [blueprint.customerId, blueprint.businessContext]
        );
        const customerId = resolveExactQaCustomerId(customers.rows, blueprint.customerId);
        await client.query('ROLLBACK');
        return { testAccountId: blueprint.testAccountId, customerId };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function requiredProductText(product, key, value, max, productId) {
    const text = cleanText(value, max + 1);
    fail(Boolean(text) && text.length <= max,
        `Live product ${key} is missing or exceeds its exact fixture bound`,
        'SHOWCASE_PREPARE_PRODUCT_SNAPSHOT_INVALID', { productId, field: key });
    return text;
}

function compilePreparedManifest(blueprint, catalog, identity) {
    fail(integer(identity?.testAccountId) > 0 && integer(identity?.customerId) > 0,
        'Preparation identity resolution is incomplete', 'SHOWCASE_PREPARE_IDENTITY_INCOMPLETE');
    fail(identity.testAccountId === blueprint.testAccountId && identity.customerId === blueprint.customerId,
        'Preparation resolved identity differs from the explicit blueprint boundary',
        'SHOWCASE_PREPARE_IDENTITY_MISMATCH');
    const bookingFixtures = blueprint.bookingBlueprints.map(item => {
        const product = catalog.productById[item.productId];
        fail(Boolean(product), 'Preparation product was not resolved',
            'SHOWCASE_PREPARE_PRODUCT_MISSING', { productId: item.productId });
        const line = catalog.lineByName[item.lineName];
        const secondLine = item.secondAnimatorLineName
            ? catalog.lineByName[item.secondAnimatorLineName]
            : null;
        fail(Boolean(line) && (!item.secondAnimatorLineName || Boolean(secondLine)),
            'Preparation animator line was not resolved',
            'SHOWCASE_PREPARE_LINE_MISSING', { key: item.key });
        const duration = integer(product.duration);
        const hosts = integer(product.hosts);
        fail(duration !== null && duration >= 1 && duration <= MAX_FIXTURE_DURATION,
            'Live product duration is outside the showcase bound',
            'SHOWCASE_PREPARE_PRODUCT_DURATION_INVALID', { productId: item.productId });
        fail(hosts === 1 || hosts === 2,
            'Live product hosts must be exactly one or two for this showcase',
            'SHOWCASE_PREPARE_PRODUCT_HOSTS_INVALID', { productId: item.productId });
        fail(item.duration === null || item.duration === duration,
            'Blueprint duration assertion differs from the live product',
            'SHOWCASE_PREPARE_PRODUCT_DURATION_MISMATCH', { key: item.key });
        fail(item.hosts === null || item.hosts === hosts,
            'Blueprint hosts assertion differs from the live product',
            'SHOWCASE_PREPARE_PRODUCT_HOSTS_MISMATCH', { key: item.key });
        fail(secondLine ? hosts === 2 : hosts === 1,
            'Blueprint animator topology differs from the live product hosts',
            'SHOWCASE_PREPARE_PRODUCT_TOPOLOGY_MISMATCH', { key: item.key });

        return {
            key: item.key,
            productId: item.productId,
            programId: item.productId,
            lineId: lineIdentity(line),
            lineName: exactDisplayName(line),
            ...(secondLine ? {
                secondAnimatorLineId: lineIdentity(secondLine),
                secondAnimator: exactDisplayName(secondLine)
            } : {}),
            roomResourceId: TAKEAWAY_ROOM_ID,
            room: TAKEAWAY_ROOM_LABEL,
            date: blueprint.date,
            time: item.time,
            duration,
            status: item.status,
            programCode: requiredProductText(product, 'programCode', product.code, 20, item.productId),
            programName: requiredProductText(product, 'programName', product.name || product.label, 100, item.productId),
            label: requiredProductText(product, 'label', product.label || product.name, 100, item.productId),
            category: requiredProductText(product, 'category', product.category, 50, item.productId),
            hosts,
            pinataMode: item.pinataMode,
            ...(item.pinataNumber !== undefined ? { pinataNumber: item.pinataNumber } : {})
        };
    });
    const rawManifest = {
        sourceCommit: catalog.release.commit,
        sourceBranch: catalog.release.branch,
        liveUrl: blueprint.liveUrl,
        runId: blueprint.runId,
        businessContext: blueprint.businessContext,
        testAccountId: identity.testAccountId,
        operatorUserId: identity.testAccountId,
        customerId: identity.customerId,
        timeWindow: blueprint.timeWindow,
        ttlMinutes: blueprint.ttlMinutes,
        resourcePolicy: 'takeaway_only',
        carrierResource: {
            selector: 'takeaway',
            resourceId: TAKEAWAY_ROOM_ID,
            name: TAKEAWAY_ROOM_LABEL
        },
        bookingFixtures
    };
    if (blueprint.maxEntityCount !== null) rawManifest.maxEntityCount = blueprint.maxEntityCount;
    return normalizeManifest(rawManifest);
}

function releaseIdentity(payload = {}) {
    const commit = String(payload.commitSha || payload.commitSHA || payload.commit || payload.gitCommit || '').trim().toLowerCase();
    const branch = String(payload.sourceBranch || payload.branch || payload.gitBranch || '').trim();
    return {
        commit,
        branch,
        version: cleanText(payload.version, 50) || null
    };
}

function lineIdentity(row = {}) {
    return cleanId(row.id || row.lineId || row.line_id || row.resourceId || row.resource_id);
}

function resourceIdentity(row = {}) {
    return cleanId(row.resourceId || row.resource_id || row.id);
}

function productIdentity(row = {}) {
    return cleanId(row.id || row.productId || row.product_id);
}

function safeExtraData(booking = {}) {
    const value = booking.extraData || booking.extra_data;
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function bookingMatchesFixture(booking, fixture, { linked = false } = {}) {
    const exactFieldsMatch = cleanText(booking.programCode || booking.program_code, 20) === fixture.booking.programCode
        && cleanText(booking.programName || booking.program_name, 100) === fixture.booking.programName
        && cleanText(booking.label, 100) === fixture.booking.label
        && cleanText(booking.category, 50) === fixture.booking.category
        && Number(booking.hosts) === fixture.booking.hosts
        && cleanText(booking.pinataMode || booking.pinata_mode || 'none', 20) === fixture.booking.pinataMode
        && cleanText(booking.room, 100) === fixture.room
        && cleanText(booking.secondAnimator || booking.second_animator, 100) === (fixture.secondAnimator || '')
        && (fixture.booking.pinataNumber === undefined
            || cleanText(booking.pinataNumber || booking.pinata_number, 80) === fixture.booking.pinataNumber);
    return exactFieldsMatch
        && dateOnly(booking.date) === fixture.date
        && timeOnly(booking.time) === fixture.time
        && cleanId(booking.lineId || booking.line_id) === (linked ? fixture.secondAnimatorLineId : fixture.lineId)
        && cleanId(booking.programId || booking.program_id) === fixture.programId
        && cleanId(booking.roomResourceId || booking.room_resource_id) === fixture.roomResourceId
        && Number(booking.duration) === fixture.duration
        && cleanText(booking.status || 'confirmed', 30).toLowerCase() === fixture.status;
}

function assertTrustedReadback(booking, fixture, manifest, { linked = false } = {}) {
    fail(Boolean(booking?.id), 'Created booking readback is missing an ID', 'SHOWCASE_READBACK_ID_MISSING', { key: fixture.key });
    const extra = safeExtraData(booking);
    const marker = extra.disposableQa || extra.disposable_qa || {};
    fail(marker.source === SHOWCASE_SOURCE && marker.runId === manifest.runId,
        'Created booking is missing the server-issued Trusted QA marker', 'SHOWCASE_READBACK_MARKER_MISMATCH', { key: fixture.key });
    fail(marker.bookingFixtureKey === fixture.requestId,
        'Created booking is missing the server-issued exact fixture key', 'SHOWCASE_READBACK_RECOVERY_MARKER_MISMATCH', { key: fixture.key });
    fail(bookingMatchesFixture(booking, fixture, { linked }),
        'Created booking readback differs from the exact fixture', 'SHOWCASE_READBACK_FIXTURE_MISMATCH', { key: fixture.key, linked });
    return cleanId(booking.id);
}

function apiBookingList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.bookings)) return payload.bookings;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

function liveCollision(existingBookings, fixture, productById) {
    for (const booking of existingBookings) {
        if (dateOnly(booking.date) !== fixture.date || !intervalOverlap({
            time: timeOnly(booking.time),
            duration: Number(booking.duration || 0)
        }, fixture)) continue;
        const lineId = cleanId(booking.lineId || booking.line_id);
        if (fixtureLineIds(fixture).includes(lineId)) return 'line';
        const roomResourceId = cleanId(booking.roomResourceId || booking.room_resource_id);
        if (fixture.roomResourceId !== TAKEAWAY_ROOM_ID && roomResourceId === fixture.roomResourceId) return 'room';
        const productId = cleanId(booking.programId || booking.program_id);
        const category = cleanText(booking.category || productById[fixture.productId]?.category, 80).toLowerCase();
        if (productId === fixture.productId && productId !== 'custom' && !['animation', 'custom'].includes(category)) return 'product';
    }
    return null;
}

async function liveReadOnlyPreflight(manifest, session, options = {}) {
    const date = manifest.timeWindow.date;
    const [version, animatorLines, roomLines, resourcesPayload, productsPayload, animatorBookings, roomBookings] = await Promise.all([
        fetchJson(manifest.liveUrl, '/api/version'),
        fetchJson(manifest.liveUrl, scopedRoute(`/api/lines/${encodeURIComponent(date)}`, manifest, { timelineView: 'animators' }), { accessToken: session.accessToken }),
        fetchJson(manifest.liveUrl, scopedRoute(`/api/lines/${encodeURIComponent(date)}`, manifest, { timelineView: 'rooms' }), { accessToken: session.accessToken }),
        fetchJson(manifest.liveUrl, scopedRoute('/api/timeline/resources', manifest, { includeInactive: 'true' }), { accessToken: session.accessToken }),
        fetchJson(manifest.liveUrl, scopedRoute('/api/products', manifest, { active: 'true' }), { accessToken: session.accessToken }),
        fetchJson(manifest.liveUrl, scopedRoute(`/api/bookings/${encodeURIComponent(date)}`, manifest, { timelineView: 'animators' }), { accessToken: session.accessToken }),
        fetchJson(manifest.liveUrl, scopedRoute(`/api/bookings/${encodeURIComponent(date)}`, manifest, { timelineView: 'rooms' }), { accessToken: session.accessToken })
    ]);
    const release = releaseIdentity(version);
    fail(release.commit === manifest.sourceCommit && release.branch === manifest.sourceBranch,
        'Live release identity does not match the approved showcase manifest', 'SHOWCASE_RELEASE_MISMATCH', release);
    fail(Array.isArray(animatorLines) && Array.isArray(roomLines), 'Live timeline line preflight returned invalid data', 'SHOWCASE_LINES_PREFLIGHT_INVALID');
    const animatorById = Object.fromEntries(animatorLines.map(line => [lineIdentity(line), line]).filter(([id]) => id));
    for (const fixture of manifest.bookingFixtures) {
        for (const lineId of fixtureLineIds(fixture)) {
            const line = animatorById[lineId];
            fail(Boolean(line) && line.assignmentAllowed !== false && line.isUnavailable !== true,
                'Exact animator line is unavailable in the live timeline', 'SHOWCASE_LINE_UNAVAILABLE', { key: fixture.key, lineId });
        }
        fail(exactDisplayName(animatorById[fixture.lineId]) === fixture.lineName,
            'Live primary animator display name differs from the exact runner snapshot',
            'SHOWCASE_PRIMARY_ANIMATOR_METADATA_MISMATCH', { key: fixture.key });
        if (fixture.secondAnimatorLineId) {
            const secondLine = animatorById[fixture.secondAnimatorLineId];
            fail(cleanText(secondLine?.name || secondLine?.displayName || secondLine?.display_name, 100) === fixture.secondAnimator,
                'Live second animator display name differs from the exact fixture snapshot',
                'SHOWCASE_SECOND_ANIMATOR_METADATA_MISMATCH', { key: fixture.key });
        }
    }
    const roomById = Object.fromEntries(roomLines.map(line => [resourceIdentity(line), line]).filter(([id]) => id));
    const resources = Array.isArray(resourcesPayload?.resources) ? resourcesPayload.resources : [];
    for (const resource of resources) roomById[resourceIdentity(resource)] = roomById[resourceIdentity(resource)] || resource;
    for (const fixture of manifest.bookingFixtures) {
        const resource = roomById[fixture.roomResourceId];
        fail(Boolean(resource) && resource.isActive !== false && resource.is_active !== false && resource.assignmentAllowed !== false,
            'Exact carrier/room resource is unavailable', 'SHOWCASE_ROOM_UNAVAILABLE', { key: fixture.key, roomResourceId: fixture.roomResourceId });
        if (manifest.resourcePolicy === 'takeaway_only') {
            const metadata = resource.metadata || {};
            fail(fixture.roomResourceId === TAKEAWAY_ROOM_ID
                && (metadata.takeaway === true || resource.source === 'rooms_virtual' || cleanText(resource.name, 100) === TAKEAWAY_ROOM_LABEL),
            'Live carrier resource is not the canonical takeaway resource', 'SHOWCASE_TAKEAWAY_RESOURCE_INVALID');
        }
    }
    const products = Array.isArray(productsPayload) ? productsPayload : (productsPayload?.products || []);
    const productById = Object.fromEntries(products.map(product => [productIdentity(product), product]).filter(([id]) => id));
    for (const fixture of manifest.bookingFixtures) {
        const product = productById[fixture.productId];
        fail(Boolean(product) && product.isActive !== false && product.is_active !== false,
            'Exact showcase product is absent or inactive', 'SHOWCASE_PRODUCT_UNAVAILABLE', { key: fixture.key, productId: fixture.productId });
        fail(integer(product.duration) === fixture.duration && integer(product.hosts) === fixture.booking.hosts,
            'Live product duration/hosts differ from the exact fixture expectation',
            'SHOWCASE_PRODUCT_TOPOLOGY_MISMATCH', { key: fixture.key });
        for (const field of ['programCode', 'programName', 'label', 'category']) {
            if (fixture.booking[field] !== undefined) {
                const productField = {
                    programCode: product.code,
                    programName: product.name || product.label,
                    label: product.label || product.name,
                    category: product.category
                }[field];
                fail(cleanText(productField, 200) === cleanText(fixture.booking[field], 200),
                    'Live product metadata differs from the exact fixture expectation', 'SHOWCASE_PRODUCT_METADATA_MISMATCH', { key: fixture.key, field });
            }
        }
    }
    assertInternalFixtureCollisions(manifest.bookingFixtures, productById);
    const existingById = new Map();
    for (const booking of [...apiBookingList(animatorBookings), ...apiBookingList(roomBookings)]) {
        const marker = safeExtraData(booking).disposableQa || safeExtraData(booking).disposable_qa || {};
        if (options.allowRunId && marker.runId === options.allowRunId) continue;
        if (booking?.id) existingById.set(String(booking.id), booking);
    }
    for (const fixture of manifest.bookingFixtures) {
        const collision = liveCollision([...existingById.values()], fixture, productById);
        fail(!collision, 'Live read-only booking preflight found a collision', 'SHOWCASE_LIVE_COLLISION', { key: fixture.key, collision });
    }
    return {
        release,
        userId: Number(session.user?.id),
        lineCount: new Set(manifest.bookingFixtures.flatMap(fixtureLineIds)).size,
        roomCount: new Set(manifest.bookingFixtures.map(fixture => fixture.roomResourceId)).size,
        productCount: new Set(manifest.bookingFixtures.map(fixture => fixture.productId)).size,
        visibleExistingBookingCount: existingById.size,
        catalog: {
            products: productById,
            lines: animatorById,
            rooms: roomById
        }
    };
}

function productRowMap(rows = []) {
    return Object.fromEntries(rows.map(row => [String(row.id), {
        id: String(row.id),
        code: row.code,
        label: row.label,
        name: row.name,
        category: row.category,
        duration: Number(row.duration || 0),
        hosts: Number(row.hosts),
        price: Number(row.price || 0),
        isActive: row.is_active !== false
    }]));
}

function assertPersistedLineIds(requiredLineIds, rows) {
    const persistedLineIds = new Set((Array.isArray(rows) ? rows : []).map(row => String(row.line_id || row.lineId || '')));
    const missingPersistedLineIds = requiredLineIds.filter(lineId => !persistedLineIds.has(String(lineId)));
    fail(missingPersistedLineIds.length === 0,
        'Exact animator lines must already exist in lines_by_date; runner will not create timeline rows',
        'SHOWCASE_DB_PERSISTED_LINE_MISSING', { missingCount: missingPersistedLineIds.length });
    return true;
}

function assertNoUnrelatedCustomerBookings(rows) {
    const count = Array.isArray(rows) ? rows.length : 0;
    fail(count === 0,
        'Approved QA customer has an unrelated active booking',
        'SHOWCASE_DB_CUSTOMER_ACTIVE_BOOKING_BLOCKER', { bookingCount: count });
    return true;
}

async function performDatabasePreflight(client, manifest, { allowRunDatabaseId = null, lockRows = false } = {}) {
    const suffix = lockRows ? ' FOR UPDATE' : '';
    const user = await client.query(
        `SELECT id, role, COALESCE(is_active, true) AS is_active FROM users WHERE id = $1${suffix}`,
        [manifest.testAccountId]
    );
    const userRow = user.rows?.[0];
    fail(Boolean(userRow) && userRow.is_active && OPERATOR_ROLES.has(cleanText(userRow.role, 80).toLowerCase()),
        'Exact Trusted QA operator account is unavailable', 'SHOWCASE_DB_OPERATOR_UNAVAILABLE');
    const customer = await client.query(
        `SELECT id FROM customers
          WHERE id = $1
            AND COALESCE(business_context, 'event_genix') = $2
            AND (LOWER(COALESCE(notes, '')) LIKE '%codex%qa%'
              OR LOWER(BTRIM(COALESCE(source, ''))) IN ('codex_qa', 'trusted_qa'))${suffix}`,
        [manifest.customerId, manifest.businessContext]
    );
    fail(customer.rowCount === 1, 'Exact Trusted QA customer evidence is missing', 'SHOWCASE_DB_CUSTOMER_UNAVAILABLE');

    const animatorLines = await getAnimatorTimelineLines(manifest.timeWindow.date, client);
    const animatorById = Object.fromEntries(animatorLines.map(line => [lineIdentity(line), line]).filter(([id]) => id));
    const requiredLineIds = [...new Set(manifest.bookingFixtures.flatMap(fixtureLineIds))];
    for (const fixture of manifest.bookingFixtures) {
        for (const lineId of fixtureLineIds(fixture)) {
            const line = animatorById[lineId];
            fail(Boolean(line) && line.assignmentAllowed !== false && line.isUnavailable !== true,
                'Exact animator line is unavailable in database preflight', 'SHOWCASE_DB_LINE_UNAVAILABLE', { key: fixture.key, lineId });
        }
        fail(exactDisplayName(animatorById[fixture.lineId]) === fixture.lineName,
            'Database primary animator display name differs from the exact runner snapshot',
            'SHOWCASE_DB_PRIMARY_ANIMATOR_METADATA_MISMATCH', { key: fixture.key });
        if (fixture.secondAnimatorLineId) {
            fail(exactDisplayName(animatorById[fixture.secondAnimatorLineId]) === fixture.secondAnimator,
                'Database second animator display name differs from the exact runner snapshot',
                'SHOWCASE_DB_SECOND_ANIMATOR_METADATA_MISMATCH', { key: fixture.key });
        }
    }
    const persistedLines = await client.query(
        `SELECT line_id FROM lines_by_date
          WHERE date = $1
            AND COALESCE(business_context, 'event_genix') = $2
            AND line_id = ANY($3::text[])${suffix}`,
        [manifest.timeWindow.date, manifest.businessContext, requiredLineIds]
    );
    assertPersistedLineIds(requiredLineIds, persistedLines.rows);

    const productIds = [...new Set(manifest.bookingFixtures.map(fixture => fixture.productId))];
    const products = await client.query(
        `SELECT id, code, label, name, category, duration, price, hosts, is_active
           FROM products
          WHERE id::text = ANY($1::text[])
            AND COALESCE(business_context, 'event_genix') = $2${suffix}`,
        [productIds, manifest.businessContext]
    );
    const productById = productRowMap(products.rows);
    for (const productId of productIds) {
        fail(productById[productId]?.isActive === true, 'Exact product is unavailable in database preflight', 'SHOWCASE_DB_PRODUCT_UNAVAILABLE', { productId });
    }
    for (const fixture of manifest.bookingFixtures) {
        const product = productById[fixture.productId];
        fail(product.duration === fixture.duration && product.hosts === fixture.booking.hosts,
            'Database product duration/hosts differ from the exact fixture',
            'SHOWCASE_DB_PRODUCT_TOPOLOGY_MISMATCH', { key: fixture.key });
        const snapshot = {
            programCode: cleanText(product.code, 20),
            programName: cleanText(product.name || product.label, 100),
            label: cleanText(product.label || product.name, 100),
            category: cleanText(product.category, 50)
        };
        fail(Object.entries(snapshot).every(([field, value]) => value === fixture.booking[field]),
            'Database product display snapshot differs from the exact fixture',
            'SHOWCASE_DB_PRODUCT_METADATA_MISMATCH', { key: fixture.key });
    }
    assertInternalFixtureCollisions(manifest.bookingFixtures, productById);
    let excludedBookingIds = [];
    if (allowRunDatabaseId) {
        const registered = await client.query(
            `SELECT entity_id FROM trusted_qa_run_entities
              WHERE run_id = $1 AND entity_type = 'booking' AND cleanup_state = 'active'`,
            [allowRunDatabaseId]
        );
        excludedBookingIds = registered.rows.map(row => String(row.entity_id));
    }
    const unrelatedCustomerBookings = await client.query(
        `SELECT id FROM bookings
          WHERE customer_id = $1
            AND COALESCE(business_context, 'event_genix') = $2
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) != 'cancelled'
            AND NOT (id::text = ANY($3::text[]))
          ORDER BY id
          LIMIT 1${suffix}`,
        [manifest.customerId, manifest.businessContext, excludedBookingIds]
    );
    assertNoUnrelatedCustomerBookings(unrelatedCustomerBookings.rows);

    const roomNameById = { [TAKEAWAY_ROOM_ID]: TAKEAWAY_ROOM_LABEL };
    fail(manifest.resourcePolicy === 'takeaway_only'
        && manifest.bookingFixtures.every(fixture => (
            fixture.roomResourceId === TAKEAWAY_ROOM_ID && fixture.room === TAKEAWAY_ROOM_LABEL
        )),
    'Database preflight requires the canonical takeaway carrier', 'SHOWCASE_DB_TAKEAWAY_INVALID');

    for (const fixture of manifest.bookingFixtures) {
        for (const lineId of fixtureLineIds(fixture)) {
            const conflict = await checkServerConflicts(
                client,
                fixture.date,
                lineId,
                fixture.time,
                fixture.duration,
                excludedBookingIds,
                manifest.businessContext
            );
            fail(!conflict.overlap, 'Database preflight found an animator collision/unavailability', 'SHOWCASE_DB_LINE_COLLISION', {
                key: fixture.key,
                lineId,
                unavailable: conflict.unavailable === true
            });
        }
        const roomName = roomNameById[fixture.roomResourceId];
        const roomConflict = await checkRoomConflict(
            client,
            fixture.date,
            roomName,
            fixture.time,
            fixture.duration,
            { excludeIds: excludedBookingIds, candidateBooking: { roomResourceId: fixture.roomResourceId } },
            manifest.businessContext
        );
        fail(!roomConflict, 'Database preflight found a room collision', 'SHOWCASE_DB_ROOM_COLLISION', { key: fixture.key });
        const duplicate = await checkServerDuplicate(
            client,
            fixture.date,
            fixture.programId,
            fixture.time,
            fixture.duration,
            excludedBookingIds,
            manifest.businessContext
        );
        fail(!duplicate, 'Database preflight found a product collision', 'SHOWCASE_DB_PRODUCT_COLLISION', { key: fixture.key });
    }
    const activeRuns = await client.query(
        `SELECT id FROM trusted_qa_runs
          WHERE state IN ('active', 'cleanup_pending', 'blocked')
            AND ($1::bigint IS NULL OR id <> $1::bigint)`,
        [allowRunDatabaseId]
    );
    fail(activeRuns.rowCount === 0, 'Another active/cleanup_pending Trusted QA run exists', 'SHOWCASE_ACTIVE_RUN_BLOCKER', {
        activeRunCount: activeRuns.rowCount
    });
    return {
        accountReady: true,
        customerReady: true,
        lineCount: new Set(manifest.bookingFixtures.flatMap(fixtureLineIds)).size,
        productCount: productIds.length,
        collisionFree: true,
        productById
    };
}

async function databaseReadOnlyPreflight(manifest, options = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await performDatabasePreflight(client, manifest, options);
        await client.query('ROLLBACK');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function normalizeAllowedEnvelope(value) {
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === 'object' ? value : null;
}

function canonicalExactFixtures(fixtures = []) {
    return fixtures.map(fixture => stableValue(exactFixtureEnvelope(fixture)))
        .sort((left, right) => String(left.requestId).localeCompare(String(right.requestId)));
}

function assertRunEnvelope(run, manifest, options = {}) {
    const allowedStates = options.allowedStates || ['active'];
    fail(Boolean(run) && run.run_id === manifest.runId
        && run.source === SHOWCASE_SOURCE
        && allowedStates.includes(run.state)
        && run.business_context === manifest.businessContext,
    'Trusted QA run identity/state differs from the approved manifest',
    'SHOWCASE_RUN_SCALAR_MISMATCH');
    fail(Number(run.operator_user_id) === manifest.operatorUserId
        && Number(run.required_operator_user_id) === manifest.operatorUserId
        && Number(run.required_user_id) === manifest.testAccountId
        && Number(run.required_customer_id) === manifest.customerId,
    'Trusted QA run account/customer boundary differs from the approved manifest',
    'SHOWCASE_RUN_ACCOUNT_BOUNDARY_MISMATCH');
    fail(run.test_customer_marker === `${manifest.runId}:customer:${manifest.customerId}`,
        'Trusted QA run customer marker differs from the approved manifest',
        'SHOWCASE_RUN_CUSTOMER_MARKER_MISMATCH');
    fail(dateOnly(run.allowed_date) === manifest.timeWindow.date
        && timeOnly(run.allowed_start_time) === manifest.timeWindow.from
        && timeOnly(run.allowed_end_time) === manifest.timeWindow.to
        && Number(run.max_entity_count) === manifest.expectedEntityCount,
    'Trusted QA run execution window/entity bound differs from the approved manifest',
    'SHOWCASE_RUN_WINDOW_BOUNDARY_MISMATCH');
    fail(['required_program_id', 'required_product_id', 'required_room_resource_id', 'required_line_id']
        .every(field => run[field] === null || run[field] === undefined || run[field] === ''),
    'Fixture-mode Trusted QA run must not retain scalar booking allowlists',
    'SHOWCASE_RUN_SCALAR_ALLOWLIST_PRESENT');
    const expiresAt = Date.parse(String(run.expires_at || ''));
    const now = Date.now();
    fail(Number.isFinite(expiresAt)
        && (options.requireUnexpired === false || expiresAt > now)
        && expiresAt <= now + (manifest.ttlMinutes * 60_000) + 120_000,
    'Trusted QA run expiry differs from the bounded TTL',
    'SHOWCASE_RUN_EXPIRY_INVALID');
    fail(/^[a-f0-9]{64}$/i.test(String(run.token_hash || ''))
        && !Object.prototype.hasOwnProperty.call(run, 'token'),
    'Trusted QA run token proof is invalid', 'SHOWCASE_RUN_TOKEN_PROOF_INVALID');
    const envelope = normalizeAllowedEnvelope(run?.allowed_endpoints);
    fail(envelope && !Array.isArray(envelope),
        'Trusted QA service did not persist the exact fixture envelope', 'SHOWCASE_RUN_ENVELOPE_MISSING');
    const endpoints = Array.isArray(envelope.endpoints) ? [...envelope.endpoints].map(String).sort() : [];
    const fixtures = Array.isArray(envelope.bookingFixtures) ? envelope.bookingFixtures : [];
    fail(JSON.stringify(endpoints) === JSON.stringify(manifest.allowedEndpoints)
        && JSON.stringify(fixtures.map(stableValue).sort((a, b) => String(a.requestId).localeCompare(String(b.requestId))))
            === JSON.stringify(canonicalExactFixtures(manifest.bookingFixtures)),
    'Trusted QA persisted envelope differs from the approved exact fixture set', 'SHOWCASE_RUN_ENVELOPE_MISMATCH');
}

async function createExactRun(manifest, tokenFile) {
    fail(!fs.existsSync(tokenFile), 'QA token file already exists; use recovery or cleanup mode', 'SHOWCASE_TOKEN_FILE_EXISTS');
    const client = await pool.connect();
    let tokenWritten = false;
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix_trusted_qa_timeline_showcase'))");
        const dbReadiness = await performDatabasePreflight(client, manifest, { lockRows: true });
        const created = await createTrustedQaRun(client, {
            runId: manifest.runId,
            source: SHOWCASE_SOURCE,
            businessContext: manifest.businessContext,
            operatorUserId: manifest.operatorUserId,
            requiredOperatorUserId: manifest.operatorUserId,
            requiredUserId: manifest.testAccountId,
            requiredCustomerId: manifest.customerId,
            allowedDate: manifest.timeWindow.date,
            allowedStartTime: manifest.timeWindow.from,
            allowedEndTime: manifest.timeWindow.to,
            allowedEndpoints: manifest.allowedEndpoints,
            bookingFixtures: manifest.bookingFixtures.map(exactFixtureEnvelope),
            maxEntityCount: manifest.maxEntityCount,
            ttlMinutes: manifest.ttlMinutes,
            testCustomerMarker: `${manifest.runId}:customer:${manifest.customerId}`
        });
        fail(created?.run?.id && created?.token, 'Trusted QA service did not create the exact run', 'SHOWCASE_RUN_CREATE_FAILED');
        assertRunEnvelope(created.run, manifest);
        await client.query('COMMIT');
        fs.writeFileSync(tokenFile, created.token, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        tokenWritten = true;
        return {
            run: created.run,
            token: created.token,
            dbReadiness
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (tokenWritten) {
            try { fs.unlinkSync(tokenFile); } catch {}
        }
        throw error;
    } finally {
        client.release();
    }
}

async function lookupRun(manifest) {
    const result = await pool.query(
        `SELECT * FROM trusted_qa_runs
          WHERE run_id = $1 AND business_context = $2
          ORDER BY id DESC LIMIT 1`,
        [manifest.runId, manifest.businessContext]
    );
    return result.rows?.[0] || null;
}

async function resumeRun(manifest, state, tokenFile) {
    const run = await lookupRun(manifest);
    fail(Boolean(run), 'Trusted QA recovery run no longer exists', 'SHOWCASE_RECOVERY_RUN_MISSING');
    assertRunEnvelope(run, manifest);
    fail(run.state === 'active', 'Trusted QA recovery run is not active; cleanup is required', 'SHOWCASE_RECOVERY_RUN_STATE_INVALID', { state: run.state });
    fail(Number.isFinite(Date.parse(String(run.expires_at || ''))) && Date.parse(String(run.expires_at)) > Date.now(),
        'Trusted QA recovery run is expired; cleanup is required', 'SHOWCASE_RECOVERY_RUN_EXPIRED');
    fail(fs.existsSync(tokenFile),
        'Trusted QA run committed without a recoverable token file; exact cleanup is required',
        'SHOWCASE_RECOVERY_TOKEN_FILE_MISSING');
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    fail(token.length >= 32 && sha256(token) === run.token_hash,
        'Trusted QA recovery token does not match the run', 'SHOWCASE_RECOVERY_TOKEN_MISMATCH');
    fail(!state.runDatabaseId || Number(state.runDatabaseId) === Number(run.id),
        'Recovery state points to another Trusted QA run', 'SHOWCASE_RECOVERY_RUN_ID_MISMATCH');
    return { run, token };
}

function assertOwnedTokenFile(tokenFile, run, { allowMissing = false } = {}) {
    if (!fs.existsSync(tokenFile)) {
        fail(allowMissing, 'Trusted QA token file is missing', 'SHOWCASE_TOKEN_FILE_MISSING');
        return false;
    }
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    fail(/^[a-f0-9]{64}$/i.test(String(run?.token_hash || ''))
        && token.length >= 32
        && sha256(token) === run.token_hash,
    'Token file does not belong to the exact Trusted QA run',
    'SHOWCASE_TOKEN_FILE_OWNERSHIP_MISMATCH');
    return true;
}

function unlinkOwnedTokenFile(tokenFile, run, options = {}) {
    if (!assertOwnedTokenFile(tokenFile, run, options)) return false;
    fs.unlinkSync(tokenFile);
    return true;
}

function fixtureState(state, fixture) {
    const entry = state.fixtures.find(item => item.key === fixture.key && item.requestId === fixture.requestId);
    fail(Boolean(entry), 'Recovery state fixture set drifted', 'SHOWCASE_STATE_FIXTURE_DRIFT', { key: fixture.key });
    return entry;
}

function assertExactRegistryRows(rows, manifest, state) {
    const expectedIds = state.fixtures.flatMap(entry => entry.bookingIds || []).map(String).sort();
    fail(expectedIds.length === manifest.expectedEntityCount
        && new Set(expectedIds).size === expectedIds.length,
    'Recovery state does not contain the exact expected booking graph',
    'SHOWCASE_REGISTRY_EXPECTED_GRAPH_INVALID');
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(row => ({
        entityType: String(row.entity_type || row.entityType || ''),
        entityId: String(row.entity_id || row.entityId || ''),
        cleanupState: String(row.cleanup_state || row.cleanupState || '')
    }));
    fail(normalizedRows.length === manifest.expectedEntityCount
        && normalizedRows.every(row => row.entityType === 'booking' && row.cleanupState === 'active'),
    'Trusted QA registry contains an unexpected entity type/state/count',
    'SHOWCASE_REGISTRY_BOUNDARY_DRIFT', {
        expectedEntityCount: manifest.expectedEntityCount,
        actualEntityCount: normalizedRows.length
    });
    const actualIds = normalizedRows.map(row => row.entityId).sort();
    fail(JSON.stringify(actualIds) === JSON.stringify(expectedIds),
        'Trusted QA registry IDs differ from the exact created booking graph',
        'SHOWCASE_REGISTRY_ID_DRIFT');
    return { entityCount: actualIds.length, entityTypes: ['booking'] };
}

async function verifyExactRunRegistry(manifest, state) {
    const result = await pool.query(
        `SELECT entity_type, entity_id, cleanup_state
           FROM trusted_qa_run_entities
          WHERE run_id = $1
          ORDER BY entity_type, entity_id`,
        [state.runDatabaseId]
    );
    return assertExactRegistryRows(result.rows, manifest, state);
}

function buildBookingPayload(manifest, fixture, liveReadiness, hash) {
    const product = liveReadiness.catalog.products[fixture.productId];
    const line = liveReadiness.catalog.lines[fixture.lineId];
    const secondLine = fixture.secondAnimatorLineId ? liveReadiness.catalog.lines[fixture.secondAnimatorLineId] : null;
    const room = liveReadiness.catalog.rooms[fixture.roomResourceId];
    fail(Boolean(product && line && room), 'Cannot build booking payload from incomplete preflight catalog', 'SHOWCASE_PAYLOAD_CATALOG_INCOMPLETE', { key: fixture.key });
    const payload = {
        businessContext: manifest.businessContext,
        date: fixture.date,
        time: fixture.time,
        duration: fixture.duration,
        lineId: fixture.lineId,
        programId: fixture.programId,
        productId: fixture.productId,
        programCode: product.code || fixture.booking.programCode || fixture.programId,
        programName: fixture.booking.programName || product.name || product.label || fixture.programId,
        label: fixture.booking.label || product.label || product.name || product.code || fixture.programId,
        category: fixture.booking.category || product.category || 'custom',
        roomResourceId: fixture.roomResourceId,
        room: fixture.room,
        customerId: manifest.customerId,
        status: fixture.status,
        hosts: fixture.booking.hosts,
        ...fixture.booking,
    };
    if (secondLine) {
        payload.secondAnimatorLineId = fixture.secondAnimatorLineId;
        payload.secondAnimator = fixture.secondAnimator;
    }
    return payload;
}

function bookingIdsFromCreateResponse(response) {
    const rows = [
        response?.booking,
        response?.mainBooking,
        ...(Array.isArray(response?.linkedBookings) ? response.linkedBookings : [])
    ].filter(Boolean);
    return [...new Set(rows.map(row => cleanId(row.id)).filter(Boolean))];
}

async function readBookingDetail(manifest, session, bookingId) {
    const payload = await fetchJson(
        manifest.liveUrl,
        scopedRoute(`/api/bookings/detail/${encodeURIComponent(bookingId)}`, manifest),
        { accessToken: session.accessToken }
    );
    return payload.booking || payload.data?.booking || payload.data || null;
}

async function recoverFixtureRows(manifest, fixture, runDatabaseId) {
    const result = await pool.query(
        `SELECT id, business_context, date, time, line_id, program_id, program_code, program_name,
                label, category, duration, room, room_resource_id, status, hosts, second_animator, pinata_mode, pinata_number,
                linked_to, extra_data
           FROM bookings
          WHERE COALESCE(business_context, 'event_genix') = $1
            AND LEFT(date::text, 10) = $2
            AND extra_data #>> '{disposableQa,runId}' = $3
            AND extra_data #>> '{disposableQa,bookingFixtureKey}' = $4
          ORDER BY CASE WHEN linked_to IS NULL THEN 0 ELSE 1 END, id`,
        [manifest.businessContext, fixture.date, manifest.runId, fixture.requestId]
    );
    if (!result.rowCount) return null;
    const primaryRows = result.rows.filter(row => !row.linked_to);
    fail(primaryRows.length === 1, 'Recovered fixture has an unexpected primary booking graph', 'SHOWCASE_RECOVERY_GRAPH_DRIFT', { key: fixture.key });
    const primary = primaryRows[0];
    assertTrustedReadback(primary, fixture, manifest);
    for (const linked of result.rows.filter(row => row.linked_to)) {
        assertTrustedReadback(linked, fixture, manifest, { linked: true });
        fail(String(linked.linked_to) === String(primary.id), 'Recovered linked booking points to another primary', 'SHOWCASE_RECOVERY_LINK_DRIFT', { key: fixture.key });
    }
    const expectedCount = fixture.secondAnimatorLineId ? 2 : 1;
    fail(result.rows.length === expectedCount,
        'Recovered fixture entity count differs from the exact graph', 'SHOWCASE_RECOVERY_ENTITY_COUNT_MISMATCH', {
            key: fixture.key,
            expectedCount,
            actualCount: result.rows.length
        });
    const manifestRows = await pool.query(
        `SELECT entity_id FROM trusted_qa_run_entities
          WHERE run_id = $1 AND entity_type = 'booking' AND cleanup_state = 'active'
            AND entity_id = ANY($2::text[])`,
        [runDatabaseId, result.rows.map(row => String(row.id))]
    );
    fail(manifestRows.rowCount === result.rows.length,
        'Recovered booking graph is not fully registered for exact cleanup', 'SHOWCASE_RECOVERY_ENTITY_REGISTRATION_DRIFT', { key: fixture.key });
    return {
        primaryBookingId: String(primary.id),
        bookingIds: result.rows.map(row => String(row.id)).sort()
    };
}

async function verifyFixtureReadback(manifest, fixture, session, bookingIds) {
    const rows = [];
    for (const bookingId of bookingIds) rows.push(await readBookingDetail(manifest, session, bookingId));
    const primary = rows.find(row => !row?.linkedTo && !row?.linked_to);
    fail(Boolean(primary), 'Created fixture readback has no primary booking', 'SHOWCASE_READBACK_PRIMARY_MISSING', { key: fixture.key });
    assertTrustedReadback(primary, fixture, manifest);
    for (const linked of rows.filter(row => row !== primary)) {
        assertTrustedReadback(linked, fixture, manifest, { linked: true });
        fail(String(linked.linkedTo || linked.linked_to) === String(primary.id),
            'Created linked booking points to another primary', 'SHOWCASE_READBACK_LINK_DRIFT', { key: fixture.key });
    }
    const expectedCount = fixture.secondAnimatorLineId ? 2 : 1;
    fail(rows.length === expectedCount,
        'Created fixture entity count differs from the exact graph', 'SHOWCASE_READBACK_ENTITY_COUNT_MISMATCH', { key: fixture.key, expectedCount, actualCount: rows.length });
    return { primaryBookingId: String(primary.id), bookingIds: rows.map(row => String(row.id)).sort() };
}

async function createFixture(manifest, fixture, session, runInfo, liveReadiness, hash) {
    const payload = buildBookingPayload(manifest, fixture, liveReadiness, hash);
    const response = await fetchJson(manifest.liveUrl, scopedRoute('/api/bookings', manifest), {
        method: 'POST',
        accessToken: session.accessToken,
        qaToken: runInfo.token,
        requestId: fixture.requestId,
        body: payload
    });
    fail(response.success === true, 'Booking create response did not confirm success', 'SHOWCASE_BOOKING_CREATE_NOT_CONFIRMED', { key: fixture.key });
    const bookingIds = bookingIdsFromCreateResponse(response);
    fail(bookingIds.length >= 1, 'Booking create response omitted entity IDs', 'SHOWCASE_BOOKING_CREATE_IDS_MISSING', { key: fixture.key });
    return verifyFixtureReadback(manifest, fixture, session, bookingIds);
}

async function verifyBatch(manifest, state, session) {
    const payload = await fetchJson(
        manifest.liveUrl,
        scopedRoute(`/api/bookings/${encodeURIComponent(manifest.timeWindow.date)}`, manifest, { timelineView: 'animators' }),
        { accessToken: session.accessToken }
    );
    const byId = new Map(apiBookingList(payload).map(booking => [String(booking.id), booking]));
    const expectedIds = state.fixtures.flatMap(item => item.bookingIds || []);
    for (const bookingId of expectedIds) {
        fail(byId.has(String(bookingId)), 'Final timeline readback is missing a created booking', 'SHOWCASE_BATCH_READBACK_MISSING', { bookingId: String(bookingId) });
    }
    for (const fixture of manifest.bookingFixtures) {
        const entry = fixtureState(state, fixture);
        const primary = byId.get(String(entry.primaryBookingId));
        assertTrustedReadback(primary, fixture, manifest);
    }
    const registry = await verifyExactRunRegistry(manifest, state);
    return { bookingCount: expectedIds.length, fixtureCount: manifest.bookingFixtures.length, registry };
}

async function cleanupExactRun(runDatabaseId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        const result = await cleanupTrustedQaRun(client, runDatabaseId, { forUpdate: true });
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function scheduleCleanupRecovery(runDatabaseId, error) {
    if (!runDatabaseId) return null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        const run = await markTrustedQaRunCleanupPending(client, runDatabaseId, cleanText(error?.message || error?.code || 'showcase_failure', 500));
        await client.query('COMMIT');
        return run;
    } catch {
        await client.query('ROLLBACK').catch(() => {});
        return null;
    } finally {
        client.release();
    }
}

function sanitizedResult(manifest, state, extra = {}) {
    return {
        success: true,
        runId: manifest.runId,
        runDatabaseId: state.runDatabaseId,
        manifestHash: state.manifestHash,
        phase: state.phase,
        fixtureCount: state.fixtures.length,
        bookingCount: state.fixtures.reduce((total, fixture) => total + fixture.bookingIds.length, 0),
        bookingIds: state.fixtures.flatMap(fixture => fixture.bookingIds).sort(),
        expiresAt: state.expiresAt,
        ...extra
    };
}

function defaultRuntime() {
    return {
        assertLocalCheckout: assertLocalCheckoutProof,
        authenticate,
        authenticatePreparation,
        preparationCatalog: readPreparationCatalog,
        resolvePreparationCustomer,
        livePreflight: liveReadOnlyPreflight,
        databasePreflight: databaseReadOnlyPreflight,
        createRun: createExactRun,
        resumeRun,
        lookupRun,
        recoverFixture: recoverFixtureRows,
        createFixture,
        verifyBatch,
        cleanupRun: cleanupExactRun,
        scheduleCleanupRecovery
    };
}

async function prepareShowcase(blueprint, options = {}, runtime = defaultRuntime()) {
    const outputFile = assertOperatorFilePath(options.outputFile, 'prepare output file');
    fail(!fs.existsSync(outputFile),
        'Preparation output file already exists', 'SHOWCASE_PREPARE_OUTPUT_EXISTS');
    const session = await runtime.authenticatePreparation(blueprint, options);
    const [catalog, identity] = await Promise.all([
        runtime.preparationCatalog(blueprint, session),
        runtime.resolvePreparationCustomer(blueprint, session)
    ]);
    const manifest = compilePreparedManifest(blueprint, catalog, identity);
    const [live, database] = await Promise.all([
        runtime.livePreflight(manifest, session),
        runtime.databasePreflight(manifest)
    ]);
    writeJsonAtomicExclusive(outputFile, manifest);
    const hash = manifestHash(manifest);
    return {
        success: true,
        mode: 'prepare',
        outputFile,
        manifestHash: hash,
        fixtureCount: manifest.bookingFixtures.length,
        expectedEntityCount: manifest.expectedEntityCount,
        lineCount: live.lineCount,
        productCount: live.productCount,
        collisionFree: database.collisionFree === true
    };
}

async function applyShowcase(manifest, options = {}, runtime = defaultRuntime()) {
    const hash = manifestHash(manifest);
    fail(options.confirm === APPLY_CONFIRMATION, `Apply requires --confirm=${APPLY_CONFIRMATION}`, 'SHOWCASE_APPLY_CONFIRMATION_REQUIRED');
    fail(options.approvedHash === hash, 'Approved showcase manifest hash does not match', 'SHOWCASE_APPROVED_HASH_MISMATCH');
    const stateFile = assertOperatorFilePath(options.stateFile, 'state file');
    const requestedTokenFile = assertOperatorFilePath(options.tokenFile, 'token file');
    let state = readState(stateFile, manifest);
    const recoveryPhase = state?.phase || null;
    if (!state) {
        state = initialState(manifest, hash, requestedTokenFile);
        persistState(stateFile, state);
    }
    fail(path.resolve(state.tokenFile) === requestedTokenFile,
        'Recovery state token path differs from --token-file', 'SHOWCASE_STATE_TOKEN_PATH_MISMATCH');

    let runInfo = null;
    let primaryError = null;
    await runtime.assertLocalCheckout(manifest);
    const session = await runtime.authenticate(manifest, options);
    try {
        const existingRun = await runtime.lookupRun(manifest);
        const allowRunDatabaseId = state.runDatabaseId || existingRun?.id || null;
        state.phase = 'preflight_running';
        persistState(stateFile, state);
        const [liveReadiness] = await Promise.all([
            runtime.livePreflight(manifest, session, { allowRunId: existingRun?.run_id || null }),
            runtime.databasePreflight(manifest, { allowRunDatabaseId })
        ]);
        state.phase = 'preflight_passed';
        persistState(stateFile, state);

        if (existingRun) {
            runInfo = await runtime.resumeRun(manifest, state, requestedTokenFile);
        } else {
            fail(!fs.existsSync(requestedTokenFile),
                'QA token file exists without a matching Trusted QA run; it will not be removed automatically',
                'SHOWCASE_TOKEN_FILE_UNOWNED', { recoveryPhase });
            state.phase = 'run_creation_pending';
            persistState(stateFile, state);
            runInfo = await runtime.createRun(manifest, requestedTokenFile);
        }
        state.runDatabaseId = Number(runInfo.run.id);
        state.expiresAt = runInfo.run.expires_at || runInfo.run.expiresAt || null;
        state.tokenHash = sha256(runInfo.token);
        state.phase = 'run_active';
        persistState(stateFile, state);

        for (const fixture of manifest.bookingFixtures) {
            const entry = fixtureState(state, fixture);
            let recovered = await runtime.recoverFixture(manifest, fixture, state.runDatabaseId);
            if (recovered) {
                entry.status = 'verified';
                entry.primaryBookingId = recovered.primaryBookingId;
                entry.bookingIds = recovered.bookingIds;
                entry.lastErrorCode = null;
                persistState(stateFile, state);
                continue;
            }
            fail(entry.status !== 'verified', 'Recovery state claims a missing verified fixture', 'SHOWCASE_STATE_VERIFIED_FIXTURE_MISSING', { key: fixture.key });
            entry.status = 'creating';
            entry.lastErrorCode = null;
            persistState(stateFile, state);
            const created = await runtime.createFixture(manifest, fixture, session, runInfo, liveReadiness, hash);
            entry.status = 'verified';
            entry.primaryBookingId = created.primaryBookingId;
            entry.bookingIds = created.bookingIds;
            persistState(stateFile, state);
            recovered = await runtime.recoverFixture(manifest, fixture, state.runDatabaseId);
            fail(Boolean(recovered)
                && recovered.primaryBookingId === entry.primaryBookingId
                && JSON.stringify(recovered.bookingIds) === JSON.stringify(entry.bookingIds),
            'Database recovery readback differs after create', 'SHOWCASE_POST_CREATE_RECOVERY_DRIFT', { key: fixture.key });
        }
        const batch = await runtime.verifyBatch(manifest, state, session);
        state.phase = 'showcase_active';
        state.verifiedAt = new Date().toISOString();
        persistState(stateFile, state);
        return sanitizedResult(manifest, state, { batch });
    } catch (error) {
        primaryError = error;
        const failedFixture = state.fixtures.find(item => item.status === 'creating');
        if (failedFixture) {
            failedFixture.status = 'failed';
            failedFixture.lastErrorCode = error?.code || 'SHOWCASE_FAILED';
        }
        state.phase = 'failure_cleanup_running';
        state.lastErrorCode = error?.code || 'SHOWCASE_FAILED';
        persistState(stateFile, state);
        if (!state.runDatabaseId) {
            const recoveredRun = await runtime.lookupRun(manifest).catch(() => null);
            if (recoveredRun?.id) {
                state.runDatabaseId = Number(recoveredRun.id);
                runInfo = runInfo || { run: recoveredRun, token: null };
            }
        }
        if (!state.runDatabaseId) {
            state.phase = 'failed_before_run';
            persistState(stateFile, state);
            throw primaryError;
        }
        try {
            const cleanup = await runtime.cleanupRun(state.runDatabaseId);
            state.phase = 'cleaned_after_failure';
            state.cleanup = {
                status: cleanup.status || cleanup.state || 'cleaned',
                cleanedAt: new Date().toISOString(),
                automatic: true
            };
            try {
                unlinkOwnedTokenFile(requestedTokenFile, runInfo?.run, { allowMissing: true });
            } catch (tokenError) {
                state.cleanup.tokenFileRetained = true;
                state.cleanup.tokenFileErrorCode = tokenError?.code || 'SHOWCASE_TOKEN_FILE_OWNERSHIP_MISMATCH';
            }
            persistState(stateFile, state);
            throw primaryError;
        } catch (cleanupError) {
            if (cleanupError === primaryError) throw primaryError;
            await runtime.scheduleCleanupRecovery(state.runDatabaseId, cleanupError).catch(() => null);
            state.phase = 'cleanup_pending';
            state.cleanup = {
                status: 'cleanup_pending',
                errorCode: cleanupError?.code || 'SHOWCASE_CLEANUP_FAILED',
                automatic: true
            };
            persistState(stateFile, state);
            throw new AggregateError([primaryError, cleanupError], 'Timeline showcase failed and exact cleanup requires recovery');
        }
    }
}

async function planShowcase(manifest, options = {}, runtime = defaultRuntime()) {
    const session = await runtime.authenticate(manifest, options);
    const [live, database] = await Promise.all([
        runtime.livePreflight(manifest, session),
        runtime.databasePreflight(manifest)
    ]);
    return {
        success: true,
        manifest,
        manifestHash: manifestHash(manifest),
        readiness: {
            live: {
                release: live.release,
                userId: live.userId,
                lineCount: live.lineCount,
                roomCount: live.roomCount,
                productCount: live.productCount,
                visibleExistingBookingCount: live.visibleExistingBookingCount
            },
            database
        }
    };
}

async function verifyShowcase(manifest, options = {}, runtime = defaultRuntime()) {
    const stateFile = assertOperatorFilePath(options.stateFile, 'state file', { mustExist: true });
    const state = readState(stateFile, manifest);
    fail(Boolean(state?.runDatabaseId), 'Showcase recovery state has no run ID', 'SHOWCASE_VERIFY_RUN_ID_MISSING');
    const session = await runtime.authenticate(manifest, options);
    for (const fixture of manifest.bookingFixtures) {
        const entry = fixtureState(state, fixture);
        const recovered = await runtime.recoverFixture(manifest, fixture, state.runDatabaseId);
        fail(Boolean(recovered)
            && recovered.primaryBookingId === entry.primaryBookingId
            && JSON.stringify(recovered.bookingIds) === JSON.stringify(entry.bookingIds),
        'Showcase verify found fixture drift', 'SHOWCASE_VERIFY_FIXTURE_DRIFT', { key: fixture.key });
    }
    const batch = await runtime.verifyBatch(manifest, state, session);
    return sanitizedResult(manifest, state, { batch, verified: true });
}

async function cleanupShowcase(manifest, options = {}, runtime = defaultRuntime()) {
    const hash = manifestHash(manifest);
    fail(options.confirm === CLEANUP_CONFIRMATION, `Cleanup requires --confirm=${CLEANUP_CONFIRMATION}`, 'SHOWCASE_CLEANUP_CONFIRMATION_REQUIRED');
    fail(options.approvedHash === hash, 'Approved showcase manifest hash does not match', 'SHOWCASE_APPROVED_HASH_MISMATCH');
    const stateFile = assertOperatorFilePath(options.stateFile, 'state file', { mustExist: true });
    const state = readState(stateFile, manifest);
    const tokenFile = assertOperatorFilePath(options.tokenFile, 'token file');
    fail(path.resolve(state.tokenFile) === tokenFile,
        'Cleanup requires the explicit token path bound to recovery state',
        'SHOWCASE_STATE_TOKEN_PATH_MISMATCH');
    await runtime.assertLocalCheckout(manifest);
    const run = await runtime.lookupRun(manifest);
    fail(Boolean(run?.id), 'Trusted QA run is unavailable for cleanup', 'SHOWCASE_CLEANUP_RUN_MISSING');
    assertRunEnvelope(run, manifest, {
        allowedStates: ['active', 'cleanup_pending', 'blocked'],
        requireUnexpired: false
    });
    fail(!state.runDatabaseId || Number(state.runDatabaseId) === Number(run.id),
        'Cleanup state points to another Trusted QA run', 'SHOWCASE_CLEANUP_RUN_MISMATCH');
    assertOwnedTokenFile(tokenFile, run, { allowMissing: true });
    state.runDatabaseId = Number(run.id);
    state.phase = 'cleanup_running';
    persistState(stateFile, state);
    try {
        const cleanup = await runtime.cleanupRun(state.runDatabaseId);
        state.phase = 'cleaned';
        state.cleanup = {
            status: cleanup.status || cleanup.state || 'cleaned',
            cleanedAt: new Date().toISOString(),
            automatic: false
        };
        try {
            unlinkOwnedTokenFile(tokenFile, run, { allowMissing: true });
        } catch (tokenError) {
            state.cleanup.tokenFileRetained = true;
            state.cleanup.tokenFileErrorCode = tokenError?.code || 'SHOWCASE_TOKEN_FILE_OWNERSHIP_MISMATCH';
        }
        persistState(stateFile, state);
        return sanitizedResult(manifest, state, { cleanup: state.cleanup });
    } catch (error) {
        await runtime.scheduleCleanupRecovery(state.runDatabaseId, error).catch(() => null);
        state.phase = 'cleanup_pending';
        state.cleanup = { status: 'cleanup_pending', errorCode: error?.code || 'SHOWCASE_CLEANUP_FAILED', automatic: false };
        persistState(stateFile, state);
        throw error;
    }
}

function publicError(error) {
    if (error instanceof AggregateError) {
        return {
            success: false,
            code: 'SHOWCASE_AND_CLEANUP_FAILED',
            message: error.message,
            causes: error.errors.map(item => ({ code: item?.code || 'SHOWCASE_FAILED', message: cleanText(item?.message, 300) }))
        };
    }
    return {
        success: false,
        code: error?.code || 'TIMELINE_SHOWCASE_FAILED',
        message: cleanText(error?.message || 'Timeline showcase failed', 300),
        details: error?.details || undefined
    };
}

async function main() {
    const args = process.argv.slice(2);
    const mode = cleanText(argValue(args, '--mode', 'plan'), 30).toLowerCase();
    const manifestFile = argValue(args, '--manifest-file') || argValue(args, '--fixture-file') || argValue(args, '--plan-file');
    const options = {
        confirm: argValue(args, '--confirm'),
        approvedHash: argValue(args, '--approved-hash'),
        stateFile: argValue(args, '--state-file'),
        tokenFile: argValue(args, '--token-file'),
        outputFile: argValue(args, '--output-file'),
        secretFile: argValue(args, '--secret-file', DEFAULT_SECRET_FILE),
        credentialProfile: argValue(args, '--credential-profile', 'creator')
    };
    if (mode === 'prepare') {
        const blueprintFile = argValue(args, '--blueprint-file') || manifestFile;
        return prepareShowcase(readPreparationBlueprint(blueprintFile), options);
    }
    const manifest = readManifest(manifestFile);
    if (mode === 'plan') return planShowcase(manifest, options);
    if (mode === 'apply' || mode === 'create') return applyShowcase(manifest, options);
    if (mode === 'verify') return verifyShowcase(manifest, options);
    if (mode === 'cleanup') return cleanupShowcase(manifest, options);
    throw new TimelineShowcaseError(`Unsupported showcase mode: ${mode}`, 'SHOWCASE_MODE_UNSUPPORTED');
}

if (require.main === module) {
    main()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(JSON.stringify(publicError(error)));
            process.exitCode = 1;
        })
        .finally(() => pool.end().catch(() => {}));
}

module.exports = {
    APPLY_CONFIRMATION,
    CLEANUP_CONFIRMATION,
    MAX_FIXTURES,
    TimelineShowcaseError,
    applyShowcase,
    assertCheckoutFacts,
    assertExactRegistryRows,
    assertInternalFixtureCollisions,
    assertLocalCheckoutProof,
    assertNoUnrelatedCustomerBookings,
    assertOwnedTokenFile,
    assertPersistedLineIds,
    assertRunEnvelope,
    assertTrustedReadback,
    buildBookingPayload,
    canonicalExactFixtures,
    cleanupShowcase,
    compilePreparedManifest,
    exactFixtureEnvelope,
    initialState,
    manifestHash,
    normalizeManifest,
    normalizePreparationBlueprint,
    parseSecretAssignments,
    planShowcase,
    prepareShowcase,
    publicError,
    readManifest,
    readPreparationBlueprint,
    readState,
    requestIdForFixture,
    resolveExactQaCustomerId,
    stableValue,
    verifyShowcase
};
