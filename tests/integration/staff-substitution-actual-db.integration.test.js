'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { createSubstitutionService } = require('../../services/staffSubstitutions');
const enabled = process.env.RUN_SUBSTITUTION_ACTUAL_DB === 'true';
const { authRequest } = require('../helpers');

test('default services use the migrated schema for an unrelated permanent occupation', { skip: !enabled }, async () => {
    assert.equal(assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL).isLocal,true);
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
    const db = new Pool({ connectionString:process.env.TEST_DATABASE_URL, ssl:false });
    try {
        const staff = (await db.query(`INSERT INTO staff(name,role_type,department,position,is_active,hourly_rate,rate_unit,hr_pool_status,is_freelance)
            VALUES($1,'manager','admin','Synthetic manager',true,100,'hour','core',false) RETURNING id`, [`Substitution QA ${randomUUID()}`])).rows[0];
        const actor = { id:1, username:'substitution_qa_operator', role:'creator' };
        const service = createSubstitutionService({pool:db});
        const catalog = await authRequest('GET','/api/staff-substitutions/catalog');
        assert.equal(catalog.status,200,JSON.stringify(catalog.data));
        const input = { sourceType:'standalone',sourceId:randomUUID(),staffId:staff.id,workDate:'2099-01-13',professionKey:'reception',
            payUnit:'fixed',payMode:'additional',rateMode:'individual',rate:'750.37',rateReason:'Synthetic one-off rate',
            workload:'Synthetic reception cover',reason:'Synthetic isolated QA',temporaryAdmission:true,admissionReason:'Synthetic skill assessment' };
        const quote = await service.preview('event_genix',actor,input);
        assert.deepEqual(quote.blockers,[]);
        assert.equal(quote.estimateMinor,75037);
        const row = await service.mutate('event_genix',actor,'create',{input,previewFingerprint:quote.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
        assert.equal(row.state,'active');
        const completed = await service.mutate('event_genix',actor,'complete',{expectedVersion:1,reason:'Synthetic approved work',workConfirmed:true,
            workEvidence:'Synthetic completed scope',requestKey:randomUUID()},row.id);
        assert.equal(completed.completion.amountMinor,75037);
        assert.equal((await db.query('SELECT role_type FROM staff WHERE id=$1',[staff.id])).rows[0].role_type,'manager');
        assert.equal((await db.query('SELECT id FROM staff_role_assignments WHERE staff_id=$1',[staff.id])).rows.length,0);
        assert.equal((await service.history('event_genix',row.id)).events.length,2);
        const payroll = require('../../services/staffSubstitutionPayroll');
        const map = await payroll.loadPayrollSubstitutions(db,[staff.id],'2099-01-01','2099-01-31');
        assert.equal(payroll.applyPayrollSubstitutions({},map.get(staff.id)).substitutionLines[0].amount,750.37);
        const report=await require('../../services/payroll').getPayrollPreview(staff.id,'2099-01',db);
        assert.equal(report.lines.find(line=>line.lineType==='staff_substitution').amount,750.37);
        assert.equal(report.additionalAmount,750.37);
        const original=(await db.query(`INSERT INTO staff(name,role_type,department,position,is_active,hourly_rate,rate_unit,hr_pool_status,is_freelance)
            VALUES($1,'reception','admin','Synthetic receptionist',true,150,'hour','core',false) RETURNING id`,[`Original QA ${randomUUID()}`])).rows[0];
        const shift=(await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key)
            VALUES($1,'2099-01-14','09:00','13:00',0,'reception') RETURNING id`,[original.id])).rows[0];
        const hrInput={...input,sourceType:'hr_shift',sourceId:String(shift.id),originalStaffId:original.id,workDate:'2099-01-14',
            startsAt:'2099-01-14T09:00:00+02:00',endsAt:'2099-01-14T13:00:00+02:00',payMode:'replace_base',originalTreatment:'retain'};
        const retainedWhole = await service.preview('event_genix', actor, hrInput);
        assert.deepEqual(retainedWhole.blockers, []);
        assert.equal(retainedWhole.payImpact.original.amountMinor, 60000);
        hrInput.originalTreatment='transfer_unworked_scope';
        const hrQuote=await service.preview('event_genix',actor,hrInput);
        assert.deepEqual(hrQuote.blockers,[]);
        const assigned=await service.mutate('event_genix',actor,'create',{input:hrInput,previewFingerprint:hrQuote.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
        assert.equal((await db.query('SELECT staff_id FROM hr_shifts WHERE id=$1',[shift.id])).rows[0].staff_id,staff.id);
        await assert.rejects(db.query("UPDATE hr_shifts SET planned_end='14:00' WHERE id=$1",[shift.id]),{code:'23514'});
        const revisedInput = { ...assigned.input, rate: '800.25', rateReason: 'Synthetic revised rate' };
        const revisedQuote = await service.preview('event_genix', actor, revisedInput, assigned.id);
        assert.deepEqual(revisedQuote.blockers, []);
        const revised = await service.mutate('event_genix', actor, 'revise', { input: revisedInput,
            previewFingerprint: revisedQuote.fingerprint, effectsAcknowledged: true, expectedVersion: 1,
            requestKey: randomUUID() }, assigned.id);
        assert.equal(revised.quote.estimateMinor, 80025);
        assert.equal(revised.input.startsAt, assigned.input.startsAt);
        const { events } = await service.history('event_genix', assigned.id);
        assert.equal(events[1].before_json.quote.estimateMinor, 75037);
        assert.equal(events[1].after_json.quote.estimateMinor, 80025);
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:2,reason:'Synthetic restore',requestKey:randomUUID()},assigned.id);
        assert.equal((await db.query('SELECT staff_id FROM hr_shifts WHERE id=$1',[shift.id])).rows[0].staff_id,original.id);
        assert.equal((await db.query('SELECT staff_id FROM staff_schedule WHERE staff_id=$1 AND date=$2',[original.id,'2099-01-14'])).rows.length,1);
        const fromShift = (await db.query(`INSERT INTO hr_shifts (staff_id,shift_date,planned_start,planned_end,profession_key)
            VALUES($1,'2099-01-18','09:00','14:00','reception') RETURNING id`, [original.id])).rows[0];
        const intoShift = (await db.query(`INSERT INTO hr_shifts (staff_id,shift_date,planned_start,planned_end,profession_key)
            VALUES($1,'2099-01-18','13:00','17:00','manager') RETURNING id`, [staff.id])).rows[0];
        const existingSegment = (await db.query(`INSERT INTO hr_shift_segments (hr_shift_id,profession_key,planned_start,planned_end)
            VALUES($1,'manager','13:00','17:00') RETURNING id`, [intoShift.id])).rows[0];
        const loadPlan = async shift => (await require('../../services/hrShiftSegments')
            .loadHrShiftDayPlan(db, { hrShiftId: shift.id })).plan.segments
            .map(({ shiftStart, shiftEnd, professionKey }) => [shiftStart, shiftEnd, professionKey]);
        const partialInput = { ...hrInput, sourceId: String(fromShift.id), slotKey: 'partial', workDate: '2099-01-18',
            startsAt: '2099-01-18T10:00:00+02:00', endsAt: '2099-01-18T12:00:00+02:00' };
        const partialQuote = await service.preview('event_genix', actor, partialInput);
        assert.deepEqual(partialQuote.blockers, []);
        const partial = await service.mutate('event_genix', actor, 'create', { input: partialInput,
            previewFingerprint: partialQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        assert.deepEqual(await loadPlan(fromShift), [['09:00', '10:00', 'reception'], ['12:00', '14:00', 'reception']]);
        assert.deepEqual(await loadPlan(intoShift), [['10:00', '12:00', 'reception'], ['13:00', '17:00', 'manager']]);
        assert.equal((await db.query("SELECT id FROM hr_shift_segments WHERE hr_shift_id=$1 AND profession_key='manager'",
            [intoShift.id])).rows[0].id, existingSegment.id);
        await assert.rejects(db.query("UPDATE hr_shift_segments SET planned_end='16:30' WHERE hr_shift_id=$1 AND profession_key='manager'",
            [intoShift.id]), { code: '23514' });
        const partialRevision = { ...partial.input, rate: '800', rateReason: 'Synthetic partial rate revision' };
        const partialRequote = await service.preview('event_genix', actor, partialRevision, partial.id);
        assert.deepEqual(partialRequote.blockers, []);
        await service.mutate('event_genix', actor, 'revise', { input: partialRevision, expectedVersion: 1,
            previewFingerprint: partialRequote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() }, partial.id);
        await service.mutate('event_genix', actor, 'cancel', { expectedVersion: 2, reason: 'Synthetic partial restore',
            requestKey: randomUUID() }, partial.id);
        assert.deepEqual(await loadPlan(fromShift), [['09:00', '14:00', 'reception']]);
        assert.deepEqual(await loadPlan(intoShift), [['13:00', '17:00', 'manager']]);
        const overlap = await service.preview('event_genix', actor, { ...partialInput,
            startsAt: '2099-01-18T12:00:00+02:00', endsAt: '2099-01-18T14:00:00+02:00' });
        assert.ok(overlap.blockers.some(item => item.code === 'HR_SHIFT_PLAN_SEGMENTS_OVERLAP'));
        const hourly = { ...partialInput, payUnit: 'hour', rate: '225', rateReason: 'Synthetic hourly rate' };
        const hourlyQuote = await service.preview('event_genix', actor, hourly);
        assert.deepEqual(hourlyQuote.blockers, []);
        const payable = await service.mutate('event_genix', actor, 'create', { input: hourly,
            previewFingerprint: hourlyQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        const { recordAttendanceClockIn, recordAttendanceClockOut } = require('../../services/hrAttendance');
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const attendance = { staffId: staff.id, recordDate: hourly.workDate, performedBy: actor.username };
            await recordAttendanceClockIn(client, { ...attendance, now: '2099-01-18T08:00:00Z' });
            await recordAttendanceClockOut(client, { ...attendance, now: '2099-01-18T15:00:00Z', settlementMode: 'actual_time' });
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
        const optionsForCompletion = await service.completionOptions('event_genix', payable.id);
        assert.deepEqual(optionsForCompletion.allocations.map(item => [item.professionKey, item.actualMinutes]), [['reception', 120]]);
        assert.ok(optionsForCompletion.attendanceId);
        const attendanceRecord = (await db.query('SELECT compensation_snapshot FROM hr_time_records WHERE id=$1',
            [optionsForCompletion.attendanceId])).rows[0];
        const otherAllocation = attendanceRecord.compensation_snapshot.compensationAllocations.findIndex(item => item.professionKey === 'manager');
        assert.ok(otherAllocation >= 0);
        const completion = { expectedVersion: 1, reason: 'Synthetic verified work', workConfirmed: true,
            workEvidence: '120 minutes of reception', actualMinutes: 120, attendanceId: optionsForCompletion.attendanceId };
        await assert.rejects(service.mutate('event_genix', actor, 'complete', { ...completion,
            requestKey: randomUUID(), baseAllocationIndices: [otherAllocation] }, payable.id),
        { code: 'SUBSTITUTION_BASE_SCOPE_REQUIRED' });
        await assert.rejects(service.mutate('event_genix', actor, 'cancel', { expectedVersion: 1, reason: 'Work started',
            requestKey: randomUUID() }, payable.id), { code: 'SUBSTITUTION_WORK_STARTED' });
        const settled = await service.mutate('event_genix', actor, 'complete', { ...completion, requestKey: randomUUID(),
            baseAllocationIndices: [optionsForCompletion.allocations[0].index],
        }, payable.id);
        assert.equal(settled.completion.amountMinor, 45000);
        const updatedPayroll = await require('../../services/payroll').getPayrollPreview(staff.id, '2099-01', db);
        assert.equal(updatedPayroll.lines.filter(line => line.lineType === 'staff_substitution' && line.amount === 450).length, 1);
        assert.ok(updatedPayroll.lines.some(line => line.group === 'base' && line.professionKey === 'manager' && line.quantity === 4));
        assert.ok(!updatedPayroll.lines.some(line => line.group === 'base' && line.professionKey === 'reception' && line.amount > 0));
        assert.ok(!updatedPayroll.payrollBlockingIssues?.length);
        const originalLedger = await require('../../services/staffSubstitutionPayroll')
            .loadPayrollSubstitutions(db, [original.id], hourly.workDate, hourly.workDate);
        assert.equal(originalLedger.has(original.id), false);
        const freshDay = (await db.query(`INSERT INTO hr_shifts (staff_id,shift_date,planned_start,planned_end,profession_key)
            VALUES($1,'2099-01-19','09:00','14:00','reception') RETURNING id`, [original.id])).rows[0];
        const fresh = { ...partialInput, sourceId: String(freshDay.id), workDate: '2099-01-19',
            startsAt: '2099-01-19T10:00:00+02:00', endsAt: '2099-01-19T12:00:00+02:00' };
        const freshQuote = await service.preview('event_genix', actor, fresh);
        assert.deepEqual(freshQuote.blockers, []);
        const freshClaim = await service.mutate('event_genix', actor, 'create', { input: fresh,
            previewFingerprint: freshQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        assert.equal((await db.query("SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date='2099-01-19'", [staff.id])).rows.length, 1);
        await service.mutate('event_genix', actor, 'cancel', { expectedVersion: 1, reason: 'Synthetic empty-day restore',
            requestKey: randomUUID() }, freshClaim.id);
        assert.equal((await db.query("SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date='2099-01-19'", [staff.id])).rows.length, 0);
        assert.deepEqual(await loadPlan(freshDay), [['09:00', '14:00', 'reception']]);
        const night = (await db.query(`INSERT INTO hr_shifts (staff_id,shift_date,planned_start,planned_end,profession_key)
            VALUES($1,'2099-01-21','20:00','04:00','reception') RETURNING id`, [original.id])).rows[0];
        const nightInput = { ...hourly, sourceId: String(night.id), workDate: '2099-01-21',
            startsAt: '2099-01-21T23:00:00+02:00', endsAt: '2099-01-22T04:00:00+02:00' };
        const wrongNight = await service.preview('event_genix', actor, { ...nightInput, endsAt: '2099-01-22T02:00:00+02:00' });
        assert.ok(wrongNight.blockers.some(item => item.code === 'SUBSTITUTION_SHIFT_POST_MIDNIGHT_REMAINDER'));
        const nightQuote = await service.preview('event_genix', actor, nightInput);
        assert.deepEqual(nightQuote.blockers, []);
        const nightClaim = await service.mutate('event_genix', actor, 'create', { input: nightInput,
            previewFingerprint: nightQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        assert.deepEqual(await loadPlan(night), [['20:00', '23:00', 'reception']]);
        const nightReplacement = (await db.query("SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date='2099-01-21'", [staff.id])).rows[0];
        assert.deepEqual(await loadPlan(nightReplacement), [['23:00', '04:00', 'reception']]);
        await service.mutate('event_genix', actor, 'cancel', { expectedVersion: 1, reason: 'Synthetic night restoration',
            requestKey: randomUUID() }, nightClaim.id);
        assert.deepEqual(await loadPlan(night), [['20:00', '04:00', 'reception']]);
        const midnight = await service.preview('event_genix', actor, { ...nightInput,
            startsAt: '2099-01-21T20:00:00+02:00', endsAt: '2099-01-22T00:00:00+02:00' });
        assert.ok(!midnight.available, 'a midnight remainder needs an explicit date offset');
        const approvedNight = await service.preview('event_genix', actor, nightInput);
        const newNightClaim = await service.mutate('event_genix', actor, 'create', { input: nightInput,
            previewFingerprint: approvedNight.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        const nightClient = await db.connect();
        try {
            await nightClient.query('BEGIN');
            const attendance = { staffId: staff.id, recordDate: nightInput.workDate, performedBy: actor.username };
            await recordAttendanceClockIn(nightClient, { ...attendance, now: '2099-01-21T21:00:00Z' });
            await recordAttendanceClockOut(nightClient, { ...attendance, now: '2099-01-22T02:00:00Z', settlementMode: 'actual_time' });
            await nightClient.query('COMMIT');
        } catch (error) {
            await nightClient.query('ROLLBACK');
            throw error;
        } finally { nightClient.release(); }
        const nightOptions = await service.completionOptions('event_genix', newNightClaim.id);
        assert.deepEqual(nightOptions.allocations.map(item => item.actualMinutes), [300]);
        const completedNight = await service.mutate('event_genix', actor, 'complete', { ...completion,
            actualMinutes: 300, attendanceId: nightOptions.attendanceId, workEvidence: 'Synthetic overnight attendance',
            baseAllocationIndices: [nightOptions.allocations[0].index], requestKey: randomUUID() }, newNightClaim.id);
        assert.equal(completedNight.completion.amountMinor, 112500);
        const procurement=(await db.query("INSERT INTO procurement_lists(title,assigned_to) VALUES('Synthetic shopping work',$1) RETURNING id",[original.id])).rows[0];
        const options=await authRequest('GET',`/api/staff-substitutions/sources?sourceType=procurement&originalStaffId=${original.id}&workDate=2099-01-15`);
        assert.equal(options.status,200,JSON.stringify(options.data));
        assert.ok(options.data.data.some(item=>item.id===String(procurement.id)));
        const officeInput={...input,sourceType:'procurement',sourceId:String(procurement.id),originalStaffId:original.id,originalTreatment:'retain',workDate:'2099-01-15'};
        const previewResponse=await authRequest('POST','/api/staff-substitutions/preview',{input:officeInput});
        assert.equal(previewResponse.status,200,JSON.stringify(previewResponse.data));
        assert.deepEqual(previewResponse.data.data.blockers,[]);
        const saved=await authRequest('POST','/api/staff-substitutions',{input:officeInput,previewFingerprint:previewResponse.data.data.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
        assert.equal(saved.status,200,JSON.stringify(saved.data));
        assert.equal((await db.query('SELECT assigned_to FROM procurement_lists WHERE id=$1',[procurement.id])).rows[0].assigned_to,staff.id);
        const cancelled=await authRequest('POST',`/api/staff-substitutions/${saved.data.data.id}/cancel`,{expectedVersion:1,reason:'Synthetic restore',requestKey:randomUUID()});
        assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));
        assert.equal((await db.query('SELECT assigned_to FROM procurement_lists WHERE id=$1',[procurement.id])).rows[0].assigned_to,original.id);
        const users=[];
        for(const person of [original,staff]) {
            const user=(await db.query(`INSERT INTO users(username,password_hash,name,role,is_active) VALUES($1,'synthetic-no-login','Synthetic linked manager','manager',true) RETURNING id`,[`sub_${randomUUID()}`])).rows[0];
            await db.query("INSERT INTO employee_profiles(user_id,staff_id,full_name,is_active) VALUES($1,$2,'Synthetic staff link',true)",[user.id,person.id]);
            users.push(user);
        }
        const task=(await db.query(`INSERT INTO tasks(title,status,priority,owner_user_id,business_context,created_by,visibility)
            VALUES('Synthetic bounded task','todo','normal',$1,'event_genix',$2,'team') RETURNING id`,[users[0].id,actor.username])).rows[0];
        const lead=(await db.query("INSERT INTO leads(client_name,assigned_to,business_context) VALUES('Synthetic lead',$1,'event_genix') RETURNING id",[users[0].id])).rows[0];
        for(const [sourceType,sourceId,table,field] of [['task',task.id,'tasks','owner_user_id'],['lead',lead.id,'leads','assigned_to']]) {
            const assignment={...officeInput,sourceType,sourceId:String(sourceId),workDate:'2099-01-16'};
            const quoted=await service.preview('event_genix',actor,assignment);
            assert.deepEqual(quoted.blockers,[],sourceType);
            const savedRow=await service.mutate('event_genix',actor,'create',{input:assignment,previewFingerprint:quoted.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
            assert.equal((await db.query(`SELECT ${field} AS owner FROM ${table} WHERE id=$1`,[sourceId])).rows[0].owner,users[1].id);
            await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,reason:'Synthetic restore',requestKey:randomUUID()},savedRow.id);
            assert.equal((await db.query(`SELECT ${field} AS owner FROM ${table} WHERE id=$1`,[sourceId])).rows[0].owner,users[0].id);
        }
        const onboarded = (await db.query("INSERT INTO staff(name,department,position) VALUES('Synthetic trainee','admin','QA') RETURNING id")).rows[0];
        const mentorScope = (await db.query(`INSERT INTO onboarding_progress(staff_id,responsible_user_id,status)
            VALUES($1,$2,'in_progress') RETURNING id`, [onboarded.id,users[0].id])).rows[0];
        const mentorInput = { ...officeInput, sourceType:'onboarding', sourceId:String(mentorScope.id), workDate:'2099-01-26' };
        const picker = await authRequest('GET', `/api/staff-substitutions/sources?sourceType=onboarding&workDate=2099-01-26&originalStaffId=${original.id}`);
        assert.equal(picker.status, 200, JSON.stringify(picker.data));
        assert.ok(picker.data.data.some(row => row.id === mentorInput.sourceId));
        const mentorQuote = await service.preview('event_genix', actor, mentorInput);
        assert.deepEqual(mentorQuote.blockers, []);
        const saveMentor = quote => service.mutate('event_genix', actor, 'create', { input:mentorInput, requestKey:randomUUID(),
            previewFingerprint:quote.fingerprint, effectsAcknowledged:true });
        const mentorClaim = await saveMentor(mentorQuote);
        const taskOwners = async () => (await db.query(`SELECT id,owner_user_id FROM tasks WHERE source_type='onboarding'
            AND split_part(source_id,':',1)=$1 ORDER BY id`, [mentorInput.sourceId])).rows;
        const synced = await taskOwners();
        assert.ok(synced.length > 0 && synced.every(item => item.owner_user_id === users[1].id));
        await assert.rejects(service.preview('event_genix', actor, { ...mentorInput, sourceType:'task', sourceId:String(synced[0].id),
            staffId:original.id, originalStaffId:staff.id }), { code:'SUBSTITUTION_USE_ONBOARDING_SOURCE' });
        await assert.rejects(db.query('UPDATE onboarding_progress SET responsible_user_id=$2 WHERE id=$1',
            [mentorScope.id,users[0].id]), { constraint:'staff_substitution_onboarding_active_guard' });
        await service.mutate('event_genix',actor,'cancel',{ expectedVersion:1, reason:'Synthetic mentor restoration', requestKey:randomUUID() },mentorClaim.id);
        assert.ok((await taskOwners()).every(item => item.owner_user_id === users[0].id));
        assert.equal((await db.query('SELECT responsible_user_id FROM onboarding_progress WHERE id=$1',[mentorScope.id])).rows[0].responsible_user_id, users[0].id);
        const payableMentor = await saveMentor(await service.preview('event_genix',actor,mentorInput));
        const finishMentor = { expectedVersion:1, reason:'Synthetic mentoring done', requestKey:randomUUID(),
            workEvidence:'Synthetic mentoring checklist reviewed', workConfirmed:true };
        const mentorCompletion = await service.mutate('event_genix',actor,'complete',finishMentor,payableMentor.id);
        assert.equal(mentorCompletion.completion.amountMinor, 75037);
        assert.deepEqual((await service.mutate('event_genix',actor,'complete',finishMentor,payableMentor.id)).completion, mentorCompletion.completion);
        const caseUsernames = (await db.query('SELECT username FROM users WHERE id=ANY($1::int[]) ORDER BY id',
            [users.map(user => user.id)])).rows.map(user => user.username);
        const conversation = (await db.query(`INSERT INTO conversations(channel,external_id,status,assigned_to,business_context)
            VALUES('telegram',$1,'open',$2,'event_genix') RETURNING id`, [randomUUID(), caseUsernames[0]])).rows[0];
        const caseInput = { ...officeInput, sourceType:'inbox', sourceId:String(conversation.id), workDate:'2099-01-27' };
        const inboxPath = `/api/staff-substitutions/sources?sourceType=inbox&workDate=2099-01-27&originalStaffId=${original.id}`;
        const cases = await authRequest('GET',inboxPath);
        assert.equal(cases.status, 200, JSON.stringify(cases.data));
        assert.ok(cases.data.data.some(row => row.id === caseInput.sourceId));
        const caseQuote = await service.preview('event_genix',actor,caseInput);
        assert.deepEqual(caseQuote.blockers, []);
        const caseClaim = await service.mutate('event_genix',actor,'create',{ input:caseInput, requestKey:randomUUID(),
            effectsAcknowledged:true, previewFingerprint:caseQuote.fingerprint });
        const assignee = async () => (await db.query('SELECT assigned_to FROM conversations WHERE id=$1',[conversation.id])).rows[0].assigned_to;
        assert.equal(await assignee(),caseUsernames[1]);
        const blockedCaseEdit = await authRequest('PATCH',`/api/omni/conversations/${conversation.id}`,{ assigned_to:caseUsernames[0] });
        assert.equal(blockedCaseEdit.status,409,JSON.stringify(blockedCaseEdit.data));
        assert.equal(await assignee(),caseUsernames[1]);
        await service.mutate('event_genix',actor,'cancel',{ expectedVersion:1, reason:'Synthetic inbox restoration',
            requestKey:randomUUID() },caseClaim.id);
        assert.equal(await assignee(),caseUsernames[0]);
        const freshCase = await service.preview('event_genix',actor,caseInput);
        const payableCase = await service.mutate('event_genix',actor,'create',{ input:caseInput, requestKey:randomUUID(),
            effectsAcknowledged:true, previewFingerprint:freshCase.fingerprint });
        const caseCompletion = await service.mutate('event_genix',actor,'complete',{ expectedVersion:1, reason:'Synthetic case completed',
            workConfirmed:true, workEvidence:'Synthetic case triage checked', requestKey:randomUUID() },payableCase.id);
        assert.equal(caseCompletion.completion.amountMinor,75037);
        const caseEarnings = (await require('../../services/payroll').getPayrollRangePreview(
            { month:'2099-01', from:caseInput.workDate, to:caseInput.workDate, staffId:staff.id },db)).staff[0];
        assert.deepEqual(caseEarnings.lines.filter(line => line.lineType === 'staff_substitution').map(line => line.amount),[750.37]);
        assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM conversation_messages WHERE conversation_id=$1',
            [conversation.id])).rows[0].count,0);
        const msg = (await db.query(`INSERT INTO conversation_messages(conversation_id,direction,content)
            VALUES($1,'outbound','Synthetic expectation') RETURNING id`,[conversation.id])).rows[0];
        await db.query(`UPDATE conversations SET reply_expected=true,awaiting_reply_since=NOW(),reply_expected_message_id=$2,
            reply_owner=$3,reply_owner_user_id=$4 WHERE id=$1`,[conversation.id,msg.id,caseUsernames[0],users[0].id]);
        const escalation = (await db.query(`INSERT INTO tasks(title,status,priority,owner_user_id,business_context,created_by,visibility,source_type,source_id)
            VALUES('Synthetic escalation','todo','normal',$1,'event_genix',$2,'team','conversation_reply',$3) RETURNING id`,
        [users[0].id,actor.username,String(msg.id)])).rows[0];
        const replyInput = { ...officeInput, sourceType:'inbox_reply',sourceId:String(msg.id),workDate:'2099-01-28' };
        const replyPicker = await authRequest('GET',`/api/staff-substitutions/sources?sourceType=inbox_reply&workDate=2099-01-28&originalStaffId=${original.id}`);
        assert.equal(replyPicker.status,200,JSON.stringify(replyPicker.data));
        assert.ok(replyPicker.data.data.some(item=>item.id===replyInput.sourceId));
        const saveReply = async input => service.mutate('event_genix',actor,'create',{input,requestKey:randomUUID(),
            effectsAcknowledged:true,previewFingerprint:(await service.preview('event_genix',actor,input)).fingerprint});
        const replyClaim = await saveReply(replyInput);
        const owners = async () => (await db.query(`SELECT c.reply_owner_user_id,t.owner_user_id,c.assigned_to, c.reply_expected_message_id
            FROM conversations c CROSS JOIN tasks t WHERE c.id=$1 AND t.id=$2`,[conversation.id,escalation.id])).rows[0];
        assert.deepEqual(await owners(),{reply_owner_user_id:users[1].id,owner_user_id:users[1].id,
            assigned_to:caseUsernames[1],reply_expected_message_id:msg.id});
        await assert.rejects(db.query('UPDATE tasks SET owner_user_id=$2 WHERE id=$1',[escalation.id,users[0].id]),
            {constraint:'staff_substitution_reply_active_guard'});
        const blockedReplyEdit = await authRequest('PATCH',`/api/work-queue/replies/${conversation.id}/owner`,{ownerUserId:users[0].id});
        assert.equal(blockedReplyEdit.status,409,JSON.stringify(blockedReplyEdit.data));
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,requestKey:randomUUID(),reason:'Synthetic reply undo'},replyClaim.id);
        assert.equal((await owners()).owner_user_id,users[0].id);
        assert.equal((await owners()).reply_owner_user_id,users[0].id);
        const payableReply = await saveReply(replyInput);
        await db.query(`UPDATE conversations SET reply_expected=false,reply_expected_message_id=NULL,
            reply_owner_user_id=NULL,reply_owner=NULL WHERE id=$1`,[conversation.id]);
        await db.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[escalation.id]);
        const finishedReply = await service.mutate('event_genix',actor,'complete',{expectedVersion:1,requestKey:randomUUID(),
            reason:'Synthetic response received',workConfirmed:true,workEvidence:'Synthetic message handled'},payableReply.id);
        assert.equal(finishedReply.completion.amountMinor,75037);
        assert.equal((await db.query("SELECT count(*)::int AS count FROM reply_action_history WHERE conversation_id=$1 AND meta_json->>'substitutionId'=$2",
            [conversation.id,payableReply.id])).rows[0].count,1);
        const nextMsg = (await db.query(`INSERT INTO conversation_messages(conversation_id,direction,content)
            VALUES($1,'outbound','Synthetic next expectation') RETURNING id`,[conversation.id])).rows[0];
        await db.query(`UPDATE conversations SET reply_expected=true,awaiting_reply_since=NOW(),reply_expected_message_id=$2,
            reply_owner=$3,reply_owner_user_id=$4 WHERE id=$1`,[conversation.id,nextMsg.id,caseUsernames[0],users[0].id]);
        await db.query(`INSERT INTO tasks(title,status,priority,owner_user_id,business_context,created_by,visibility,source_type,source_id)
            VALUES('Synthetic next escalation','todo','normal',$1,'event_genix',$2,'team','conversation_reply',$3)`,
        [users[0].id,actor.username,String(nextMsg.id)]);
        const nextReply = await saveReply({ ...replyInput,sourceId:String(nextMsg.id) });
        assert.notEqual(nextReply.id,payableReply.id);
        assert.equal((await owners()).reply_expected_message_id,nextMsg.id);
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,requestKey:randomUUID(),reason:'Synthetic next reply undo'},nextReply.id);
        const chatBookingId = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,room,room_resource_id,business_context)
            VALUES($1,'2099-01-29','10:00',60,'banquet-service','confirmed','На виніс','room-takeaway','event_genix')`,[chatBookingId]);
        const channel = (await db.query(`INSERT INTO chat_channels(slug,name,linked_booking_id)
            VALUES($1,'Synthetic Park channel',$2) RETURNING id`,[`sub-${randomUUID()}`,chatBookingId])).rows[0];
        await db.query('INSERT INTO chat_channel_members(channel_id,user_id) VALUES($1,$2),($1,$3)',[channel.id,actor.id,users[0].id]);
        const directChat = (await db.query(`INSERT INTO chat_tasks(channel_id,assigned_to,assigned_by,title)
            VALUES($1,$2,$3,'Synthetic chat task') RETURNING id`,[channel.id,users[0].id,actor.id])).rows[0];
        const chatInput={ ...officeInput, sourceType:'chat_task',sourceId:String(directChat.id),workDate:'2099-01-29' };
        assert.ok((await service.preview('event_genix',actor,chatInput)).blockers.some(item=>item.code==='SUBSTITUTION_CHAT_MEMBER_REQUIRED'));
        await db.query('INSERT INTO chat_channel_members(channel_id,user_id) VALUES($1,$2)',[channel.id,users[1].id]);
        const chatClaim=await saveReply(chatInput);
        const chatOwner=async()=> (await db.query('SELECT assigned_to FROM chat_tasks WHERE id=$1',[directChat.id])).rows[0].assigned_to;
        assert.equal(await chatOwner(),users[1].id);
        await assert.rejects(db.query('UPDATE chat_tasks SET assigned_to=$2 WHERE id=$1',[directChat.id,users[0].id]),
            {constraint:'staff_substitution_chat_task_active_guard'});
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,requestKey:randomUUID(),reason:'Synthetic chat undo'},chatClaim.id);
        assert.equal(await chatOwner(),users[0].id);
        const payableChat = await saveReply(chatInput);
        await db.query("UPDATE chat_tasks SET status='done' WHERE id=$1",[directChat.id]);
        const finishedChat = await service.mutate('event_genix',actor,'complete',{expectedVersion:1,requestKey:randomUUID(),
            reason:'Synthetic channel task completed',workConfirmed:true,workEvidence:'Synthetic work checked'},payableChat.id);
        assert.equal(finishedChat.completion.amountMinor,75037);
        const meeting = (await db.query(`INSERT INTO meeting_notes(title,meeting_date,created_by,channel_id)
            VALUES('Synthetic Park meeting','2099-01-30',$1,$2) RETURNING id`,[actor.id,channel.id])).rows[0];
        const action = (await db.query(`INSERT INTO meeting_action_items(meeting_id,description,assigned_to,due_date)
            VALUES($1,'Synthetic meeting action',$2,'2099-01-30') RETURNING id`,[meeting.id,users[0].id])).rows[0];
        const unscopedMeeting = (await db.query(`INSERT INTO meeting_notes(title,meeting_date,created_by)
            VALUES('Synthetic unscoped meeting','2099-01-30',$1) RETURNING id`,[actor.id])).rows[0];
        await db.query(`INSERT INTO meeting_action_items(meeting_id,description,assigned_to)
            VALUES($1,'Synthetic unscoped action',$2)`,[unscopedMeeting.id,users[0].id]);
        const meetingInput={...officeInput,sourceType:'meeting_action',sourceId:String(action.id),workDate:'2099-01-30'};
        const listMeeting=await authRequest('GET',`/api/staff-substitutions/sources?sourceType=meeting_action&workDate=2099-01-30&originalStaffId=${original.id}`);
        assert.equal(listMeeting.status,200,JSON.stringify(listMeeting.data));
        assert.deepEqual(listMeeting.data.data.map(item=>item.id),[meetingInput.sourceId]);
        await assert.rejects(service.preview('event_genix',{...actor,id:users[0].id},meetingInput),
            {code:'SUBSTITUTION_SOURCE_NOT_FOUND'});
        const meetingClaim=await saveReply(meetingInput);
        const readAction=async()=> (await db.query('SELECT assigned_to,status,task_id FROM meeting_action_items WHERE id=$1',[action.id])).rows[0];
        assert.equal((await readAction()).assigned_to,users[1].id);
        const createTasksUrl=`/api/notes/meeting/${meeting.id}/create-tasks`;
        const blockedConversion=await authRequest('POST',createTasksUrl,{});
        assert.equal(blockedConversion.status,409,JSON.stringify(blockedConversion.data));
        assert.deepEqual((await db.query("SELECT id FROM tasks WHERE source_type='meeting_action' AND source_id=$1",[String(action.id)])).rows,[]);
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,requestKey:randomUUID(),reason:'Synthetic meeting undo'},meetingClaim.id);
        assert.equal((await readAction()).assigned_to,users[0].id);
        const payableMeeting=await saveReply(meetingInput);
        const completedMeeting=await service.mutate('event_genix',actor,'complete',{expectedVersion:1,requestKey:randomUUID(),
            reason:'Synthetic meeting action completed',workConfirmed:true,workEvidence:'Synthetic action checked'},payableMeeting.id);
        assert.equal(completedMeeting.completion.amountMinor,75037);
        assert.deepEqual(await readAction(),{assigned_to:users[1].id,status:'done',task_id:null});
        const afterCompletion=await authRequest('POST',createTasksUrl,{});
        assert.equal(afterCompletion.status,200,JSON.stringify(afterCompletion.data));
        assert.equal(afterCompletion.data.created,0);

        const raceMeeting = (await db.query(`INSERT INTO meeting_notes(title,meeting_date,created_by,channel_id)
            VALUES('Synthetic concurrent meeting','2099-01-31',$1,$2) RETURNING id`,[actor.id,channel.id])).rows[0];
        const raceAction = (await db.query(`INSERT INTO meeting_action_items(meeting_id,description,assigned_to)
            VALUES($1,'Synthetic concurrent action',$2) RETURNING id`,[raceMeeting.id,users[0].id])).rows[0];
        const raceInput={...meetingInput,sourceId:String(raceAction.id),workDate:'2099-01-31'};
        const meetingOffer=await service.preview('event_genix',actor,raceInput);
        assert.equal(meetingOffer.available,true,JSON.stringify(meetingOffer.blockers));
        const conversionAndClaim=await Promise.allSettled([
            service.mutate('event_genix',actor,'create',{input:raceInput,requestKey:randomUUID(),
                effectsAcknowledged:true,previewFingerprint:meetingOffer.fingerprint}),
            authRequest('POST',`/api/notes/meeting/${raceMeeting.id}/create-tasks`,{})
        ]);
        assert.equal(conversionAndClaim[1].status,'fulfilled');
        if (conversionAndClaim[0].status==='fulfilled') {
            assert.equal(conversionAndClaim[1].value.status,409);
        } else {
            assert.equal(conversionAndClaim[1].value.status,200);
            assert.equal(conversionAndClaim[1].value.data.created,1);
            assert.ok(['SUBSTITUTION_PREVIEW_STALE','SUBSTITUTION_MEETING_ALIAS_CLAIMED'].includes(conversionAndClaim[0].reason.code),
                String(conversionAndClaim[0].reason));
        }
        const pendingAction = (await db.query(`INSERT INTO meeting_action_items(meeting_id,description,assigned_to)
            VALUES($1,'Synthetic double conversion',$2) RETURNING id`,[meeting.id,users[0].id])).rows[0];
        const doubledConversion = await Promise.all([authRequest('POST',createTasksUrl,{}),authRequest('POST',createTasksUrl,{})]);
        assert.ok(doubledConversion.every(response=>response.status===200),JSON.stringify(doubledConversion));
        assert.deepEqual(doubledConversion.map(response=>response.data.created).sort(),[0,1]);
        assert.equal((await db.query("SELECT id FROM tasks WHERE source_type='meeting_action' AND source_id=$1",[String(pendingAction.id)])).rowCount,1);
        const meetingPayroll = (await require('../../services/payroll').getPayrollRangePreview(
            { month:'2099-01',from:meetingInput.workDate,to:meetingInput.workDate,staffId:staff.id },db)).staff[0];
        assert.deepEqual(meetingPayroll.lines.filter(line=>line.lineType==='staff_substitution').map(line=>line.amount),[750.37]);
        const leadTask = (await db.query(`INSERT INTO tasks(title,status,priority,owner_user_id,business_context,created_by,visibility,
            source_type,source_id,source_entity_type,source_entity_id)
            VALUES('Synthetic lead task','todo','normal',$1,'event_genix',$2,'team','lead',$3,'lead',$3) RETURNING id`,
        [users[0].id,actor.username,String(lead.id)])).rows[0];
        const leadAlias = { ...officeInput, sourceType: 'lead', sourceId: String(lead.id), workDate: '2099-01-24' };
        const taskAlias = { ...leadAlias, sourceType: 'task', sourceId: String(leadTask.id), workDate: '2099-01-25' };
        const quotedLead = await service.preview('event_genix', actor, leadAlias);
        const quotedTask = await service.preview('event_genix', actor, taskAlias);
        const submitAlias = (input, quote) => service.mutate('event_genix', actor, 'create', { input,
            previewFingerprint: quote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        const aliasRace = await Promise.allSettled([submitAlias(leadAlias, quotedLead), submitAlias(taskAlias, quotedTask)]);
        assert.equal(aliasRace.filter(result => result.status === 'fulfilled').length, 1);
        assert.ok(aliasRace.some(result => result.status === 'rejected'
            && ['SUBSTITUTION_PREVIEW_STALE','SUBSTITUTION_LEAD_ALIAS_CLAIMED'].includes(result.reason.code)));
        const wonLead = aliasRace[0].status === 'fulfilled';
        const losingQuote = await service.preview('event_genix', actor, wonLead ? taskAlias : leadAlias);
        assert.ok(losingQuote.blockers.some(item => item.code === 'SUBSTITUTION_LEAD_ALIAS_CLAIMED'));
        const winner = aliasRace[wonLead ? 0 : 1].value;
        const other = wonLead ? taskAlias : leadAlias;
        await assert.rejects(db.query(`INSERT INTO staff_substitutions
            (business_context,staff_id,original_staff_id,work_date,source_type,source_id,slot_key,state,version,input_json,quote_json,source_snapshot,created_by)
            VALUES('event_genix',$1,$2,$3,$4,$5,'primary','active',1,'{}','{}','{}',$6)`,
        [other.staffId,other.originalStaffId,other.workDate,other.sourceType,other.sourceId,actor.username]),
        { constraint: 'staff_substitution_lead_alias_guard' });
        await service.mutate('event_genix', actor, 'cancel', { expectedVersion: 1, reason: 'Synthetic alias release',
            requestKey: randomUUID() }, winner.id);
        assert.deepEqual((await service.preview('event_genix', actor, wonLead ? taskAlias : leadAlias)).blockers, []);

        const animators=[];
        for(let i=0;i<3;i++) {
            const person=(await db.query(`INSERT INTO staff(name,role_type,department,position,is_active,hourly_rate,rate_unit,hr_pool_status,is_freelance)
                VALUES($1,'animator','animators','Synthetic animator',true,100,'hour','core',false) RETURNING id`,[`QA Animator ${i}`])).rows[0];
            const day=(await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key)
                VALUES($1,'2099-01-17','09:00','18:00',0,'animator') RETURNING id`,[person.id])).rows[0];
            await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end) VALUES($1,'animator','09:00','18:00')`,[day.id]);
            await db.query(`INSERT INTO staff_schedule(staff_id,date,status,shift_start,shift_end) VALUES($1,'2099-01-17','working','09:00','18:00')`,[person.id]);
            const occurrenceDay=(await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key)
                VALUES($1,'2099-01-16','09:00','18:00',0,'animator') RETURNING id`,[person.id])).rows[0];
            await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end) VALUES($1,'animator','09:00','18:00')`,[occurrenceDay.id]);
            await db.query(`INSERT INTO staff_schedule(staff_id,date,status,shift_start,shift_end) VALUES($1,'2099-01-16','working','09:00','18:00')`,[person.id]);
            animators.push(person.id);
        }
        await require('../../services/staffScheduleMutations').reconcileAnimatorRosterDates(db,['2099-01-16','2099-01-17']);
        for(const [slotKey,hour] of [['primary',13],['second',14]]) {
            const event=(await db.query(`INSERT INTO afisha(date,time,title,duration,type,line_id,second_line_id)
                VALUES('2099-01-17',$1,'Synthetic substitution event',60,'event',$2,$3) RETURNING id`,
            [`${hour}:00`,String(slotKey==='primary'?animators[0]:animators[2]),String(slotKey==='primary'?animators[2]:animators[0])])).rows[0];
            const assignment={...input,staffId:animators[1],originalStaffId:animators[0],professionKey:'animator',temporaryAdmission:false,
                sourceType:'afisha',sourceId:String(event.id),slotKey,workDate:'2099-01-17',originalTreatment:'retain',
                startsAt:`2099-01-17T${hour}:00:00+02:00`,endsAt:`2099-01-17T${hour+1}:00:00+02:00`,allowConcurrent:true,concurrentReason:'Event inside approved animator shift'};
            const sourceQuery = `/api/staff-substitutions/sources?sourceType=afisha&workDate=2099-01-17&originalStaffId=${animators[0]}`;
            const listed = await authRequest('GET', `${sourceQuery}&slotKey=${slotKey}`);
            const item = listed.data.data.find(row => row.id === String(event.id));
            assert.equal(item?.endTime, `${hour + 1}:00`);
            const otherSlot = await authRequest('GET', `${sourceQuery}&slotKey=${slotKey === 'primary' ? 'second' : 'primary'}`);
            assert.ok(!otherSlot.data.data.some(row => row.id === String(event.id)));
            const quoted=await service.preview('event_genix',actor,assignment);
            assert.deepEqual(quoted.blockers,[],slotKey);
            const savedRow=await service.mutate('event_genix',actor,'create',{input:assignment,previewFingerprint:quoted.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
            const field=slotKey==='primary'?'line_id':'second_line_id';
            assert.equal(String((await db.query(`SELECT ${field} AS owner FROM afisha WHERE id=$1`,[event.id])).rows[0].owner),String(animators[1]));
            await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,reason:'Synthetic restore',requestKey:randomUUID()},savedRow.id);
            assert.equal(String((await db.query(`SELECT ${field} AS owner FROM afisha WHERE id=$1`,[event.id])).rows[0].owner),String(animators[0]));
        }
        const greeting = (await db.query(`INSERT INTO afisha(date,time,original_time,title,duration,type,line_id)
            VALUES('2099-01-17','16:00','16:00','Synthetic fixed greeting',15,'greeting',$1) RETURNING id`,
        [String(animators[0])])).rows[0];
        await db.query("INSERT INTO afisha_birthday_slots(afisha_id,slot_key,time,mode) VALUES($1,'single','16:00','manual')",[greeting.id]);
        const greetingInput = { ...input, sourceType:'afisha', sourceId:String(greeting.id), slotKey:'single:primary',workDate:'2099-01-17',
            staffId:animators[1], originalStaffId:animators[0], professionKey:'animator', temporaryAdmission:false,
            originalTreatment:'retain', startsAt:'2099-01-17T16:00:00+02:00', endsAt:'2099-01-17T16:15:00+02:00',
            allowConcurrent:true, concurrentReason:'Greeting inside approved shift' };
        const greetingOptions = await authRequest('GET', `/api/staff-substitutions/sources?sourceType=afisha&workDate=2099-01-17&originalStaffId=${animators[0]}`);
        assert.equal(greetingOptions.data.data.find(item => item.id === greetingInput.sourceId)?.endTime, '16:15');
        const greetingQuote = await service.preview('event_genix',actor,greetingInput);
        assert.deepEqual(greetingQuote.blockers, []);
        const greetingClaim = await service.mutate('event_genix',actor,'create',{ input:greetingInput, requestKey:randomUUID(),
            effectsAcknowledged:true, previewFingerprint:greetingQuote.fingerprint });
        assert.equal((await db.query('SELECT line_id FROM afisha WHERE id=$1',[greeting.id])).rows[0].line_id, String(animators[0]));
        await assert.rejects(db.query("UPDATE afisha_birthday_slots SET time='16:30' WHERE afisha_id=$1",[greeting.id]),
            { constraint:'afisha_substitution_schedule_conflict' });
        const rescheduleGreeting = await authRequest('PATCH',`/api/afisha/${greeting.id}/birthday-slots/single`,
            { mode:'manual', time:'16:30', expectedMode:'manual', expectedTime:'16:00' });
        assert.equal(rescheduleGreeting.status,409,JSON.stringify(rescheduleGreeting.data));
        await service.mutate('event_genix',actor,'cancel',{ expectedVersion:1, reason:'Synthetic greeting restoration',
            requestKey:randomUUID() },greetingClaim.id);
        assert.equal((await db.query('SELECT line_id FROM afisha WHERE id=$1',[greeting.id])).rows[0].line_id, String(animators[0]));
        const auto = (await db.query(`INSERT INTO afisha(date,time,original_time,title,duration,type,line_id,second_line_id)
            VALUES('2099-01-16','12:00','12:00','Synthetic two-slot greeting',15,'birthday',$1,$2) RETURNING id`,
        [String(animators[0]),String(animators[2])])).rows[0];
        const slotsUrl = '/api/afisha/2099-01-16';
        const apiEvent = async () => {
            const response = await authRequest('GET',slotsUrl);
            assert.equal(response.status,200,JSON.stringify(response.data));
            return response.data.find(event => event.id===auto.id);
        };
        const list = await authRequest('GET',`/api/staff-substitutions/sources?sourceType=afisha&workDate=2099-01-16&originalStaffId=${animators[0]}`);
        assert.deepEqual(list.data.data.filter(item=>item.sourceId===String(auto.id)).map(item=>item.slotKey),['first:primary','second:primary']);
        const first = (await apiEvent()).birthday_slots[0];
        const autoInput = {...greetingInput,sourceId:String(auto.id),slotKey:'first:primary',workDate:'2099-01-16',
            startsAt:`2099-01-16T${first.time}:00+02:00`,
            endsAt:new Date(Date.parse(`2099-01-16T${first.time}:00+02:00`)+15*60000).toISOString()};
        const automatic = await saveReply(autoInput);
        const slotsBefore = (await apiEvent()).birthday_slots;
        assert.deepEqual(slotsBefore[0].line_ids,[String(animators[1]),String(animators[2])]);
        assert.deepEqual(slotsBefore[1].line_ids,[String(animators[0]),String(animators[2])]);
        const concurrentWrite = await db.connect();
        try {
            await concurrentWrite.query('BEGIN');
            await concurrentWrite.query("SELECT lock_afisha_substitution_days_v404(ARRAY['2099-01-16'])");
            await assert.rejects(db.query("UPDATE afisha SET original_time='12:05' WHERE id=$1",[auto.id]),
                {constraint:'afisha_substitution_schedule_busy'});
        } finally {
            await concurrentWrite.query('ROLLBACK');
            concurrentWrite.release();
        }
        const obstacle = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,business_context,room,room_resource_id)
            VALUES($1,'2099-01-16',$2,15,$3,'confirmed','event_genix','На виніс','room-takeaway')`,[obstacle,first.time,String(animators[1])]);
        const slotsAfter = (await apiEvent()).birthday_slots;
        assert.notEqual(slotsAfter[0].time,slotsBefore[0].time);
        assert.deepEqual(slotsAfter[1],slotsBefore[1]);
        const movedClaim = await service.history('event_genix',automatic.id);
        const timing = movedClaim.events.at(-1);
        assert.equal(timing.action,'revise');
        assert.equal(timing.before_json.source.time,slotsBefore[0].time);
        assert.equal(timing.after_json.source.time,slotsAfter[0].time);
        const lockedRoster = await db.connect();
        try {
            await lockedRoster.query('BEGIN');
            await lockedRoster.query('SELECT id FROM staff WHERE id=$1 FOR UPDATE',[animators[1]]);
            await assert.rejects(db.query('DELETE FROM bookings WHERE id=$1',[obstacle]),
                {constraint:'afisha_substitution_schedule_busy'});
            assert.equal((await apiEvent()).birthday_slots[0].time,slotsAfter[0].time);
        } finally {
            await lockedRoster.query('ROLLBACK');
            lockedRoster.release();
        }
        const blockedObstacle = `SUB-${randomUUID()}`;
        await assert.rejects(db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,business_context,room,room_resource_id)
            VALUES($1,'2099-01-16','12:00',390,$2,'confirmed','event_genix','На виніс','room-takeaway')`,[blockedObstacle,String(animators[1])]),
            {constraint:'afisha_substitution_schedule_conflict'});
        assert.equal((await db.query('SELECT id FROM bookings WHERE id=$1',[blockedObstacle])).rowCount,0);
        assert.equal((await service.history('event_genix',automatic.id)).events.length,2);
        const completedGreeting = await service.mutate('event_genix',actor,'complete',{expectedVersion:2,requestKey:randomUUID(),
            reason:'Synthetic moved greeting completed',workConfirmed:true,workEvidence:'Synthetic slot presence verified'},automatic.id);
        assert.equal(completedGreeting.completion.amountMinor,75037);
        const greetingPayroll = (await require('../../services/payroll').getPayrollRangePreview(
            {month:'2099-01',from:autoInput.workDate,to:autoInput.workDate,staffId:animators[1]},db)).staff[0];
        assert.deepEqual(greetingPayroll.lines.filter(line=>line.lineType==='staff_substitution').map(line=>line.amount),[750.37]);
        await db.query('DELETE FROM bookings WHERE id=$1',[obstacle]);
        assert.equal((await apiEvent()).birthday_slots[0].time,slotsAfter[0].time);
        const rootId = `SUB-${randomUUID()}`;
        const childId = `SUB-${randomUUID()}`;
        const names = (await db.query('SELECT id,name FROM staff WHERE id=ANY($1) ORDER BY id', [animators])).rows.map(row => row.name);
        await db.query(`INSERT INTO bookings (id,date,time,duration,line_id,status,price,hosts,label,room,room_resource_id,
            business_context,linked_to,second_animator,extra_data)
            VALUES ($1,'2099-01-17','15:00',60,$3,'confirmed',650,2,'Synthetic booking','На виніс','room-takeaway',
                    'event_genix',NULL,$5,$7), ($2,'2099-01-17','15:00',60,$4,'confirmed',0,2,'Synthetic booking','На виніс',
                    'room-takeaway','event_genix',$1,$5,$6)`, [rootId, childId, String(animators[0]), String(animators[2]),
            names[2], { timelineIdentity: { lineId: String(animators[2]), resourceId: String(animators[2]), resourceType: 'animator' } },
            { bookingWorkspace: { secondAnimatorLineId: String(animators[2]) } }]);
        const bookingInput = { ...input, sourceType: 'booking', sourceId: rootId, staffId: animators[1],
            originalStaffId: animators[2], professionKey: 'animator', temporaryAdmission: false, slotKey: 'second',
            workDate: '2099-01-17', startsAt: '2099-01-17T15:00:00+02:00', endsAt: '2099-01-17T16:00:00+02:00',
            allowConcurrent: true, concurrentReason: 'Within roster shift', originalTreatment: 'retain' };
        const secondList = await authRequest('GET', `/api/staff-substitutions/sources?sourceType=booking&slotKey=second&workDate=2099-01-17&originalStaffId=${animators[2]}`);
        assert.equal(secondList.status, 200);
        assert.ok(secondList.data.data.some(item => item.id === rootId && item.endTime === '16:00'));
        const bookingQuote = await service.preview('event_genix', actor, bookingInput);
        assert.deepEqual(bookingQuote.blockers, []);
        const withoutBaseSegment = await service.preview('event_genix', actor, { ...bookingInput, payMode: 'replace_base' });
        assert.ok(withoutBaseSegment.blockers.some(item => item.code === 'SUBSTITUTION_BOOKING_BASE_SEGMENT_REQUIRED'));
        const overlapBooking = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings (id,date,time,duration,line_id,status,room,room_resource_id,business_context)
            VALUES ($1,'2099-01-17','15:30',30,$2,'confirmed','На виніс','room-takeaway','event_genix')`,
        [overlapBooking, String(animators[1])]);
        const busyQuote = await service.preview('event_genix', actor, bookingInput);
        assert.ok(busyQuote.blockers.some(item => item.code === 'SUBSTITUTION_BOOKING_CONFLICT'));
        await assert.rejects(service.mutate('event_genix', actor, 'create', { input: bookingInput, requestKey: randomUUID(),
            previewFingerprint: bookingQuote.fingerprint, effectsAcknowledged: true }), { code: 'SUBSTITUTION_PREVIEW_STALE' });
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [overlapBooking]);
        const freeQuote = await service.preview('event_genix', actor, bookingInput);
        const saveBooking = () => service.mutate('event_genix', actor, 'create', { input: bookingInput, requestKey: randomUUID(),
            previewFingerprint: freeQuote.fingerprint, effectsAcknowledged: true });
        const race = await Promise.allSettled([saveBooking(), saveBooking()]);
        assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
        const bookingClaim = race.find(result => result.status === 'fulfilled').value;
        const booked = async id => (await db.query('SELECT * FROM bookings WHERE id=$1', [id])).rows[0];
        assert.equal((await booked(rootId)).line_id, String(animators[0]));
        assert.equal((await booked(rootId)).second_animator, names[1]);
        assert.equal((await booked(rootId)).price, 650);
        assert.equal((await booked(childId)).line_id, String(animators[1]));
        assert.equal((await booked(childId)).linked_to, rootId);
        assert.equal((await booked(childId)).extra_data.timelineIdentity.lineId, String(animators[1]));
        const detail = await authRequest('GET', `/api/bookings/detail/${childId}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.data.booking?.lineId ?? detail.data.lineId ?? detail.data.data?.lineId, String(animators[1]));
        const linkedReschedule = await authRequest('POST', `/api/bookings/${rootId}/linked-atomic`, { main: { time: '16:00' } });
        assert.equal(linkedReschedule.status, 409, JSON.stringify(linkedReschedule.data));
        assert.equal(linkedReschedule.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        await assert.rejects(db.query("UPDATE bookings SET time='15:15' WHERE id=$1", [rootId]), { code: '23514' });
        await assert.rejects(db.query('DELETE FROM bookings WHERE id=$1', [childId]), { code: '23514' });
        const cancelResponse = await authRequest('DELETE', `/api/bookings/${rootId}`);
        assert.equal(cancelResponse.status, 409);
        assert.equal(cancelResponse.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        await assert.rejects(db.query(`INSERT INTO booking_banquet_links(business_context,booking_a_id,booking_b_id)
            VALUES('event_genix',$1,$2)`, [rootId, childId]), { code: '23514' });
        const aliasedTask = (await db.query(`INSERT INTO tasks (title,status,priority,owner_user_id,business_context,created_by,visibility,source_type,source_id)
            VALUES ('Synthetic booking work','todo','normal',$1,'event_genix',$2,'team','booking',$3) RETURNING id`,
        [users[0].id, actor.username, childId])).rows[0];
        const aliasQuote = await service.preview('event_genix', actor, { ...officeInput, sourceType: 'task',
            sourceId: String(aliasedTask.id), workDate: '2099-01-17' });
        assert.ok(aliasQuote.blockers.some(item => item.code === 'SUBSTITUTION_USE_BOOKING_SOURCE'));
        const revision = { ...bookingInput, rate: '770', rateReason: 'Synthetic revised booking rate' };
        const revisionQuote = await service.preview('event_genix', actor, revision, bookingClaim.id);
        assert.deepEqual(revisionQuote.blockers, []);
        await service.mutate('event_genix', actor, 'revise', { input: revision, expectedVersion: 1,
            previewFingerprint: revisionQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() }, bookingClaim.id);
        await service.mutate('event_genix', actor, 'cancel', { expectedVersion: 2, reason: 'Synthetic booking restore',
            requestKey: randomUUID() }, bookingClaim.id);
        assert.equal((await booked(childId)).line_id, String(animators[2]));
        assert.equal((await booked(rootId)).second_animator, names[2]);
        assert.deepEqual((await booked(rootId)).extra_data, { bookingWorkspace: { secondAnimatorLineId: String(animators[2]) } });
        assert.deepEqual((await booked(childId)).extra_data.timelineIdentity, {
            lineId: String(animators[2]), resourceId: String(animators[2]), resourceType: 'animator'
        });
        const banquetId = `QAB-${randomUUID()}`;
        const banquetPrimary = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,price,hosts,label,room,room_resource_id,business_context)
            VALUES($1,'2099-01-17','15:00',60,'banquet-service','confirmed',450,0,'Synthetic banquet root','На виніс','room-takeaway','event_genix')`,
        [banquetPrimary]);
        const banquetFixture = await db.connect();
        try {
            await banquetFixture.query('BEGIN');
            await banquetFixture.query(`INSERT INTO banquet_groups(id,business_context,primary_booking_id,date,room,room_resource_id,guest_arrival_time,updated_at)
                VALUES($1,'event_genix',$2,'2099-01-17','На виніс','room-takeaway','14:45','2025-01-01')`, [banquetId,banquetPrimary]);
            await banquetFixture.query(`INSERT INTO banquet_group_bookings(group_id,business_context,booking_id,role)
                VALUES($1,'event_genix',$2,'primary'),($1,'event_genix',$3,'activity')`, [banquetId,banquetPrimary,rootId]);
            await banquetFixture.query('COMMIT');
        } catch (error) {
            await banquetFixture.query('ROLLBACK');
            throw error;
        } finally { banquetFixture.release(); }
        await db.query(`INSERT INTO booking_banquet_links(business_context,booking_a_id,booking_b_id)
            VALUES('event_genix',$1,$2)`, [banquetPrimary,rootId]);
        const banquetList = await authRequest('GET', `/api/staff-substitutions/sources?sourceType=booking&slotKey=second&workDate=2099-01-17&originalStaffId=${animators[2]}`);
        assert.equal(banquetList.status, 200);
        assert.match(banquetList.data.data.find(item => item.id === rootId).title, /Банкетне бронювання/);
        const groupBefore = (await db.query('SELECT * FROM banquet_groups WHERE id=$1',[banquetId])).rows[0];
        const primaryBefore = await booked(banquetPrimary);
        const quoteBanquet = await service.preview('event_genix', actor, bookingInput);
        assert.deepEqual(quoteBanquet.blockers, []);
        const banquetClaim = await service.mutate('event_genix', actor, 'create', { input: bookingInput, requestKey: randomUUID(),
            previewFingerprint: quoteBanquet.fingerprint, effectsAcknowledged: true });
        assert.equal((await booked(childId)).line_id, String(animators[1]));
        assert.equal((await booked(rootId)).second_animator, names[1]);
        assert.deepEqual(await booked(banquetPrimary), primaryBefore);
        const groupAfter = (await db.query('SELECT * FROM banquet_groups WHERE id=$1',[banquetId])).rows[0];
        assert.ok(groupAfter.updated_at > groupBefore.updated_at);
        const { updated_at, updated_by } = groupAfter;
        assert.deepEqual(groupAfter, { ...groupBefore, updated_at, updated_by });
        const logRow = (await db.query("SELECT data FROM history WHERE action='booking_substitution_assigned' AND data->>'substitutionId'=$1",
            [banquetClaim.id])).rows[0];
        assert.equal(logRow.data.groupId, banquetId);
        assert.equal(logRow.data.slotBookingId, childId);
        await assert.rejects(db.query("UPDATE banquet_groups SET status='closed' WHERE id=$1",[banquetId]),
            { constraint: 'booking_substitution_active_guard' });
        await assert.rejects(db.query('DELETE FROM banquet_group_bookings WHERE booking_id=$1',[rootId]),
            { constraint: 'booking_substitution_active_guard' });
        await assert.rejects(db.query("UPDATE banquet_group_bookings SET role='manual' WHERE booking_id=$1",[rootId]),
            { constraint: 'booking_substitution_active_guard' });
        const detachLink = await authRequest('DELETE', `/api/bookings/${banquetPrimary}/banquet-links/${rootId}`);
        assert.equal(detachLink.status, 409, JSON.stringify(detachLink.data));
        assert.equal(detachLink.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        const cancelActivity = await authRequest('DELETE', `/api/banquets/${banquetId}/activities/${rootId}`);
        assert.equal(cancelActivity.status, 409, JSON.stringify(cancelActivity.data));
        assert.equal(cancelActivity.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        await db.query("UPDATE bookings SET line_id=$2,status='confirmed' WHERE id=$1", [overlapBooking,String(animators[2])]);
        const undoBanquet = { expectedVersion: 1, reason: 'Synthetic banquet restoration', requestKey: randomUUID() };
        await assert.rejects(service.mutate('event_genix', actor, 'cancel', undoBanquet, banquetClaim.id),
            { code: 'SUBSTITUTION_BOOKING_CONFLICT' });
        assert.equal((await booked(childId)).line_id, String(animators[1]));
        assert.equal((await service.history('event_genix',banquetClaim.id)).events.length, 1);
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [overlapBooking]);
        await service.mutate('event_genix', actor, 'cancel', undoBanquet, banquetClaim.id);
        assert.equal((await booked(childId)).line_id, String(animators[2]));
        assert.equal((await booked(rootId)).second_animator, names[2]);
        const primaryInput = { ...bookingInput, slotKey: 'primary', originalStaffId: animators[0] };
        const primaryQuote = await service.preview('event_genix', actor, primaryInput);
        assert.deepEqual(primaryQuote.blockers, []);
        const primary = await service.mutate('event_genix', actor, 'create', { input: primaryInput, requestKey: randomUUID(),
            previewFingerprint: primaryQuote.fingerprint, effectsAcknowledged: true });
        assert.equal((await booked(rootId)).line_id, String(animators[1]));
        assert.equal((await booked(childId)).line_id, String(animators[2]));
        const duplicateSlot = await service.preview('event_genix', actor, bookingInput);
        assert.ok(duplicateSlot.blockers.some(item => item.code === 'SUBSTITUTION_DUPLICATE_SLOT'));
        const deniedActor = { id: 991, username: 'synthetic_animator', role: 'animator' };
        await assert.rejects(service.preview('event_genix', deniedActor, bookingInput), { code: 'SUBSTITUTION_SOURCE_FORBIDDEN' });
        const doneBooking = await service.mutate('event_genix', actor, 'complete', { expectedVersion: 1, reason: 'Synthetic verified booking',
            requestKey: randomUUID(), workConfirmed: true, workEvidence: '60 minutes of animation' }, primary.id);
        assert.equal(doneBooking.completion.amountMinor, 75037);
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=ANY($1)", [[rootId, childId]]);
        assert.equal((await service.history('event_genix', primary.id)).substitution.completion.amountMinor, 75037);
        const bookingPayroll = await require('../../services/payroll').getPayrollPreview(animators[1], '2099-01', db);
        assert.equal(bookingPayroll.lines.filter(line => line.lineType === 'staff_substitution' && line.amount === 750.37).length, 2);
        for (const staffId of animators.slice(0, 2)) {
            const shift = (await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,profession_key)
                VALUES($1,'2099-01-20','09:00','18:00','animator') RETURNING id`, [staffId])).rows[0];
            await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end,sort_order)
                VALUES($1,'animator','09:00','17:00',0),($1,'animator','17:00','18:00',1)`, [shift.id]);
            await db.query(`INSERT INTO staff_schedule(staff_id,date,status,shift_start,shift_end)
                VALUES($1,'2099-01-20','working','09:00','18:00')`, [staffId]);
        }
        await require('../../services/staffScheduleMutations').reconcileAnimatorRosterDates(db, ['2099-01-20']);
        const animatorDate = '2099-01-23';
        const animatorShift = (await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,profession_key)
            VALUES($1,$2,'09:00','18:00','animator') RETURNING id`, [animators[0],animatorDate])).rows[0];
        await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end)
            VALUES($1,'animator','09:00','18:00')`, [animatorShift.id]);
        await db.query(`INSERT INTO staff_schedule(staff_id,date,status,shift_start,shift_end)
            VALUES($1,$2,'working','09:00','18:00')`, [animators[0],animatorDate]);
        await require('../../services/staffScheduleMutations').reconcileAnimatorRosterDates(db, [animatorDate]);
        const animatorInput = { ...hourly, sourceId: String(animatorShift.id), workDate: animatorDate, professionKey: 'animator',
            originalStaffId: animators[0], staffId: animators[1], temporaryAdmission: false,
            startsAt: '2099-01-23T13:00:00+02:00', endsAt: '2099-01-23T14:00:00+02:00' };
        const blockedBookingId = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,business_context,room,room_resource_id)
            VALUES($1,$2,'13:00',60,$3,'confirmed','event_genix','На виніс','room-takeaway')`, [blockedBookingId,animatorDate,String(animators[0])]);
        const blockedAnimatorQuote = await service.preview('event_genix', actor, animatorInput);
        assert.ok(blockedAnimatorQuote.blockers.some(item => item.code === 'SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT'));
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [blockedBookingId]);
        const animatorQuote = await service.preview('event_genix', actor, animatorInput);
        assert.deepEqual(animatorQuote.blockers, []);
        const animatorClaim = await service.mutate('event_genix', actor, 'create', { input: animatorInput,
            previewFingerprint: animatorQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        const roster = () => require('../../services/booking').getAnimatorTimelineLines(animatorDate, db);
        const windows = async staffId => (await roster()).find(line => line.staffId === staffId)?.availabilityWindows
            .map(item => [item.start,item.end]);
        assert.deepEqual(await windows(animators[0]), [['09:00','13:00'],['14:00','18:00']]);
        assert.deepEqual(await windows(animators[1]), [['13:00','14:00']]);
        await db.query("UPDATE bookings SET line_id=$2,status='confirmed' WHERE id=$1", [blockedBookingId,String(animators[1])]);
        const cancelAnimator = { expectedVersion: 1, reason: 'Synthetic animator restore', requestKey: randomUUID() };
        await assert.rejects(service.mutate('event_genix', actor, 'cancel', cancelAnimator, animatorClaim.id),
            { code: 'SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT' });
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [blockedBookingId]);
        await service.mutate('event_genix', actor, 'cancel', cancelAnimator, animatorClaim.id);
        assert.deepEqual(await windows(animators[0]), [['09:00','18:00']]);
        assert.equal(await windows(animators[1]), undefined);
        for (const originalTreatment of ['retain', 'transfer_unworked_scope']) {
            for (const payMode of ['additional', 'replace_base']) {
                const combination = await service.preview('event_genix', actor, { ...animatorInput, originalTreatment, payMode });
                assert.deepEqual(combination.blockers, [], JSON.stringify({ originalTreatment, payMode }));
                assert.equal(combination.payImpact.original.amountMinor, 10000);
                assert.equal(combination.payImpact.replacement.amountMinor, 10000);
            }
        }
        const paidAnimatorInput = { ...animatorInput, originalTreatment: 'retain', payMode: 'additional', rate: '125.37' };
        const paidAnimatorQuote = await service.preview('event_genix', actor, paidAnimatorInput);
        assert.deepEqual(paidAnimatorQuote.blockers, []);
        assert.equal(paidAnimatorQuote.payImpact.original.amountMinor, 10000);
        assert.equal(paidAnimatorQuote.payImpact.replacement.amountMinor, 10000);
        const paidAnimator = await service.mutate('event_genix', actor, 'create', { input: paidAnimatorInput,
            previewFingerprint: paidAnimatorQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        const finishAnimator = { expectedVersion: 1, reason: 'Synthetic approved premium',
            workConfirmed: true, workEvidence: 'Synthetic transferred animator hour', actualMinutes: 60 };
        await assert.rejects(service.mutate('event_genix', actor, 'complete',
            { ...finishAnimator, requestKey: randomUUID() }, paidAnimator.id), { code: 'SUBSTITUTION_ADDITIONAL_ATTENDANCE_REQUIRED' });
        await db.query('UPDATE staff SET hourly_rate=179 WHERE id=$1', [animators[0]]);
        const animatorAttendanceClient = await db.connect();
        try {
            await animatorAttendanceClient.query('BEGIN');
            const attendance = { staffId: animators[1], recordDate: animatorDate, performedBy: actor.username };
            await recordAttendanceClockIn(animatorAttendanceClient, { ...attendance, now: '2099-01-23T11:00:00Z' });
            await recordAttendanceClockOut(animatorAttendanceClient, { ...attendance, now: '2099-01-23T12:00:00Z', settlementMode: 'actual_time' });
            await animatorAttendanceClient.query('COMMIT');
        } catch (error) {
            await animatorAttendanceClient.query('ROLLBACK');
            throw error;
        } finally { animatorAttendanceClient.release(); }
        const finishedAnimator = await service.mutate('event_genix', actor, 'complete',
            { ...finishAnimator, requestKey: randomUUID() }, paidAnimator.id);
        assert.equal(finishedAnimator.completion.amountMinor, 12537);
        assert.equal(finishedAnimator.completion.originalPay.amountMinor, 10000);
        const { getPayrollRangePreview } = require('../../services/payroll');
        const range = { month: '2099-01', from: animatorDate, to: animatorDate };
        const replacementPreview = (await getPayrollRangePreview({ ...range, staffId: animators[1] }, db)).staff[0];
        assert.equal(replacementPreview.baseAmount, 100);
        assert.equal(replacementPreview.additionalAmount, 125.37);
        assert.equal(replacementPreview.grossAmount, 225.37);
        const originalPreview = (await getPayrollRangePreview({ ...range, staffId: animators[0] }, db)).staff[0];
        const retained = originalPreview.lines.filter(line => line.lineType === 'staff_substitution');
        assert.equal(retained.length, 1);
        assert.equal(retained[0].amount, 100);
        assert.equal(retained[0].group, 'base');
        assert.equal(originalPreview.baseAmount, 100);
        await db.query('UPDATE staff SET hourly_rate=193 WHERE id=$1', [animators[0]]);
        assert.equal((await db.query('SELECT id FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',
            [animators[0],animatorDate])).rowCount, 0);
        const remainingAttendance = await db.connect();
        try {
            await remainingAttendance.query('BEGIN');
            const attendance = { staffId: animators[0], recordDate: animatorDate, performedBy: actor.username };
            await recordAttendanceClockIn(remainingAttendance, { ...attendance, now: '2099-01-23T07:00:00Z' });
            await recordAttendanceClockOut(remainingAttendance, { ...attendance, now: '2099-01-23T16:00:00Z', settlementMode: 'actual_time' });
            await remainingAttendance.query('COMMIT');
        } catch (error) {
            await remainingAttendance.query('ROLLBACK');
            throw error;
        } finally { remainingAttendance.release(); }
        const refreshedOriginal = (await getPayrollRangePreview({ ...range, staffId: animators[0] }, db)).staff[0];
        assert.equal(refreshedOriginal.lines.filter(line => line.lineType === 'staff_substitution').length, 1);
        assert.equal(refreshedOriginal.lines.find(line => line.lineType === 'staff_substitution').amount, 100);
        assert.equal(refreshedOriginal.baseAmount, 8 * 193 + 100);
        assert.deepEqual(refreshedOriginal.payrollBlockingIssues, []);
        const baseBookingId = `SUB-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,price,hosts,label,room,room_resource_id,business_context)
            VALUES($1,'2099-01-20','17:00',60,$2,'confirmed',650,1,'Synthetic base replacement','На виніс','room-takeaway','event_genix')`,
        [baseBookingId, String(animators[0])]);
        const baseInput = { ...primaryInput, sourceId: baseBookingId, workDate: '2099-01-20',
            startsAt: '2099-01-20T17:00:00+02:00', endsAt: '2099-01-20T18:00:00+02:00',
            payUnit: 'hour', payMode: 'replace_base', rate: '200' };
        const baseQuote = await service.preview('event_genix', actor, baseInput);
        assert.deepEqual(baseQuote.blockers, []);
        const baseClaim = await service.mutate('event_genix', actor, 'create', { input: baseInput,
            previewFingerprint: baseQuote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() });
        assert.equal((await service.completionOptions('event_genix', baseClaim.id)).allocations.length, 0);
        const attendanceClient = await db.connect();
        try {
            await attendanceClient.query('BEGIN');
            const attendance = { staffId: animators[1], recordDate: '2099-01-20', performedBy: actor.username };
            await recordAttendanceClockIn(attendanceClient, { ...attendance, now: '2099-01-20T07:00:00Z' });
            await recordAttendanceClockOut(attendanceClient, { ...attendance, now: '2099-01-20T16:00:00Z', settlementMode: 'actual_time' });
            await attendanceClient.query('COMMIT');
        } catch (error) {
            await attendanceClient.query('ROLLBACK');
            throw error;
        } finally { attendanceClient.release(); }
        const baseOptions = await service.completionOptions('event_genix', baseClaim.id);
        assert.deepEqual(baseOptions.allocations.map(item => item.actualMinutes), [60]);
        assert.equal(baseOptions.allocations[0].startTime, '17:00');
        assert.equal(baseOptions.allocations[0].endTime, '18:00');
        await assert.rejects(service.mutate('event_genix', actor, 'complete', { expectedVersion: 1, reason: 'Invalid allocation',
            workConfirmed: true, workEvidence: 'Synthetic booked hour', actualMinutes: 60, attendanceId: baseOptions.attendanceId,
            baseAllocationIndices: [0], requestKey: randomUUID() }, baseClaim.id), { code: 'SUBSTITUTION_BASE_SCOPE_REQUIRED' });
        await service.mutate('event_genix', actor, 'complete', { expectedVersion: 1, reason: 'Synthetic allocated hour',
            workConfirmed: true, workEvidence: 'Synthetic booked hour', actualMinutes: 60, attendanceId: baseOptions.attendanceId,
            baseAllocationIndices: [baseOptions.allocations[0].index], requestKey: randomUUID() }, baseClaim.id);
        const replacedPayroll = (await getPayrollRangePreview({ month: '2099-01', from: '2099-01-20',
            to: '2099-01-20', staffId: animators[1] }, db)).staff[0];
        assert.equal(replacedPayroll.baseAmount, 800);
        assert.equal(replacedPayroll.lines.filter(line => line.lineType === 'staff_substitution' && line.amount === 200).length, 1);
        assert.deepEqual(replacedPayroll.payrollBlockingIssues, []);
        // Immutable accounting evidence stays in this disposable database, never a shared/live target.
    } finally { await db.end(); }
});

