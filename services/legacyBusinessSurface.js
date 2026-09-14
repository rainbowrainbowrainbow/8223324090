'use strict';

const { BUSINESS_SCOPE_SINGLE, DEFAULT_BUSINESS_CONTEXT, resolveBusinessScope } = require('./businessContext');
const { userBusinessModuleState } = require('./businessModuleRegistry');
const { recordCompatibilityTelemetrySafe } = require('./businessCutover');
const { canReadParkStaffSchedule, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');
const { projectParkStaffSchedulePayload } = require('./parkStaffScheduleProjection');

const SURFACES = Object.freeze({
    catalogs: { code: 'catalogs_not_migrated', label: 'Спільні каталоги' },
    booking_templates: { code: 'booking_templates_not_migrated', label: 'Шаблони бронювань' },
    recurring: { code: 'recurring_not_migrated', label: 'Повторювані бронювання' },
    finance_salary: { code: 'finance_salary_not_migrated', label: 'Спільні звіти зарплат' },
    payroll: { code: 'payroll_not_migrated', label: 'Розрахунки зарплат' },
    staff: { code: 'staff_not_migrated', label: 'Спільні дані працівників' },
    certificates: { code: 'certificates_not_migrated', label: 'Спільний реєстр сертифікатів' },
    art: { code: 'art_not_migrated', label: 'Спільні Art-матеріали' },
    contractors_procurement: { code: 'contractors_procurement_not_migrated', label: 'Спільні підрядники та закупівлі' },
    warehouse_photo_intake: { code: 'warehouse_photo_intake_not_migrated', label: 'Спільні чернетки фото складу' },
    chat: { code: 'chat_not_migrated', label: 'Спільний чат' },
    kleshnya: { code: 'kleshnya_not_migrated', label: 'Спільний AI-помічник' },
    finance_notifications: { code: 'finance_notifications_not_migrated', label: 'Спільні сповіщення про дохід' }
});

function unavailable(surface) {
    const descriptor = SURFACES[surface];
    if (!descriptor) throw new TypeError('Unknown legacy business surface');
    return { available: false, status: 403, code: descriptor.code,
        message: `${descriptor.label} тимчасово недоступні в цьому кабінеті до розмежування даних за бізнесами.` };
}

function available() {
    return { available: true, status: 200, code: null, message: null };
}

function legacyTelemetry(db, businessContext, authoritySource, outcome) {
    recordCompatibilityTelemetrySafe(db, {
        businessContext: typeof businessContext === 'string' && businessContext.trim() ? businessContext.trim().toLowerCase() : 'unknown',
        entryFamily: 'service',
        authoritySource,
        outcome
    });
}

function legacyBusinessSurfaceAccess(req, surface = 'catalogs') {
    const denied = unavailable(surface);
    if (!req?.user) return { available: false, status: 401, code: 'auth_required', message: 'Потрібна авторизація.' };
    const scope = resolveBusinessScope(req);
    if (scope.invalid) return { available: false, status: 403, code: scope.reason || 'business_scope_unavailable',
        message: 'Вибраний бізнес недоступний для цього облікового запису.' };
    const access = req.user.businessMembershipAccess;
    const business = access?.registry?.find(item => item.businessContext === DEFAULT_BUSINESS_CONTEXT);
    // Only a server-resolved pre-cutover Park request may keep legacy behavior.
    // A different compatible context or revoked membership cannot restore this namespace.
    if (scope.mode !== BUSINESS_SCOPE_SINGLE || scope.activeContext !== DEFAULT_BUSINESS_CONTEXT
        || !access || access.invalid) return denied;
    if (surface === 'catalogs' && access.membershipEnabled === true) {
        const moduleState = userBusinessModuleState(req.user, DEFAULT_BUSINESS_CONTEXT, 'catalogs');
        return moduleState.available ? available() : denied;
    }
    if (access.membershipEnabled !== false
        || (business && (business.accessMode !== 'compatibility' || business.active !== true))) return denied;
    return available();
}

function requireLegacyBusinessSurface(surface, { parkScheduleRouter = null } = {}) {
    unavailable(surface); // Reject a programming error when mounting, not during a request.
    if (parkScheduleRouter && (surface !== 'staff' || !['staff', 'hr'].includes(parkScheduleRouter))) {
        throw new TypeError('Park schedule recovery must be mounted on a staff or HR surface');
    }
    return (req, res, next) => {
        const access = legacyBusinessSurfaceAccess(req, surface);
        if (access.available) return next();
        if (access.code === 'staff_not_migrated' && canReadParkStaffSchedule(req, parkScheduleRouter)) {
            const routePath = parkStaffScheduleRoutePath(req);
            const sendJson = res.json.bind(res);
            res.json = payload => {
                const projected = projectParkStaffSchedulePayload(parkScheduleRouter, routePath, payload);
                if (projected?.success === true && parkScheduleRouter === 'staff' && ['/', '/schedule'].includes(routePath)) {
                    return sendJson({ ...projected, scheduleAccess: { readOnly: true, businessContext: DEFAULT_BUSINESS_CONTEXT } });
                }
                return sendJson(projected);
            };
            return next();
        }
        return res.status(access.status).json({ success: false, code: access.code, error: access.message });
    };
}

// Internal callers must supply an already-authorized stored/request context.
// Missing context never manufactures Park, and the registry is read on each call.
async function loadLegacyBusinessSurfaceAccess(db, businessContext, surface = 'catalogs') {
    const denied = unavailable(surface);
    if (typeof businessContext !== 'string' || businessContext.trim().toLowerCase() !== DEFAULT_BUSINESS_CONTEXT) return denied;
    try {
        const result = await db.query(
            `SELECT b.access_mode, b.status AS business_status, o.status AS organization_status
             FROM businesses b LEFT JOIN organizations o ON o.id = b.organization_id
             WHERE b.context_key = $1`, [DEFAULT_BUSINESS_CONTEXT]
        );
        if (result.rows.length === 0) {
            legacyTelemetry(db, businessContext, 'compatibility', 'allowed');
            return available();
        }
        if (result.rows.length !== 1) {
            legacyTelemetry(db, businessContext, 'unknown', 'denied');
            return denied;
        }
        const row = result.rows[0];
        const allowed = row.access_mode === 'compatibility' && row.business_status === 'active' && row.organization_status === 'active';
        legacyTelemetry(db, businessContext, allowed ? 'compatibility' : 'membership', allowed ? 'allowed' : 'denied');
        return allowed ? available() : denied;
    } catch {
        legacyTelemetry(db, businessContext, 'unknown', 'unavailable');
        return { available: false, status: 503, code: 'legacy_business_scope_unavailable',
            message: 'Не вдалося перевірити доступ до спільних даних. Оновіть сторінку та повторіть спробу.' };
    }
}

module.exports = { legacyBusinessSurfaceAccess, requireLegacyBusinessSurface, loadLegacyBusinessSurfaceAccess };
