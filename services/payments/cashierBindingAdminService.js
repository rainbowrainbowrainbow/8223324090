'use strict';

const { pool } = require('../../db');
const { PaymentServiceError } = require('./paymentService');
const { authorizeFiscalActorAction } = require('./fiscalAccess');
const { BUSINESS_SCOPES, defaultRouteOptionIdForBusiness } = require('./catalogSaleService');
const { resolveFiscalSaleRoute } = require('./fiscalSaleRouteService');

const SECRET_FIELDS = /password|secret|pin|license.?key|access.?key|device|credential.?value/i;
const EDITABLE_FIELDS = new Set(['cashierName', 'cashier_name', 'cashierLogin', 'cashier_login']);

function assertNoSecrets(body = {}) {
    const forbidden = Object.keys(body).filter(key => SECRET_FIELDS.test(key));
    if (forbidden.length) throw new PaymentServiceError('cashier_secret_forbidden', 'Secrets must only be supplied through ref-specific environment variables', { status: 422, details: { fields: forbidden } });
    const unsupported = Object.keys(body).filter(key => !EDITABLE_FIELDS.has(key));
    if (unsupported.length) throw new PaymentServiceError('cashier_metadata_field_forbidden', 'Only cashier display name and login metadata may be edited', { status: 422, details: { fields: unsupported } });
}

function clean(value, field) {
    const text = String(value ?? '').trim();
    if (text.length < 2 || text.length > 160 || /[\r\n\0]/.test(text)) throw new PaymentServiceError('cashier_metadata_invalid', 'Cashier metadata is invalid', { status: 422, details: { field } });
    return text;
}

function project(row) {
    const pinConfigured = Boolean(row.action_pin_set_at || row.action_pin_hash);
    return {
        id: Number(row.id),
        cashierName: row.cashier_name || row.user_name || row.username || null,
        cashierLogin: row.cashier_login || null,
        status: row.status,
        businessContext: row.route_business_context || row.crm_profile_key,
        registerDisplayName: row.register_display_name,
        mode: row.expected_is_test === true ? 'test' : 'production',
        targetUserId: Number(row.user_id),
        actionPin: {
            configured: pinConfigured,
            lockedUntil: row.pin_locked_until || null
        },
        pinConfigured,
        pinLockedUntil: row.pin_locked_until || null,
        pinSetAt: row.action_pin_set_at || null
    };
}

function projectSelectable(row) {
    return {
        id: Number(row.id),
        cashierName: row.cashier_name || null,
        status: row.status,
        mode: row.expected_is_test === true ? 'test' : 'production'
    };
}

async function listCashierBindings({
    dbPool = pool,
    businessContext,
    routeOptionId = null,
    user,
    authorizer = authorizeFiscalActorAction,
    routeResolver = resolveFiscalSaleRoute
} = {}) {
    const scope = BUSINESS_SCOPES[String(businessContext || '').trim().toLowerCase()];
    if (!scope) throw new PaymentServiceError('catalog_business_context_invalid', 'Unknown catalog business context', { status: 422 });
    const client = await dbPool.connect();
    try {
        const route = await routeResolver({
            client,
            user,
            routeOptionId: routeOptionId || defaultRouteOptionIdForBusiness(scope.crmProfileKey),
            businessContext: scope.crmProfileKey
        });
        await authorizer(client, {
            user,
            action: 'fiscal.configure',
            crmProfileKey: route.businessContext
        });
        const mapping = route.mapping;
        const result = await client.query(
            `SELECT fcb.id,
                    fcb.user_id,
                    fcb.cashier_name,
                    fcb.cashier_login,
                    fcb.status,
                    fcb.action_pin_hash,
                    fcb.action_pin_set_at,
                    fcb.pin_locked_until,
                    fp.crm_profile_key,
                    $4::text AS route_business_context,
                    fr.display_name AS register_display_name,
                    COALESCE(
                        NULLIF(BTRIM(fr.metadata->>'expected_is_test'), '')::boolean,
                        NULLIF(BTRIM(fr.metadata->>'expectedIsTest'), '')::boolean,
                        FALSE
                    ) AS expected_is_test,
                    u.name AS user_name,
                    u.username
               FROM fiscal_cashier_bindings fcb
               JOIN fiscal_profiles fp
                 ON fp.id = fcb.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = fcb.fiscal_register_id
                AND fr.fiscal_profile_id = fcb.fiscal_profile_id
               JOIN fiscal_locations fl
                 ON fl.id = fcb.fiscal_location_id
                AND fl.fiscal_profile_id = fcb.fiscal_profile_id
               LEFT JOIN users u
                 ON u.id = fcb.user_id
              WHERE fcb.fiscal_profile_id = $1
                AND fcb.fiscal_location_id = $2
                AND fcb.fiscal_register_id = $3
                AND fcb.provider = 'checkbox'
                AND fcb.status <> 'archived'
              ORDER BY fcb.cashier_name NULLS LAST, u.name NULLS LAST, u.username NULLS LAST, fcb.id`,
            [mapping.fiscal_profile_id, mapping.fiscal_location_id, mapping.fiscal_register_id, route.businessContext]
        );
        return result.rows.map(project);
    } finally {
        client.release();
    }
}

