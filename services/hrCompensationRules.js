'use strict';

const { pool } = require('../db');
const { createHash } = require('node:crypto');
const { normalizePayRules } = require('./payrollRules');
const { normalizeBusinessContext, DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { normalizeProfessionKey, staffProfessionKeys } = require('./professions');
const { lockPayrollPeriodMutation, assertPayrollPeriodOpen } = require('./hrPayrollPeriod');

function failure(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function requiredText(value, field, max = 2000) {
    const result = String(value ?? '').trim();
    if (!result || result.length > max) throw failure('HR_PAY_RULE_INPUT_INVALID', `Перевірте поле «${field}»`);
    return result;
}
function scope(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(raw)) throw failure('HR_PAY_SCOPE_REQUIRED', 'Потрібна явна компанія');
    return normalizeBusinessContext(raw);
}
function positiveId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw failure('HR_PAY_ID_INVALID', 'Некоректний ідентифікатор');
    return id;
}
function day(value) {
    const str = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || !Number.isFinite(new Date(str + 'T00:00:00Z').getTime())
        || new Date(str + 'T00:00:00Z').toISOString().slice(0, 10) !== str) throw failure('HR_PAY_DATE_INVALID', 'Вкажіть коректну дату');
    return str;
}
function month(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) throw failure('HR_PAY_MONTH_INVALID', 'Вкажіть місяць');
    return value;
}
function amount(value, nullable = false) {
    if (value == null || value === '') {
        if (nullable) return null;
        throw failure('HR_PAY_AMOUNT_REQUIRED', 'Вкажіть грошову суму');
    }
    const parsed = Number(value);
    if (typeof value === 'boolean' || !Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999.99) throw failure('HR_PAY_AMOUNT_INVALID', 'Некоректна сума');
    return Math.round(parsed * 100) / 100;
}
function normalizeCompensationTemplate(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) throw failure('HR_PAY_TEMPLATE_INVALID', 'Непідтримуваний шаблон оплати');
    const rateUnit = value.rateUnit;
    if (!['hour', 'day', 'month'].includes(rateUnit)) throw failure('HR_PAY_TEMPLATE_UNIT_INVALID', 'Оберіть одиницю оплати');
    const defaultRate = amount(value.defaultRate, true), salaryFrom = amount(value.salaryFrom, true), salaryTo = amount(value.salaryTo, true);
    if (defaultRate === 0 || salaryFrom === 0 || salaryTo === 0 || (salaryFrom != null && salaryTo != null && salaryFrom > salaryTo)) throw failure('HR_PAY_TEMPLATE_RANGE_INVALID', 'Перевірте ставку та діапазон');
    if (defaultRate == null && salaryFrom == null && salaryTo == null) throw failure('HR_PAY_TEMPLATE_AMOUNT_REQUIRED', 'Вкажіть ставку або зарплатний діапазон');
    const rules = normalizePayRules(value.payRules, rateUnit);
    if (!rules) throw failure('HR_PAY_TEMPLATE_RULES_REQUIRED', 'Для нового шаблону оберіть явні правила оплати');
    const dayRates = Array.isArray(value.dayRates) ? value.dayRates : [];
    if (dayRates.length > 7 || (rateUnit === 'month' && dayRates.length)) throw failure('HR_PAY_TEMPLATE_DAY_RATES_INVALID', 'Перевірте ставки за днями тижня');
    const seen = new Set();
    const normalizedDays = dayRates.map(row => {
        const isoWeekday = Number(row.isoWeekday), rate = amount(row.rate);
        if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7 || seen.has(isoWeekday) || rate <= 0) throw failure('HR_PAY_TEMPLATE_DAY_RATES_INVALID', 'Перевірте ставки за днями тижня');
        seen.add(isoWeekday);
        return { isoWeekday, rate };
    }).sort((a, b) => a.isoWeekday - b.isoWeekday);
    return { schemaVersion: 1, rateUnit, defaultRate, salaryFrom, salaryTo, payRules: rules, dayRates: normalizedDays,
        levelId: value.levelId == null || value.levelId === '' ? null : positiveId(value.levelId) };
}
const actorName = actor => requiredText(actor?.username || actor, 'Автор', 100);

