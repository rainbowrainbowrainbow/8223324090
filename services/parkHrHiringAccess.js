'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { resolveBusinessScope } = require('./businessContext');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { legacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');

function hiringRoute(req) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = String(req.path || '/').replace(/\/$/, '');
    if (['GET', 'POST'].includes(method) && /^\/(?:vacancies|vacancy-platforms(?:\/format-preview)?)$/.test(path)) {
        return { kind: 'collection' };
    }
    const vacancy = /^\/vacancies\/([1-9]\d*)(?:\/(applications))?$/.exec(path);
    if (vacancy && (vacancy[2] ? ['GET', 'POST'] : ['PATCH', 'DELETE']).includes(method)) {
        return { kind: 'vacancy', id: vacancy[1] };
    }
    const application = /^\/applications\/([1-9]\d*)(?:\/(hire|resume-files)(?:\/([1-9]\d*)\/download)?)?$/.exec(path);
    if (application && (application[2] === 'hire' ? method === 'POST'
        : application[2] === 'resume-files' ? ['GET', 'POST'].includes(method) : method === 'PATCH')) {
        return { kind: 'application', id: application[1], fileId: application[3] };
    }
    return null;
}

function requireParkHrHiringAccess(db) {
    return async (req, res, next) => {
        const route = hiringRoute(req);
        if (!route) return next();
        const read = ['GET', 'HEAD'].includes(req.method);
        const capability = read ? 'hr.staff.view' : 'hr.staff.manage';
        const parkAccess = hasCurrentParkScheduleMembership(req) || legacyBusinessSurfaceAccess(req, 'staff').available;
        if (!parkAccess
            || (!read && resolveBusinessScope(req).canWrite !== true)
            || !resolveCapability(req.user, capability, { type: 'action' }).allowed) {
            return res.status(403).json({ success: false, code: 'HR_HIRING_ACCESS_REQUIRED',
                error: 'Найм доступний у вибраному кабінеті Парку за відповідного доступу.' });
        }
        if ([route.id, route.fileId].filter(Boolean).some(id => Number(id) > 2147483647)) {
            return res.status(400).json({ success: false, error: 'Некоректний ідентифікатор запису найму.' });
        }
        try {
            if (route.kind !== 'collection') {
                const sql = route.kind === 'vacancy'
                    ? 'SELECT id FROM job_vacancies WHERE id = $1 AND business_context = $2'
                    : `SELECT a.id FROM job_applications a JOIN job_vacancies v ON v.id = a.vacancy_id
                       WHERE a.id = $1 AND v.business_context = $2
                       ${route.fileId ? 'AND EXISTS (SELECT 1 FROM job_application_resume_files f WHERE f.id = $3 AND f.application_id = a.id)' : ''}`;
                const params = [route.id, 'event_genix'];
                if (route.fileId) params.push(route.fileId);
                const { rows } = await db.query(sql, params);
                if (!rows.length) return res.status(404).json({ success: false, error: 'Запис найму не знайдено.' });
            }
            req.parkHrHiringAccess = true;
            return next();
        } catch {
            return res.status(503).json({ success: false, error: 'Найм тимчасово недоступний. Повторіть спробу.' });
        }
    };
}

module.exports = { hiringRoute, requireParkHrHiringAccess };
