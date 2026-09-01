'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const {
    createDisposableQaMarker,
    disposableQaMarkerFrom
} = require('./disposableQa');
const { insertHistory } = require('./historyLog');

const TRUSTED_QA_STATES = Object.freeze({
    ACTIVE: 'active',
    CLEANUP_PENDING: 'cleanup_pending',
    CLEANED: 'cleaned',
    BLOCKED: 'blocked'
});
const TRUSTED_QA_ENTITY_STATES = Object.freeze({
    ACTIVE: 'active',
    CLEANUP_PENDING: 'cleanup_pending',
    CLEANED: 'cleaned',
    BLOCKED: 'blocked'
});
const DEFAULT_MAX_ENTITY_COUNT = 25;
const DEFAULT_TTL_MINUTES = 30;
const MAX_TRUSTED_QA_BOOKING_FIXTURES = 100;
const WATCHDOG_BATCH_LIMIT = 10;
const WATCHDOG_MAX_ATTEMPTS = 5;
const TRUSTED_QA_BOOKING_FIXTURE_KEYS = new Set([
    'requestId',
    'programId',
    'productId',
    'lineId',
    'secondAnimatorLineId',
    'secondAnimator',
    'roomResourceId',
    'room',
    'date',
    'time',
    'duration',
    'status',
    'programCode',
    'programName',
    'label',
    'category',
    'hosts',
    'pinataMode',
    'pinataNumber'
]);
const TRUSTED_QA_FIXTURE_PAYLOAD_KEYS = new Set([
    'businessContext',
    'date',
    'time',
    'duration',
    'lineId',
    'programId',
    'productId',
    'programCode',
    'programName',
    'label',
    'category',
    'roomResourceId',
    'room',
    'customerId',
    'status',
    'hosts',
    'pinataMode',
    'pinataNumber',
    'secondAnimatorLineId',
    'secondAnimator'
]);
const TRUSTED_QA_ENTITY_TYPES = new Set([
    'booking',
    'banquet_group',
    'banquet_membership',
    'booking_banquet_link',
    'product'
]);
const TRUSTED_QA_CAPABILITY_STATUS = Object.freeze({
    READABLE: 'readable',
    ABSENT: 'absent',
    PERMISSION_DENIED: 'permission_denied',
    SCHEMA_MISMATCH: 'schema_mismatch',
    QUERY_FAILED: 'query_failed',
    UNSUPPORTED: 'unsupported'
});
const TRUSTED_QA_SIDE_EFFECT_CAPABILITIES = Object.freeze([
    { tableName: 'finance_transactions', required: true },
    { tableName: 'receipts', required: true },
    { tableName: 'banquet_deposits', required: true },
    { tableName: 'warehouse_stock_movements', required: true },
    { tableName: 'warehouse_history', required: true },
    { tableName: 'outbox_events', required: true },
    { tableName: 'event_queue', required: true },
    { tableName: 'rule_execution_log', required: true },
    { tableName: 'notification_outbox', required: true },
    { tableName: 'chat_messages', required: true },
    { tableName: 'announcements', required: true },
    { tableName: 'print_jobs', required: true },
    { tableName: 'loyalty_transactions', required: false },
    { tableName: 'gamification_events', required: false }
]);
const TRUSTED_QA_SIDE_EFFECT_TABLES = Object.freeze(
    TRUSTED_QA_SIDE_EFFECT_CAPABILITIES.map(capability => capability.tableName)
);

class TrustedQaRunError extends Error {
    constructor(message, code, details = {}, statusCode = 403) {
        super(message);
        this.name = 'TrustedQaRunError';
        this.code = code || 'TRUSTED_QA_RUN_ERROR';
        this.details = details || {};
        this.statusCode = statusCode;
        this.publicMessage = message;
    }
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function cleanText(value, max = 200) {
    return String(value || '').trim().slice(0, max);
}

function cleanId(value) {
    return cleanText(value, 120);
}

function dateOnly(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    }
    const normalized = cleanText(value, 40);
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function boundedNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function requestQaToken(req) {
    return String(
        req?.get?.('X-Disposable-QA-Token')
        || req?.get?.('X-QA-Run-Token')
        || req?.body?.qaRunToken
        || req?.body?.qa_run_token
        || ''
    ).trim();
}

function requestReplayKey(req) {
    return cleanText(
        req?.get?.('X-QA-Run-Request-Id')
        || req?.get?.('Idempotency-Key')
        || req?.body?.qaRunRequestId
        || req?.body?.qa_run_request_id
        || '',
        160
    );
}

function requestEndpointKey(req) {
    const method = cleanText(req?.method || 'POST', 12).toUpperCase();
    const path = cleanText(
        req?.route?.path
        || req?.path
        || req?.originalUrl
        || req?.url
        || '',
        240
    ).split('?')[0];
    const base = cleanText(req?.baseUrl || '', 160);
    const joined = (path.startsWith('/api/') || !base ? path : `${base}${path}`)
        .replace(/\/+/g, '/');
    const normalizedPath = joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
    return `${method} ${normalizedPath}`;
}

function parseJsonContainer(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function requestHeaderText(req, name) {
    return String(req?.get?.(name) || '').trim();
}

function normalizeAllowedEndpoints(value) {
    const parsed = parseJsonContainer(value);
    const raw = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' ? parsed : {});
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.endpoints) ? raw.endpoints : []);
    return list.map(item => {
        if (typeof item === 'string') return cleanText(item, 260);
        if (item && typeof item === 'object') {
            const method = cleanText(item.method || '*', 12).toUpperCase();
            const path = cleanText(item.path || item.endpoint || '', 240);
            return path ? `${method} ${path}` : '';
        }
        return '';
    }).filter(Boolean);
}

function trustedQaFixtureManifestError(message, details = {}, statusCode = 400) {
    return new TrustedQaRunError(
        message,
        'QA_RUN_FIXTURE_MANIFEST_INVALID',
        details,
        statusCode
    );
}

function normalizeFixtureText(value, field, max, { required = true, statusCode = 400 } = {}) {
    const scalar = typeof value === 'string'
        || (typeof value === 'number' && Number.isFinite(value));
    if (!scalar) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture is malformed',
            { field },
            statusCode
        );
    }
    const normalized = String(value ?? '').trim();
    if ((!normalized && required) || normalized.length > max) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture is malformed',
            { field },
            statusCode
        );
    }
    return normalized;
}

function normalizeTrustedQaBookingFixture(value, index = 0, options = {}) {
    const statusCode = options.statusCode || 400;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture must be an object',
            { fixtureIndex: index },
            statusCode
        );
    }
    const unknownKeys = Object.keys(value).filter(key => !TRUSTED_QA_BOOKING_FIXTURE_KEYS.has(key));
    if (unknownKeys.length) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture contains unsupported fields',
            { fixtureIndex: index, fields: unknownKeys.sort() },
            statusCode
        );
    }

    const requestId = normalizeFixtureText(value.requestId, 'requestId', 160, { statusCode });
    const programId = normalizeFixtureText(value.programId, 'programId', 120, { statusCode });
    const lineId = normalizeFixtureText(value.lineId, 'lineId', 120, { statusCode });
    const roomResourceId = normalizeFixtureText(value.roomResourceId, 'roomResourceId', 120, { statusCode });
    const room = normalizeFixtureText(value.room, 'room', 100, { statusCode });
    const date = normalizeFixtureText(value.date, 'date', 10, { statusCode });
    const time = normalizeFixtureText(value.time, 'time', 5, { statusCode });
    const duration = Number(value.duration);
    const parsedDate = Date.parse(`${date}T00:00:00.000Z`);
    const timeMatch = time.match(/^(\d{2}):(\d{2})$/);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(parsedDate)
        || new Date(parsedDate).toISOString().slice(0, 10) !== date) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture date is invalid',
            { fixtureIndex: index, field: 'date' },
            statusCode
        );
    }
    if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture time is invalid',
            { fixtureIndex: index, field: 'time' },
            statusCode
        );
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture duration is invalid',
            { fixtureIndex: index, field: 'duration' },
            statusCode
        );
    }

    const fixture = {
        requestId,
        programId,
        lineId,
        roomResourceId,
        room,
        date,
        time,
        duration
    };
    for (const [field, max] of [
        ['productId', 120],
        ['secondAnimatorLineId', 120],
        ['secondAnimator', 100],
        ['status', 32],
        ['programCode', 20],
        ['programName', 100],
        ['label', 100],
        ['category', 50],
        ['pinataNumber', 120]
    ]) {
        if (value[field] === undefined || value[field] === null || value[field] === '') continue;
        fixture[field] = normalizeFixtureText(value[field], field, max, { statusCode });
    }
    if (value.hosts !== undefined && value.hosts !== null && value.hosts !== '') {
        const hosts = Number(value.hosts);
        if (!Number.isInteger(hosts) || hosts < 1 || hosts > 20) {
            throw trustedQaFixtureManifestError(
                'Trusted QA booking fixture hosts is invalid',
                { fixtureIndex: index, field: 'hosts' },
                statusCode
            );
        }
        fixture.hosts = hosts;
    }
    if (value.pinataMode !== undefined && value.pinataMode !== null && value.pinataMode !== '') {
        const pinataMode = normalizeFixtureText(value.pinataMode, 'pinataMode', 20, { statusCode });
        if (!['none', 'park', 'client'].includes(pinataMode)) {
            throw trustedQaFixtureManifestError(
                'Trusted QA booking fixture pinataMode is invalid',
                { fixtureIndex: index, field: 'pinataMode' },
                statusCode
            );
        }
        fixture.pinataMode = pinataMode;
    }
    return fixture;
}

