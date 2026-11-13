'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { resolveBusinessScope, DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');
const { projectParkStaffSchedulePayload } = require('./parkStaffScheduleProjection');

const VIEW = ['hr.payroll.view'];
const RULES = [...VIEW, 'hr.payroll.manage', 'manage_payroll_rules'];
const FREELANCE_PAYMENT_OPTIONS = '/freelance/payment-options';
const FREELANCE_CAPABILITIES = new Map([
    ['GET /freelance/day', 'view_payroll'],
    ['GET /freelance/settlement', 'view_payroll'],
    ['GET /freelance/rates', 'manage_payroll_rules'],
    ['POST /freelance/rates', 'manage_payroll_rules'],
    ['POST /freelance/terms', 'manage_payroll_rules'],
    ['POST /freelance/attendance', 'manage_payroll_accrual'],
    ['POST /freelance/payments', 'confirm_payroll_payment'],
    ['POST /freelance/reversals', 'reverse_payroll_payment']
]);
const STAFF_PAY_FIELDS = new Set(['hourly_rate', 'hourlyRate', 'rate_unit', 'rateUnit', 'profession_rates', 'professionRates',
    'role_type', 'secondary_professions', 'secondaryProfessions']);

// Allow individual HR, attendance and freelance operations. General payroll
// payment, settlement, close and bulk routes stay closed.
function parkHrPayrollCapabilities(req, routerId) {
    const method = String(req.method || 'GET').toUpperCase();
    const path = parkStaffScheduleRoutePath(req);
    if (routerId === 'payroll') {
        const freelanceCapability = FREELANCE_CAPABILITIES.get(`${method} ${path}`);
        if (freelanceCapability) return [...VIEW, freelanceCapability];
        if (method === 'GET' && path === FREELANCE_PAYMENT_OPTIONS) return VIEW;
        if (method !== 'GET') return null;
        if (['/preview', '/range-preview', '/schemes'].includes(path)) return [...VIEW, 'view_payroll'];
        if (['/export', '/export-xlsx'].includes(path)) return [...VIEW, 'view_payroll', 'export_data'];
        return null;
    }
    if (routerId !== 'hr') return null;
    // Exact OCR operations reuse attendance management; all membership,
    // context, writable-scope and ownership guards below remain in force.
    if ((method === 'GET' && (path === '/attendance/ocr/status'
        || /^\/attendance\/ocr\/previews\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(path)))
        || (method === 'POST' && (['/attendance/ocr/preview', '/attendance/ocr/recover', '/attendance/ocr/apply'].includes(path)
        || /^\/attendance\/ocr\/previews\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/refresh$/.test(path)))) return ['hr.schedule.manage'];
    if ((method==='GET' && (path==='/attendance/ocr/uploads' || /^\/attendance\/ocr\/uploads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/photo$/.test(path))) || (method==='POST' &&
        (path==='/attendance/ocr/upload-links' || /^\/attendance\/ocr\/upload-links\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/revoke$/.test(path)
        || /^\/attendance\/ocr\/uploads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/recover$/.test(path)))) return ['hr.schedule.manage'];
    if (method === 'GET') {
        if (path === '/today') return ['hr.today.view'];
        if (['/salary', '/salary/reconciliation', '/payroll-profiles', '/payroll-profiles/diagnostics', '/payroll-profiles/forecast'].includes(path)
            || /^\/payroll-profiles\/[1-9]\d*$/.test(path)
            || /^\/staff\/[1-9]\d*\/(?:payroll-conditions|payroll-profile-assignments|payroll-profile-history|payroll-scheme)$/.test(path)) return VIEW;
        if (/^\/staff\/[1-9]\d*\/role-assignments$/.test(path)
            || /^\/professions\/workspace\/[^/]+$/.test(path)) return [...VIEW, 'hr.staff.view'];
    }
    if (method === 'POST') {
        if (['/clock-in', '/clock-out', '/mark-absent'].includes(path)) return ['hr.schedule.manage'];
        if (path === '/payroll-profiles/simulator' || /^\/payroll-profiles\/[1-9]\d*\/impact-preview$/.test(path)) return VIEW;
        if (path === '/payroll-profiles' || /^\/payroll-profiles\/[1-9]\d*\/(?:clone|versions|sync-from-base)$/.test(path)) return RULES;
    }
    if (method === 'PUT') {
        if (/^\/records\/[1-9]\d*\/correct$/.test(path)) return ['hr.schedule.manage'];
        if (/^\/staff\/[1-9]\d*\/(?:payroll-day-exception|payroll-profile-assignments|payroll-scheme)$/.test(path)
            || /^\/payroll-profiles\/[1-9]\d*\/archive$/.test(path)) return RULES;
        if (/^\/staff\/[1-9]\d*\/role-assignments$/.test(path)
            || /^\/professions\/[^/]+\/staff\/[1-9]\d*\/conditions$/.test(path)) return [...RULES, 'hr.staff.manage'];
        if (/^\/staff\/[1-9]\d*$/.test(path)) {
            const keys = Object.keys(req.body || {});
            if (keys.length && keys.every(key => STAFF_PAY_FIELDS.has(key))) return [...RULES, 'hr.staff.manage'];
        }
    }
    return null;
}