async function transaction(options, callback) {
    const db = options.db || pool;
    if (options.reuseClient) return callback(db);
    const connected = typeof db.connect === 'function';
    const client = connected ? await db.connect() : db;
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') throw failure('HR_PAY_VERSION_CONFLICT', 'Умови вже змінено. Оновіть дані.', 409);
        throw error;
    } finally { if (connected) client.release(); }
}
async function audit(db, action, staffId, author, details) {
    await db.query('INSERT INTO hr_audit_log (action, staff_id, performed_by, details) VALUES ($1,$2,$3,$4::jsonb)',
        [action, staffId, author, JSON.stringify(details)]);
}
async function assertProfession(db, professionKey) {
    const result = await db.query('SELECT key FROM hr_professions WHERE key=$1 AND is_active=true', [professionKey]);
    if (!result.rows.length) throw failure('HR_PAY_PROFESSION_INVALID', 'Професія неактивна або відсутня', 404);
}
async function loadScopedStaff(db, staffId, businessContext) {
    // The canonical staff/profile namespace is currently Park-owned. Do not infer
    // that another business owns these rows merely because its request has an ID.
    if (businessContext !== DEFAULT_BUSINESS_CONTEXT) throw failure('HR_PAY_STAFF_SCOPE_UNAVAILABLE', 'Кадровий payroll-простір цієї компанії ще не підтримує ці записи', 409);
    const result = await db.query('SELECT * FROM staff WHERE id=$1 FOR UPDATE', [positiveId(staffId)]);
    if (!result.rows[0] || result.rows[0].is_active === false) throw failure('HR_PAY_STAFF_UNAVAILABLE', 'Активного працівника не знайдено', 404);
    return result.rows[0];
}
async function assertMutableFrom(db, staffId, effectiveFrom) {
    await lockPayrollPeriodMutation(effectiveFrom.slice(0, 7), db);
    await assertPayrollPeriodOpen(effectiveFrom.slice(0, 7), db);
    const futureLocks = await db.query('SELECT period_month FROM payroll_period_locks WHERE period_month >= $1 AND is_locked=true LIMIT 1', [effectiveFrom.slice(0, 7)]);
    if (futureLocks.rows.length) throw failure('HR_PAY_HISTORY_LOCKED', 'Наступний зарплатний період закрито', 409);
    const locked = await db.query(`SELECT pr.id FROM payroll_reports pr WHERE pr.staff_id=$1 AND pr.period_month >= $2
        AND (pr.status IN ('reviewed','approved','paid') OR EXISTS (SELECT 1 FROM payroll_installments pi
            WHERE pi.payroll_report_id=pr.id AND (pi.workflow_status <> 'draft' OR EXISTS (
                SELECT 1 FROM payroll_payment_movements pm WHERE pm.installment_id=pi.id)))) LIMIT 1`, [staffId, effectiveFrom.slice(0, 7)]);
    if (locked.rows.length) throw failure('HR_PAY_HISTORY_LOCKED', 'Наступні нарахування вже зафіксовано', 409);
    const frozen = await db.query(`SELECT id FROM hr_time_records WHERE staff_id=$1 AND record_date >= $2::date
        AND (compensation_snapshot IS NOT NULL OR clock_in IS NOT NULL OR clock_out IS NOT NULL OR total_worked_minutes > 0) LIMIT 1`, [staffId, effectiveFrom]);
    if (frozen.rows.length) throw failure('HR_PAY_ATTENDANCE_FROZEN', 'Умови наступних дат уже зафіксовано. Оберіть іншу дату або окрему корекцію.', 409);
}