test('DAR substitutes one lesson occurrence and accrues teacher pay inside DAR', { skip: !enabled }, async () => {
    assert.equal(assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL).isLocal, true);
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
    const api = (method, path, body) => authRequest(method, `/api/staff-substitutions${path}${path.includes('?') ? '&' : '?'}businessContext=dar`, body);
    try {
        await db.query(`INSERT INTO settings(key,value) VALUES ('timeline_display:dar',$1)
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ mode: 'education' })]);
        const cabinet = await authRequest('PUT', '/api/business/cabinet?businessContext=dar',
            { businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' });
        assert.equal(cabinet.status, 200, JSON.stringify(cabinet.data));
        const teachers = (await db.query(`INSERT INTO staff(name,department,position,is_active)
            VALUES('QA DAR original','education','Teacher',true),('QA DAR replacement','education','Teacher',true),
                ('QA DAR outsider','education','Teacher',true) RETURNING id,name`)).rows;
        const [original, replacement, outsider] = teachers;
        await db.query("INSERT INTO education_teacher_memberships(business_context,staff_id) VALUES('dar',$1),('dar',$2)",
            [original.id, replacement.id]);
        const date = '2099-02-10';
        const lessonId = `DAR-${randomUUID()}`;
        const siblingId = `DAR-${randomUUID()}`;
        const seriesId = randomUUID();
        const lesson = { mode: 'education_lesson', teacherId: String(original.id), teacherName: original.name, title: 'Synthetic lesson', seriesId };
        const extra = { educationLesson: lesson, education_lesson: { ...lesson, legacyMarker: true },
            bookingWorkspace: { lesson: { ...lesson, workspaceMarker: true } } };
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,business_context,room,extra_data)
             VALUES($1,$3,'10:00',60,'edu-cabinet-1','confirmed','dar','Кабінет 1',$4),
                   ($2,$3,'11:00',60,'edu-cabinet-1','confirmed','dar','Кабінет 1',$4)`,
        [lessonId, siblingId, date, extra]);
        const input = { sourceType: 'education_lesson', sourceId: lessonId, workDate: date, staffId: replacement.id,
            originalStaffId: original.id, professionKey: 'teacher', startsAt: '2099-02-10T10:00:00+02:00',
            endsAt: '2099-02-10T11:00:00+02:00', payUnit: 'hour', payMode: 'additional', originalTreatment: 'retain',
            rateMode: 'individual', rate: '325.50', workload: 'Synthetic class', reason: 'Synthetic substitution',
            rateReason: 'Synthetic agreed rate' };
        const catalog = await api('GET', '/catalog');
        assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
        assert.deepEqual(catalog.data.data.staff.map(row => row.id).filter(id => teachers.some(teacher => teacher.id === id)).sort(),
            [original.id, replacement.id].sort());
        const sources = await api('GET', `/sources?sourceType=education_lesson&originalStaffId=${original.id}&workDate=${date}`);
        assert.equal(sources.status, 200, JSON.stringify(sources.data));
        assert.ok(sources.data.data.some(row => row.id === lessonId && row.startTime === '10:00'));
        const outside = await api('POST', '/preview', { input: { ...input, staffId: outsider.id } });
        assert.ok(outside.data.data?.blockers?.some(item => item.code === 'DAR_TEACHER_REQUIRED'));
        const preview = async terms => {
            const response = await api('POST', '/preview', { input: terms });
            assert.equal(response.status, 200, JSON.stringify(response.data));
            return response.data.data;
        };
        const rateInput = { staffId: replacement.id, effectiveFrom: '2099-02-01', payUnit: 'hour', rate: '320.25',
            reason: 'Synthetic dated rate' };
        const rate = await api('POST', '/teacher-rates', rateInput);
        assert.equal(rate.status, 200, JSON.stringify(rate.data));
        assert.equal((await api('POST', '/teacher-rates', rateInput)).data.data.rateMinor, 32025);
        assert.equal((await api('POST', '/teacher-rates', { ...rateInput, rate: '321' })).status, 409);
        const standard = await preview({ ...input, rateMode: 'standard' });
        assert.equal(standard.estimateMinor, 32025);
        assert.equal(standard.rate.source, 'dar_teacher_rate');
        const ratesPath = `/teacher-rates?staffId=${replacement.id}`;
        assert.equal((await api('GET', ratesPath)).data.data[0].rateMinor, 32025);
        assert.equal((await authRequest('GET', `/api/staff-substitutions${ratesPath}`)).status, 403);
        const quote = await preview(input);
        assert.deepEqual(quote.blockers, []);
        assert.equal(quote.estimateMinor, 32550);
        const request = { input, previewFingerprint: quote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() };
        const busyId = `DAR-${randomUUID()}`;
        await db.query(`INSERT INTO bookings(id,date,time,duration,line_id,status,business_context,room,extra_data)
            VALUES($1,$2,'10:30',60,'edu-cabinet-2','confirmed','dar','Кабінет 2',$3)`, [busyId, date,
            { educationLesson: { ...lesson, teacherId: String(replacement.id), teacherName: replacement.name } }]);
        assert.ok((await preview(input)).blockers.some(item => item.code === 'DAR_TEACHER_CONFLICT'));
        assert.equal((await api('POST', '/', request)).data.code, 'SUBSTITUTION_PREVIEW_STALE');
        await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [busyId]);
        const create = await api('POST', '/', request);
        assert.equal(create.status, 200, JSON.stringify(create.data));
        const id = create.data.data.id;
        assert.equal((await api('POST', '/', request)).data.data.id, id);
        const metadata = async bookingId => (await db.query('SELECT extra_data FROM bookings WHERE id=$1', [bookingId])).rows[0].extra_data;
        const updated = await metadata(lessonId);
        for (const entry of [updated.educationLesson, updated.education_lesson, updated.bookingWorkspace.lesson]) {
            assert.equal(entry.teacherId, String(replacement.id));
            assert.equal(entry.seriesId, seriesId);
        }
        assert.equal(updated.education_lesson.legacyMarker, true);
        assert.equal(updated.bookingWorkspace.lesson.workspaceMarker, true);
        assert.deepEqual(await metadata(siblingId), extra);
        await assert.rejects(db.query("UPDATE bookings SET time='10:15' WHERE id=$1", [lessonId]), { constraint: 'booking_substitution_active_guard' });
        assert.equal((await authRequest('GET', `/api/staff-substitutions/${id}/history`)).status, 404);
        const deleteLesson = await authRequest('DELETE', `/api/bookings/${lessonId}?businessContext=dar`);
        assert.equal(deleteLesson.status, 409, JSON.stringify(deleteLesson.data));
        assert.equal(deleteLesson.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        const cancelSeries = await authRequest('POST', `/api/bookings/education-series/${seriesId}/cancel?businessContext=dar`, { scope: 'all' });
        assert.equal(cancelSeries.status, 409, JSON.stringify(cancelSeries.data));
        assert.equal(cancelSeries.data.code, 'BOOKING_SUBSTITUTION_ACTIVE');
        assert.equal((await db.query('SELECT status FROM bookings WHERE id=$1', [siblingId])).rows[0].status, 'confirmed');
        const cancel = await api('POST', `/${id}/cancel`, { requestKey: randomUUID(), expectedVersion: 1, reason: 'Synthetic restore' });
        assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
        assert.deepEqual(await metadata(lessonId), extra);
        const second = await api('POST', '/', { ...request, requestKey: randomUUID(), previewFingerprint: (await preview(input)).fingerprint });
        assert.equal(second.status, 200);
        const newId = second.data.data.id;
        const finish = { expectedVersion: 1, requestKey: randomUUID(), reason: 'Synthetic confirmation',
            workConfirmed: true, workEvidence: 'Confirmed synthetic class', actualMinutes: 60 };
        const completed = await api('POST', `/${newId}/complete`, finish);
        assert.equal(completed.status, 200, JSON.stringify(completed.data));
        assert.equal(completed.data.data.completion.amountMinor, 32550);
        assert.deepEqual((await api('POST', `/${newId}/complete`, finish)).data, completed.data);
        const accruals = await api('GET', `/accruals?from=${date}&to=${date}`);
        assert.equal(accruals.status, 200);
        assert.equal(accruals.data.data.totalMinor, 32550);
        assert.equal(accruals.data.data.rows.length, 1);
        const park = await require('../../services/staffSubstitutionPayroll').loadPayrollSubstitutions(db, [replacement.id], date, date);
        assert.equal(park.size, 0);
        assert.ok((await preview({ ...input, originalStaffId: replacement.id, staffId: original.id })).blockers
            .some(item => item.code === 'SUBSTITUTION_DUPLICATE'));

        if (process.env.RUN_SUBSTITUTION_BROWSER === 'true') {
            const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
            const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
            try {
                const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
                const appOrigin = new URL(process.env.TEST_URL).origin;
                await context.route(url => url.origin !== appOrigin, route => route.abort());
                const page = await context.newPage();
                page.setDefaultTimeout(20000);
                await page.goto(process.env.TEST_URL, { waitUntil: 'commit' });
                await page.locator('#username').fill(process.env.TEST_USER);
                await page.locator('#password').fill(process.env.TEST_PASS);
                await page.locator('#loginForm button[type="submit"]').click();
                await page.locator('#mainApp').waitFor({ state: 'visible' });
                await page.goto(`${process.env.TEST_URL}/?businessContext=dar&date=${date}`, { waitUntil: 'commit' });
                const container = page.locator('#staffSubstitutionActions');
                await container.getByRole('button', { name: 'Підміни викладачів' }).waitFor();
                await container.getByRole('button', { name: 'Нарахування за підміни' }).click();
                const modal = page.locator('.form-modal-overlay:not(.confirm-exit)');
                await modal.locator('[data-key="from"]').fill(date);
                await modal.locator('[data-key="to"]').fill(date);
                await modal.getByRole('button', { name: 'Продовжити' }).click();
                await modal.getByText(/QA DAR replacement/).waitFor();
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                const output = require('node:path').join(__dirname, '../../output/substitution-browser');
                await require('node:fs/promises').mkdir(output, { recursive: true });
                await page.screenshot({ path: require('node:path').join(output, 'dar-actual-mobile-accruals.png') });
            } finally {
                await browser.close();
            }
        }
    } finally {
        await db.end();
    }
});
