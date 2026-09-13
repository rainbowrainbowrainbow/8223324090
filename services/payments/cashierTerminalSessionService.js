'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { canUseAction, loadAuthenticatedUserAccess } = require('../../middleware/auth');
const { canAccessBusinessContext } = require('../businessContext');
const { applyMembershipAccess, loadMembershipAccess } = require('../businessMembership');
const { PaymentServiceError } = require('./paymentService');
const { evaluatePinChallenge, sanitizePin } = require('./fiscalApprovals');
const { resolveFiscalSaleRoute } = require('./fiscalSaleRouteService');

const TERMINAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TERMINAL_PIN_MAX_ATTEMPTS = 5;
const TERMINAL_PIN_LOCK_MS = 15 * 60 * 1000;
const TERMINAL_REQUIRED_ACTIONS = Object.freeze(['payments.create', 'payments.confirm_received']);
const TERMINAL_MUTATION_ACTIONS = Object.freeze(new Set(['payments.create', 'payments.confirm_received']));

function normalizePositiveId(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizePublicId(value) {
    const text = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text.toLowerCase()
        : '';
}

function sessionIdFromRequest(req) {
    return normalizePublicId(
        req?.get?.('X-Cashier-Terminal-Session')
        || req?.get?.('x-cashier-terminal-session')
        || req?.body?.terminalSessionId
        || req?.body?.terminal_session_id
        || req?.query?.terminalSessionId
        || req?.query?.terminal_session_id
    );
}

function sessionVersionFromRequest(req) {
    const value = req?.get?.('X-Cashier-Terminal-Version')
        || req?.get?.('x-cashier-terminal-version')
        || req?.body?.terminalSessionVersion
        || req?.body?.terminal_session_version
        || req?.query?.terminalSessionVersion
        || req?.query?.terminal_session_version;
    const version = Number(value);
    return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function assertTerminalLaunchAllowed(user, businessContext) {
    if (!user?.id) {
        throw new PaymentServiceError('terminal_authentication_required', 'Authenticated CRM user is required', { status: 401 });
    }
    if (!canUseAction(user, 'fiscal.terminal.launch')) {
        throw new PaymentServiceError('terminal_launch_denied', 'User cannot open this cashier terminal', {
            status: 403,
            details: { action: 'fiscal.terminal.launch' }
        });
    }
    if (!canAccessBusinessContext(user, businessContext)) {
        throw new PaymentServiceError('terminal_business_context_denied', 'User cannot access this terminal business context', { status: 403 });
    }
}

function assertTerminalRoute(route = {}) {
    if (route.mode !== 'test' || route.expectedIsTest !== true || route.sharedTestRegister !== true) {
        throw new PaymentServiceError('terminal_route_scope_invalid', 'Shared terminal login is currently available only for verified test registers', { status: 403 });
    }
    const mapping = route.mapping || {};
    if (
        mapping.route_status !== 'active'
        || mapping.route_feature_enabled !== true
        || mapping.fiscal_register_status !== 'active'
        || mapping.feature_enabled !== true
    ) {
        throw new PaymentServiceError('terminal_route_disabled', 'Selected cashier terminal route is not active', { status: 409 });
    }
}

function terminalRouteResolverOptions() {
    return {
        allowTestPinRead: true,
        canUseActionFn: (actor, action) => action === 'fiscal.configure'
            ? canUseAction(actor, 'fiscal.terminal.launch') || canUseAction(actor, 'fiscal.configure')
            : canUseAction(actor, action)
    };
}

async function withTransaction(dbPool, run) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function projectSession(row = {}, { includeActiveCashier = true } = {}) {
    const activeCashier = includeActiveCashier && row.active_cashier_binding_id ? {
        userId: Number(row.active_cashier_user_id),
        bindingId: Number(row.active_cashier_binding_id)
    } : null;
    const rawStatus = String(row.status || '').trim().toLowerCase() || 'active';
    const state = rawStatus === 'revoked' || rawStatus === 'expired'
        ? 'ended'
        : rawStatus === 'locked'
        ? 'screen_locked'
        : activeCashier
        ? 'cashier_active'
        : 'cashier_required';
    return {
        id: row.public_id,
        businessContext: row.business_context,
        routeOptionId: row.route_option_id,
        fiscalProfileId: Number(row.fiscal_profile_id),
        fiscalLocationId: Number(row.fiscal_location_id),
        fiscalRegisterId: Number(row.fiscal_register_id),
        openedByUserId: Number(row.opened_by_user_id),
        status: rawStatus,
        state,
        version: Number(row.session_version || 0),
        expiresAt: row.expires_at || null,
        lockedAt: row.locked_at || null,
        lockedUntil: row.locked_until || null,
        activeCashier
    };
}

function normalizeCapabilityScope(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return trimmed.slice(1, -1).split(',').map(item => item.trim().replace(/^"|"$/g, '')).filter(Boolean);
        }
        return [trimmed];
    }
    return [];
}

