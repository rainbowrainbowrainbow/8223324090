'use strict';

const { before, after, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const profiles = require('../../services/hrPayrollProfiles');
const rules = require('../../services/hrCompensationRules');
const { loadPayrollProfileContext, calculateProfessionPay, buildCanonicalPayrollInstallmentPreview } = require('../../services/payroll');
const { resolvePayrollConditions, loadPayrollConditionContext } = require('../../services/hrPayrollConditions');
const { buildAttendanceCompensationPlanSnapshot, allocateAttendanceToSegments, finalizeAttendanceCompensationSnapshot } = require('../../services/hrAttendance');
const { calculateConditionSnapshots } = require('../../services/payrollConditionCalculation');
const { authRequest, request } = require('../helpers');

const enabled = process.env.RUN_PAYROLL_PROFILES_INTEGRATION === 'true';
describe('configurable compensation on disposable PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let db, profession, staffId, otherStaffId, frozenStaffId;
    const actor = { username: 'synthetic_pay_rules_operator' };
    const fixed = { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } };
    const daily = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600 } };
    const context = 'event_genix';
    let firstProfile, levels, event;
    before(async () => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
        assert.equal(target.isLocal, true);
        db = new Pool({ connectionString: target.url.toString(), ssl: false, max: 6 });
        profession = 'pay_rules_' + process.pid + '_' + Date.now();
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES ($1,$2,$3)', [profession, 'Synthetic pay profession', 'qa']);
        const staff = await db.query(`INSERT INTO staff (name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES ('Synthetic rule worker','qa','Synthetic',$1,100,'hour',true,'2198-01-01'),
            ('Synthetic vacancy worker','qa','Synthetic',$1,100,'hour',true,'2198-01-01'),
            ('Synthetic frozen worker','qa','Synthetic',$1,100,'hour',true,'2198-01-01') RETURNING id`, [profession]);
        [staffId, otherStaffId, frozenStaffId] = staff.rows.map(row => Number(row.id));
    });
    after(async () => { await db?.end(); });

    test('actual canonical installments and forecast keep a no-attendance fixed salary consistent', async () => {
        const key = 'fixed_' + process.pid;
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic fixed forecast', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic fixed installment','qa','Synthetic',$1,20000,'month',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        await profiles.createPayrollProfile({ title: 'Synthetic fixed forecast', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, status: 'active', rateUnit: 'month', defaultRate: 20000, effectiveFrom: '2198-01-01', payRules: fixed }, actor, { db });
        const forecast = await profiles.forecastPayrollProfiles({ month: '2198-11', staffIds: [id], includeActual: true }, { db });
        assert.equal(forecast.rows[0].total_salary, 20000);
        assert.deepEqual(forecast.rows[0].blocking_issues, []);
        assert.equal(forecast.actual.rows[0].actual_salary, 20000);
        const settlement = await buildCanonicalPayrollInstallmentPreview({ month: '2198-11', staffId: id }, db);
        assert.equal(settlement.monthlyNetAmount, 20000);
        assert.equal(settlement.advanceAmount, 10000);
        assert.equal(settlement.finalAmount, 10000);
        assert.equal(settlement.combinedAmount, 20000);
        assert.deepEqual(settlement.blockers, []);
    });

    test('draft conditions survive reload and edit without assignment until the exact revision is activated', async () => {
        const key = 'draft_' + process.pid;
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES ($1,$2,$3)', [key, 'Synthetic draft', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic draft worker','qa','Synthetic',$1,75,'hour',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        const payRules = { ...daily, daily: { ...daily.daily, fullDayMinutes: 480,
            fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 600 }] },
            conditionReviews: { commission: { state: 'unknown', source: 'Synthetic interview', reason: 'Percent is awaiting confirmation' } } };
        const initial = await profiles.createPayrollProfile({ title: 'Saved draft', professionKey: key, ownerStaffId: id,
            profileKind: 'personal', status: 'draft', effectiveFrom: '2198-11-01', rateUnit: 'day',
            defaultRate: 500, dayRates: [{ isoWeekday: 7, rate: 600 }], payRules }, actor, { db });
        const loaded = await profiles.getPayrollProfile(initial.id, { db, asOfDate: '2198-11-22' });
        assert.equal(loaded.status, 'draft');
        assert.equal(loaded.currentVersion, null);
        assert.equal(loaded.latestVersion.defaultRate, 500);
        assert.equal(loaded.latestVersion.activatedAt, null);
        assert.equal(loaded.latestVersion.payRules.conditionReviews.commission.author, actor.username);
        assert.equal(loaded.latestVersion.payRules.daily.fullDayMinutesByWeekday[0].minutes, 600);
        const assignment = { professionKey: key, profileId: initial.id, effectiveFrom: '2198-11-01', assignmentKind: 'explicit' };
        await assert.rejects(profiles.saveStaffPayrollProfileAssignments(id, { assignments: [assignment], reason: 'Synthetic assignment' }, actor, { db }));
        const oldRevision = { expectedVersionId: loaded.latestVersion.id, expectedDraftUpdatedAt: loaded.latestVersion.updatedAt.toISOString(),
            effectiveFrom: '2198-11-01', reason: 'Synthetic approval' };
        const edited = await profiles.createPayrollProfileVersion(initial.id, { ...oldRevision, defaultRate: 504,
            changeReason: 'Synthetic correction', payRules: { ...daily, daily: { ...daily.daily, fullDayMinutes: 540 } } }, actor, { db });
        assert.equal(edited.profile.status, 'draft');
        assert.equal(edited.version.payRules.daily.fullDayMinutesByWeekday[0].minutes, 600);
        assert.equal(edited.version.payRules.conditionReviews.commission.state, 'unknown');
        await assert.rejects(profiles.activatePayrollProfile(initial.id, oldRevision, actor, { db }), { code: 'PAYROLL_PROFILE_DRAFT_STALE' });
        const activation = { ...oldRevision, expectedDraftUpdatedAt: edited.version.updatedAt.toISOString() };
        const active = await profiles.activatePayrollProfile(initial.id, activation, actor, { db });
        assert.equal(active.status, 'active');
        assert.equal(active.latestVersion.defaultRate, 504);
        assert.equal(active.latestVersion.id, loaded.latestVersion.id);
        await profiles.activatePayrollProfile(initial.id, activation, actor, { db });
        assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_audit_log WHERE staff_id=$1 AND action='payroll_profile_activate'", [id])).rows[0].n, 1);
        const cleared = await profiles.createPayrollProfileVersion(initial.id, { rateUnit: 'day', defaultRate: 504,
            effectiveFrom: '2198-12-01', changeReason: 'Synthetic explicit reset', payRules: { ...daily, daily: { ...daily.daily, fullDayMinutesByWeekday: [] } } }, actor, { db });
        assert.deepEqual(cleared.version.payRules.daily.fullDayMinutesByWeekday, []);
    });

    test('approval applies a single calendar fraction to salary, supplement and three distinct commission bases', async () => {
        const key = 'review_' + process.pid, month = '2198-11';
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic monthly review', 'qa']);
        const staff = await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic reviewed month','qa','Synthetic',$1,30000,'month',true,'2198-11-10') RETURNING id`, [key]);
        const id = Number(staff.rows[0].id);
        const payRules = { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
            { id: 'ads', title: 'Synthetic advertising', kind: 'monthly', amount: 3000, monthly: { mode: 'fixed' } },
            { id: 'orders', title: 'Synthetic own orders', kind: 'percent', percent: 3, basisKey: 'own_orders' },
            { id: 'banquets', title: 'Synthetic own banquets', kind: 'percent', percent: 3, basisKey: 'own_banquets' },
            { id: 'other', title: 'Synthetic other manager banquets', kind: 'percent', percent: 1, basisKey: 'other_manager_banquets' }
        ] };
        const profile = await profiles.createPayrollProfile({ title: 'Synthetic monthly review', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, rateUnit: 'month', defaultRate: 30000, effectiveFrom: month + '-01', payRules }, actor, { db });
        const sales = [['own_orders', 10000], ['own_banquets', 20000], ['other_manager_banquets', 30000]];
        for (const [basisKey] of sales) {
            await rules.saveComponentInput({ businessContext: context, staffId: id, month, basisKey, amount: 0,
                expectedVersion: 0, confirmed: false, reason: 'Synthetic unconfirmed zero' }, actor, { db });
        }
        const withUnconfirmedBases = await buildCanonicalPayrollInstallmentPreview({ month, staffId: id }, db);
        assert.deepEqual([...new Set(withUnconfirmedBases.blockers.filter(issue => issue.code === 'PAYROLL_COMMISSION_BASE_REQUIRED')
            .map(issue => issue.basisKey))].sort(), sales.map(([key]) => key).sort());
        for (const [basisKey, amount] of sales) {
            await rules.saveComponentInput({ businessContext: context, staffId: id, month, basisKey, amount,
                expectedVersion: 1, confirmed: true, reason: 'Confirmed synthetic sales' }, actor, { db });
        }
        const url = `/api/hr/staff/${id}/payroll-rules`;
        const awaiting = await authRequest('GET', url + `?businessContext=park&view=monthly_reviews&month=${month}&professionKey=${key}`);
        assert.equal(awaiting.status, 200, JSON.stringify(awaiting.data));
        const reviews = awaiting.data.data;
        assert.equal(reviews.length, 5);
        assert.ok(reviews.every(review => review.from === month + '-10' && review.to === month + '-30'));
        const before = await buildCanonicalPayrollInstallmentPreview({ month, staffId: id }, db);
        assert.ok(before.blockers.some(issue => issue.code === 'PAYROLL_FIXED_PARTIAL_MONTH_REVIEW_REQUIRED'));
        for (const review of reviews) {
            const response = await authRequest('PUT', url + '/component-input', { businessContext: 'park',
                action: 'approve_monthly_review', month, professionKey: key, fingerprint: review.fingerprint,
                decision: review.decision, reason: 'Approved synthetic calendar allocation' });
            assert.equal(response.status, 200, JSON.stringify(response.data));
        }
        const done = await buildCanonicalPayrollInstallmentPreview({ month, staffId: id }, db);
        assert.deepEqual(done.blockers, []);
        assert.equal(done.monthlyNetAmount, 23940);
        assert.equal(done.advanceAmount, 6840);
        assert.equal(done.finalAmount, 17100);
        await profiles.createPayrollProfileVersion(profile.id, { rateUnit: 'month', defaultRate: 33000,
            effectiveFrom: month + '-16', changeReason: 'Synthetic change invalidates earlier decisions', payRules }, actor, { db });
        const changed = await rules.listMonthlyReviewRequests({ staffId: id, month, businessContext: context }, { db });
        assert.ok(changed.length > 0);
        assert.ok(changed.every(review => !reviews.some(old => old.fingerprint === review.fingerprint)));
    });

    test('database-loaded installment ranges preserve base continuity across independent component versions', async () => {
        const key = 'continuity_' + process.pid;
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic continuity', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic continuity worker','qa','Synthetic',$1,19000,'month',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        const policy = amount => ({ schemaVersion: 1, monthly: { mode: 'fixed' }, note: 'Synthetic note ' + amount,
            components: [{ id: 'ads', title: 'Advertising', kind: 'monthly', amount,
                monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }] });
        const profile = await profiles.createPayrollProfile({ title: 'Synthetic continuity', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, status: 'active', rateUnit: 'month', defaultRate: 19000,
            effectiveFrom: '2198-01-01', payRules: policy(6000) }, actor, { db });
        await profiles.createPayrollProfileVersion(profile.id, { rateUnit: 'month', defaultRate: 19000,
            effectiveFrom: '2198-11-16', changeReason: 'Synthetic independent component change', payRules: policy(8000) }, actor, { db });
        const staff = { id, role_type: key, hire_date: '2198-01-01' };
        for (const [from, to, expected] of [['2198-11-01', '2198-11-15', 12500], ['2198-11-16', '2198-11-30', 13500]]) {
            const loaded = await loadPayrollProfileContext([id], { from, to }, db);
            assert.equal(loaded.from, from);
            assert.equal(loaded.to, to);
            assert.equal(loaded.profilesById.get(profile.id).versions.length, 2);
            const pay = calculateProfessionPay(staff, null, {}, new Map(), loaded);
            assert.equal(pay.baseAmount, 9500);
            assert.equal(pay.totalAmount, expected);
            assert.deepEqual(pay.blockingIssues, []);
        }
        const forecast = await profiles.forecastPayrollProfiles({ month: '2198-11', staffIds: [id], includeActual: true }, { db });
        assert.equal(forecast.rows[0].total_salary, 26000);
        assert.deepEqual(forecast.rows[0].blocking_issues, []);
        const settlement = await buildCanonicalPayrollInstallmentPreview({ month: '2198-11', staffId: id }, db);
        assert.equal(settlement.monthlyNetAmount, 26000);
        assert.equal(settlement.advanceAmount, 12500);
        assert.equal(settlement.finalAmount, 13500);
        assert.equal(settlement.combinedAmount, 26000);
        assert.deepEqual(settlement.blockers, []);
    });

    test('recorded absence needs a separate fixed-pay decision and the approved amount reaches both installments', async () => {
        const key = 'leave_review_' + process.pid, month = '2198-11', leaveDate = month + '-12';
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic leave review', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic leave review worker','qa','Synthetic',$1,30000,'month',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        await profiles.createPayrollProfile({ title: 'Synthetic leave review', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, rateUnit: 'month', defaultRate: 30000, effectiveFrom: '2198-01-01', payRules: fixed }, actor, { db });
        const plan = await buildAttendanceCompensationPlanSnapshot(db, { staffId: id, recordDate: leaveDate, plan: { primaryProfessionKey: key } });
        const snapshot = finalizeAttendanceCompensationSnapshot(plan, { actualMinutes: 0 });
        await db.query(`INSERT INTO hr_time_records(staff_id,record_date,status,business_context,compensation_snapshot)
            VALUES($1,$2::date,'unpaid',$3,$4::jsonb)`,
        [id, leaveDate, context, JSON.stringify({ ...snapshot, leavePolicy: 'unpaid_v1' })]);
        const input = { staffId: id, professionKey: key, businessContext: context, month };
        const awaiting = await rules.listMonthlyReviewRequests(input, { db });
        assert.equal(awaiting.length, 1);
        assert.equal(awaiting[0].kind, 'leave');
        assert.deepEqual(awaiting[0].leaveDates, [leaveDate]);
        const pending = await buildCanonicalPayrollInstallmentPreview({ staffId: id, month }, db);
        assert.ok(pending.blockers.some(issue => issue.code === 'PAYROLL_FIXED_LEAVE_REVIEW_REQUIRED'));
        await rules.approveMonthlyReview({ ...input, fingerprint: awaiting[0].fingerprint,
            decision: 'retain_calendar_amount', reason: 'Synthetic decision to retain the fixed calendar amount' }, actor, { db });
        const result = await buildCanonicalPayrollInstallmentPreview({ staffId: id, month }, db);
        assert.deepEqual(result.blockers, []);
        assert.deepEqual([result.monthlyNetAmount, result.advanceAmount, result.finalAmount], [30000, 15000, 15000]);
    });

    test('forecast uses planned net minutes, merges same-date blocks and loads separate manual commission bases', async () => {
        const key = 'plan_' + process.pid;
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic daily forecast', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic daily forecast','qa','Synthetic',$1,600,'day',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        const planProfile = await profiles.createPayrollProfile({ title: 'Synthetic daily forecast', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, status: 'active', rateUnit: 'day', defaultRate: 600, effectiveFrom: '2198-01-01', payRules: {
                ...daily, daily: { ...daily.daily, fullDayMinutes: 480,
                    fullDayMinutesByWeekday: [1, 2, 3, 4, 5, 6, 7].map(isoWeekday => ({ isoWeekday, minutes: 600 })) },
                components: [{ id: 'ads', title: 'Synthetic advertising', kind: 'monthly', amount: 3500,
                    monthly: { mode: 'fixed', partialMonth: 'calendar_days' } },
                { id: 'own', title: 'Synthetic own', kind: 'percent', percent: 4, basisKey: 'own_bookings' },
                { id: 'other', title: 'Synthetic other', kind: 'percent', percent: 1, basisKey: 'other_bookings' }]
            } }, actor, { db });
        for (const [basisKey, amount] of [['own_bookings', 10000], ['other_bookings', 20000]]) {
            await rules.saveComponentInput({ businessContext: context, staffId: id, month: '2198-11', basisKey, amount,
                expectedVersion: 0, confirmed: true, reason: 'Synthetic forecast confirmed base' }, actor, { db });
        }
        const shift = (await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key)
            VALUES($1,'2198-11-03','10:00','16:00',60,$2) RETURNING id`, [id, key])).rows[0];
        await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end,break_minutes)
            VALUES($1,$2,'10:00','12:00',0),($1,$2,'13:00','16:00',0)`, [shift.id, key]);
        const result = await profiles.forecastPayrollProfiles({ month: '2198-11', staffIds: [id], includeActual: true }, { db });
        assert.equal(result.rows[0].planned_hours, 5);
        assert.equal(result.rows[0].total_salary, 4400);
        assert.deepEqual(result.rows[0].blocking_issues, []);
        assert.equal(result.actual.rows[0].actual_salary, 4100);
        assert.deepEqual(result.actual.rows[0].blocking_issues, []);
        const simulation = await profiles.simulatePayrollProfiles({ profileAId: planProfile.id, staffId: id,
            month: '2198-11', hoursPerDay: 5, exits: 1 }, { db });
        assert.equal(simulation.primary.total, 4400);
        assert.deepEqual(simulation.primary.blockingIssues, []);
        const impact = await profiles.impactPayrollProfilePreview(planProfile.id, { month: '2198-11', rateUnit: 'day',
            defaultRate: 1200, effectiveFrom: '2198-11-01' }, { db });
        assert.equal(impact.currentFund, 4400);
        assert.equal(impact.projectedFund, 4700);
        assert.equal(impact.delta, 300);
        const missing = await profiles.forecastPayrollProfiles({ month: '2198-12', staffIds: [id] }, { db });
        assert.ok(missing.rows[0].blocking_issues.some(issue => issue.code === 'PAYROLL_COMMISSION_BASE_REQUIRED'));
    });

    test('night shift captures the working-day override and excludes the break after midnight', async () => {
        const key = 'night_' + process.pid, workDate = '2198-11-04';
        const weekday = new Date(workDate + 'T00:00:00Z').getUTCDay() || 7;
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [key, 'Synthetic night shift', 'qa']);
        const id = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic night worker','qa','Synthetic',$1,500,'day',true,'2198-01-01') RETURNING id`, [key])).rows[0].id);
        const profile = await profiles.createPayrollProfile({ title: 'Synthetic overnight', professionKey: key, profileKind: 'shared',
            isDefaultForProfession: true, rateUnit: 'day', defaultRate: 500, effectiveFrom: '2198-01-01',
            dayRates: [{ isoWeekday: weekday, rate: 600 }], payRules: { ...daily, daily: { ...daily.daily,
                fullDayMinutes: 480, fullDayMinutesByWeekday: [{ isoWeekday: weekday, minutes: 600 }] } } }, actor, { db });
        const plan = { primaryProfessionKey: key, segments: [
            { id: 1, professionKey: key, shiftStart: '22:00', shiftEnd: '00:00', startDayOffset: 0, endDayOffset: 1 },
            { id: 2, professionKey: key, shiftStart: '00:00', shiftEnd: '04:00', startDayOffset: 1, endDayOffset: 1, breakMinutes: 60 }
        ] };
        const planned = await buildAttendanceCompensationPlanSnapshot(db, { staffId: id, recordDate: workDate, plan });
        assert.equal(planned.state, 'planned');
        assert.deepEqual(planned.compensationAllocations.map(item => item.conditions.dailyNorm),
            Array(2).fill({ minutes: 600, source: 'weekday', isoWeekday: weekday }));
        const physical = allocateAttendanceToSegments({ recordDate: workDate, clockIn: workDate + 'T22:00:00+02:00',
            clockOut: '2198-11-05T04:00:00+02:00', actualMinutes: 300, ...plan });
        const snapshot = finalizeAttendanceCompensationSnapshot(planned, physical);
        assert.equal(snapshot.state, 'final');
        assert.equal(snapshot.totals.physicalMinutes, 300);
        await profiles.createPayrollProfileVersion(profile.id, { rateUnit: 'day', defaultRate: 700, effectiveFrom: '2198-11-05',
            changeReason: 'Synthetic later version' }, actor, { db });
        const pay = calculateConditionSnapshots({ periodFrom: workDate, periodTo: workDate,
            conditionDays: [{ date: workDate, worked: true, snapshot }] }, 1.5);
        assert.deepEqual(pay.blockingIssues, []);
        assert.equal(pay.baseAmount, 300);
        assert.equal(pay.baseLines[0].meta.dailyNorm.minutes, 600);
    });

    test('profile rules round trip through create, clone, append and frozen condition resolution', async () => {
        firstProfile = await profiles.createPayrollProfile({ title: 'Synthetic fixed month', professionKey: profession,
            profileKind: 'shared', isDefaultForProfession: true, status: 'active', rateUnit: 'month', defaultRate: 19000,
            effectiveFrom: '2198-01-01', payRules: fixed }, actor, { db });
        assert.deepEqual(firstProfile.latestVersion.payRules.monthly, fixed.monthly);
        const clone = await profiles.createPayrollProfileClone(firstProfile.id, { ownerStaffId: otherStaffId,
            profileKind: 'personal', effectiveFrom: '2198-01-01', reason: 'Synthetic clone' }, actor, { db });
        assert.deepEqual((clone.profile || clone).latestVersion.payRules.monthly, fixed.monthly);
        const appended = await profiles.createPayrollProfileVersion(firstProfile.id, { rateUnit: 'month', defaultRate: 20000,
            effectiveFrom: '2198-02-01', changeReason: 'Synthetic raise retaining explicit rules' }, actor, { db });
        assert.deepEqual(appended.version.payRules.monthly, fixed.monthly);
        const loaded = await loadPayrollProfileContext([otherStaffId], { from: '2198-02-01', to: '2198-02-28' }, db);
        const pay = calculateProfessionPay({ id: otherStaffId, role_type: profession, hire_date: '2198-01-01' }, null, {}, new Map(), loaded);
        assert.equal(pay.baseAmount, 20000);
        assert.deepEqual(pay.blockingIssues, []);
        const conditions = resolvePayrollConditions(await loadPayrollConditionContext(db, [otherStaffId], { from: '2198-02-03', to: '2198-02-03' }), otherStaffId, profession, '2198-02-03');
        assert.deepEqual(conditions.payRules.monthly, fixed.monthly);
    });

    test('sync explicitly replaces personal weekday norms with the source profile rules', async () => {
        const source = await profiles.createPayrollProfile({ title: 'Synthetic source without weekday overrides', professionKey: profession,
            profileKind: 'shared', rateUnit: 'day', defaultRate: 500, effectiveFrom: '2198-01-01', payRules: daily }, actor, { db });
        const { profile: personal } = await profiles.createPayrollProfileClone(source.id, { ownerStaffId: otherStaffId,
            profileKind: 'personal', effectiveFrom: '2198-01-01', sourceDate: '2198-01-01', reason: 'Synthetic clone' }, actor, { db });
        await profiles.createPayrollProfileVersion(personal.id, { rateUnit: 'day', defaultRate: 500,
            effectiveFrom: '2198-02-01', changeReason: 'Synthetic personal override',
            payRules: { ...daily, daily: { ...daily.daily, fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 660 }] } } }, actor, { db });
        const synced = await profiles.syncPayrollProfileFromBase(personal.id, {
            sourceDate: '2198-02-01', personalDate: '2198-02-01', effectiveFrom: '2198-03-01',
            selectedChanges: ['pay_rules'], apply: true, reason: 'Use source rules exactly'
        }, actor, { db });
        assert.equal(synced.profile.latestVersion.payRules.daily.fullDayMinutesByWeekday, undefined);
        assert.equal(synced.profile.latestVersion.payRules.daily.fullDayMinutes, 600);
    });

    test('company/profession defaults are scoped, dated and never open a foreign legacy staff namespace', async () => {
        const template = rate => ({ schemaVersion: 1, rateUnit: 'month', defaultRate: rate, payRules: fixed });
        for (const [businessContext, rate] of [[context, 19000], ['dar', 25000]]) {
            await rules.saveRuleDefault({ businessContext, professionKey: profession, effectiveFrom: '2198-01-01',
                template: template(rate), reason: 'Synthetic company policy' }, actor, { db });
        }
        assert.equal((await rules.listRuleDefaults({ businessContext: context, asOfDate: '2198-11-01' }, { db }))[0].template.defaultRate, 19000);
        assert.equal((await rules.listRuleDefaults({ businessContext: 'dar', asOfDate: '2198-11-01' }, { db }))[0].template.defaultRate, 25000);
        await assert.rejects(rules.saveRuleDefault({ businessContext: context, professionKey: profession, effectiveFrom: '2198-01-01', template: template(20000), reason: 'Duplicate' }, actor, { db }), error => error.code === 'HR_PAY_DEFAULT_APPEND_ONLY');
        await assert.rejects(rules.saveComponentInput({ businessContext: 'dar', staffId, month: '2198-11', basisKey: 'own_bookings', amount: 0,
            expectedVersion: 0, confirmed: true, reason: 'Wrong scope' }, actor, { db }), error => error.code === 'HR_PAY_STAFF_SCOPE_UNAVAILABLE');
    });

    test('waiter-style levels promote with dated pay assignments and preserve an explicit personal decision', async () => {
        levels = [];
        for (const [index, rate] of [300, 400, 550].entries()) {
            const profile = await profiles.createPayrollProfile({ title: 'Synthetic level ' + index, professionKey: profession,
                profileKind: 'shared', status: 'active', rateUnit: 'day', defaultRate: rate, effectiveFrom: '2198-01-01', payRules: daily }, actor, { db });
            levels.push(await rules.createQualificationLevel({ businessContext: context, professionKey: profession,
                levelKey: 'level_' + index, title: 'Synthetic level ' + index, rank: index, profileId: profile.id }, actor, { db }));
        }
        const payload = (index, date, expectedEventId, payDecision) => ({ businessContext: context, staffId, professionKey: profession,
            levelId: levels[index].id, effectiveFrom: date, expectedEventId, payDecision, reason: 'Synthetic qualification confirmation' });
        event = (await rules.changeQualificationLevel(payload(0, '2198-11-01', 0), actor, { db })).event;
        const promoted = await rules.changeQualificationLevel(payload(1, '2198-11-15', event.id, 'use_level'), actor, { db });
        event = promoted.event;
        const contextA = await loadPayrollConditionContext(db, [staffId], { from: '2198-11-14', to: '2198-11-16' });
        assert.equal(resolvePayrollConditions(contextA, staffId, profession, '2198-11-14').rate, 300);
        assert.equal(resolvePayrollConditions(contextA, staffId, profession, '2198-11-15').rate, 400);
        const kept = await rules.changeQualificationLevel(payload(2, '2198-11-20', event.id, 'keep_personal'), actor, { db });
        assert.equal(kept.event.snapshot.preservedPersonalConditions, true);
        const contextB = await loadPayrollConditionContext(db, [staffId], { from: '2198-11-20', to: '2198-11-20' });
        assert.equal(resolvePayrollConditions(contextB, staffId, profession, '2198-11-20').rate, 400);
        await assert.rejects(rules.changeQualificationLevel(payload(2, '2198-11-21', event.id, 'use_level'), actor, { db }), error => error.code === 'HR_PAY_LEVEL_STALE');
        assert.equal((await rules.qualificationHistory({ businessContext: context, staffId, professionKey: profession }, { db })).length, 3);
    });

    test('vacancy range requires a chosen rate and applying creates a stable personal snapshot', async () => {
        const vacancy = (await db.query(`INSERT INTO job_vacancies(title,role_type,department,business_context)
            VALUES ('Synthetic pay vacancy',$1,'qa',$2) RETURNING id`, [profession, context])).rows[0];
        const input = { businessContext: context, vacancyId: vacancy.id, effectiveFrom: '2199-01-01' };
        const inherited = await rules.vacancyTemplate(input, { db });
        assert.equal(inherited.source.type, 'company_profession_default');
        const vacancyRules = { ...daily, daily: { ...daily.daily, fullDayMinutes: 480,
            fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 600 }] } };
        const saved = await rules.saveVacancyTemplate({ ...input, expectedTemplateHash: inherited.templateHash, reason: 'Synthetic vacancy range',
            template: { schemaVersion: 1, rateUnit: 'day', salaryFrom: 500, salaryTo: 700, payRules: vacancyRules } }, actor, { db });
        await assert.rejects(rules.applyVacancyTemplate({ ...input, staffId: otherStaffId, reason: 'Synthetic apply', expectedTemplateHash: saved.templateHash }, actor, { db }), error => error.code === 'HR_PAY_VACANCY_RATE_SELECTION_REQUIRED');
        const applied = await rules.applyVacancyTemplate({ ...input, staffId: otherStaffId, selectedRate: 600,
            reason: 'Synthetic selected amount', expectedTemplateHash: saved.templateHash, payDecision: 'replace' }, actor, { db });
        assert.equal(applied.profile.latestVersion.defaultRate, 600);
        assert.equal(applied.profile.templateOrigin.type, 'vacancy');
        const edited = await rules.saveVacancyTemplate({ ...input, expectedTemplateHash: saved.templateHash, reason: 'Synthetic later vacancy edit',
            template: { schemaVersion: 1, rateUnit: 'day', defaultRate: 650, payRules: daily } }, actor, { db });
        assert.equal(edited.template.payRules.daily.fullDayMinutesByWeekday[0].minutes, 600);
        const replaced = await rules.saveVacancyTemplate({ ...input, expectedTemplateHash: edited.templateHash, reason: 'Synthetic Sunday norm change',
            template: { ...edited.template, payRules: { ...vacancyRules, daily: { ...vacancyRules.daily,
                fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 660 }] } } } }, actor, { db });
        assert.notEqual(replaced.templateHash, edited.templateHash);
        const unchanged = await profiles.getPayrollProfile(applied.profile.id, { db, asOfDate: '2199-01-01' });
        assert.equal(unchanged.currentVersion.defaultRate, 600);
        assert.equal(unchanged.currentVersion.payRules.daily.fullDayMinutesByWeekday[0].minutes, 600);
        await assert.rejects(rules.vacancyTemplate({ ...input, businessContext: 'dar' }, { db }), error => error.code === 'HR_PAY_VACANCY_UNAVAILABLE');
    });

    test('confirmed zero bases are retained and concurrent edits use one append-only winning version', async () => {
        const base = { businessContext: context, staffId: otherStaffId, month: '2198-11', basisKey: 'own_bookings',
            amount: 0, confirmed: true, expectedVersion: 0, reason: 'Synthetic zero confirmed' };
        assert.equal((await rules.saveComponentInput(base, actor, { db })).amount, 0);
        const results = await Promise.allSettled([10000, 12000].map(value => rules.saveComponentInput({ ...base, amount: value, expectedVersion: 1 }, actor, { db })));
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, 'HR_PAY_COMPONENT_INPUT_STALE');
        const loaded = (await rules.loadComponentInputs({ businessContext: context, staffId: otherStaffId, month: '2198-11' }, { db })).get(otherStaffId);
        assert.equal(loaded.own_bookings.version, 2);
        const count = (await db.query('SELECT COUNT(*)::int AS count FROM hr_payroll_component_inputs WHERE staff_id=$1', [otherStaffId])).rows[0].count;
        assert.equal(count, 2);
        await db.query("INSERT INTO payroll_period_locks(period_month,is_locked) VALUES ('2198-11',true) ON CONFLICT(period_month) DO UPDATE SET is_locked=true");
        await assert.rejects(rules.saveComponentInput({ ...base, expectedVersion: 2 }, actor, { db }), error => error.statusCode === 423);
    });

    test('frozen attendance blocks retrospective qualification changes and migration rerun preserves all rows', async () => {
        await db.query(`INSERT INTO hr_time_records(staff_id,record_date,status,business_context,compensation_snapshot)
            VALUES ($1,'2199-02-02','present',$2,'{"schemaVersion":2}'::jsonb)`, [frozenStaffId, context]);
        await assert.rejects(rules.changeQualificationLevel({ businessContext: context, staffId: frozenStaffId, professionKey: profession,
            levelId: levels[0].id, effectiveFrom: '2199-02-01', expectedEventId: 0, reason: 'Synthetic frozen history' }, actor, { db }), error => error.code === 'HR_PAY_ATTENDANCE_FROZEN');
        const before = await db.query('SELECT COUNT(*)::int AS count FROM hr_staff_qualification_events');
        await db.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/423_configurable_pay_rules.sql'), 'utf8'));
        const after = await db.query('SELECT COUNT(*)::int AS count FROM hr_staff_qualification_events');
        assert.equal(after.rows[0].count, before.rows[0].count);
        assert.ok(after.rows[0].count >= 3);
        // Rehearse the release postcheck before the isolated runner clears its
        // schema; the receipt must recognize configured data without altering it.
        const inspection = await db.query(fs.readFileSync(path.join(__dirname, '../../docs/PAY_RULES_RELEASE_POSTCHECKS.sql'), 'utf8'));
        const selected = inspection.filter(result => result.command === 'SELECT');
        assert.equal(selected[0].rows[0].version, '423_configurable_pay_rules');
        assert.equal(selected[1].rows.length, 3);
        assert.equal(selected[2].rows.length, 7);
        assert.equal(Number(selected[2].rows.find(row => row.entity === 'qualification_events').configured_count), before.rows[0].count);
        assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM hr_staff_qualification_events')).rows[0].count, before.rows[0].count);
    });

    test('authenticated routes expose rule settings and atomically apply a reviewed vacancy snapshot during hire', async () => {
        const vacancy = (await db.query(`INSERT INTO job_vacancies(title,role_type,department,business_context,compensation_template)
            VALUES ('Synthetic HTTP vacancy',$1,'qa',$2,$3::jsonb) RETURNING id`, [profession, context,
            JSON.stringify({ schemaVersion: 1, rateUnit: 'month', defaultRate: 30000, payRules: fixed })])).rows[0];
        const application = (await db.query(`INSERT INTO job_applications(vacancy_id,name,status)
            VALUES ($1,'Synthetic hired worker','offer') RETURNING id`, [vacancy.id])).rows[0];
        const preview = await authRequest('GET', `/api/hr/vacancies/${vacancy.id}/payroll-template?businessContext=park&effectiveFrom=2200-01-01`);
        assert.equal(preview.status, 200, preview.data?.error);
        assert.equal(preview.data.data.template.defaultRate, 30000);
        const payload = { hire_mode: 'new_staff', vacancy_action: 'keep_open', start_profession_onboarding: false,
            businessContext: 'park', compensation: { apply: true, expectedTemplateHash: preview.data.data.templateHash,
                effectiveFrom: '2200-01-01', selectedRate: 30000, reason: 'Reviewed synthetic hiring terms', payDecision: 'replace' } };
        const hired = await authRequest('POST', `/api/hr/applications/${application.id}/hire`, payload);
        assert.equal(hired.status, 200, hired.data?.error);
        assert.equal(hired.data.compensation_applied, true);
        const hiredId = Number(hired.data.staff_id);
        const workspace = await authRequest('GET', `/api/hr/staff/${hiredId}/payroll-rules?businessContext=park&asOfDate=2200-01-01`);
        assert.equal(workspace.status, 200, workspace.data?.error);
        assert.equal(workspace.data.data.assignments.length, 1);
        const ownBase = await authRequest('PUT', `/api/hr/staff/${hiredId}/payroll-rules/component-input`, {
            businessContext: 'park', month: '2200-01', basisKey: 'own_bookings', amount: 0, confirmed: true,
            expectedVersion: 0, reason: 'Confirmed synthetic zero base'
        });
        assert.equal(ownBase.status, 200, ownBase.data?.error);
        assert.equal(ownBase.data.data.amount, 0);
        const unauthenticated = await request('GET', '/api/hr/payroll-rules/defaults?businessContext=park&asOfDate=2200-01-01');
        assert.equal(unauthenticated.status, 401);
        const foreign = await authRequest('GET', `/api/hr/staff/${hiredId}/payroll-rules?businessContext=dar&asOfDate=2200-01-01`);
        assert.ok([403, 409].includes(foreign.status));
        const stale = (await db.query(`INSERT INTO job_applications(vacancy_id,name,status)
            VALUES ($1,'Synthetic stale hire','offer') RETURNING id`, [vacancy.id])).rows[0];
        const failed = await authRequest('POST', `/api/hr/applications/${stale.id}/hire`, { ...payload,
            compensation: { ...payload.compensation, expectedTemplateHash: 'outdated_preview' } });
        assert.equal(failed.status, 409);
        const afterFailure = (await db.query('SELECT staff_id,status FROM job_applications WHERE id=$1', [stale.id])).rows[0];
        assert.equal(afterFailure.staff_id, null);
        assert.equal(afterFailure.status, 'offer');
        assert.equal((await db.query("SELECT count(*)::int AS count FROM staff WHERE name='Synthetic stale hire'")).rows[0].count, 0);
    });
});
