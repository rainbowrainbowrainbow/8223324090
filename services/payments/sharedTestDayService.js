'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { authorizeFiscalActorAction } = require('./fiscalAccess');
const { loadCheckboxRuntimeConfig, isCheckboxIntegrationEnabled, isCheckboxPaymentAcceptanceEnabled } = require('../checkbox/config');
const { createProviderFromConfig, normalizeShiftResponse, getCurrentShiftWithAbsenceProof } = require('../checkbox/provider');
const { countFiscalShiftCloseBlockers } = require('./shiftCloseBlockers');
const { TestDrainError, lockFiscalRegister, loadActiveTestDrain } = require('./testDrainGate');

async function transaction(dbPool, work) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new TestDrainError('shared_test_idempotency_conflict');
        throw error;
    } finally { client.release(); }
}

function positiveId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TestDrainError('shared_test_id_invalid', 422);
    return id;
}

function requestKey(action, key) {
    const value = String(key || '').trim();
    if (!value || value.length > 255) throw new TestDrainError('idempotency_key_required', 400);
    return `${action}:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function projectDrain(row) {
    return row ? { id: Number(row.id), shiftId: Number(row.fiscal_shift_id), status: row.status,
        startedAt: row.started_at, closedAt: row.closed_at, resumedAt: row.resumed_at } : null;
}

async function authorizeScope(client, { user, shiftId, routeOptionId }) {
    const { loadAndAuthorizePhase1CloseShift, loadPhase1CloseFiscalBinding } = require('./paymentReadinessService');
    const shift = await loadAndAuthorizePhase1CloseShift(client, { user, shiftId, requireProviderOpen: false });
    await lockFiscalRegister(client, shift.fiscal_profile_id, shift.fiscal_register_id);
    // Rehydrate current authority in every transaction, including after provider I/O.
    // Keep the user row locked until commit so a concurrent revocation serializes here.
    try {
        user = await require('../../middleware/auth').loadAuthenticatedUserAccess(user, {
            db: client, requireFresh: true, lockUser: true, includeStaffProfile: false
        });
    } catch (error) {
        if (error?.isAuthSessionError) throw new TestDrainError(error.code, 401);
        throw error;
    }
    const locked = await loadAndAuthorizePhase1CloseShift(client, { user, shiftId, lock: true, requireProviderOpen: false });
    if (String(locked.fiscal_profile_id) !== String(shift.fiscal_profile_id)
        || String(locked.fiscal_register_id) !== String(shift.fiscal_register_id)) throw new TestDrainError('shared_test_scope_changed');
    const routes = (await client.query(`SELECT * FROM fiscal_sale_routes
        WHERE fiscal_register_id = $1 ORDER BY route_option_id FOR SHARE`, [shift.fiscal_register_id])).rows;
    const expected = { dar_test: 'dar', park_test: 'event_genix' };
    if (routes.length !== 2 || !routes.every(route => expected[route.route_option_id] === route.business_context
        && route.mode === 'test' && route.expected_is_test === true
        && String(route.fiscal_profile_id) === String(locked.fiscal_profile_id)
        && String(route.fiscal_location_id) === String(locked.fiscal_location_id)
        && route.shared_register_group && route.shared_register_group === routes[0].shared_register_group)
        || !expected[routeOptionId] || expected[routeOptionId] !== locked.business_context
        || !['true', '1'].includes(String(locked.register_expected_is_test).toLowerCase())) {
        throw new TestDrainError('shared_test_scope_mismatch');
    }
    for (const route of routes) await authorizeFiscalActorAction(client, { user, action: 'fiscal.shift.close', crmProfileKey: route.business_context });
    const binding = await loadPhase1CloseFiscalBinding(client, locked);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        routes: routes.map(route => [route.route_option_id, route.business_context, String(route.fiscal_profile_id),
            String(route.fiscal_location_id), String(route.fiscal_register_id), route.shared_register_group, route.expected_is_test]),
        shift: [String(locked.id), locked.provider_shift_id, locked.provider_organization_id, locked.provider_outlet_id,
            locked.provider_register_id, String(binding.id), String(binding.user_id), binding.provider_cashier_id]
    })).digest('hex');
    return { shift: locked, binding, routes, fingerprint };
}

function assertOwner(row, scope, user, routeOptionId) {
    if (String(row.initiated_by_user_id) !== String(user?.id) || row.initiating_route_option_id !== routeOptionId) {
        throw new TestDrainError('shared_test_owner_mismatch', 403);
    }
    if (row.scope_fingerprint !== scope.fingerprint) throw new TestDrainError('shared_test_scope_changed');
}

async function readProviderEvidence(scope, { env, fetchImpl }) {
    if (!isCheckboxIntegrationEnabled(env)) throw new TestDrainError('checkbox_integration_disabled', 503);
    const { shift, binding } = scope;
    const config = loadCheckboxRuntimeConfig({ env, credentialRef: binding.provider_cashier_login_ref,
        licenseRef: shift.provider_license_ref, expectedIsTest: true });
    // These lifecycle actions must never authenticate, open/close a shift, or send a receipt.
    // Existing cached provider access is required; expiry leaves the durable stop active.
    const readOnlyFetch = (url, options = {}) => {
        if (String(options.method || 'GET').toUpperCase() !== 'GET') throw new TestDrainError('shared_test_provider_read_access_required', 503);
        return (fetchImpl || globalThis.fetch)(url, options);
    };
    const provider = createProviderFromConfig(config, { fetchImpl: readOnlyFetch });
    const expected = { expectedCashierId: binding.provider_cashier_id, expectedOrganizationId: shift.provider_organization_id,
        expectedRegisterId: shift.provider_register_id, expectedIsTest: true };
    const observedAt = Date.now();
    const readiness = await provider.verifyReadiness(expected, { requireSalesPermission: false });
    const current = await getCurrentShiftWithAbsenceProof(provider.client, expected, readiness.register);
    const currentShift = current.absent ? null : normalizeShiftResponse(current.payload, expected, { requireCashier: false });
    const detailed = normalizeShiftResponse(await provider.client.getShiftById({ shiftId: shift.provider_shift_id }),
        { ...expected, expectedShiftId: shift.provider_shift_id }, { requireCashier: true });
    return { observedAt, status: detailed.status, shiftId: detailed.id, currentShift };
}

function assertEvidence(evidence, scope, status) {
    if (!evidence || !Number.isFinite(evidence.observedAt) || Date.now() - evidence.observedAt > 30_000 || evidence.observedAt > Date.now()
        || evidence.status !== status || String(evidence.shiftId) !== String(scope.shift.provider_shift_id)
        || (evidence.currentShift && (evidence.currentShift.id !== evidence.shiftId || evidence.currentShift.status !== status))
        || (status === 'OPENED' && !evidence.currentShift)) throw new TestDrainError('shared_test_provider_evidence_invalid');
}

async function audit(client, row, actorId) {
    await client.query(`INSERT INTO fiscal_audit_events
        (fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, idempotency_key, after_snapshot)
        VALUES ($1, $2, $3, 'fiscal_register_payment_drains', $4, $5, $6::jsonb)`,
    [row.fiscal_profile_id, actorId, `shared_test_${row.status}`, row.id, `shared_test_${row.status}:${row.id}`, JSON.stringify(projectDrain(row))]);
}

async function resultFor(client, row, scope, env, replayed = false) {
    const active = await loadActiveTestDrain(client, row.fiscal_profile_id, row.fiscal_register_id);
    return { drain: projectDrain(row), activeDrain: projectDrain(active), replayed,
        localDrainBlocked: Boolean(active),
        paymentAcceptanceEnabled: isCheckboxIntegrationEnabled(env) && isCheckboxPaymentAcceptanceEnabled(env)
            && scope.shift.acceptance_enabled === true && scope.routes.every(route => route.acceptance_enabled === true),
        requiresReadinessRefresh: true };
}

async function findReplay(client, action, key, targetId, scope, user, routeOptionId) {
    const column = action === 'drain' ? 'drain_idempotency_key' : 'resume_idempotency_key';
    const keyed = (await client.query(`SELECT * FROM fiscal_register_payment_drains WHERE ${column} = $1`, [key])).rows[0];
    if (keyed && (String(action === 'drain' ? keyed.fiscal_shift_id : keyed.id) !== String(targetId)
        || String(keyed.initiated_by_user_id) !== String(user?.id) || keyed.initiating_route_option_id !== routeOptionId)) {
        throw new TestDrainError('shared_test_idempotency_conflict');
    }
    const target = (await client.query(`SELECT * FROM fiscal_register_payment_drains
        WHERE ${action === 'drain' ? 'fiscal_shift_id' : 'id'} = $1 FOR UPDATE`, [targetId])).rows[0];
    if (target) assertOwner(target, scope, user, routeOptionId);
    return target || null;
}

async function requestSharedTestDrain({ dbPool = pool, user, shiftId, routeOptionId, idempotencyKey, body = {}, env = process.env, fetchImpl } = {}) {
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) throw new TestDrainError('shared_test_body_invalid', 422);
    const id = positiveId(shiftId);
    const key = requestKey('drain', idempotencyKey);
    const prepare = client => authorizeScope(client, { user, shiftId: id, routeOptionId });
    const preflight = await transaction(dbPool, async client => {
        const scope = await prepare(client);
        const row = await findReplay(client, 'drain', key, id, scope, user, routeOptionId);
        if (row) return { result: await resultFor(client, row, scope, env, true) };
        if (await loadActiveTestDrain(client, scope.shift.fiscal_profile_id, scope.shift.fiscal_register_id)) throw new TestDrainError('shared_test_drain_shift_conflict');
        if (scope.shift.lifecycle_stage !== 'OPENED' || scope.shift.status !== 'open') throw new TestDrainError('shift_not_provider_open');
        return { scope };
    });
    if (preflight.result) return preflight.result;
    const evidence = await readProviderEvidence(preflight.scope, { env, fetchImpl });
    return transaction(dbPool, async client => {
        const scope = await prepare(client);
        const replay = await findReplay(client, 'drain', key, id, scope, user, routeOptionId);
        if (replay) return resultFor(client, replay, scope, env, true);
        if (scope.fingerprint !== preflight.scope.fingerprint) throw new TestDrainError('shared_test_scope_changed');
        assertEvidence(evidence, scope, 'OPENED');
        if (scope.shift.lifecycle_stage !== 'OPENED' || scope.shift.status !== 'open') throw new TestDrainError('shift_not_provider_open');
        if (await loadActiveTestDrain(client, scope.shift.fiscal_profile_id, scope.shift.fiscal_register_id)) throw new TestDrainError('shared_test_drain_shift_conflict');
        const row = (await client.query(`INSERT INTO fiscal_register_payment_drains
            (fiscal_profile_id, fiscal_register_id, fiscal_shift_id, initiating_route_option_id, scope_fingerprint,
             initiated_by_user_id, drain_idempotency_key, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'draining') RETURNING *`,
        [scope.shift.fiscal_profile_id, scope.shift.fiscal_register_id, id, routeOptionId, scope.fingerprint, user.id, key])).rows[0];
        await audit(client, row, user.id);
        return resultFor(client, row, scope, env);
    });
}

async function assertResumeLocal(client, row, scope) {
    if (row.status !== 'closed' || scope.shift.status !== 'closed' || scope.shift.lifecycle_stage !== 'CLOSED') {
        throw new TestDrainError('shared_test_drain_not_closed');
    }
    const active = await loadActiveTestDrain(client, row.fiscal_profile_id, row.fiscal_register_id);
    if (String(active?.id) !== String(row.id)) throw new TestDrainError('shared_test_active_drain_changed');
    const close = (await client.query(`SELECT status FROM fiscal_operations WHERE id = $1
        AND fiscal_shift_id = $2 AND fiscal_profile_id = $3 AND fiscal_register_id = $4
        AND operation_type = 'shift_close'`, [scope.shift.close_operation_id, scope.shift.id, row.fiscal_profile_id, row.fiscal_register_id])).rows[0];
    if (close?.status !== 'fiscalized') throw new TestDrainError('shared_test_close_not_verified');
    if (await countFiscalShiftCloseBlockers(client, { fiscalProfileId: row.fiscal_profile_id, fiscalRegisterId: row.fiscal_register_id })) {
        throw new TestDrainError('shared_test_resume_blocked_unresolved');
    }
    const other = await client.query(`SELECT id FROM fiscal_shifts WHERE fiscal_register_id = $1
        AND id <> $2 AND (id > $2 OR lifecycle_stage IN ('CREATED','OPENING','OPENED','CLOSING')) LIMIT 1`, [row.fiscal_register_id, row.fiscal_shift_id]);
    if (other.rows.length) throw new TestDrainError('shared_test_other_shift_exists');
}

async function requestSharedTestResume({ dbPool = pool, user, drainId, routeOptionId, idempotencyKey, body, env = process.env, fetchImpl } = {}) {
    if (!body || body.confirmNextTestDay !== true || Object.keys(body).length !== 1) throw new TestDrainError('shared_test_confirmation_required', 422);
    const id = positiveId(drainId);
    const key = requestKey('resume', idempotencyKey);
    const prepare = async client => {
        const row = (await client.query('SELECT * FROM fiscal_register_payment_drains WHERE id = $1', [id])).rows[0];
        if (!row) throw new TestDrainError('shared_test_drain_not_found', 404);
        const scope = await authorizeScope(client, { user, shiftId: row.fiscal_shift_id, routeOptionId });
        const current = await findReplay(client, 'resume', key, id, scope, user, routeOptionId);
        return { row: current, scope };
    };
    const preflight = await transaction(dbPool, async client => {
        const context = await prepare(client);
        if (context.row.status === 'resumed') return { result: await resultFor(client, context.row, context.scope, env, true) };
        await assertResumeLocal(client, context.row, context.scope);
        return context;
    });
    if (preflight.result) return preflight.result;
    const evidence = await readProviderEvidence(preflight.scope, { env, fetchImpl });
    return transaction(dbPool, async client => {
        const { row, scope } = await prepare(client);
        if (row.status === 'resumed') return resultFor(client, row, scope, env, true);
        if (scope.fingerprint !== preflight.scope.fingerprint) throw new TestDrainError('shared_test_scope_changed');
        assertEvidence(evidence, scope, 'CLOSED');
        await assertResumeLocal(client, row, scope);
        const resumed = (await client.query(`UPDATE fiscal_register_payment_drains SET status='resumed',
            resumed_at=clock_timestamp(), resumed_by_user_id=$2, resume_idempotency_key=$3 WHERE id=$1 RETURNING *`, [id, user.id, key])).rows[0];
        await audit(client, resumed, user.id);
        return resultFor(client, resumed, scope, env);
    });
}

async function loadSharedTestDayState(client, { user, shift, routeOptionId, profileId, registerId }) {
    const active = await loadActiveTestDrain(client, profileId, registerId);
    const state = { visible: false, canDrain: false, canResume: false, activeDrain: projectDrain(active),
        localDrainBlocked: Boolean(active), reasonCode: active ? 'shared_test_register_draining' : 'ready' };
    if (!shift || !['park_test', 'dar_test'].includes(routeOptionId)) return state;
    try {
        const scope = await authorizeScope(client, { user, shiftId: active?.fiscal_shift_id || shift.id, routeOptionId });
        if (active) assertOwner(active, scope, user, routeOptionId);
        state.visible = true;
        state.canDrain = !active && scope.shift.status === 'open' && scope.shift.lifecycle_stage === 'OPENED';
        if (active?.status === 'closed') {
            await assertResumeLocal(client, active, scope);
            state.canResume = true; // Provider evidence is refreshed only on the explicit mutation.
        }
    } catch (error) {
        if (!['TestDrainError', 'FiscalAccessError', 'PaymentReadinessError'].includes(error.name)) throw error;
        state.reasonCode = error.code;
    }
    return state;
}

module.exports = { requestSharedTestDrain, requestSharedTestResume, loadSharedTestDayState, authorizeScope, projectDrain, readProviderEvidence, assertEvidence };
