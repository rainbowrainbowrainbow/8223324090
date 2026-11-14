'use strict';
const router = require('express').Router();
const { pool } = require('../db');
const { requireAction } = require('../middleware/auth');
const { requireParkStaffAccounts } = require('../services/legacyBusinessSurface');
const { resolveBusinessScope, requireWritableBusinessScope } = require('../services/businessContext');
const { createSubstitutionService } = require('../services/staffSubstitutions');
const { fail } = require('../services/staffSubstitutionContract');
const education = require('../services/staffSubstitutionEducation');
const { listTeachers } = require('../services/educationGroups');
const { canAccessTimelineContext } = require('../services/timelineContext');
const { getBusinessCabinetSettings } = require('../services/businessCabinet');
const service = createSubstitutionService();
router.use(requireAction('hr.staff.view'), requireAction('hr.payroll.view'));
router.use(async (req, res, next) => {
    const scope = resolveBusinessScope(req);
    const business = scope.activeContext;
    req.substitutionBusiness = business;
    if (!scope.invalid && scope.mode === 'single') {
        if (business === 'event_genix') return requireParkStaffAccounts(req, res, next);
        if (business === education.DAR && canAccessTimelineContext(req.user, business)) {
            try {
                if ((await getBusinessCabinetSettings(pool, business)).timelineMode === 'education') return next();
            } catch (error) { return next(error); }
        }
    }
    return res.status(403).json({ success: false, code: 'SUBSTITUTION_BUSINESS_UNSUPPORTED', error: 'Оберіть доступний кабінет Park або навчальний кабінет Дару' });
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

router.get('/catalog', handle(async req => {
    if (req.substitutionBusiness === education.DAR) return {
        staff: await listTeachers(education.DAR), professions: [{ key:'teacher', title:'Викладач' }],
        sources: [{ key:education.TYPE, title:'Навчальне заняття' }]
    };
    const staff = await pool.query('SELECT id,name,role_type,is_active,termination_date,hr_pool_status FROM staff WHERE is_active=true ORDER BY name,id');
    const professions = await pool.query('SELECT key,title FROM hr_professions WHERE is_active=true ORDER BY sort_order,title');
    return { staff: staff.rows, professions: professions.rows,
        sources: [{ key: 'standalone', title: 'Окрема робота' }, { key: 'hr_shift', title: 'Зміна графіка' }, { key: 'task', title: 'Задача' },
            { key:'afisha',title:'Захід Афіші' },{key:'booking',title:'Бронювання Park'},
            {key:'procurement',title:'Завдання закупівлі'},{key:'lead',title:'Робота з лідом'},{key:'onboarding',title:'Наставництво'},{key:'inbox',title:'Відповідальний за розмову Omni'},
            {key:'inbox_reply',title:'Очікувана відповідь Omni'},{key:'chat_task',title:'Пряма задача чату Park'}, {key:'meeting_action',title:'Доручення з наради Park'}],
        unavailableSources: [] };
}));
router.get('/', handle(req => service.list(req.substitutionBusiness, req.query)));
router.get('/sources', requireAction('hr.schedule.manage'), handle(req => require('../services/staffSubstitutionSources')
    .listScopes(pool,req.substitutionBusiness,req.user,req.query)));
router.get('/teacher-rates', handle(req => {
    if (req.substitutionBusiness !== education.DAR) fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Ставки викладачів доступні в кабінеті Дару', 403);
    return education.listRates(pool, req.query.staffId);
}));
router.get('/accruals', handle(req => {
    if (req.substitutionBusiness !== education.DAR) fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Цей звіт доступний у кабінеті Дару', 403);
    return service.darAccruals(req.query);
}));
router.get('/:id/history', handle(req => service.history(req.substitutionBusiness, req.params.id)));
router.get('/:id/completion-options', handle(req => service.completionOptions(req.substitutionBusiness, req.params.id)));
router.post('/preview', requireAction('hr.schedule.manage'), handle(req => service.preview(req.substitutionBusiness, req.user, req.body.input, req.body.id)));

router.use(requireAction('hr.schedule.manage'), requireAction('hr.payroll.manage'), requireAction('manage_payroll_rules'));
router.use((req, res, next) => requireWritableBusinessScope(req, res) && next());
router.use((req, res, next) => {
    if (req.substitutionBusiness !== education.DAR) return next();
    try { education.requireEdit(req.user); next(); }
    catch (error) { res.status(error.statusCode).json({ success:false, code:error.code, error:error.message }); }
});
router.post('/teacher-rates', handle(req => {
    if (req.substitutionBusiness !== education.DAR) {
        fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Ставки викладачів доступні в кабінеті Дару', 403);
    }
    return education.saveRate(pool, req.user, req.body);
}));
router.post('/', handle(req => service.mutate(req.substitutionBusiness, req.user, 'create', req.body)));
router.post('/:id/revise', handle(req => service.mutate(req.substitutionBusiness, req.user, 'revise', req.body, req.params.id)));
router.post('/:id/complete', requireAction('manage_payroll_accrual'), handle(req => service.mutate(req.substitutionBusiness, req.user, 'complete', req.body, req.params.id)));
router.post('/:id/cancel', handle(req => service.mutate(req.substitutionBusiness, req.user, 'cancel', req.body, req.params.id)));

module.exports = router;