function bindingAllowsAction(binding, action) {
    return normalizeCapabilityScope(binding?.capability_scope).includes(action);
}

function bindingAllowsTerminalActions(binding) {
    return TERMINAL_REQUIRED_ACTIONS.every(action => bindingAllowsAction(binding, action));
}

function projectCashier(row = {}) {
    return {
        bindingId: Number(row.id),
        userId: Number(row.user_id),
        cashierName: row.cashier_name || row.name || row.username || null,
        cashierLogin: row.cashier_login || null,
        username: row.username || null,
        pinConfigured: Boolean(row.action_pin_hash),
        pinLockedUntil: row.pin_locked_until || null,
        status: row.status
    };
}

async function resolveTerminalRoute(client, { user, businessContext, routeOptionId, requireMutationReady = false } = {}) {
    const route = await resolveFiscalSaleRoute({
        client,
        user,
        businessContext,
        routeOptionId,
        requireMutationReady,
        ...terminalRouteResolverOptions()
    });
    assertTerminalRoute(route);
    return route;
}

async function openTerminalSession({
    dbPool = pool,
    user,
    businessContext,
    routeOptionId,
    now = new Date(),
    ttlMs = TERMINAL_SESSION_TTL_MS
} = {}) {
    return withTransaction(dbPool, async client => {
        const route = await resolveTerminalRoute({
            client,
            user,
            businessContext,
            routeOptionId,
            requireMutationReady: false
        });
        assertTerminalLaunchAllowed(user, route.businessContext);
        const expiresAt = new Date(now.getTime() + ttlMs);
        const mapping = route.mapping;
        const publicId = crypto.randomUUID();
        const inserted = await client.query(
            `INSERT INTO cashier_terminal_sessions (
                 public_id,
                 fiscal_profile_id, fiscal_location_id, fiscal_register_id,
                 business_context, route_option_id, opened_by_user_id,
                 status, expires_at, metadata
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9::jsonb)
             RETURNING *`,
            [
                publicId,
                mapping.fiscal_profile_id,
                mapping.fiscal_location_id,
                mapping.fiscal_register_id,
                route.businessContext,
                route.routeOptionId,
                user.id,
                expiresAt,
                JSON.stringify({
                    route_mode: route.mode,
                    shared_test_register: route.sharedTestRegister === true
                })
            ]
        );
        const session = inserted.rows[0];
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, after_snapshot
             )
             VALUES ($1,$2,'cashier_terminal_opened','cashier_terminal_sessions',$3,$4::jsonb)`,
            [
                session.fiscal_profile_id,
                user.id,
                session.id,
                JSON.stringify({
                    terminal_session_public_id: session.public_id,
                    route_option_id: session.route_option_id,
                    business_context: session.business_context
                })
            ]
        );
        return { session: projectSession(session), route };
    });
}

async function loadSessionRow(client, { sessionId, openerUserId, forUpdate = false } = {}) {
    const publicId = normalizePublicId(sessionId);
    if (!publicId) {
        throw new PaymentServiceError('terminal_session_required', 'Cashier terminal session is required', { status: 401 });
    }
    const result = await client.query(
        `SELECT *
           FROM cashier_terminal_sessions
          WHERE public_id = $1
            AND opened_by_user_id = $2
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [publicId, openerUserId || null]
    );
    if (!result.rows.length) {
        throw new PaymentServiceError('terminal_session_not_found', 'Cashier terminal session was not found for this CRM user', { status: 401 });
    }
    return result.rows[0];
}