async function listRuleDefaults(input, options = {}) {
    const result = await (options.db || pool).query(`SELECT DISTINCT ON (d.profession_key) d.*, d.effective_from::text AS effective_from
        FROM hr_payroll_rule_defaults d WHERE d.business_context=$1 AND d.effective_from <= $2::date
        ORDER BY d.profession_key, d.effective_from DESC, d.id DESC`, [scope(input.businessContext), day(input.asOfDate)]);
    return result.rows;
}
async function saveRuleDefault(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), professionKey = normalizeProfessionKey(input.professionKey);
    const effectiveFrom = day(input.effectiveFrom), template = normalizeCompensationTemplate(input.template);
    const reason = requiredText(input.reason, 'Причина'), author = actorName(actor);
    if (!template) throw failure('HR_PAY_TEMPLATE_REQUIRED', 'Потрібен шаблон оплати');
    return transaction(options, async db => {
        await assertProfession(db, professionKey);
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hr-pay-default:${businessContext}:${professionKey}`]);
        const last = await db.query('SELECT effective_from::text FROM hr_payroll_rule_defaults WHERE business_context=$1 AND profession_key=$2 ORDER BY effective_from DESC LIMIT 1', [businessContext, professionKey]);
        if (last.rows[0]?.effective_from >= effectiveFrom) throw failure('HR_PAY_DEFAULT_APPEND_ONLY', 'Нова версія має починатися пізніше за попередню', 409);
        if (template.levelId) await loadLevel(db, template.levelId, businessContext, professionKey);
        const result = await db.query(`INSERT INTO hr_payroll_rule_defaults (business_context,profession_key,effective_from,template,reason,created_by)
            VALUES ($1,$2,$3::date,$4::jsonb,$5,$6) RETURNING *`, [businessContext, professionKey, effectiveFrom, JSON.stringify(template), reason, author]);
        await audit(db, 'pay_rule_default_create', null, author, { businessContext, professionKey, effectiveFrom, template, reason });
        return result.rows[0];
    });
}
async function loadLevel(db, levelId, businessContext, professionKey) {
    const result = await db.query('SELECT * FROM hr_qualification_levels WHERE id=$1 AND business_context=$2 AND profession_key=$3 AND is_active=true', [positiveId(levelId), businessContext, professionKey]);
    if (!result.rows[0]) throw failure('HR_PAY_LEVEL_UNAVAILABLE', 'Рівень не належить цій компанії та професії', 404);
    return result.rows[0];
}
async function listQualificationLevels(input, options = {}) {
    const result = await (options.db || pool).query('SELECT * FROM hr_qualification_levels WHERE business_context=$1 AND profession_key=$2 ORDER BY rank,id', [scope(input.businessContext), normalizeProfessionKey(input.professionKey)]);
    return result.rows;
}
async function createQualificationLevel(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), professionKey = normalizeProfessionKey(input.professionKey), profileId = positiveId(input.profileId);
    const title = requiredText(input.title, 'Назва рівня', 120), levelKey = requiredText(input.levelKey, 'Код рівня', 64), rank = Number(input.rank), author = actorName(actor);
    if (!/^[a-z][a-z0-9_]*$/.test(levelKey) || !Number.isInteger(rank) || rank < 0) throw failure('HR_PAY_LEVEL_INVALID', 'Перевірте код і порядок рівня');
    return transaction(options, async db => {
        // Existing profiles have proven Park ownership only. Scoped definitions
        // for other companies can be stored as templates, not linked to Park IDs.
        if (businessContext !== DEFAULT_BUSINESS_CONTEXT) throw failure('HR_PAY_PROFILE_SCOPE_UNAVAILABLE', 'Профілі оплати цієї компанії ще не підтверджені', 409);
        const profile = await require('./hrPayrollProfiles').getPayrollProfile(profileId, { db });
        if (profile.professionKey !== professionKey || profile.profileKind !== 'shared' || profile.status !== 'active') throw failure('HR_PAY_LEVEL_PROFILE_INVALID', 'Оберіть активний спільний профіль цієї професії');
        const result = await db.query(`INSERT INTO hr_qualification_levels (business_context,profession_key,level_key,title,rank,profile_id,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [businessContext, professionKey, levelKey, title, rank, profileId, author]);
        await audit(db, 'qualification_level_create', null, author, { businessContext, level: result.rows[0] });
        return result.rows[0];
    });
}
async function qualificationHistory(input, options = {}) {
    const businessContext = scope(input.businessContext);
    const staffId = positiveId(input.staffId);
    if (businessContext !== DEFAULT_BUSINESS_CONTEXT) throw failure('HR_PAY_STAFF_SCOPE_UNAVAILABLE', 'Кадрові дані цієї компанії недоступні', 409);
    const result = await (options.db || pool).query(`SELECT h.*,h.effective_from::text AS effective_from FROM hr_staff_qualification_events h
        WHERE h.staff_id=$1 AND h.business_context=$2 AND h.profession_key=$3 ORDER BY h.effective_from DESC,h.id DESC`, [staffId, businessContext, normalizeProfessionKey(input.professionKey)]);
    return result.rows;
}
async function applyProfile(db, staff, professionKey, profileId, effectiveFrom, input, actor) {
    const profiles = require('./hrPayrollProfiles');
    const current = await profiles.listStaffPayrollProfileAssignments(staff.id, { db, includePast: true });
    const assignments = current.assignments || [];
    const overlapping = assignments.filter(row => row.professionKey === professionKey && (!row.effectiveTo || row.effectiveTo >= effectiveFrom));
    if (overlapping.length && input.payDecision !== 'use_level' && input.payDecision !== 'replace') {
        if (input.payDecision === 'keep_personal') return { preservedPersonalConditions: true, assignments: overlapping };
        throw failure('HR_PAY_PERSONAL_DECISION_REQUIRED', 'Є персональні або тимчасові умови. Оберіть: зберегти їх чи застосувати нові.', 409);
    }
    // Temporary arrangements remain higher priority and are not silently removed.
    if (overlapping.some(row => row.assignmentKind === 'temporary') && input.payDecision !== 'keep_personal') throw failure('HR_PAY_TEMPORARY_ASSIGNMENT_REVIEW', 'Спочатку перегляньте чинні тимчасові умови', 409);
    const patch = await profiles.buildAssignmentPatchForEffectiveFrom(db, staff.id, professionKey,
        { professionKey, profileId, assignmentKind: 'explicit', effectiveFrom, effectiveTo: null });
    return profiles.saveStaffPayrollProfileAssignments(staff.id, { mode: 'patch', ...patch, reason: input.reason }, actor, { db, reuseClient: true });
}
async function changeQualificationLevel(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), staffId = positiveId(input.staffId), professionKey = normalizeProfessionKey(input.professionKey);
    const effectiveFrom = day(input.effectiveFrom), reason = requiredText(input.reason, 'Причина'), author = actorName(actor);
    return transaction(options, async db => {
        await lockPayrollPeriodMutation(effectiveFrom.slice(0, 7), db);
        const staff = await loadScopedStaff(db, staffId, businessContext);
        if (!staffProfessionKeys(staff).includes(professionKey)) throw failure('HR_PAY_STAFF_PROFESSION_INVALID', 'Професія не призначена працівнику');
        await assertMutableFrom(db, staffId, effectiveFrom);
        const history = await qualificationHistory({ businessContext, staffId, professionKey }, { db });
        const last = history[0];
        if (Number(input.expectedEventId || 0) !== Number(last?.id || 0)) throw failure('HR_PAY_LEVEL_STALE', 'Рівень уже змінено. Оновіть картку.', 409);
        if (last?.effective_from >= effectiveFrom) throw failure('HR_PAY_LEVEL_APPEND_ONLY', 'Зміна рівня має починатися після попередньої', 409);
        const level = await loadLevel(db, input.levelId, businessContext, professionKey);
        const profile = await require('./hrPayrollProfiles').getPayrollProfile(level.profile_id, { db, asOfDate: effectiveFrom });
        if (profile.status !== 'active' || !profile.currentVersion) throw failure('HR_PAY_LEVEL_PROFILE_UNAVAILABLE', 'Ставка рівня не діє на обрану дату', 409);
        const assignment = await applyProfile(db, staff, professionKey, profile.id, effectiveFrom, { ...input, reason }, actor);
        const snapshot = { level: { id: Number(level.id), title: level.title, rank: level.rank },
            profile: { id: profile.id, title: profile.title, version: profile.currentVersion }, previousEventId: last?.id || null,
            payDecision: input.payDecision || 'use_level', preservedPersonalConditions: assignment.preservedPersonalConditions === true };
        const result = await db.query(`INSERT INTO hr_staff_qualification_events (staff_id,business_context,profession_key,level_id,effective_from,reason,snapshot,created_by)
            VALUES ($1,$2,$3,$4,$5::date,$6,$7::jsonb,$8) RETURNING *,effective_from::text AS effective_from`, [staffId, businessContext, professionKey, level.id, effectiveFrom, reason, JSON.stringify(snapshot), author]);
        await audit(db, 'staff_qualification_change', staffId, author, { businessContext, event: result.rows[0] });
        return { event: result.rows[0], assignment };
    });
}

