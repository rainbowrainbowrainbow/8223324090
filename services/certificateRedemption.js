'use strict';

const { resolveBusinessScope, BUSINESS_SCOPE_SINGLE, DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { applyMembershipAccess, loadMembershipAccess } = require('./businessMembership');
const { hasCurrentParkMembership } = require('./parkLegacyModuleAccess');
const { resolveCapability } = require('./accountAccessPolicy');
const { insertHistory } = require('./historyLog');
const { mapCertificateRow, getCertificateEffectiveStatus } = require('./certificates');

const REDEMPTION_ROLES = new Set(['reception', 'admin', 'manager', 'senior_manager', 'vice_director', 'director', 'creator']);

function redemptionError(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code, publicMessage: message });
}

function canRedeemCertificate(req, cert) {
    const scope = resolveBusinessScope(req);
    return !scope.invalid && scope.mode === BUSINESS_SCOPE_SINGLE && scope.canWrite !== false
        && hasCurrentParkMembership(req.user, scope.activeContext)
        && REDEMPTION_ROLES.has(req.user.role)
        && resolveCapability(req.user, '/certificates/check', { type: 'page' }).allowed
        && getCertificateEffectiveStatus(cert) === 'active'
        && String(cert.type_text || '').trim().toLocaleLowerCase('uk-UA') === 'на одноразовий вхід';
}

// The caller owns BEGIN/COMMIT/ROLLBACK so booking creation and redemption are atomic.
async function redeemCertificateInTransaction(client, req, { id, code, bookingId = null }) {
    const scope = resolveBusinessScope(req);
    if (scope.invalid || scope.mode !== BUSINESS_SCOPE_SINGLE || scope.activeContext !== DEFAULT_BUSINESS_CONTEXT || scope.canWrite === false) {
        throw redemptionError(403, 'certificate_redemption_scope_denied', 'Погашення доступне лише в одному поточному кабінеті Парку.');
    }

    const principalResult = await client.query('SELECT * FROM users WHERE id = $1 AND is_active IS TRUE FOR SHARE', [req.user?.id]);
    const principal = principalResult.rows[0];
    if (!principal) throw redemptionError(403, 'certificate_redemption_denied', 'Немає доступу до погашення сертифікатів.');

    // Hold membership and registry rows through the write; concurrent revocation must serialize.
    const memberships = await client.query(
        `SELECT bm.business_id FROM business_memberships bm
         JOIN businesses b ON b.id = bm.business_id AND b.organization_id = bm.organization_id
         JOIN organization_memberships om ON om.organization_id = b.organization_id AND om.user_id = bm.user_id
         JOIN organizations o ON o.id = b.organization_id
         WHERE bm.user_id = $1 AND b.context_key = $2
           AND bm.is_active IS TRUE AND om.is_active IS TRUE
           AND b.status = 'active' AND o.status = 'active' AND b.access_mode = 'membership'
         FOR SHARE OF bm, b, om, o`,
        [principal.id, DEFAULT_BUSINESS_CONTEXT]
    );
    if (memberships.rows.length !== 1) throw redemptionError(403, 'certificate_redemption_denied', 'Потрібне чинне членство працівника в Парку.');
    const access = await loadMembershipAccess(client, principal, DEFAULT_BUSINESS_CONTEXT);
    const actor = applyMembershipAccess(principal, access);
    if (!hasCurrentParkMembership(actor, DEFAULT_BUSINESS_CONTEXT)
        || !REDEMPTION_ROLES.has(actor.role)
        || !resolveCapability(actor, '/certificates/check', { type: 'page' }).allowed) {
        throw redemptionError(403, 'certificate_redemption_denied', 'Немає доступу до погашення сертифікатів.');
    }

    const selector = id != null ? 'id = $1' : 'cert_code = $1';
    const value = id != null ? id : String(code || '').trim().toUpperCase();
    const found = await client.query(`SELECT *, valid_until::text AS valid_until FROM certificates WHERE ${selector} FOR UPDATE`, [value]);
    const cert = found.rows[0];
    if (!cert) throw redemptionError(404, 'certificate_not_found', 'Сертифікат не знайдено.');
    if (cert.status !== 'active') {
        throw redemptionError(409, `certificate_${cert.status}`, 'Сертифікат уже використаний або недійсний.');
    }
    // Legacy certificates have free-text types. Only the canonical one-time admission is redeemable.
    if (String(cert.type_text || '').trim().toLocaleLowerCase('uk-UA') !== 'на одноразовий вхід') {
        throw redemptionError(409, 'certificate_verification_only', 'Цей тип доступний лише для перевірки.');
    }
    const updated = await client.query(
        `WITH redemption_time AS MATERIALIZED (SELECT clock_timestamp() AS redeemed_at)
         UPDATE certificates AS c
         SET status = 'used', used_at = redemption_time.redeemed_at, updated_at = redemption_time.redeemed_at
         FROM redemption_time
         WHERE c.id = $1 AND c.status = 'active'
           AND c.valid_until >= (redemption_time.redeemed_at AT TIME ZONE 'Europe/Kyiv')::date
         RETURNING c.*, c.valid_until::text AS valid_until`,
        [cert.id]
    );
    if (updated.rows.length !== 1) throw redemptionError(409, 'certificate_expired', 'Строк дії сертифіката минув.');
    await insertHistory(client, {
        businessContext: DEFAULT_BUSINESS_CONTEXT,
        action: 'certificate_used',
        username: actor.username,
        data: {
            certificateId: cert.id, certCode: cert.cert_code,
            oldStatus: cert.status, newStatus: 'used', usedAt: updated.rows[0].used_at,
            actorUserId: actor.id, actorRole: actor.role,
            source: bookingId ? 'booking' : 'crm', bookingId,
            businessId: access.activeMembership.businessId,
            organizationId: access.activeMembership.organizationId
        }
    });
    return mapCertificateRow(updated.rows[0]);
}

module.exports = { redeemCertificateInTransaction, canRedeemCertificate };