function allowed(req, capabilities) {
    return capabilities.every(capability => resolveCapability(req.user, capability, { type: 'action' }).allowed);
}

function canReadFreelancePaymentOptions(user) {
    return allowed({ user }, ['confirm_payroll_payment']) || allowed({ user }, ['reverse_payroll_payment']);
}

function requireParkHrPayrollAccess(routerId, legacyGuard, db) {
    return async (req, res, next) => {
        const capabilities = parkHrPayrollCapabilities(req, routerId);
        // Compatibility and existing narrower Park lanes keep their own guards.
        if (!capabilities || req.user?.businessMembershipAccess?.membershipEnabled !== true) return legacyGuard(req, res, next);
        const isFreelanceOptions = routerId === 'payroll' && parkStaffScheduleRoutePath(req) === FREELANCE_PAYMENT_OPTIONS;
        if (!hasCurrentParkScheduleMembership(req) || !allowed(req, capabilities)
            || (isFreelanceOptions && !canReadFreelancePaymentOptions(req.user))
            || (req.method !== 'GET' && resolveBusinessScope(req).canWrite === false)) {
            return res.status(403).json({ success: false, code: 'PARK_HR_PAYROLL_ACCESS_DENIED', error: 'Немає доступу до цієї дії в Park.' });
        }
        try {
            // Staff, profession profiles and schemes are the existing Park-only
            // namespace (same ownership contract as parkStaffScheduleAccess).
            // Attendance has explicit ownership. Do not infer Park from null or
            // combine foreign attendance with the unpartitioned legacy payroll.
            const result = await db.query(`SELECT EXISTS (
                SELECT 1 FROM hr_time_records WHERE business_context IS DISTINCT FROM $1
            ) AS ownership_conflict`, [DEFAULT_BUSINESS_CONTEXT]);
            if (result.rows.length !== 1 || result.rows[0].ownership_conflict !== false) {
                return res.status(409).json({ success: false, code: 'PARK_HR_PAYROLL_OWNERSHIP_UNVERIFIED',
                    error: 'Належність кадрових даних Park не підтверджена. Розрахунок недоступний.' });
            }
        } catch {
            return res.status(503).json({ success: false, code: 'PARK_HR_PAYROLL_SCOPE_UNAVAILABLE',
                error: 'Не вдалося перевірити належність кадрових даних. Повторіть спробу.' });
        }
        if (routerId === 'hr' && req.method === 'GET' && parkStaffScheduleRoutePath(req) === '/today') {
            const sendJson = res.json.bind(res);
            res.json = payload => {
                const projected = projectParkStaffSchedulePayload('hr', '/today', payload, {
                    method: req.method, includePayroll: allowed(req, VIEW)
                });
                return sendJson(projected?.success === true ? { ...projected, todayAccess: {
                    readOnly: !allowed(req, ['hr.schedule.manage']) || resolveBusinessScope(req).canWrite === false,
                    businessContext: DEFAULT_BUSINESS_CONTEXT
                } } : projected);
            };
        }
        if (routerId === 'hr' && req.method === 'GET'
            && ['/salary', '/salary/reconciliation'].includes(parkStaffScheduleRoutePath(req))) {
            const sendJson = res.json.bind(res);
            res.json = payload => sendJson(payload?.success === true ? { ...payload,
                payroll_activation: { ...payload.payroll_activation, readOnly: true, calculateEndpoint: null },
                payrollAccess: { readOnly: true, businessContext: DEFAULT_BUSINESS_CONTEXT }
            } : payload);
        }
        return next();
    };
}

function canManageStaffPayrollRules(user) {
    return allowed({ user }, RULES);
}

module.exports = { parkHrPayrollCapabilities, requireParkHrPayrollAccess, canManageStaffPayrollRules, canReadFreelancePaymentOptions };
