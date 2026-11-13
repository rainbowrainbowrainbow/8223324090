'use strict';
const router = require('express').Router();
const { pool } = require('../db');
const { requireAction } = require('../middleware/auth');
const { requireParkStaffAccounts } = require('../services/legacyBusinessSurface');
const { resolveBusinessScope, requireWritableBusinessScope } = require('../services/businessContext');
const { createSubstitutionService } = require('../services/staffSubstitutions');
const service = createSubstitutionService();

router.use(requireParkStaffAccounts);
router.use(requireAction('hr.staff.view'), requireAction('hr.payroll.view'));
router.use((req, res, next) => {
    const scope = resolveBusinessScope(req);
    if (scope.invalid || scope.activeContext !== 'event_genix' || scope.mode !== 'single') {
        return res.status(403).json({ success: false, code: 'SUBSTITUTION_BUSINESS_UNSUPPORTED', error: 'Оберіть доступний кабінет Park' });
    }
    req.substitutionBusiness = scope.activeContext;
    next();
});

function handle(work) {
    return async (req, res) => {
        try { res.json({ success: true, data: await work(req) }); }
        catch (error) {
            const status = error.statusCode || error.status || 500;
            res.status(status).json({ success: false, code: error.code || 'SUBSTITUTION_FAILED',
                error: status < 500 ? error.message : 'Не вдалося виконати дію підміни. Повторіть спробу.', details: status < 500 ? error.details : undefined });
        }
    };
}

router.get('/catalog', handle(async () => {
    const staff = await pool.query('SELECT id,name,role_type,is_active,termination_date,hr_pool_status FROM staff WHERE is_active=true ORDER BY name,id');
    const professions = await pool.query('SELECT key,title FROM hr_professions WHERE is_active=true ORDER BY sort_order,title');
    return { staff: staff.rows, professions: professions.rows,
        sources: [{ key: 'standalone', title: 'Окрема робота' }, { key: 'hr_shift', title: 'Зміна графіка' }, { key: 'task', title: 'Задача' },
            { key:'afisha',title:'Захід Афіші' },{key:'procurement',title:'Завдання закупівлі'},{key:'lead',title:'Робота з лідом'}],
        unavailableSources: [{key:'booking',title:'Бронювання'},{key:'education_lesson',title:'Навчальні заняття'}] };
}));
router.get('/', handle(req => service.list(req.substitutionBusiness, req.query)));
router.get('/sources', requireAction('hr.schedule.manage'), handle(req => require('../services/staffSubstitutionSources')
    .listScopes(pool,req.substitutionBusiness,req.user,req.query)));
router.get('/:id/history', handle(req => service.history(req.substitutionBusiness, req.params.id)));
router.get('/:id/completion-options', handle(req => service.completionOptions(req.substitutionBusiness, req.params.id)));
router.post('/preview', requireAction('hr.schedule.manage'), handle(req => service.preview(req.substitutionBusiness, req.user, req.body.input, req.body.id)));

router.use(requireAction('hr.schedule.manage'), requireAction('hr.payroll.manage'), requireAction('manage_payroll_rules'));
router.use((req, res, next) => requireWritableBusinessScope(req, res) && next());
router.post('/', handle(req => service.mutate(req.substitutionBusiness, req.user, 'create', req.body)));
router.post('/:id/revise', handle(req => service.mutate(req.substitutionBusiness, req.user, 'revise', req.body, req.params.id)));
router.post('/:id/complete', requireAction('manage_payroll_accrual'), handle(req => service.mutate(req.substitutionBusiness, req.user, 'complete', req.body, req.params.id)));
router.post('/:id/cancel', handle(req => service.mutate(req.substitutionBusiness, req.user, 'cancel', req.body, req.params.id)));

module.exports = router;