async function loadComponentInputs(input, options = {}) {
    const businessContext = scope(input.businessContext), periodMonth = month(input.month);
    const ids = [...new Set((input.staffIds || [input.staffId]).map(positiveId))];
    const result = await (options.db || pool).query(`SELECT DISTINCT ON (staff_id,basis_key) *,period_month AS month,created_by AS author
        FROM hr_payroll_component_inputs WHERE business_context=$1 AND period_month=$2 AND staff_id=ANY($3::int[])
        ORDER BY staff_id,basis_key,version DESC`, [businessContext, periodMonth, ids]);
    const grouped = new Map(ids.map(id => [id, {}]));
    for (const row of result.rows) grouped.get(Number(row.staff_id))[row.basis_key] = { id: Number(row.id), version: row.version,
        amount: Number(row.amount), month: row.month, confirmed: row.confirmed, reason: row.reason, author: row.author };
    return grouped;
}
async function saveComponentInput(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), periodMonth = month(input.month), staffId = positiveId(input.staffId);
    const basisKey = input.basisKey, base = amount(input.amount), reason = requiredText(input.reason, 'Пояснення бази'), author = actorName(actor);
    const expectedVersion = Number(input.expectedVersion);
    if (!['own_bookings', 'other_bookings', 'manual'].includes(basisKey) || !Number.isInteger(expectedVersion) || expectedVersion < 0) throw failure('HR_PAY_COMPONENT_INPUT_INVALID', 'Перевірте базу і версію');
    return transaction(options, async db => {
        await lockPayrollPeriodMutation(periodMonth, db);
        await loadScopedStaff(db, staffId, businessContext);
        await assertPayrollPeriodOpen(periodMonth, db);
        const locked = await db.query(`SELECT pr.id FROM payroll_reports pr WHERE pr.staff_id=$1 AND pr.period_month=$2
            AND (pr.status IN ('reviewed','approved','paid') OR EXISTS (SELECT 1 FROM payroll_installments pi
                WHERE pi.payroll_report_id=pr.id AND (pi.workflow_status <> 'draft' OR EXISTS (
                    SELECT 1 FROM payroll_payment_movements pm WHERE pm.installment_id=pi.id)))) LIMIT 1`, [staffId, periodMonth]);
        if (locked.rows.length) throw failure('HR_PAY_HISTORY_LOCKED', 'Нарахування вже зафіксовано', 409);
        const existing = (await loadComponentInputs({ businessContext, month: periodMonth, staffId }, { db })).get(staffId)[basisKey];
        if ((existing?.version || 0) !== expectedVersion) throw failure('HR_PAY_COMPONENT_INPUT_STALE', 'Базу вже змінено. Оновіть дані.', 409);
        const result = await db.query(`INSERT INTO hr_payroll_component_inputs (staff_id,business_context,period_month,basis_key,version,amount,confirmed,reason,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [staffId, businessContext, periodMonth, basisKey, expectedVersion + 1, base, input.confirmed === true, reason, author]);
        await audit(db, 'payroll_component_input', staffId, author, { businessContext, input: result.rows[0], source: 'manual_confirmed' });
        return (await loadComponentInputs({ businessContext, month: periodMonth, staffId }, { db })).get(staffId)[basisKey];
    });
}

async function vacancyTemplate(input, options = {}) {
    const db = options.db || pool, businessContext = scope(input.businessContext), vacancyId = positiveId(input.vacancyId);
    const result = await db.query(`SELECT id,title,role_type,business_context,compensation_template FROM job_vacancies
        WHERE id=$1 AND business_context=$2${options.forUpdate ? ' FOR UPDATE' : ''}`, [vacancyId, businessContext]);
    const vacancy = result.rows[0];
    if (!vacancy) throw failure('HR_PAY_VACANCY_UNAVAILABLE', 'Вакансія не належить обраній компанії', 404);
    const professionKey = normalizeProfessionKey(vacancy.role_type);
    let template = normalizeCompensationTemplate(vacancy.compensation_template), source = { type: 'vacancy', vacancyId };
    if (!template) {
        const defaults = await listRuleDefaults({ businessContext, asOfDate: day(input.effectiveFrom) }, { db });
        const entry = defaults.find(row => row.profession_key === professionKey);
        if (entry) { template = normalizeCompensationTemplate(entry.template); source = { type: 'company_profession_default', defaultId: Number(entry.id), vacancyId }; }
    }
    const templateHash = createHash('sha256').update(JSON.stringify({ businessContext, professionKey, template, source })).digest('hex');
    return { vacancy: { id: Number(vacancy.id), title: vacancy.title }, businessContext, professionKey, template, source, templateHash };
}
async function saveVacancyTemplate(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), vacancyId = positiveId(input.vacancyId);
    const template = normalizeCompensationTemplate(input.template), author = actorName(actor), reason = requiredText(input.reason, 'Причина');
    return transaction(options, async db => {
        const before = await vacancyTemplate({ businessContext, vacancyId, effectiveFrom: day(input.effectiveFrom) }, { db, forUpdate: true });
        if (input.expectedTemplateHash !== before.templateHash) throw failure('HR_PAY_VACANCY_TEMPLATE_STALE', 'Умови вакансії вже змінилися. Оновіть дані.', 409);
        if (template?.levelId) await loadLevel(db, template.levelId, businessContext, before.professionKey);
        await db.query('UPDATE job_vacancies SET compensation_template=$3::jsonb WHERE id=$1 AND business_context=$2', [vacancyId, businessContext, template ? JSON.stringify(template) : null]);
        await audit(db, 'vacancy_compensation_template', null, author, { businessContext, vacancyId, template, reason, previousSource: before.source });
        return vacancyTemplate({ businessContext, vacancyId, effectiveFrom: input.effectiveFrom }, { db });
    });
}
async function applyVacancyTemplate(input, actor, options = {}) {
    const businessContext = scope(input.businessContext), staffId = positiveId(input.staffId), effectiveFrom = day(input.effectiveFrom);
    const reason = requiredText(input.reason, 'Причина'), author = actorName(actor);
    return transaction(options, async db => {
        await lockPayrollPeriodMutation(effectiveFrom.slice(0, 7), db);
        const staff = await loadScopedStaff(db, staffId, businessContext);
        const preview = await vacancyTemplate({ ...input, businessContext, effectiveFrom }, { db, forUpdate: true });
        if (!preview.template) throw failure('HR_PAY_VACANCY_TEMPLATE_MISSING', 'У вакансії немає умов оплати');
        if (input.expectedTemplateHash !== preview.templateHash) throw failure('HR_PAY_VACANCY_TEMPLATE_STALE', 'Спочатку перегляньте актуальні умови вакансії', 409);
        if (!staffProfessionKeys(staff).includes(preview.professionKey)) throw failure('HR_PAY_STAFF_PROFESSION_INVALID', 'Професія вакансії не призначена працівнику');
        const template = preview.template;
        const chosen = input.selectedRate == null || input.selectedRate === '' ? template.defaultRate : amount(input.selectedRate);
        if (!(chosen > 0)) throw failure('HR_PAY_VACANCY_RATE_SELECTION_REQUIRED', 'Оберіть точну ставку із зарплатного діапазону');
        if ((template.salaryFrom != null && chosen < template.salaryFrom) || (template.salaryTo != null && chosen > template.salaryTo)) throw failure('HR_PAY_VACANCY_RATE_OUTSIDE_RANGE', 'Ставка поза діапазоном вакансії');
        await assertMutableFrom(db, staffId, effectiveFrom);
        const profiles = require('./hrPayrollProfiles');
        const profile = await profiles.createPayrollProfile({ title: `${preview.vacancy.title} · #${staffId}`, professionKey: preview.professionKey,
            profileKind: 'personal', ownerStaffId: staffId, status: 'active', isDefaultForProfession: false,
            rateUnit: template.rateUnit, defaultRate: chosen, effectiveFrom, payRules: template.payRules,
            dayRates: template.dayRates, changeReason: reason }, actor, { db, reuseClient: true });
        // Existing service returns a normalized profile, not a mutable vacancy link.
        const profileId = Number(profile.id || profile.profile?.id);
        const origin = { ...preview.source, businessContext, templateHash: preview.templateHash,
            effectiveFrom, template: structuredClone(template), chosenRate: chosen, author, reason };
        await db.query('UPDATE payroll_profiles SET template_origin=$2::jsonb WHERE id=$1', [profileId, JSON.stringify(origin)]);
        const assignment = await applyProfile(db, staff, preview.professionKey, profileId, effectiveFrom, { ...input, reason }, actor);
        if (assignment.preservedPersonalConditions) throw failure('HR_PAY_VACANCY_PERSONAL_PRESERVED', 'Для застосування шаблону потрібне явне рішення замінити персональні умови', 409);
        let qualification = null;
        if (template.levelId) {
            const level = await loadLevel(db, template.levelId, businessContext, preview.professionKey);
            const previous = await qualificationHistory({ businessContext, staffId, professionKey: preview.professionKey }, { db });
            if (previous[0]?.effective_from >= effectiveFrom) throw failure('HR_PAY_LEVEL_APPEND_ONLY', 'Дата шаблону перетинається з історією рівнів', 409);
            const snapshot = { level: { id: Number(level.id), title: level.title, rank: level.rank }, profileId, origin,
                payDecision: 'vacancy_snapshot', previousEventId: previous[0]?.id || null };
            const result = await db.query(`INSERT INTO hr_staff_qualification_events (staff_id,business_context,profession_key,level_id,effective_from,reason,snapshot,created_by)
                VALUES ($1,$2,$3,$4,$5::date,$6,$7::jsonb,$8) RETURNING *`, [staffId, businessContext, preview.professionKey, level.id, effectiveFrom, reason, JSON.stringify(snapshot), author]);
            qualification = result.rows[0];
        }
        await audit(db, 'vacancy_compensation_apply', staffId, author, { ...origin, profileId });
        return { profile: await profiles.getPayrollProfile(profileId, { db, asOfDate: effectiveFrom }), assignment, qualification, origin };
    });
}