async function listSelectableCashiers({
    dbPool = pool,
    businessContext,
    routeOptionId,
    user,
    authorizer = authorizeFiscalActorAction,
    routeResolver = resolveFiscalSaleRoute
} = {}) {
    const scope = BUSINESS_SCOPES[String(businessContext || '').trim().toLowerCase()];
    if (!scope) throw new PaymentServiceError('catalog_business_context_invalid', 'Unknown catalog business context', { status: 422 });
    const client = await dbPool.connect();
    try {
        const route = await routeResolver({
            client,
            user,
            routeOptionId: routeOptionId || defaultRouteOptionIdForBusiness(scope.crmProfileKey),
            businessContext: scope.crmProfileKey
        });
        const mapping = route.mapping;
        await authorizer(client, {
            user,
            action: 'payments.create',
            crmProfileKey: route.businessContext
        });
        const result = await client.query(
            `SELECT fcb.id,fcb.cashier_name,fcb.status,
                    COALESCE(
                        NULLIF(BTRIM(fr.metadata->>'expected_is_test'),'')::boolean,
                        NULLIF(BTRIM(fr.metadata->>'expectedIsTest'),'')::boolean,
                        FALSE
                    ) AS expected_is_test
               FROM fiscal_cashier_bindings fcb
               JOIN fiscal_registers fr ON fr.id=fcb.fiscal_register_id AND fr.fiscal_profile_id=fcb.fiscal_profile_id
              WHERE fcb.fiscal_profile_id=$1 AND fcb.fiscal_register_id=$2
                AND fcb.provider='checkbox'
                AND fcb.status='active'
                AND NULLIF(BTRIM(fcb.provider_cashier_login_ref),'') IS NOT NULL
              ORDER BY fcb.cashier_name NULLS LAST,fcb.id`,
            [mapping.fiscal_profile_id,mapping.fiscal_register_id]
        );
        return result.rows.map(projectSelectable);
    } finally {
        client.release();
    }
}

async function updateCashierBinding({ dbPool = pool, bindingId, body = {}, actorUserId } = {}) {
    assertNoSecrets(body);
    const id = Number(bindingId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new PaymentServiceError('cashier_binding_id_invalid', 'Cashier binding id is invalid', { status: 422 });
    const cashierName = clean(body.cashierName ?? body.cashier_name, 'cashierName');
    const cashierLogin = clean(body.cashierLogin ?? body.cashier_login, 'cashierLogin');
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const updated = await client.query(`UPDATE fiscal_cashier_bindings SET cashier_name=$2,cashier_login=$3,updated_at=NOW() WHERE id=$1 RETURNING fiscal_profile_id,id`, [id,cashierName,cashierLogin]);
        if (!updated.rows.length) throw new PaymentServiceError('cashier_binding_not_found', 'Cashier binding not found', { status: 404 });
        await client.query(`INSERT INTO fiscal_audit_events (fiscal_profile_id,actor_user_id,event_type,entity_table,entity_id,after_snapshot) VALUES ($1,$2,'cashier_binding_metadata_updated','fiscal_cashier_bindings',$3,$4::jsonb)`, [updated.rows[0].fiscal_profile_id,actorUserId || null,id,JSON.stringify({ updated_fields_count: 2 })]);
        await client.query('COMMIT');
        return { id, updated: true };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

module.exports = { assertNoSecrets, listCashierBindings, listSelectableCashiers, projectSelectable, updateCashierBinding };