function normalizeTrustedQaBookingFixtures(value, options = {}) {
    const statusCode = options.statusCode || 400;
    const configuredMax = Number.parseInt(options.maxFixtures, 10);
    const maxFixtures = Number.isFinite(configuredMax)
        ? Math.max(1, Math.min(MAX_TRUSTED_QA_BOOKING_FIXTURES, configuredMax))
        : MAX_TRUSTED_QA_BOOKING_FIXTURES;
    if (!Array.isArray(value) || value.length < 1 || value.length > maxFixtures) {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixture manifest is outside bounded limits',
            { maxFixtures },
            statusCode
        );
    }
    const normalized = value.map((fixture, index) => (
        normalizeTrustedQaBookingFixture(fixture, index, { statusCode })
    ));
    const seenRequestIds = new Set();
    for (const fixture of normalized) {
        if (seenRequestIds.has(fixture.requestId)) {
            throw trustedQaFixtureManifestError(
                'Trusted QA booking fixture requestId must be unique',
                { requestId: fixture.requestId },
                statusCode
            );
        }
        seenRequestIds.add(fixture.requestId);
    }
    return normalized.sort((left, right) => left.requestId.localeCompare(right.requestId));
}

function normalizeTrustedQaAuthorizationManifest(value, options = {}) {
    const parsed = parseJsonContainer(value);
    const endpoints = normalizeAllowedEndpoints(parsed);
    if (Array.isArray(parsed)) return { endpoints, bookingFixtures: [] };
    if (!parsed || typeof parsed !== 'object') return { endpoints, bookingFixtures: [] };
    if (!Object.prototype.hasOwnProperty.call(parsed, 'bookingFixtures')) {
        return { endpoints, bookingFixtures: [] };
    }
    const unknownKeys = Object.keys(parsed).filter(key => !['endpoints', 'bookingFixtures'].includes(key));
    if (unknownKeys.length) {
        throw trustedQaFixtureManifestError(
            'Trusted QA authorization manifest contains unsupported fields',
            { fields: unknownKeys.sort() },
            options.statusCode || 400
        );
    }
    if (endpoints.length !== 1 || endpoints[0] !== 'POST /api/bookings') {
        throw trustedQaFixtureManifestError(
            'Trusted QA booking fixtures require the exact booking-create endpoint',
            { endpoints },
            options.statusCode || 400
        );
    }
    return {
        endpoints,
        bookingFixtures: normalizeTrustedQaBookingFixtures(parsed.bookingFixtures, options)
    };
}

function endpointAllowed(endpointKey, allowedEndpoints) {
    const endpoint = cleanText(endpointKey, 260);
    const allowed = normalizeAllowedEndpoints(allowedEndpoints);
    if (!allowed.length) return false;
    return allowed.some(item => {
        if (item === endpoint) return true;
        if (item.startsWith('* ')) return endpoint.endsWith(item.slice(2));
        if (item.endsWith('*')) return endpoint.startsWith(item.slice(0, -1));
        return false;
    });
}

function hasClientDisposableQaMarker(payload = {}) {
    const marker = disposableQaMarkerFrom(payload);
    return Boolean(marker && Object.keys(marker).length);
}

function qaPublicDetails(details = {}) {
    return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function requestUserId(req) {
    const parsed = Number.parseInt(req?.user?.id, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function bookingConstraintValue(booking, camel, snake = null) {
    return cleanText(booking?.[camel] ?? (snake ? booking?.[snake] : undefined), 120);
}

function bookingFixtureConstraintValue(booking, camel, snake = null) {
    return String(booking?.[camel] ?? (snake ? booking?.[snake] : undefined) ?? '').trim();
}

function bookingSecondAnimatorLineConstraintValue(booking = {}) {
    const extra = booking?.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)
        ? booking.extraData
        : safeJsonObject(booking?.extra_data);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    return String(
        booking?.secondAnimatorLineId
        ?? booking?.second_animator_line_id
        ?? workspace.secondAnimatorLineId
        ?? workspace.second_animator_line_id
        ?? ''
    ).trim();
}

function timeMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function trustedQaFixtureMismatch(fixture, field, code = 'QA_RUN_FIXTURE_MISMATCH') {
    throw new TrustedQaRunError(
        'QA run booking fixture mismatch',
        code,
        { entityType: 'booking', fixtureRequestId: fixture.requestId, field }
    );
}

function trustedQaCanonicalRoomFieldIsSafe(payload, key) {
    const canonicalRoomId = cleanId(payload?.roomResourceId);
    if (!canonicalRoomId) return false;
    if (key === 'room_resource_id') {
        return cleanId(payload.room_resource_id) === canonicalRoomId;
    }
    if (key === 'roomResourceType') {
        return cleanText(payload.roomResourceType, 20).toLowerCase() === 'room';
    }
    return false;
}

function assertTrustedQaFixtureSafePayload(req, booking) {
    const unsupportedFields = new Set();
    for (const payload of [req?.body, booking]) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
        for (const key of Object.keys(payload)) {
            if (!TRUSTED_QA_FIXTURE_PAYLOAD_KEYS.has(key)
                && !trustedQaCanonicalRoomFieldIsSafe(payload, key)) unsupportedFields.add(key);
        }
    }
    if (unsupportedFields.size) {
        throw new TrustedQaRunError(
            'QA run booking fixture payload contains unsafe fields',
            'QA_RUN_FIXTURE_UNSAFE_PAYLOAD',
            { fields: [...unsupportedFields].sort() }
        );
    }
}

function trustedQaFixtureAuthorizationHeaders(run, req) {
    const token = requestHeaderText(req, 'X-QA-Run-Token');
    const requestId = requestHeaderText(req, 'X-QA-Run-Request-Id');
    const missingHeaders = [];
    if (!token || token.length > 512) missingHeaders.push('X-QA-Run-Token');
    if (!requestId || requestId.length > 160) missingHeaders.push('X-QA-Run-Request-Id');
    if (missingHeaders.length) {
        throw new TrustedQaRunError(
            'QA run booking fixtures require authorization headers',
            'QA_RUN_FIXTURE_HEADERS_REQUIRED',
            { missingHeaders }
        );
    }
    if (!run?.token_hash || sha256(token) !== String(run.token_hash)) {
        throw new TrustedQaRunError(
            'QA run booking fixture token header mismatch',
            'QA_RUN_FIXTURE_TOKEN_MISMATCH',
            {}
        );
    }
    return { requestId };
}

function canonicalFixtureBookingTime(value) {
    const match = String(value || '').trim().match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) !== 0) return '';
    return `${match[1]}:${match[2]}`;
}

