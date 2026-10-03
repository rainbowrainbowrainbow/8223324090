'use strict';
const { before, after, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadPayrollConditionContext, resolvePayrollConditions, savePayrollDayException } = require('../../services/hrPayrollConditions');
const { recordAttendanceClockIn, recordAttendanceClockOut } = require('../../services/hrAttendance');
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
        const context = await loadPayrollConditionContext(db, [staffId], { from: '2198-10-02', to: '2198-10-04' });
        assert.equal(resolvePayrollConditions(context, staffId, profession, '2198-10-02').rate, 100);
        assert.equal(resolvePayrollConditions(context, staffId, profession, '2198-10-04').rate, 100);
        assert.ok([130,140].includes(resolvePayrollConditions(context, staffId, profession, date).rate));
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
        const repeat=await recordAttendanceClockOut(db,{staffId,recordDate:date,now:date+'T16:00:00Z',performedBy:actor.username});
        assert.deepEqual(repeat.record.compensation_snapshot,snapshot);
    });
});