function assertSessionUsable(user, session, { action = null, requireActiveCashier = false, allowScreenLocked = false, expectedVersion = null, now = new Date() } = {}) {
    assertTerminalLaunchAllowed(user, session.business_context);
    const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
    if (session.revoked_at || session.status === 'revoked' || session.status === 'expired' || (expiresAt && expiresAt <= now)) {
        throw new PaymentServiceError('terminal_session_expired', 'Cashier terminal session is no longer active', { status: 401 });
    }
    const lockedUntil = session.locked_until ? new Date(session.locked_until) : null;
    if (lockedUntil && lockedUntil > now) {
        throw new PaymentServiceError('terminal_session_pin_locked', 'Cashier terminal is temporarily locked after repeated PIN failures', {
            status: 423,
            details: { lockedUntil: session.locked_until }
        });
    }
    if (session.status === 'locked' && !allowScreenLocked) {
        throw new PaymentServiceError('terminal_screen_locked', 'Cashier terminal is locked. Enter cashier PIN again before this action', { status: 423 });
    }
    if (session.status !== 'active' && !(allowScreenLocked && session.status === 'locked')) {
        throw new PaymentServiceError('terminal_session_expired', 'Cashier terminal session is no longer active', { status: 401 });
    }
    if (expectedVersion !== null) {
        const actualVersion = Number(session.session_version || 0);
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
            throw new PaymentServiceError('terminal_session_version_required', 'Cashier terminal session version is required', { status: 409 });
        }
        if (actualVersion !== expectedVersion) {
            throw new PaymentServiceError('terminal_session_version_stale', 'Cashier terminal session changed in another tab', {
                status: 409,
                details: { expectedVersion, actualVersion }
            });
        }
    }
    if (action && !TERMINAL_MUTATION_ACTIONS.has(action)) {
        throw new PaymentServiceError('terminal_action_unsupported', 'Cashier terminal session cannot authorize this action', { status: 403, details: { action } });
    }
    if (requireActiveCashier && (!session.active_cashier_user_id || !session.active_cashier_binding_id)) {
        throw new PaymentServiceError('terminal_cashier_login_required', 'A cashier must log in with PIN before this terminal action', { status: 401 });
    }
}

async function listTerminalCashiers({ dbPool = pool, user, sessionId, now = new Date() } = {}) {
    const client = await dbPool.connect();
    try {
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id });
        assertSessionUsable(user, session, { now, allowScreenLocked: true });
        const result = await client.query(
            `SELECT b.id, b.user_id, b.cashier_name, b.cashier_login, b.status,
                    b.action_pin_hash, b.pin_locked_until, b.capability_scope,
                    u.username, u.name
               FROM fiscal_cashier_bindings b
               JOIN users u ON u.id = b.user_id
              WHERE b.fiscal_profile_id = $1
                AND b.fiscal_location_id = $2
                AND b.fiscal_register_id = $3
                AND b.status = 'active'
                AND COALESCE(u.is_active, true) IS TRUE
                AND b.capability_scope @> $4::text[]
                AND NULLIF(BTRIM(b.provider_cashier_login_ref), '') IS NOT NULL
              ORDER BY b.cashier_name NULLS LAST, u.name NULLS LAST, u.username, b.id`,
            [
                session.fiscal_profile_id,
                session.fiscal_location_id,
                session.fiscal_register_id,
                TERMINAL_REQUIRED_ACTIONS
            ]
        );
        const cashiers = [];
        for (const row of result.rows) {
            try {
                const cashierUser = await loadEffectiveCashierUser(client, {
                    userId: row.user_id,
                    businessContext: session.business_context
                });
                if (TERMINAL_REQUIRED_ACTIONS.every(action => canUseAction(cashierUser, action))) {
                    cashiers.push(projectCashier(row));
                }
            } catch (error) {
                if (error instanceof PaymentServiceError) continue;
                throw error;
            }
        }
        return {
            session: projectSession(session),
            cashiers
        };
    } finally {
        client.release();
    }
}