function assertBookingMatchesTrustedQaFixture(booking, fixture) {
    const bookingProgram = bookingFixtureConstraintValue(booking, 'programId', 'program_id');
    if (bookingProgram !== fixture.programId) {
        trustedQaFixtureMismatch(fixture, 'programId', 'QA_RUN_PROGRAM_MISMATCH');
    }
    const bookingProduct = (
        bookingFixtureConstraintValue(booking, 'productId', 'product_id')
        || bookingProgram
    );
    if (bookingProduct !== (fixture.productId || fixture.programId)) {
        trustedQaFixtureMismatch(fixture, 'productId', 'QA_RUN_PRODUCT_MISMATCH');
    }
    if (bookingFixtureConstraintValue(booking, 'lineId', 'line_id') !== fixture.lineId) {
        trustedQaFixtureMismatch(fixture, 'lineId', 'QA_RUN_LINE_MISMATCH');
    }
    if (bookingFixtureConstraintValue(booking, 'roomResourceId', 'room_resource_id') !== fixture.roomResourceId) {
        trustedQaFixtureMismatch(fixture, 'roomResourceId', 'QA_RUN_ROOM_MISMATCH');
    }
    if (bookingFixtureConstraintValue(booking, 'room') !== fixture.room) {
        trustedQaFixtureMismatch(fixture, 'room');
    }
    const bookingSecondAnimatorLineId = bookingSecondAnimatorLineConstraintValue(booking);
    if (bookingSecondAnimatorLineId !== (fixture.secondAnimatorLineId || '')) {
        trustedQaFixtureMismatch(
            fixture,
            'secondAnimatorLineId',
            'QA_RUN_SECOND_ANIMATOR_LINE_MISMATCH'
        );
    }
    if (dateOnly(bookingConstraintValue(booking, 'date')) !== fixture.date) {
        trustedQaFixtureMismatch(fixture, 'date', 'QA_RUN_DATE_MISMATCH');
    }
    if (canonicalFixtureBookingTime(bookingFixtureConstraintValue(booking, 'time')) !== fixture.time) {
        trustedQaFixtureMismatch(fixture, 'time');
    }
    if (!Number.isInteger(Number(booking?.duration)) || Number(booking?.duration) !== fixture.duration) {
        trustedQaFixtureMismatch(fixture, 'duration');
    }
    if (String(booking?.status ?? '').trim() !== (fixture.status || '')) {
        trustedQaFixtureMismatch(fixture, 'status');
    }
    for (const [field, camel, snake] of [
        ['programCode', 'programCode', 'program_code'],
        ['programName', 'programName', 'program_name'],
        ['label', 'label', null],
        ['category', 'category', null],
        ['secondAnimator', 'secondAnimator', null],
        ['pinataMode', 'pinataMode', 'pinata_mode'],
        ['pinataNumber', 'pinataNumber', 'pinata_number']
    ]) {
        if (bookingFixtureConstraintValue(booking, camel, snake) !== (fixture[field] || '')) {
            trustedQaFixtureMismatch(fixture, field);
        }
    }
    const bookingHasHosts = booking?.hosts !== undefined && booking?.hosts !== null && booking?.hosts !== '';
    if ((fixture.hosts === undefined && bookingHasHosts)
        || (fixture.hosts !== undefined
            && (!Number.isInteger(Number(booking?.hosts)) || Number(booking.hosts) !== fixture.hosts))) {
        trustedQaFixtureMismatch(fixture, 'hosts');
    }
}

