'use strict';
const { before, after, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadPayrollConditionContext, resolvePayrollConditions, getPayrollDayConditions, savePayrollDayException } = require('../../services/hrPayrollConditions');
const { recordAttendanceClockIn, recordAttendanceClockOut, buildAttendanceCompensationPlanSnapshot } = require('../../services/hrAttendance');
const { lockAttendanceWriteTarget } = require('../../services/attendanceWriteLock');
const { calculateConditionSnapshots } = require('../../services/payrollConditionCalculation');
const enabled = process.env.RUN_PAYROLL_PROFILES_INTEGRATION === 'true';
describe('HR PAY dated conditions on disposable PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let db, staffId, profession, extraProfession, profileId;
    const date = '2198-10-03';
    const actor = { username: 'isolated_hr_pay' };
    before(async () => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
        db = new Pool({ connectionString: target.url.toString(), ssl: target.isLocal ? false : { rejectUnauthorized: false }, max: 5 });
        const suffix = `${process.pid}_${Date.now()}`;
        profession = `pay_base_${suffix}`.slice(0, 30); extraProfession = `pay_extra_${suffix}`.slice(0, 30);
        await db.query(`INSERT INTO hr_professions (key,title,department) VALUES ($1,'Synthetic base','QA'),($2,'Synthetic extra','QA')`, [profession, extraProfession]);
        staffId = Number((await db.query(`INSERT INTO staff (name,department,position,role_type,hourly_rate,rate_unit,is_active)
            VALUES ('Synthetic HR PAY','qa','Synthetic',$1,100,'hour',true) RETURNING id`, [profession])).rows[0].id);
        await db.query(`INSERT INTO staff_role_assignments (staff_id,profession_key,is_primary,status,admission_status,internship_status,created_by,updated_by)
            VALUES ($1,$2,true,'active','approved','none','isolated_hr_pay','isolated_hr_pay'),
            ($1,$3,false,'active','approved','none','isolated_hr_pay','isolated_hr_pay')`, [staffId, profession, extraProfession]);
        profileId = Number((await db.query(`INSERT INTO payroll_profiles (title,profession_key,profile_kind,is_default_for_profession,status,created_by)
            VALUES ('Synthetic daily extra',$1,'shared',true,'active','isolated_hr_pay') RETURNING id`, [extraProfession])).rows[0].id);
        await db.query(`INSERT INTO payroll_profile_versions (profile_id,version_number,rate_unit,default_rate,effective_from,created_by)
            VALUES ($1,1,'day',500,'2198-01-01','isolated_hr_pay')`, [profileId]);
    });
    // The runner owns and drops the entire disposable schema; append-only journals are never deleted individually.
    after(async () => { await db?.end(); });
    const payload = (overrides = {}) => ({ staffId, professionKey: profession, workDate: date,
        purpose: 'base_replacement', expectedVersion: 0, rate: 120, rateUnit: 'hour',
        reason: 'Synthetic one-day coverage', idempotencyKey: 'conditions-first', ...overrides });

    test('append-only journal rejects invalid active rows and unsafe mutation', async () => {
        await assert.rejects(db.query(`INSERT INTO payroll_day_exceptions
            (staff_id,profession_key,work_date,purpose,version,state,reason,created_by,idempotency_key,request_hash)
            VALUES ($1,$2,$3,'base_replacement',1,'active','Synthetic','isolated_hr_pay','null-rate-key',repeat('a',64))`,
        [staffId, profession, date]), error => error.code === '23514');
        const saved = await savePayrollDayException(db, payload(), actor);
        assert.equal(saved.version, 1);
        await assert.rejects(db.query('UPDATE payroll_day_exceptions SET rate=900 WHERE id=$1', [saved.id]), error => error.code === '23514');
        await assert.rejects(db.query('DELETE FROM payroll_day_exceptions WHERE id=$1', [saved.id]), error => error.code === '23514');
    });
    test('repeated request replays, changed body conflicts and concurrent editors cannot overwrite', async () => {
        assert.equal((await savePayrollDayException(db, payload(), actor)).replayed, true);
        await assert.rejects(savePayrollDayException(db, payload({ rate: 999 }), actor), error => error.code === 'PAYROLL_DAY_EXCEPTION_IDEMPOTENCY_CONFLICT');
        const results = await Promise.allSettled([
            savePayrollDayException(db, payload({ expectedVersion: 1, rate: 130, idempotencyKey: 'editor-one' }), actor),
            savePayrollDayException(db, payload({ expectedVersion: 1, rate: 140, idempotencyKey: 'editor-two' }), actor)
        ]);
        assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
        assert.equal(results.find(row => row.status === 'rejected').reason.code, 'PAYROLL_DAY_EXCEPTION_VERSION_CONFLICT');
        const read = await getPayrollDayConditions(db, staffId, profession, date);
        assert.equal(read.available, true); assert.equal(read.frozen, false); assert.equal(read.exceptionVersion, 2);
        const choices = await getPayrollDayConditions(db, staffId, extraProfession, date, 'additional');
        assert.equal(choices.choices[0].rate, 500); assert.equal(choices.choices[0].rateUnit, 'day');
        const context = await loadPayrollConditionContext(db, [staffId], { from: '2198-10-02', to: '2198-10-04' });
        assert.equal(resolvePayrollConditions(context, staffId, profession, '2198-10-02').rate, 100);
        assert.equal(resolvePayrollConditions(context, staffId, profession, '2198-10-04').rate, 100);
        assert.ok([130,140].includes(resolvePayrollConditions(context, staffId, profession, date).rate));
    });
    test('selected profile is verified server-side, freezes its source and rejects stale amount', async () => {
        const read = await getPayrollDayConditions(db,staffId,extraProfession,'2198-10-09','additional');
        const choice = read.choices[0];
        const request = payload({professionKey:extraProfession,workDate:'2198-10-09',purpose:'additional',rate:500,rateUnit:'day',
            selectedProfileId:choice.profileId,selectedProfileVersionId:choice.profileVersionId,idempotencyKey:'selected-profile-day',expectedPlanUpdatedAt:null});
        await assert.rejects(savePayrollDayException(db,{...request,expectedPlanUpdatedAt:'stale-plan'},actor),error=>error.code==='HR_SHIFT_PLAN_STALE');
        await assert.rejects(savePayrollDayException(db,{...request,rate:1},actor),error=>error.code==='PAYROLL_DAY_PROFILE_STALE');
        const saved=await savePayrollDayException(db,request,actor);
        assert.equal(saved.selectedProfile.profileVersionId,choice.profileVersionId);
        assert.equal(saved.selectedProfile.title,choice.title);
        assert.equal((await savePayrollDayException(db,request,actor)).replayed,true);
        const applied=await getPayrollDayConditions(db,staffId,extraProfession,'2198-10-09','additional');
        assert.equal(applied.conditions.profileVersionId,choice.profileVersionId);
        assert.equal(applied.conditions.effectiveFrom,'2198-10-09');
        assert.equal(applied.conditions.effectiveTo,'2198-10-09');
    });
    test('temporary assignment overlaps permanent terms but two permanent assignments are rejected', async () => {
        await db.query(`INSERT INTO staff_payroll_profile_assignments (staff_id,profession_key,profile_id,assignment_kind,effective_from,created_by,updated_by)
            VALUES ($1,$2,$3,'explicit','2198-01-01','isolated_hr_pay','isolated_hr_pay')`, [staffId, extraProfession, profileId]);
        await db.query(`INSERT INTO staff_payroll_profile_assignments (staff_id,profession_key,profile_id,assignment_kind,effective_from,effective_to,created_by,updated_by)
            VALUES ($1,$2,$3,'temporary',$4,$4,'isolated_hr_pay','isolated_hr_pay')`, [staffId, extraProfession, profileId, date]);
        await assert.rejects(db.query(`INSERT INTO staff_payroll_profile_assignments (staff_id,profession_key,profile_id,assignment_kind,effective_from,created_by,updated_by)
            VALUES ($1,$2,$3,'explicit','2198-05-01','isolated_hr_pay','isolated_hr_pay')`, [staffId, extraProfession, profileId]), error => ['23514','23P01'].includes(error.code));
    });
    test('clock-in freezes both components, later catalog edits and repeat clock-out preserve pay', async () => {
        await db.query(`UPDATE hr_compensation_policies SET status='active', effective_from='2198-01-01' WHERE policy_version='simultaneous-profession-pay-v1'`);
        const shiftId = (await db.query(`INSERT INTO hr_shifts (staff_id,shift_date,planned_start,planned_end,break_minutes,shift_type,profession_key,created_by)
            VALUES ($1,$2,'10:00','18:00',30,'regular',$3,'isolated_hr_pay') RETURNING id`, [staffId,date,profession])).rows[0].id;
        const segments = (await db.query(`INSERT INTO hr_shift_segments (hr_shift_id,profession_key,planned_start,planned_end,break_minutes,sort_order,created_by,updated_by)
            VALUES ($1,$2,'10:00','14:00',30,0,'isolated_hr_pay','isolated_hr_pay'),($1,$2,'14:00','18:00',0,1,'isolated_hr_pay','isolated_hr_pay') RETURNING id`, [shiftId,profession])).rows;
        for (const segment of segments) await db.query(`INSERT INTO hr_shift_segment_roles (segment_id,profession_key,compensation_mode,pay_multiplier,policy_version)
            VALUES ($1,$2,'paid_hourly',1,'simultaneous-profession-pay-v1')`, [segment.id,extraProfession]);
        const client = await db.connect();
        let capturedRate;
        try {
            await client.query('BEGIN'); await lockAttendanceWriteTarget(client,{staffId,date});
            const result = await recordAttendanceClockIn(client, {staffId,recordDate:date,now:date+'T07:00:00Z',performedBy:actor.username});
            assert.equal(result.record.compensation_snapshot.state,'planned');
            capturedRate = result.record.compensation_snapshot.compensationAllocations[0].rate;
            await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
        await assert.rejects(savePayrollDayException(db,payload({expectedVersion:2,rate:170,idempotencyKey:'after-clock-in'}),actor), error=>error.code==='PAYROLL_DAY_EXCEPTION_FROZEN');
        await db.query('UPDATE staff SET hourly_rate=999 WHERE id=$1',[staffId]);
        await db.query('UPDATE payroll_profile_versions SET default_rate=900 WHERE profile_id=$1',[profileId]);
        const closed = await recordAttendanceClockOut(db,{staffId,recordDate:date,now:date+'T15:00:00Z',settlementMode:'actual_time',performedBy:actor.username});
        const snapshot = closed.record.compensation_snapshot;
        assert.equal(snapshot.totals.physicalMinutes,450);
        assert.equal(snapshot.totals.baseMinutes,450);
        assert.equal(snapshot.totals.simultaneousAdditionalMinutes,450);
        const result=calculateConditionSnapshots({conditionDays:[{date,worked:true,paidPlannedFactor:1,snapshot}]},1.5);
        assert.deepEqual(result.blockingIssues,[]);
        assert.equal(result.baseAmount,Math.round(capturedRate*7.5));
        assert.equal(result.additionalAmount,500);
        assert.equal(result.additionalLines.length,1);
        const read = await getPayrollDayConditions(db,staffId,extraProfession,date,'additional');
        assert.equal(read.frozen,true); assert.equal(read.conditions.rate,500);
        assert.equal(read.choices[0].rate,900); // Current catalog is separate from the immutable applied conditions.
        const repeat=await recordAttendanceClockOut(db,{staffId,recordDate:date,now:date+'T16:00:00Z',performedBy:actor.username});
        assert.deepEqual(repeat.record.compensation_snapshot,snapshot);
    });
    test('voiding a day exception restores inheritance only on its own date', async () => {
        const future = payload({workDate:'2198-10-04',idempotencyKey:'future-exception'});
        await savePayrollDayException(db,future,actor);
        await savePayrollDayException(db,{...future,state:'voided',expectedVersion:1,idempotencyKey:'future-exception-void'},actor);
        const read = await getPayrollDayConditions(db,staffId,profession,'2198-10-04');
        assert.equal(read.exceptionVersion,2); assert.equal(read.conditions.rate,999);
        assert.equal(read.conditions.exception,null);
        assert.equal((await getPayrollDayConditions(db,staffId,profession,date)).frozen,true);
    });
    test('a permanent monthly role is not also added to a block where it is already the base profession', async () => {
        await db.query("UPDATE payroll_profile_versions SET rate_unit='month',default_rate=6000 WHERE profile_id=$1",[profileId]);
        const snapshot = await buildAttendanceCompensationPlanSnapshot(db,{staffId,recordDate:'2198-10-04',
            plan:{professionKey:extraProfession,plannedStart:'10:00',plannedEnd:'18:00',
                segments:[{id:1,professionKey:extraProfession,shiftStart:'10:00',shiftEnd:'18:00',breakMinutes:0,additionalRoles:[]}]}});
        assert.equal(snapshot.plan.segments.length,1);
        assert.equal(snapshot.plan.segments[0].professionKey,extraProfession);
        assert.equal(snapshot.compensationAllocations.length,1);
        assert.equal(snapshot.compensationAllocations[0].allocationType,'base');
        assert.equal(snapshot.compensationAllocations[0].conditions.rateUnit,'month');
    });
    test('monthly base accepts a separate day top-up, while day replacement of that base is rejected', async () => {
        await db.query("UPDATE staff SET rate_unit='month',hourly_rate=30000 WHERE id=$1",[staffId]);
        const future = payload({workDate:'2198-10-05',rate:250,rateUnit:'day',idempotencyKey:'monthly-topup'});
        await assert.rejects(savePayrollDayException(db,future,actor),error=>error.code==='PAYROLL_DAY_EXCEPTION_UNIT_CONFLICT');
        await savePayrollDayException(db,{...future,purpose:'additional'},actor);
        const base = await getPayrollDayConditions(db,staffId,profession,'2198-10-05');
        const extra = await getPayrollDayConditions(db,staffId,profession,'2198-10-05','additional');
        assert.equal(base.conditions.rate,30000); assert.equal(base.conditions.rateUnit,'month');
        assert.equal(extra.conditions.rate,250); assert.equal(extra.conditions.rateUnit,'day');
        assert.equal((await getPayrollDayConditions(db,staffId,profession,'2198-10-06','additional')).conditions.rate,0);
    });
    test('admission blocker does not erase an existing daily or monthly profile rate', async () => {
        await db.query("UPDATE staff_role_assignments SET admission_status='pending' WHERE staff_id=$1 AND profession_key=$2",[staffId,extraProfession]);
        try {
            const read=await getPayrollDayConditions(db,staffId,extraProfession,'2198-10-06','additional');
            assert.equal(read.available,false);assert.equal(read.blocker.code,'admission_required');
            assert.equal(read.conditions.rate,6000);assert.equal(read.conditions.rateUnit,'month');
        } finally {
            await db.query("UPDATE staff_role_assignments SET admission_status='approved' WHERE staff_id=$1 AND profession_key=$2",[staffId,extraProfession]);
        }
    });
    test('monthly base and permanent additional salary are grouped once across two real attendance dates', async () => {
        await db.query(`INSERT INTO payroll_schemes(staff_id,scheme_type,title,is_active,config_json,effective_from,effective_to,created_by,updated_by)
            VALUES($1,'monthly_fixed','Synthetic month',true,$2::jsonb,'2198-11-01','2198-11-30','isolated_hr_pay','isolated_hr_pay')`,
        [staffId,JSON.stringify({monthlyAmount:30000,monthlyNormMinutes:900,monthlyNormMonth:'2198-11',monthlyNormConfirmed:true,monthlyNormSource:'synthetic_approved_norm'})]);
        for(const workDate of ['2198-11-01','2198-11-02']){
            const id=(await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,shift_type,profession_key,created_by)
                VALUES($1,$2,'10:00','18:00',30,'regular',$3,'isolated_hr_pay') RETURNING id`,[staffId,workDate,profession])).rows[0].id;
            await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end,break_minutes,sort_order,created_by,updated_by)
                VALUES($1,$2,'10:00','14:00',30,0,'isolated_hr_pay','isolated_hr_pay'),($1,$2,'14:00','18:00',0,1,'isolated_hr_pay','isolated_hr_pay')`,[id,profession]);
            await recordAttendanceClockIn(db,{staffId,recordDate:workDate,now:workDate+'T08:00:00Z',performedBy:actor.username});
            await recordAttendanceClockOut(db,{staffId,recordDate:workDate,now:workDate+'T16:00:00Z',settlementMode:'actual_time',performedBy:actor.username});
        }
        const metrics=(await require('../../services/payroll').loadPayrollAttendanceMetrics({staffIds:[staffId],from:'2198-11-01',to:'2198-11-30'},db)).get(staffId);
        const result=calculateConditionSnapshots(metrics,1.5);
        assert.deepEqual(result.blockingIssues,[]);
        assert.equal(result.baseAmount,30000);assert.equal(result.additionalAmount,6000);
        assert.equal(result.baseLines.length,1);assert.equal(result.additionalLines.length,1);
        assert.equal(result.baseLines[0].quantity,1);assert.equal(result.additionalLines[0].quantity,1);
        assert.equal(metrics.physicalMinutes,900);
    });
    test('readiness audit reads real PostgreSQL in READ ONLY and uses the same effective profile', async () => {
        const {readDatabaseInputs}=require('../../scripts/audit-hr-pay-readiness');
        const {buildHrPayReadiness}=require('../../services/hrPayReadiness');
        const client=await db.connect();
        try {
            const inputs=await readDatabaseInputs(client,'2198-11-01');
            assert.equal(inputs.exceptionsAvailable,true);assert.deepEqual(inputs.sourceErrors,[]);
            const report=buildHrPayReadiness(inputs);
            const extra=report.rows.find(row=>row.staffId===staffId&&row.professionKey===extraProfession);
            assert.equal(extra.effectiveUnit,'month');assert.deepEqual(extra.findings,[]);
            assert.doesNotMatch(JSON.stringify(report),/Synthetic HR PAY|Synthetic daily extra|"rate":|"default_rate":/);
            assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'off');
        } finally {client.release();}
    });
    test('an inactive legacy scheme cannot override the base wage or supply a monthly norm', async () => {
        await db.query(`INSERT INTO payroll_schemes(staff_id,scheme_type,title,is_active,config_json,effective_from,created_by,updated_by)
            VALUES($1,'per_shift','Disabled synthetic scheme',false,'{"perShiftRate":9000}'::jsonb,'2198-12-01','isolated_hr_pay','isolated_hr_pay')`,[staffId]);
        const read=await getPayrollDayConditions(db,staffId,profession,'2198-12-01');
        assert.equal(read.conditions.rateUnit,'month');assert.equal(read.conditions.rate,30000);
        assert.equal(read.conditions.monthlyNorm.monthlyNormConfirmed,false);
    });
    test('absence creates no hourly or daily payout and no physical hours', async () => {
        await db.query("UPDATE staff SET rate_unit='day',hourly_rate=700 WHERE id=$1",[staffId]);
        const workDate='2198-12-02';
        await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,shift_type,profession_key,created_by)
            VALUES($1,$2,'10:00','18:00',30,'regular',$3,'isolated_hr_pay')`,[staffId,workDate,profession]);
        const result=await require('../../services/hrAttendance').recordAttendanceStatus(db,{staffId,recordDate:workDate,status:'no_show',
            now:workDate+'T16:00:00Z',source:'isolated_no_show',performedBy:actor.username});
        assert.equal(result.compensationSnapshot.totals.physicalMinutes,0);
        const metrics=(await require('../../services/payroll').loadPayrollAttendanceMetrics({staffIds:[staffId],from:workDate,to:workDate},db)).get(staffId);
        const pay=calculateConditionSnapshots(metrics,1.5);
        assert.equal(pay.baseAmount,0);assert.equal(pay.additionalAmount,0);assert.equal(metrics.physicalMinutes,0);
        assert.equal(pay.baseLines.length,0);
        assert.ok(pay.blockingIssues.some(issue=>issue.code==='PAYROLL_LEAVE_POLICY_UNDEFINED')); // No invented absence formula.
    });
    test('a reviewed payroll snapshot rejects new dated overrides and remains unchanged', async () => {
        const inserted=(await db.query(`INSERT INTO payroll_reports(period_month,staff_id,gross_amount,net_amount,status,breakdown_json,created_by,updated_by)
            VALUES('2198-12',$1,700,700,'approved','{"schemaVersion":2,"syntheticClosed":true}'::jsonb,'isolated_hr_pay','isolated_hr_pay') RETURNING *`,[staffId])).rows[0];
        await assert.rejects(savePayrollDayException(db,payload({workDate:'2198-12-03',rate:800,rateUnit:'day',idempotencyKey:'closed-month-attempt'}),actor),
            error=>error.code==='PAYROLL_DAY_EXCEPTION_HISTORY_LOCKED');
        const after=(await db.query('SELECT * FROM payroll_reports WHERE id=$1',[inserted.id])).rows[0];
        assert.deepEqual(after,inserted);
        assert.equal((await db.query("SELECT id FROM payroll_day_exceptions WHERE staff_id=$1 AND work_date='2198-12-03'",[staffId])).rows.length,0);
    });
});