async function staffRuleWorkspace(input, options = {}) {
    const db = options.db || pool, businessContext = scope(input.businessContext), staffId = positiveId(input.staffId);
    if (businessContext !== DEFAULT_BUSINESS_CONTEXT) throw failure('HR_PAY_STAFF_SCOPE_UNAVAILABLE', 'Кадрові дані цієї компанії недоступні', 409);
    const result = await db.query('SELECT id,role_type,secondary_professions FROM staff WHERE id=$1', [staffId]);
    const staff = result.rows[0];
    if (!staff) throw failure('HR_PAY_STAFF_UNAVAILABLE', 'Працівника не знайдено', 404);
    const professionKey = normalizeProfessionKey(input.professionKey || staff.role_type);
    if (!staffProfessionKeys(staff).includes(professionKey)) throw failure('HR_PAY_STAFF_PROFESSION_INVALID', 'Професія не призначена працівнику');
    const asOfDate = day(input.asOfDate);
    const [defaults, levels, history, inputs, assignments] = await Promise.all([
        listRuleDefaults({ businessContext, asOfDate }, { db }),
        listQualificationLevels({ businessContext, professionKey }, { db }),
        qualificationHistory({ businessContext, staffId, professionKey }, { db }),
        loadComponentInputs({ businessContext, month: asOfDate.slice(0, 7), staffId }, { db }),
        require('./hrPayrollProfiles').listStaffPayrollProfileAssignments(staffId, { db, includePast: true })
    ]);
    return { businessContext, staffId, professionKey, asOfDate,
        defaultTemplate: defaults.find(entry => entry.profession_key === professionKey) || null,
        levels, history, currentLevel: history.find(entry => entry.effective_from <= asOfDate) || null,
        componentInputs: inputs.get(staffId), assignments: assignments.assignments };
}

module.exports = { normalizeCompensationTemplate, listRuleDefaults, saveRuleDefault, listQualificationLevels,
    createQualificationLevel, qualificationHistory, changeQualificationLevel, loadComponentInputs, saveComponentInput,
    vacancyTemplate, saveVacancyTemplate, applyVacancyTemplate,
    staffRuleWorkspace,
    scope, loadScopedStaff, assertMutableFrom, applyProfile, transaction };