function assertRunMatchesRequest(run, req, booking, businessContext) {
    const normalizedContext = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    if (normalizeBusinessContext(run.business_context || DEFAULT_BUSINESS_CONTEXT) !== normalizedContext) {
        throw new TrustedQaRunError('QA run business context mismatch', 'QA_RUN_CONTEXT_MISMATCH', { businessContext: normalizedContext });
    }
    if (run.state !== TRUSTED_QA_STATES.ACTIVE) {
        throw new TrustedQaRunError('QA run is not active', 'QA_RUN_NOT_ACTIVE', { state: run.state });
    }
    const expiresAt = Date.parse(String(run.expires_at || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new TrustedQaRunError('Invalid or expired QA run token', 'QA_RUN_TOKEN_EXPIRED', { businessContext: normalizedContext });
    }
    const userId = requestUserId(req);
    const requiredOperatorId = Number.parseInt(run.operator_user_id ?? run.required_operator_user_id, 10);
    if (Number.isFinite(requiredOperatorId) && userId !== requiredOperatorId) {
        throw new TrustedQaRunError('QA run operator mismatch', 'QA_RUN_OPERATOR_MISMATCH', { userId });
    }
    const requiredUserId = Number.parseInt(run.required_user_id, 10);
    if (Number.isFinite(requiredUserId) && userId !== requiredUserId) {
        throw new TrustedQaRunError('QA run user mismatch', 'QA_RUN_USER_MISMATCH', { userId });
    }
    const authorization = normalizeTrustedQaAuthorizationManifest(run.allowed_endpoints, {
        maxFixtures: run.max_entity_count,
        statusCode: 500
    });
    const endpointKey = requestEndpointKey(req);
    if (!endpointAllowed(endpointKey, authorization.endpoints)) {
        throw new TrustedQaRunError('QA run endpoint is not allowed', 'QA_RUN_ENDPOINT_NOT_ALLOWED', { endpoint: endpointKey });
    }
    let bookingFixture = null;
    if (authorization.bookingFixtures.length) {
        const { requestId } = trustedQaFixtureAuthorizationHeaders(run, req);
        bookingFixture = authorization.bookingFixtures.find(fixture => fixture.requestId === requestId) || null;
        if (!bookingFixture) {
            throw new TrustedQaRunError(
                'QA run request is absent from the exact booking fixture manifest',
                'QA_RUN_FIXTURE_NOT_ALLOWED',
                { requestId }
            );
        }
        assertTrustedQaFixtureSafePayload(req, booking);
        assertBookingMatchesTrustedQaFixture(booking, bookingFixture);
    }
    const expectedCustomer = cleanId(run.required_customer_id);
    if (expectedCustomer && cleanId(bookingConstraintValue(booking, 'customerId', 'customer_id')) !== expectedCustomer) {
        throw new TrustedQaRunError('QA run customer mismatch', 'QA_RUN_CUSTOMER_MISMATCH', { entityType: 'booking' });
    }
    const expectedProgram = bookingFixture ? '' : cleanId(run.required_program_id);
    if (expectedProgram && cleanId(bookingConstraintValue(booking, 'programId', 'program_id')) !== expectedProgram) {
        throw new TrustedQaRunError('QA run program mismatch', 'QA_RUN_PROGRAM_MISMATCH', { entityType: 'booking' });
    }
    const expectedProduct = bookingFixture ? '' : cleanId(run.required_product_id);
    const bookingProduct = cleanId(bookingConstraintValue(booking, 'productId', 'product_id') || bookingConstraintValue(booking, 'programId', 'program_id'));
    if (expectedProduct && bookingProduct !== expectedProduct) {
        throw new TrustedQaRunError('QA run product mismatch', 'QA_RUN_PRODUCT_MISMATCH', { entityType: 'booking' });
    }
    const expectedRoom = bookingFixture ? '' : cleanId(run.required_room_resource_id);
    if (expectedRoom && cleanId(bookingConstraintValue(booking, 'roomResourceId', 'room_resource_id')) !== expectedRoom) {
        throw new TrustedQaRunError('QA run room mismatch', 'QA_RUN_ROOM_MISMATCH', { entityType: 'booking' });
    }
    const expectedLine = bookingFixture ? '' : cleanId(run.required_line_id);
    if (expectedLine && cleanId(bookingConstraintValue(booking, 'lineId', 'line_id')) !== expectedLine) {
        throw new TrustedQaRunError('QA run timeline line mismatch', 'QA_RUN_LINE_MISMATCH', { entityType: 'booking' });
    }
    const expectedDate = dateOnly(run.allowed_date);
    if (expectedDate && dateOnly(bookingConstraintValue(booking, 'date')) !== expectedDate) {
        throw new TrustedQaRunError('QA run date mismatch', 'QA_RUN_DATE_MISMATCH', { entityType: 'booking' });
    }
    const start = timeMinutes(run.allowed_start_time);
    const end = timeMinutes(run.allowed_end_time);
    const bookingStart = timeMinutes(bookingConstraintValue(booking, 'time'));
    const duration = Number.parseInt(booking?.duration, 10) || 0;
    if (start !== null && end !== null
        && (bookingStart === null || bookingStart < start || bookingStart + duration > end)) {
        throw new TrustedQaRunError('QA run time window mismatch', 'QA_RUN_TIME_WINDOW_MISMATCH', { entityType: 'booking' });
    }
    return bookingFixture
        ? { endpointKey, bookingFixtureKey: bookingFixture.requestId }
        : { endpointKey };
}

async function createTrustedQaRun(queryable, options = {}) {
    const token = options.token || crypto.randomBytes(32).toString('base64url');
    const ttlMinutes = boundedNumber(options.ttlMinutes, DEFAULT_TTL_MINUTES, 1, 240);
    const maxEntityCount = boundedNumber(options.maxEntityCount, DEFAULT_MAX_ENTITY_COUNT, 1, 500);
    const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
    const authorizationInput = options.bookingFixtures === undefined
        ? options.allowedEndpoints
        : { endpoints: normalizeAllowedEndpoints(options.allowedEndpoints), bookingFixtures: options.bookingFixtures };
    const authorization = normalizeTrustedQaAuthorizationManifest(authorizationInput, {
        maxFixtures: maxEntityCount,
        statusCode: 400
    });
    const allowedEndpoints = authorization.endpoints;
    if (!allowedEndpoints.length) {
        throw new TrustedQaRunError('QA run requires allowed endpoints', 'QA_RUN_ENDPOINTS_REQUIRED', {}, 400);
    }
    const storedAuthorization = authorization.bookingFixtures.length
        ? authorization
        : allowedEndpoints;
    const runId = cleanText(options.runId || `qa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, 100);
    const result = await queryable.query(
        `INSERT INTO trusted_qa_runs
            (run_id, token_hash, source, business_context, operator_user_id, test_customer_marker,
             allowed_endpoints, max_entity_count, state, expires_at,
             required_operator_user_id, required_user_id, required_customer_id,
             required_program_id, required_product_id, required_room_resource_id,
             required_line_id, allowed_date, allowed_start_time, allowed_end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'active', NOW() + ($9::int * INTERVAL '1 minute'),
                  $10, $11, $12, $13, $14, $15, $16, $17::date, $18::time, $19::time)
         RETURNING *`,
        [
            runId,
            sha256(token),
            cleanText(options.source || 'trusted_qa', 100),
            businessContext,
            options.operatorUserId || options.requiredOperatorUserId || null,
            cleanText(options.testCustomerMarker || `${runId}:test_customer`, 200),
            JSON.stringify(storedAuthorization),
            maxEntityCount,
            ttlMinutes,
            options.requiredOperatorUserId || options.operatorUserId || null,
            options.requiredUserId || null,
            options.requiredCustomerId || null,
            options.requiredProgramId || null,
            options.requiredProductId || null,
            options.requiredRoomResourceId || null,
            options.requiredLineId || null,
            options.allowedDate || null,
            options.allowedStartTime || null,
            options.allowedEndTime || null
        ]
    );
    return { run: result.rows?.[0] || null, token };
}

async function loadTrustedQaRun(queryable, token, businessContext) {
    if (!token) return null;
    const result = await queryable.query(
        `SELECT *
           FROM trusted_qa_runs
          WHERE token_hash = $1
            AND business_context = $2
            AND state = 'active'
            AND expires_at > NOW()
          ORDER BY id DESC
          LIMIT 1`,
        [sha256(token), normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT)]
    );
    return result.rows?.[0] || null;
}

async function consumeTrustedQaToken(queryable, run, req, endpointKey) {
    const requestKey = requestReplayKey(req);
    if (!requestKey) {
        throw new TrustedQaRunError('QA run request id is required', 'QA_RUN_REQUEST_ID_REQUIRED', { endpoint: endpointKey });
    }
    try {
        // This lifecycle claim holds the run row lock inside the caller's
        // booking transaction until its exact entity manifest is registered.
        const lifecycleClaim = await queryable.query(
            `UPDATE trusted_qa_runs
                SET token_use_count = COALESCE(token_use_count, 0) + 1,
                    updated_at = NOW()
              WHERE id = $1
                AND state = 'active'
                AND expires_at > NOW()
              RETURNING id`,
            [run.id]
        );
        if (!lifecycleClaim.rowCount) {
            throw new TrustedQaRunError(
                'QA run is no longer active',
                'QA_RUN_NOT_ACTIVE',
                {},
                409
            );
        }
        const result = await queryable.query(
            `INSERT INTO trusted_qa_run_token_uses (run_id, request_key, endpoint)
             VALUES ($1, $2, $3)
             ON CONFLICT (run_id, request_key) DO NOTHING
             RETURNING id`,
            [run.id, requestKey, endpointKey]
        );
        if (!result.rowCount) {
            throw new TrustedQaRunError('QA run token request was already used', 'QA_RUN_TOKEN_REPLAYED', { requestKey });
        }
    } catch (err) {
        if (err instanceof TrustedQaRunError) throw err;
        if (/does not exist|undefined_table|undefined_column/i.test(String(err.message || err.code || ''))) {
            throw new TrustedQaRunError('Trusted QA replay table is not installed', 'QA_RUN_SCHEMA_MISSING', {}, 500);
        }
        throw err;
    }
}

function attachServerQaMarker(booking, run, bookingFixtureKey = '') {
    const marker = createDisposableQaMarker({
        runId: run.run_id,
        source: run.source,
        testCustomerMarker: run.test_customer_marker,
        kind: 'booking',
        createdAt: new Date().toISOString()
    });
    const normalizedFixtureKey = cleanText(bookingFixtureKey, 160);
    if (normalizedFixtureKey) marker.bookingFixtureKey = normalizedFixtureKey;
    const extra = booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)
        ? { ...booking.extraData }
        : safeJsonObject(booking.extra_data);
    extra.disposableQa = marker;
    booking.extraData = extra;
    delete booking.extra_data;
    booking.skipNotification = true;
    booking.skip_notification = true;
    return marker;
}

async function prepareTrustedQaBookingInput(queryable, req, booking = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const token = requestQaToken(req);
    const clientMarkerPresent = hasClientDisposableQaMarker(booking);
    if (!token && clientMarkerPresent) {
        throw new TrustedQaRunError(
            'Disposable QA marker requires a server-issued QA run token',
            'QA_MARKER_UNTRUSTED',
            { entityType: 'booking' }
        );
    }
    if (!token) {
        // A client flag is presentation input, not authorization to suppress
        // Telegram, rules, warehouse, CRM, or other business side effects.
        booking.skipNotification = false;
        booking.skip_notification = false;
        return {
            trusted: false,
            suppressSideEffects: false,
            run: null,
            marker: null
        };
    }
    if (req.__trustedQaContext?.trusted) {
        const match = assertRunMatchesRequest(req.__trustedQaContext.run, req, booking, businessContext);
        const marker = attachServerQaMarker(
            booking,
            req.__trustedQaContext.run,
            match.bookingFixtureKey
        );
        return { ...req.__trustedQaContext, ...match, marker };
    }
    const run = await loadTrustedQaRun(queryable, token, businessContext);
    if (!run) {
        throw new TrustedQaRunError(
            'Invalid or expired QA run token',
            'QA_RUN_TOKEN_INVALID',
            { businessContext: normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT) }
        );
    }
    const match = assertRunMatchesRequest(run, req, booking, businessContext);
    const { endpointKey, bookingFixtureKey } = match;
    await consumeTrustedQaToken(queryable, run, req, endpointKey);
    const marker = attachServerQaMarker(booking, run, bookingFixtureKey);
    const context = {
        trusted: true,
        suppressSideEffects: true,
        run,
        marker,
        ...match
    };
    req.__trustedQaContext = context;
    return context;
}

async function registeredEntityCount(queryable, runId) {
    const result = await queryable.query(
        'SELECT COUNT(*)::int AS count FROM trusted_qa_run_entities WHERE run_id = $1',
        [runId]
    );
    return Number(result.rows?.[0]?.count || 0);
}

async function registerQaEntity(queryable, qaContext, entityType, entityId, payload = {}) {
    if (!qaContext?.trusted || !qaContext.run?.id || !entityId) return { registered: false };
    const entity = cleanId(entityId);
    const normalizedType = cleanText(entityType, 80);
    if (!TRUSTED_QA_ENTITY_TYPES.has(normalizedType)) {
        throw new TrustedQaRunError(
            'Unsupported trusted QA entity type',
            'QA_RUN_ENTITY_TYPE_UNSUPPORTED',
            { entityType: normalizedType },
            409
        );
    }
    const runLock = await queryable.query(
        `SELECT id, max_entity_count, state
           FROM trusted_qa_runs
          WHERE id = $1
          FOR UPDATE`,
        [qaContext.run.id]
    );
    const lockedRun = runLock.rows?.[0];
    if (!lockedRun || lockedRun.state !== TRUSTED_QA_STATES.ACTIVE) {
        throw new TrustedQaRunError('QA run is not active', 'QA_RUN_NOT_ACTIVE', {
            state: lockedRun?.state || null
        });
    }
    const existing = await queryable.query(
        `SELECT id
           FROM trusted_qa_run_entities
          WHERE run_id = $1 AND entity_type = $2 AND entity_id = $3
          LIMIT 1`,
        [qaContext.run.id, normalizedType, entity]
    );
    const maxEntityCount = boundedNumber(
        lockedRun.max_entity_count,
        DEFAULT_MAX_ENTITY_COUNT,
        1,
        500
    );
    const count = await registeredEntityCount(queryable, qaContext.run.id);
    if (!existing.rowCount && count >= maxEntityCount) {
        throw new TrustedQaRunError(
            'QA run entity limit exceeded',
            'QA_RUN_ENTITY_LIMIT_EXCEEDED',
            { maxEntityCount },
            409
        );
    }
    await queryable.query(
        `INSERT INTO trusted_qa_run_entities
            (run_id, entity_type, entity_id, payload, cleanup_state)
         VALUES ($1, $2, $3, $4::jsonb, 'active')
         ON CONFLICT (run_id, entity_type, entity_id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING id`,
        [
            qaContext.run.id,
            normalizedType,
            entity,
            JSON.stringify({
                ...safeJsonObject(payload),
                registeredAt: new Date().toISOString()
            })
        ]
    );
    return { registered: true, entityId: entity, existed: Boolean(existing.rowCount) };
}

async function markTrustedQaRunCleanupPending(queryable, runId, reason = 'transport_failure') {
    const result = await queryable.query(
        `UPDATE trusted_qa_runs
            SET state = CASE WHEN state = 'cleaned' THEN state ELSE 'cleanup_pending' END,
                cleanup_last_error = $2,
                next_cleanup_at = COALESCE(next_cleanup_at, NOW()),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [runId, cleanText(reason, 500)]
    );
    return result.rows?.[0] || null;
}

async function markTrustedQaRunBlocked(queryable, runId, reason = 'trusted_qa_ownership_mismatch') {
    const result = await queryable.query(
        `UPDATE trusted_qa_runs
            SET state = CASE WHEN state = 'cleaned' THEN state ELSE 'blocked' END,
                blocked_reason = $2,
                cleanup_last_error = $2,
                next_cleanup_at = NULL,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [runId, cleanText(reason, 500)]
    );
    return result.rows?.[0] || null;
}

async function loadTrustedQaCleanupInventory(queryable, runId, { forUpdate = false } = {}) {
    const runResult = await queryable.query(
        `SELECT *
           FROM trusted_qa_runs
          WHERE id = $1
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [runId]
    );
    const run = runResult.rows?.[0] || null;
    if (!run) return null;
    const entityResult = await queryable.query(
        `SELECT *
           FROM trusted_qa_run_entities
          WHERE run_id = $1
          ORDER BY id
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [runId]
    );
    return { run, entities: entityResult.rows || [] };
}

function classifyCleanupInventory(inventory) {
    if (!inventory) return { status: 'missing_run', blockers: ['missing_run'] };
    const entities = inventory.entities || [];
    const active = entities.filter(row => row.cleanup_state !== TRUSTED_QA_ENTITY_STATES.CLEANED);
    return {
        status: active.length ? 'cleanup_pending' : 'cleaned',
        blockers: [],
        entityCount: entities.length,
        pendingEntityCount: active.length,
        bookingIds: entities
            .filter(row => row.entity_type === 'booking')
            .map(row => String(row.entity_id))
            .filter(Boolean)
            .sort()
    };
}

function entityIdsByType(inventory, entityType) {
    return [...new Set((inventory?.entities || [])
        .filter(row => row.entity_type === entityType)
        .map(row => cleanId(row.entity_id))
        .filter(Boolean))].sort();
}

async function relationExists(queryable, tableName) {
    const result = await queryable.query('SELECT to_regclass($1)::text AS relation_name', [tableName]);
    return Boolean(result.rows?.[0]?.relation_name);
}

function quoteTrustedQaIdent(value) {
    const ident = String(value || '').trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) {
        throw new TrustedQaRunError('Unsafe trusted QA SQL identifier', 'QA_RUN_UNSAFE_IDENTIFIER', {}, 500);
    }
    return `"${ident.replace(/"/g, '""')}"`;
}

function sanitizedQueryError(err) {
    const code = cleanText(err?.code || '', 80);
    const message = cleanText(err?.message || String(err || ''), 240);
    if (code === '42501' || /permission denied/i.test(message)) {
        return { status: TRUSTED_QA_CAPABILITY_STATUS.PERMISSION_DENIED, code, message: 'permission denied' };
    }
    if (code === '42P01' || /does not exist|undefined_table/i.test(message)) {
        return { status: TRUSTED_QA_CAPABILITY_STATUS.ABSENT, code, message: 'relation absent' };
    }
    if (code === '42703' || /undefined_column|column .* does not exist/i.test(message)) {
        return { status: TRUSTED_QA_CAPABILITY_STATUS.SCHEMA_MISMATCH, code, message: 'schema mismatch' };
    }
    return { status: TRUSTED_QA_CAPABILITY_STATUS.QUERY_FAILED, code, message };
}

async function trustedQaTableColumns(queryable, tableName) {
    const result = await queryable.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = ANY (current_schemas(false))
            AND table_name = $1
          ORDER BY ordinal_position`,
        [tableName]
    );
    return new Set((result.rows || []).map(row => String(row.column_name || '').trim()).filter(Boolean));
}

function trustedQaEntityRowIds(inventory) {
    return [...new Set((inventory?.entities || [])
        .map(row => Number.parseInt(row.id, 10))
        .filter(Number.isSafeInteger))];
}

function trustedQaSideEffectScope(inventory, bookingIds, groupIds) {
    return {
        runDbId: Number.parseInt(inventory?.run?.id, 10),
        runPublicId: cleanId(inventory?.run?.run_id),
        entityRowIds: trustedQaEntityRowIds(inventory),
        bookingIds: trustedQaTextArray(bookingIds),
        groupIds: trustedQaTextArray(groupIds),
        productIds: entityIdsByType(inventory, 'product')
    };
}

function trustedQaTextArray(values = []) {
    return [...new Set(values.map(cleanId).filter(Boolean))];
}

function buildTrustedQaAttributionClauses(columns, scope) {
    const clauses = [];
    const methods = [];
    const queryParams = [];
    const has = column => columns.has(column);
    const column = name => quoteTrustedQaIdent(name);
    const param = (value, cast) => {
        queryParams.push(value);
        return `$${queryParams.length}${cast ? `::${cast}` : ''}`;
    };
    if (has('trusted_qa_run_id') && Number.isSafeInteger(scope.runDbId)) {
        clauses.push(`${column('trusted_qa_run_id')} = ${param(scope.runDbId, 'int')}`);
        methods.push('trusted_qa_run_id');
    }
    if (has('trusted_qa_run_entity_id') && scope.entityRowIds.length) {
        clauses.push(`${column('trusted_qa_run_entity_id')} = ANY(${param(scope.entityRowIds, 'int[]')})`);
        methods.push('trusted_qa_run_entity_id');
    }
    if (has('run_id') && scope.runPublicId) {
        clauses.push(`${column('run_id')} = ${param(scope.runPublicId, 'text')}`);
        methods.push('run_id');
    }
    if (has('trusted_qa_run_public_id') && scope.runPublicId) {
        clauses.push(`${column('trusted_qa_run_public_id')} = ${param(scope.runPublicId, 'text')}`);
        methods.push('trusted_qa_run_public_id');
    }
    if (has('booking_id') && scope.bookingIds.length) {
        clauses.push(`${column('booking_id')} = ANY(${param(trustedQaTextArray(scope.bookingIds), 'text[]')})`);
        methods.push('booking_id');
    }
    if (has('primary_booking_id') && scope.bookingIds.length) {
        clauses.push(`${column('primary_booking_id')} = ANY(${param(trustedQaTextArray(scope.bookingIds), 'text[]')})`);
        methods.push('primary_booking_id');
    }
    if (has('source_booking_id') && scope.bookingIds.length) {
        clauses.push(`${column('source_booking_id')} = ANY(${param(trustedQaTextArray(scope.bookingIds), 'text[]')})`);
        methods.push('source_booking_id');
    }
    if (has('source_type') && has('source_id') && scope.bookingIds.length) {
        clauses.push(`(LOWER(${column('source_type')}::text) = 'booking' AND ${column('source_id')} = ANY(${param(trustedQaTextArray(scope.bookingIds), 'text[]')}))`);
        methods.push('source_type_booking');
    }
    if (has('banquet_group_id') && scope.groupIds.length) {
        clauses.push(`${column('banquet_group_id')} = ANY(${param(trustedQaTextArray(scope.groupIds), 'text[]')})`);
        methods.push('banquet_group_id');
    }
    if (has('group_id') && scope.groupIds.length) {
        clauses.push(`${column('group_id')} = ANY(${param(trustedQaTextArray(scope.groupIds), 'text[]')})`);
        methods.push('group_id');
    }
    if (has('source_type') && has('source_id') && scope.groupIds.length) {
        clauses.push(`(LOWER(${column('source_type')}::text) = 'banquet_group' AND ${column('source_id')} = ANY(${param(trustedQaTextArray(scope.groupIds), 'text[]')}))`);
        methods.push('source_type_banquet_group');
    }
    if (has('product_id') && scope.productIds.length) {
        clauses.push(`${column('product_id')} = ANY(${param(trustedQaTextArray(scope.productIds), 'text[]')})`);
        methods.push('product_id');
    }
    for (const correlationColumn of ['idempotency_key', 'correlation_id', 'request_id', 'request_key']) {
        if (has(correlationColumn) && scope.runPublicId) {
            clauses.push(`${column(correlationColumn)} = ${param(scope.runPublicId, 'text')}`);
            methods.push(correlationColumn);
        }
    }
    return {
        whereSql: clauses.length ? `(${clauses.join(' OR ')})` : '',
        attributionMethod: [...new Set(methods)].sort(),
        queryParams
    };
}

function trustedQaActiveSql(columns) {
    const column = name => quoteTrustedQaIdent(name);
    if (columns.has('status')) {
        return `LOWER(COALESCE(NULLIF(BTRIM(${column('status')}::text), ''), 'pending')) NOT IN (
            'processed', 'done', 'completed', 'complete', 'archived', 'cleaned',
            'cancelled', 'canceled', 'closed', 'resolved', 'sent', 'delivered',
            'skipped', 'ignored'
        )`;
    }
    if (columns.has('processed_at')) return `${column('processed_at')} IS NULL`;
    if (columns.has('archived_at')) return `${column('archived_at')} IS NULL`;
    if (columns.has('deleted_at')) return `${column('deleted_at')} IS NULL`;
    return 'TRUE';
}

function emptyTrustedQaCapability(capability, status, extra = {}) {
    const blocking = status === TRUSTED_QA_CAPABILITY_STATUS.PERMISSION_DENIED
        || status === TRUSTED_QA_CAPABILITY_STATUS.SCHEMA_MISMATCH
        || status === TRUSTED_QA_CAPABILITY_STATUS.QUERY_FAILED
        || (capability.required && status !== TRUSTED_QA_CAPABILITY_STATUS.ABSENT
            && status !== TRUSTED_QA_CAPABILITY_STATUS.UNSUPPORTED);
    return {
        tableName: capability.tableName,
        required: Boolean(capability.required),
        status,
        exactCount: 0,
        activeCount: 0,
        processedHistoricalCount: 0,
        attributionMethod: [],
        blocking,
        error: null,
        ...extra
    };
}

async function trustedQaSideEffectCapabilityInventory(queryable, capability, scope) {
    let exists = false;
    try {
        exists = await relationExists(queryable, capability.tableName);
    } catch (err) {
        const error = sanitizedQueryError(err);
        return emptyTrustedQaCapability(capability, error.status, { blocking: capability.required || error.status !== TRUSTED_QA_CAPABILITY_STATUS.ABSENT, error });
    }
    if (!exists) {
        return emptyTrustedQaCapability(capability, TRUSTED_QA_CAPABILITY_STATUS.ABSENT, {
            blocking: Boolean(capability.required)
        });
    }

    let columns;
    try {
        columns = await trustedQaTableColumns(queryable, capability.tableName);
    } catch (err) {
        const error = sanitizedQueryError(err);
        return emptyTrustedQaCapability(capability, error.status, { blocking: true, error });
    }
    const attribution = buildTrustedQaAttributionClauses(columns, scope);
    if (!attribution.whereSql) {
        return emptyTrustedQaCapability(capability, TRUSTED_QA_CAPABILITY_STATUS.UNSUPPORTED, {
            blocking: Boolean(capability.required),
            error: capability.required ? { code: 'NO_DURABLE_ATTRIBUTION', message: 'no supported exact attribution columns' } : null
        });
    }

    const activeSql = trustedQaActiveSql(columns);
    const tableSql = quoteTrustedQaIdent(capability.tableName);
    try {
        const result = await queryable.query(
            `SELECT COUNT(*)::int AS exact_count,
                    COUNT(*) FILTER (WHERE ${activeSql})::int AS active_count,
                    COUNT(*) FILTER (WHERE NOT (${activeSql}))::int AS processed_historical_count
               FROM ${tableSql}
              WHERE ${attribution.whereSql}`,
            attribution.queryParams
        );
        const row = result.rows?.[0] || {};
        const activeCount = Number(row.active_count || 0);
        return {
            tableName: capability.tableName,
            required: Boolean(capability.required),
            status: TRUSTED_QA_CAPABILITY_STATUS.READABLE,
            exactCount: Number(row.exact_count || 0),
            activeCount,
            processedHistoricalCount: Number(row.processed_historical_count || 0),
            attributionMethod: attribution.attributionMethod,
            blocking: activeCount > 0,
            error: null
        };
    } catch (err) {
        const error = sanitizedQueryError(err);
        return emptyTrustedQaCapability(capability, error.status, { blocking: true, error });
    }
}

async function trustedQaSideEffectInventory(queryable, inventory, bookingIds, groupIds, options = {}) {
    const scope = trustedQaSideEffectScope(inventory, bookingIds, groupIds);
    const hasBookingOrGroupScope = scope.bookingIds.length > 0 || scope.groupIds.length > 0;
    const allowUnsupportedNoAttribution = !hasBookingOrGroupScope && options.allowUnsupportedNoAttribution === true;
    const unsupportedNoAttributionReason = cleanText(options.unsupportedNoAttributionReason || (
        hasBookingOrGroupScope ? '' : 'no_booking_or_group_scope'
    ), 100);
    const capabilities = [];
    for (const capability of TRUSTED_QA_SIDE_EFFECT_CAPABILITIES) {
        const item = await trustedQaSideEffectCapabilityInventory(queryable, capability, scope);
        if ((!hasBookingOrGroupScope || allowUnsupportedNoAttribution)
            && item.status === TRUSTED_QA_CAPABILITY_STATUS.UNSUPPORTED
            && item.error?.code === 'NO_DURABLE_ATTRIBUTION') {
            capabilities.push({
                ...item,
                blocking: false,
                error: {
                    ...item.error,
                    reason: unsupportedNoAttributionReason || 'trusted_qa_suppression_proof'
                }
            });
            continue;
        }
        capabilities.push(item);
    }
    const counts = Object.fromEntries(capabilities.map(item => [item.tableName, item.activeCount]));
    const exactCounts = Object.fromEntries(capabilities.map(item => [item.tableName, item.exactCount]));
    const processedHistoricalCounts = Object.fromEntries(capabilities.map(item => [item.tableName, item.processedHistoricalCount]));
    const visibilityBlockers = capabilities.filter(item => item.blocking && item.activeCount === 0);
    const activeLeftovers = capabilities.filter(item => item.activeCount > 0);
    return {
        capabilities,
        counts,
        exactCounts,
        processedHistoricalCounts,
        total: activeLeftovers.reduce((sum, item) => sum + Number(item.activeCount || 0), 0),
        visibilityBlockers,
        blocking: activeLeftovers.length > 0 || visibilityBlockers.length > 0
    };
}

function assertTrustedQaBookingRows(rows, inventory, bookingIds) {
    const actualIds = rows.map(row => cleanId(row.id)).sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(bookingIds)) {
        throw new TrustedQaRunError(
            'Trusted QA booking manifest changed',
            'QA_RUN_BOOKING_MANIFEST_DRIFT',
            { expectedCount: bookingIds.length, actualCount: actualIds.length },
            409
        );
    }
    const run = inventory.run;
    const expectedContext = normalizeBusinessContext(run.business_context || DEFAULT_BUSINESS_CONTEXT);
    const requiredCustomerId = cleanId(run.required_customer_id);
    let customerMatched = !requiredCustomerId || rows.length === 0;
    for (const row of rows) {
        const marker = safeJsonObject(row.extra_data).disposableQa || {};
        if (normalizeBusinessContext(row.business_context || DEFAULT_BUSINESS_CONTEXT) !== expectedContext
            || cleanId(marker.runId) !== cleanId(run.run_id)
            || cleanText(marker.source, 100) !== cleanText(run.source, 100)
            || cleanText(marker.testCustomerMarker, 200) !== cleanText(run.test_customer_marker, 200)) {
            throw new TrustedQaRunError(
                'Trusted QA booking marker changed',
                'QA_RUN_BOOKING_MARKER_DRIFT',
                { bookingId: cleanId(row.id) },
                409
            );
        }
        if (requiredCustomerId && cleanId(row.customer_id) === requiredCustomerId) customerMatched = true;
        if (row.customer_id && requiredCustomerId && cleanId(row.customer_id) !== requiredCustomerId) {
            throw new TrustedQaRunError(
                'Trusted QA booking customer changed',
                'QA_RUN_CUSTOMER_MISMATCH',
                { bookingId: cleanId(row.id) },
                409
            );
        }
    }
    if (!customerMatched) {
        throw new TrustedQaRunError(
            'Trusted QA customer is absent from the exact booking set',
            'QA_RUN_CUSTOMER_MISMATCH',
            {},
            409
        );
    }
}

async function loadTrustedQaCleanupRows(queryable, inventory, bookingIds, groupIds) {
    const bookings = bookingIds.length ? await queryable.query(
        `SELECT id, business_context, status, customer_id, program_id, skip_notification, extra_data
           FROM bookings
          WHERE id = ANY($1::text[])
          ORDER BY id
          FOR UPDATE`,
        [bookingIds]
    ) : { rows: [] };
    const groups = groupIds.length ? await queryable.query(
        `SELECT id, business_context, status
           FROM banquet_groups
          WHERE id = ANY($1::text[])
          ORDER BY id
          FOR UPDATE`,
        [groupIds]
    ) : { rows: [] };
    assertTrustedQaBookingRows(bookings.rows || [], inventory, bookingIds);
    if ((groups.rows || []).length !== groupIds.length) {
        throw new TrustedQaRunError(
            'Trusted QA banquet group manifest changed',
            'QA_RUN_GROUP_MANIFEST_DRIFT',
            { expectedCount: groupIds.length, actualCount: groups.rows?.length || 0 },
            409
        );
    }
    return { bookings: bookings.rows || [], groups: groups.rows || [] };
}

function trustedQaBookingRowsSuppressSideEffects(rows = []) {
    return rows.every(row => row.skip_notification === true || String(row.skip_notification).toLowerCase() === 'true');
}

async function trustedQaRegisteredProductsHaveNoStockRequirements(queryable, inventory) {
    const productIds = entityIdsByType(inventory, 'product');
    if (!productIds.length) return false;
    const stockRequirementExists = await relationExists(queryable, 'product_stock_requirements');
    if (!stockRequirementExists) return true;
    const context = normalizeBusinessContext(inventory.run?.business_context || DEFAULT_BUSINESS_CONTEXT);
    const result = await queryable.query(
        `WITH manifest_products AS (
            SELECT UNNEST($1::text[]) AS product_id
        )
        SELECT COUNT(p.id)::int AS product_count,
               COUNT(psr.product_id)::int AS stock_requirement_count
          FROM manifest_products mp
          LEFT JOIN products p
            ON p.id::text = mp.product_id
           AND COALESCE(NULLIF(BTRIM(p.business_context), ''), $2) = $2
          LEFT JOIN product_stock_requirements psr
            ON psr.product_id::text = mp.product_id`,
        [productIds, context]
    );
    const row = result.rows?.[0] || {};
    return Number(row.product_count || 0) === productIds.length
        && Number(row.stock_requirement_count || 0) === 0;
}

async function trustedQaCleanupHasSuppressionProof(queryable, inventory, cleanupRows) {
    const bookingRows = cleanupRows?.bookings || [];
    if (!bookingRows.length) return false;
    if (!trustedQaBookingRowsSuppressSideEffects(bookingRows)) return false;
    return trustedQaRegisteredProductsHaveNoStockRequirements(queryable, inventory);
}

async function cleanupTrustedQaRun(queryable, runId, options = {}) {
    const inventory = await loadTrustedQaCleanupInventory(queryable, runId, { forUpdate: options.forUpdate === true });
    const classified = classifyCleanupInventory(inventory);
    if (!inventory) return classified;
    if (classified.status === 'cleaned') {
        await queryable.query(
            `UPDATE trusted_qa_runs
                SET state = 'cleaned', cleaned_at = COALESCE(cleaned_at, NOW()), updated_at = NOW()
              WHERE id = $1`,
            [runId]
        );
        return { ...classified, state: TRUSTED_QA_STATES.CLEANED, idempotent: true };
    }
    const unsupportedEntities = (inventory.entities || [])
        .filter(row => !TRUSTED_QA_ENTITY_TYPES.has(row.entity_type));
    if (unsupportedEntities.length) {
        throw new TrustedQaRunError(
            'Trusted QA cleanup found unsupported manifest entities',
            'QA_RUN_ENTITY_TYPE_UNSUPPORTED',
            { entityTypes: [...new Set(unsupportedEntities.map(row => row.entity_type))].sort() },
            409
        );
    }
    const bookingIds = classified.bookingIds;
    const groupIds = entityIdsByType(inventory, 'banquet_group');
    const productIds = entityIdsByType(inventory, 'product');
    const context = normalizeBusinessContext(inventory.run.business_context || DEFAULT_BUSINESS_CONTEXT);
    const cleanupRows = await loadTrustedQaCleanupRows(queryable, inventory, bookingIds, groupIds);
    const openTasks = bookingIds.length ? await queryable.query(
        `SELECT id
           FROM tasks
          WHERE source_type = 'booking'
            AND source_id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'todo')) NOT IN
                ('done', 'completed', 'complete', 'archived', 'cancelled', 'canceled', 'resolved', 'closed')
          ORDER BY id
          FOR UPDATE`,
        [bookingIds]
    ) : { rows: [] };
    if (openTasks.rows?.length) {
        throw new TrustedQaRunError(
            'Trusted QA cleanup found unexpected active tasks',
            'QA_RUN_ACTIVE_TASK_BLOCKER',
            { count: openTasks.rows.length },
            409
        );
    }
    const hasSuppressionProof = await trustedQaCleanupHasSuppressionProof(queryable, inventory, cleanupRows);
    const sideEffects = await trustedQaSideEffectInventory(queryable, inventory, bookingIds, groupIds, {
        allowUnsupportedNoAttribution: false,
        unsupportedNoAttributionReason: hasSuppressionProof ? 'trusted_qa_suppression_proof' : ''
    });
    if (sideEffects.visibilityBlockers?.length) {
        throw new TrustedQaRunError(
            'Trusted QA cleanup could not prove side-effect visibility',
            'QA_RUN_SIDE_EFFECT_VISIBILITY_BLOCKER',
            {
                capabilities: sideEffects.visibilityBlockers.map(item => ({
                    tableName: item.tableName,
                    status: item.status,
                    required: item.required,
                    error: item.error
                }))
            },
            409
        );
    }
    if (sideEffects.total > 0) {
        throw new TrustedQaRunError(
            'Trusted QA cleanup found persistent business side effects',
            'QA_RUN_SIDE_EFFECT_BLOCKER',
            {
                counts: sideEffects.counts,
                capabilities: sideEffects.capabilities
                    .filter(item => item.activeCount > 0)
                    .map(item => ({
                        tableName: item.tableName,
                        activeCount: item.activeCount,
                        exactCount: item.exactCount,
                        attributionMethod: item.attributionMethod
                    }))
            },
            409
        );
    }
    if (bookingIds.length) {
        await queryable.query(
            `UPDATE bookings
                SET status = 'cancelled',
                    skip_notification = true,
                    updated_at = NOW()
              WHERE id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2
                AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'`,
            [bookingIds, context]
        );
    }
    if (groupIds.length) {
        await queryable.query(
            `UPDATE banquet_groups
                SET status = 'cancelled',
                    updated_by = 'trusted_qa_cleanup',
                    updated_at = NOW()
              WHERE id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2
                AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'`,
            [groupIds, context]
        );
    }
    if (productIds.length) {
        await queryable.query(
            `UPDATE products
                SET is_active = false,
                    updated_by = 'trusted_qa_cleanup',
                    updated_at = NOW()
              WHERE id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2
                AND is_active = true`,
            [productIds, context]
        );
    }
    const activeAfter = bookingIds.length ? await queryable.query(
        `SELECT COUNT(*)::int AS count
           FROM bookings
          WHERE id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'`,
        [bookingIds]
    ) : { rows: [{ count: 0 }] };
    const activeGroupsAfter = groupIds.length ? await queryable.query(
        `SELECT COUNT(*)::int AS count
           FROM banquet_groups
          WHERE id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'`,
        [groupIds]
    ) : { rows: [{ count: 0 }] };
    const activeProductsAfter = productIds.length ? await queryable.query(
        `SELECT COUNT(*)::int AS count
           FROM products
          WHERE id = ANY($1::text[])
            AND is_active = true`,
        [productIds]
    ) : { rows: [{ count: 0 }] };
    if (Number(activeAfter.rows?.[0]?.count || 0)
        || Number(activeGroupsAfter.rows?.[0]?.count || 0)
        || Number(activeProductsAfter.rows?.[0]?.count || 0)) {
        throw new TrustedQaRunError(
            'Trusted QA cleanup postcondition failed',
            'QA_RUN_CLEANUP_POSTCONDITION_FAILED',
            {},
            409
        );
    }
    await queryable.query(
        `UPDATE trusted_qa_run_entities
            SET cleanup_state = 'cleaned',
                updated_at = NOW()
          WHERE run_id = $1`,
        [runId]
    );
    await queryable.query(
        `UPDATE trusted_qa_runs
            SET state = 'cleaned',
                cleaned_at = COALESCE(cleaned_at, NOW()),
                cleanup_last_error = NULL,
                next_cleanup_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [runId]
    );
    await insertHistory(queryable, {
        businessContext: inventory.run.business_context,
        action: 'trusted_qa_cleanup',
        username: 'trusted_qa_watchdog',
        data: {
            run_id: inventory.run.run_id,
            booking_count: bookingIds.length,
            group_count: groupIds.length,
            product_count: productIds.length,
            entity_count: classified.entityCount,
            purged_event_queue_count: 0
        }
    });
    return {
        ...classified,
        status: 'cleaned',
        state: TRUSTED_QA_STATES.CLEANED,
        cleanedBookingIds: bookingIds,
        cleanedGroupIds: groupIds,
        cleanedProductIds: productIds,
        sideEffectCounts: sideEffects.counts,
        sideEffectInventory: sideEffects.capabilities,
        sideEffectExactCounts: sideEffects.exactCounts,
        sideEffectProcessedHistoricalCounts: sideEffects.processedHistoricalCounts,
        purgedEventQueueIds: []
    };
}

async function runTrustedQaCleanupWatchdog(options = {}) {
    const batchLimit = boundedNumber(options.limit, WATCHDOG_BATCH_LIMIT, 1, 50);
    const maxAttempts = boundedNumber(options.maxAttempts, WATCHDOG_MAX_ATTEMPTS, 1, 20);
    const client = options.client || await pool.connect();
    const ownsClient = !options.client;
    const processed = [];
    try {
        await client.query('BEGIN');
        const exactRunDatabaseId = options.runDatabaseId === undefined || options.runDatabaseId === null
            ? null
            : Number(options.runDatabaseId);
        if (exactRunDatabaseId !== null && (!Number.isInteger(exactRunDatabaseId) || exactRunDatabaseId <= 0)) {
            throw new TrustedQaRunError('Trusted QA watchdog run ID is invalid', 'QA_RUN_WATCHDOG_RUN_ID_INVALID', {}, 400);
        }
        const allowedSources = Array.isArray(options.allowedSources)
            ? [...new Set(options.allowedSources.map(value => cleanText(value, 100)).filter(Boolean))]
            : [];
        const result = await client.query(
            `SELECT *
               FROM trusted_qa_runs
              WHERE COALESCE(cleanup_attempts, 0) < $1
                AND ($3::bigint IS NULL OR id = $3)
                AND (CARDINALITY($4::text[]) = 0 OR source = ANY($4::text[]))
                AND (
                    (state = 'cleanup_pending'
                        AND (next_cleanup_at IS NULL OR next_cleanup_at <= NOW()))
                    OR (state = 'active' AND expires_at <= NOW())
                )
              ORDER BY CASE
                    WHEN state = 'active' THEN expires_at
                    ELSE COALESCE(next_cleanup_at, updated_at)
                END ASC,
                updated_at ASC
              LIMIT $2
              FOR UPDATE SKIP LOCKED`,
            [maxAttempts, batchLimit, exactRunDatabaseId, allowedSources]
        );
        for (const run of result.rows || []) {
            await client.query('SAVEPOINT trusted_qa_cleanup_run');
            try {
                await client.query(
                    `UPDATE trusted_qa_runs
                        SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1,
                            cleanup_last_attempt_at = NOW(),
                            updated_at = NOW()
                      WHERE id = $1`,
                    [run.id]
                );
                const cleanup = await cleanupTrustedQaRun(client, run.id, { forUpdate: true });
                await client.query('RELEASE SAVEPOINT trusted_qa_cleanup_run');
                processed.push({ runId: run.run_id, status: cleanup.status, state: cleanup.state });
            } catch (err) {
                await client.query('ROLLBACK TO SAVEPOINT trusted_qa_cleanup_run');
                const nextDelay = Math.min(60, Math.pow(2, Number(run.cleanup_attempts || 0)));
                await client.query(
                    `UPDATE trusted_qa_runs
                        SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1,
                            cleanup_last_attempt_at = NOW(),
                            state = CASE WHEN COALESCE(cleanup_attempts, 0) + 1 >= $3 THEN 'blocked' ELSE 'cleanup_pending' END,
                            cleanup_last_error = $2,
                            blocked_reason = CASE WHEN COALESCE(cleanup_attempts, 0) + 1 >= $3 THEN $2 ELSE blocked_reason END,
                            next_cleanup_at = NOW() + ($4::int * INTERVAL '1 minute'),
                            updated_at = NOW()
                      WHERE id = $1`,
                    [run.id, cleanText(err.message, 500), maxAttempts, nextDelay]
                );
                await client.query('RELEASE SAVEPOINT trusted_qa_cleanup_run');
                processed.push({ runId: run.run_id, status: 'retry_scheduled', errorCode: err.code || 'cleanup_failed' });
            }
        }
        await client.query('COMMIT');
        return { processed: processed.length, runs: processed };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        if (ownsClient) client.release();
    }
}

module.exports = {
    DEFAULT_MAX_ENTITY_COUNT,
    MAX_TRUSTED_QA_BOOKING_FIXTURES,
    TRUSTED_QA_CAPABILITY_STATUS,
    TRUSTED_QA_ENTITY_STATES,
    TRUSTED_QA_SIDE_EFFECT_CAPABILITIES,
    TRUSTED_QA_SIDE_EFFECT_TABLES,
    TRUSTED_QA_STATES,
    TrustedQaRunError,
    assertBookingMatchesTrustedQaFixture,
    assertRunMatchesRequest,
    assertTrustedQaFixtureSafePayload,
    classifyCleanupInventory,
    cleanupTrustedQaRun,
    createTrustedQaRun,
    endpointAllowed,
    hasClientDisposableQaMarker,
    loadTrustedQaCleanupInventory,
    loadTrustedQaRun,
    markTrustedQaRunBlocked,
    markTrustedQaRunCleanupPending,
    normalizeAllowedEndpoints,
    normalizeTrustedQaAuthorizationManifest,
    normalizeTrustedQaBookingFixture,
    normalizeTrustedQaBookingFixtures,
    prepareTrustedQaBookingInput,
    qaPublicDetails,
    registerQaEntity,
    requestEndpointKey,
    requestQaToken,
    requestReplayKey,
    runTrustedQaCleanupWatchdog,
    sha256,
    trustedQaSideEffectInventory
};