async function writePinChallengeResult(client, { binding, pinResult, actorUserId, sessionId = null, incrementSessionFailure = false, now = new Date() } = {}) {
    await client.query(
        `UPDATE fiscal_cashier_bindings
            SET pin_failed_attempts = $2,
                pin_last_failed_at = $3,
                pin_locked_until = $4,
                pin_last_verified_at = $5,
                updated_at = NOW()
          WHERE id = $1`,
        [
            binding.id,
            pinResult.bindingPatch.pin_failed_attempts ?? binding.pin_failed_attempts ?? 0,
            pinResult.bindingPatch.pin_last_failed_at ?? binding.pin_last_failed_at ?? null,
            pinResult.bindingPatch.pin_locked_until ?? null,
            pinResult.bindingPatch.pin_last_verified_at ?? binding.pin_last_verified_at ?? null
        ]
    );
    const audit = pinResult.auditEvent || {};
    await client.query(
        `INSERT INTO fiscal_audit_events (
             fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
            binding.fiscal_profile_id,
            actorUserId || null,
            pinResult.ok ? 'cashier_terminal_pin_verified' : 'cashier_terminal_pin_failed',
            audit.entity_table || 'fiscal_cashier_bindings',
            audit.entity_id || binding.id,
            JSON.stringify({
                ...(audit.metadata || {}),
                terminal_session_id: sessionId,
                target_cashier_user_id: Number(binding.user_id)
            })
        ]
    );
    if (incrementSessionFailure && sessionId) {
        const lockedUntil = new Date(now.getTime() + TERMINAL_PIN_LOCK_MS);
        await client.query(
            `UPDATE cashier_terminal_sessions
                SET failed_pin_attempts = failed_pin_attempts + 1,
                    last_failed_pin_at = NOW(),
                    locked_at = CASE WHEN failed_pin_attempts + 1 >= $2 THEN COALESCE(locked_at, NOW()) ELSE locked_at END,
                    locked_until = CASE WHEN failed_pin_attempts + 1 >= $2 THEN $3 ELSE locked_until END,
                    last_seen_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1`,
            [sessionId, TERMINAL_PIN_MAX_ATTEMPTS, lockedUntil]
        );
    }
}

async function loginTerminalCashier({
    dbPool = pool,
    user,
    sessionId,
    bindingId,
    actionPin,
    now = new Date(),
    pinEvaluator = evaluatePinChallenge
} = {}) {
    sanitizePin(actionPin);
    const client = await dbPool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id, forUpdate: true });
        assertSessionUsable(user, session, { now, allowScreenLocked: true });
        const targetBindingId = normalizePositiveId(bindingId);
        if (!targetBindingId) {
            throw new PaymentServiceError('terminal_cashier_binding_required', 'Select a cashier for this terminal', { status: 422 });
        }
        const bindingResult = await client.query(
            `SELECT b.*, fp.crm_profile_key, fr.fiscal_location_id AS register_fiscal_location_id
               FROM fiscal_cashier_bindings b
               JOIN fiscal_profiles fp ON fp.id = b.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = b.fiscal_register_id
                AND fr.fiscal_profile_id = b.fiscal_profile_id
              WHERE b.id = $1
                AND b.fiscal_profile_id = $2
                AND b.fiscal_location_id = $3
                AND b.fiscal_register_id = $4
                AND b.status = 'active'
              FOR UPDATE OF b`,
            [
                targetBindingId,
                session.fiscal_profile_id,
                session.fiscal_location_id,
                session.fiscal_register_id
            ]
        );
        if (bindingResult.rows.length !== 1) {
            throw new PaymentServiceError('terminal_cashier_binding_invalid', 'Selected cashier is not active for this terminal', { status: 403 });
        }
        const binding = bindingResult.rows[0];
        if (!bindingAllowsTerminalActions(binding)) {
            throw new PaymentServiceError('terminal_cashier_binding_capability_denied', 'Selected cashier binding cannot perform terminal sales', { status: 403 });
        }
        const cashierUser = await loadEffectiveCashierUser(client, {
            userId: binding.user_id,
            businessContext: session.business_context
        });
        for (const action of TERMINAL_REQUIRED_ACTIONS) {
            if (!canUseAction(cashierUser, action)) {
                throw new PaymentServiceError('terminal_cashier_action_denied', 'Selected cashier cannot perform terminal sales', {
                    status: 403,
                    details: { action }
                });
            }
        }
        const pinResult = await pinEvaluator({ binding, providedPin: actionPin, now });
        await writePinChallengeResult(client, {
            binding,
            pinResult,
            actorUserId: user.id,
            sessionId: session.id,
            incrementSessionFailure: !pinResult.ok,
            now
        });
        if (!pinResult.ok) {
            await client.query('COMMIT');
            committed = true;
            throw new PaymentServiceError(pinResult.code, 'Cashier PIN is invalid or locked', {
                status: pinResult.code === 'action_pin_locked' ? 423 : 403
            });
        }
        const updated = await client.query(
            `UPDATE cashier_terminal_sessions
                SET status = 'active',
                    active_cashier_user_id = $2,
                    active_cashier_binding_id = $3,
                    failed_pin_attempts = 0,
                    last_failed_pin_at = NULL,
                    locked_at = NULL,
                    locked_until = NULL,
                    session_version = session_version + 1,
                    last_seen_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [session.id, binding.user_id, binding.id]
        );
        const nextSession = updated.rows[0];
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, after_snapshot
             )
             VALUES ($1,$2,'cashier_terminal_cashier_logged_in','cashier_terminal_sessions',$3,$4::jsonb)`,
            [
                nextSession.fiscal_profile_id,
                user.id,
                nextSession.id,
                JSON.stringify({
                    terminal_session_public_id: nextSession.public_id,
                    active_cashier_user_id: Number(binding.user_id),
                    active_cashier_binding_id: Number(binding.id)
                })
            ]
        );
        await client.query('COMMIT');
        committed = true;
        return {
            session: projectSession(nextSession),
            cashier: {
                userId: Number(binding.user_id),
                bindingId: Number(binding.id),
                username: cashierUser.username || null,
                name: cashierUser.name || null
            }
        };
    } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function loadEffectiveCashierUser(client, { userId, businessContext } = {}) {
    const id = normalizePositiveId(userId);
    if (!id) {
        throw new PaymentServiceError('terminal_cashier_user_invalid', 'Cashier user is invalid', { status: 403 });
    }
    const freshUser = await loadAuthenticatedUserAccess({ id }, { db: client, requireFresh: true });
    const membership = await loadMembershipAccess(client, freshUser, businessContext);
    return applyMembershipAccess(freshUser, membership);
}

async function loadTerminalSessionForAction({
    dbPool = pool,
    user,
    sessionId,
    action,
    businessContext = null,
    routeOptionId = null,
    expectedVersion = null,
    now = new Date()
} = {}) {
    const client = await dbPool.connect();
    try {
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id, forUpdate: true });
        assertSessionUsable(user, session, { action, requireActiveCashier: true, expectedVersion, now });
        if (businessContext && String(businessContext).trim().toLowerCase() !== session.business_context) {
            throw new PaymentServiceError('terminal_business_context_mismatch', 'Terminal session belongs to another business context', { status: 409 });
        }
        if (routeOptionId && String(routeOptionId).trim().toLowerCase() !== session.route_option_id) {
            throw new PaymentServiceError('terminal_route_mismatch', 'Terminal session belongs to another register route', { status: 409 });
        }
        const bindingResult = await client.query(
            `SELECT b.*, fr.fiscal_location_id AS register_fiscal_location_id, fp.crm_profile_key
               FROM fiscal_cashier_bindings b
               JOIN fiscal_registers fr
                 ON fr.id = b.fiscal_register_id
                AND fr.fiscal_profile_id = b.fiscal_profile_id
               JOIN fiscal_profiles fp
                 ON fp.id = b.fiscal_profile_id
              WHERE b.id = $1
                AND b.user_id = $2
                AND b.fiscal_profile_id = $3
                AND b.fiscal_location_id = $4
                AND b.fiscal_register_id = $5
                AND b.status = 'active'
              LIMIT 2`,
            [
                session.active_cashier_binding_id,
                session.active_cashier_user_id,
                session.fiscal_profile_id,
                session.fiscal_location_id,
                session.fiscal_register_id
            ]
        );
        if (bindingResult.rows.length !== 1) {
            throw new PaymentServiceError('terminal_cashier_binding_invalid', 'Active cashier binding is no longer valid', { status: 403 });
        }
        const binding = bindingResult.rows[0];
        if (!bindingAllowsAction(binding, action)) {
            throw new PaymentServiceError('terminal_cashier_binding_capability_denied', 'Active cashier binding cannot perform this terminal action', {
                status: 403,
                details: { action }
            });
        }
        const cashierUser = await loadEffectiveCashierUser(client, {
            userId: session.active_cashier_user_id,
            businessContext: session.business_context
        });
        if (!canUseAction(cashierUser, action)) {
            throw new PaymentServiceError('terminal_cashier_action_denied', 'Active cashier cannot perform this terminal action', {
                status: 403,
                details: { action }
            });
        }
        await client.query(
            `UPDATE cashier_terminal_sessions
                SET last_seen_at = NOW(), updated_at = NOW()
              WHERE id = $1`,
            [session.id]
        );
        return {
            session: projectSession(session),
            sessionRow: session,
            openerUser: user,
            activeCashierUser: cashierUser,
            activeCashierBinding: binding,
            terminalContext: {
                terminalSessionId: session.public_id,
                terminalSessionRowId: Number(session.id),
                terminalSessionVersion: Number(session.session_version || 0),
                openedByUserId: Number(session.opened_by_user_id),
                activeCashierUserId: Number(session.active_cashier_user_id),
                activeCashierBindingId: Number(session.active_cashier_binding_id),
                businessContext: session.business_context,
                routeOptionId: session.route_option_id,
                fiscalProfileId: Number(session.fiscal_profile_id),
                fiscalLocationId: Number(session.fiscal_location_id),
                fiscalRegisterId: Number(session.fiscal_register_id)
            },
            routeResolverOptions: terminalRouteResolverOptions()
        };
    } finally {
        client.release();
    }
}

async function getTerminalSession({ dbPool = pool, user, sessionId, now = new Date() } = {}) {
    const client = await dbPool.connect();
    try {
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id });
        assertTerminalLaunchAllowed(user, session.business_context);
        const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
        if (session.status === 'active' && expiresAt && expiresAt <= now) {
            const updated = await client.query(
                `UPDATE cashier_terminal_sessions
                    SET status = 'expired',
                        active_cashier_user_id = NULL,
                        active_cashier_binding_id = NULL,
                        session_version = session_version + 1,
                        updated_at = NOW()
                  WHERE id = $1
                  RETURNING *`,
                [session.id]
            );
            return { session: projectSession(updated.rows[0] || session) };
        }
        return { session: projectSession(session) };
    } finally {
        client.release();
    }
}

async function lockTerminalSession({ dbPool = pool, user, sessionId, expectedVersion = null, now = new Date() } = {}) {
    return withTransaction(dbPool, async client => {
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id, forUpdate: true });
        assertSessionUsable(user, session, { allowScreenLocked: true, expectedVersion, now });
        const updated = await client.query(
            `UPDATE cashier_terminal_sessions
                SET status = 'locked',
                    active_cashier_user_id = NULL,
                    active_cashier_binding_id = NULL,
                    session_version = session_version + 1,
                    last_seen_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [session.id]
        );
        const nextSession = updated.rows[0];
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, after_snapshot
             )
             VALUES ($1,$2,'cashier_terminal_locked','cashier_terminal_sessions',$3,$4::jsonb)`,
            [
                nextSession.fiscal_profile_id,
                user.id,
                nextSession.id,
                JSON.stringify({
                    terminal_session_public_id: nextSession.public_id,
                    previous_version: Number(session.session_version || 0),
                    next_version: Number(nextSession.session_version || 0)
                })
            ]
        );
        return { session: projectSession(nextSession) };
    });
}

async function endTerminalSession({ dbPool = pool, user, sessionId, expectedVersion = null, now = new Date() } = {}) {
    return withTransaction(dbPool, async client => {
        const session = await loadSessionRow(client, { sessionId, openerUserId: user?.id, forUpdate: true });
        assertSessionUsable(user, session, { allowScreenLocked: true, expectedVersion, now });
        const updated = await client.query(
            `UPDATE cashier_terminal_sessions
                SET status = 'revoked',
                    revoked_at = NOW(),
                    active_cashier_user_id = NULL,
                    active_cashier_binding_id = NULL,
                    session_version = session_version + 1,
                    last_seen_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [session.id]
        );
        const nextSession = updated.rows[0];
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id, after_snapshot
             )
             VALUES ($1,$2,'cashier_terminal_ended','cashier_terminal_sessions',$3,$4::jsonb)`,
            [
                nextSession.fiscal_profile_id,
                user.id,
                nextSession.id,
                JSON.stringify({
                    terminal_session_public_id: nextSession.public_id,
                    previous_version: Number(session.session_version || 0),
                    next_version: Number(nextSession.session_version || 0)
                })
            ]
        );
        return { session: projectSession(nextSession) };
    });
}

function terminalErrorResponse(error) {
    if (error instanceof PaymentServiceError || error?.code) {
        return {
            status: error.status || error.statusCode || 500,
            body: {
                success: false,
                error: error.code || 'terminal_error',
                message: error.message,
                details: error.details || undefined
            }
        };
    }
    return { status: 500, body: { success: false, error: 'terminal_error', message: 'Terminal operation failed' } };
}

module.exports = {
    TERMINAL_SESSION_TTL_MS,
    TERMINAL_REQUIRED_ACTIONS,
    openTerminalSession,
    listTerminalCashiers,
    loginTerminalCashier,
    getTerminalSession,
    lockTerminalSession,
    endTerminalSession,
    loadTerminalSessionForAction,
    sessionIdFromRequest,
    sessionVersionFromRequest,
    terminalErrorResponse,
    terminalRouteResolverOptions
};
