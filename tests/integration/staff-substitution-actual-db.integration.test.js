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
        assert.ok((await service.preview('event_genix',actor,hrInput)).blockers.some(item=>item.code==='SUBSTITUTION_SHIFT_RETAIN_UNSUPPORTED'));
        hrInput.originalTreatment='transfer_unworked_scope';
        const hrQuote=await service.preview('event_genix',actor,hrInput);
        assert.deepEqual(hrQuote.blockers,[]);
        const assigned=await service.mutate('event_genix',actor,'create',{input:hrInput,previewFingerprint:hrQuote.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
        assert.equal((await db.query('SELECT staff_id FROM hr_shifts WHERE id=$1',[shift.id])).rows[0].staff_id,staff.id);
        await assert.rejects(db.query("UPDATE hr_shifts SET planned_end='14:00' WHERE id=$1",[shift.id]),{code:'23514'});
        await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,reason:'Synthetic restore',requestKey:randomUUID()},assigned.id);
        assert.equal((await db.query('SELECT staff_id FROM hr_shifts WHERE id=$1',[shift.id])).rows[0].staff_id,original.id);
        assert.equal((await db.query('SELECT staff_id FROM staff_schedule WHERE staff_id=$1 AND date=$2',[original.id,'2099-01-14'])).rows.length,1);
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
        const animators=[];
        for(let i=0;i<3;i++) {
            const person=(await db.query(`INSERT INTO staff(name,role_type,department,position,is_active,hourly_rate,rate_unit,hr_pool_status,is_freelance)
                VALUES($1,'animator','animators','Synthetic animator',true,100,'hour','core',false) RETURNING id`,[`QA Animator ${i}`])).rows[0];
            const day=(await db.query(`INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key)
                VALUES($1,'2099-01-17','09:00','18:00',0,'animator') RETURNING id`,[person.id])).rows[0];
            await db.query(`INSERT INTO hr_shift_segments(hr_shift_id,profession_key,planned_start,planned_end) VALUES($1,'animator','09:00','18:00')`,[day.id]);
            await db.query(`INSERT INTO staff_schedule(staff_id,date,status,shift_start,shift_end) VALUES($1,'2099-01-17','working','09:00','18:00')`,[person.id]);
            animators.push(person.id);
        }
        await require('../../services/staffScheduleMutations').reconcileAnimatorRosterDates(db,['2099-01-17']);
        for(const [slotKey,hour] of [['primary',13],['second',14]]) {
            const event=(await db.query(`INSERT INTO afisha(date,time,title,duration,type,line_id,second_line_id)
                VALUES('2099-01-17',$1,'Synthetic substitution event',60,'event',$2,$3) RETURNING id`,
            [`${hour}:00`,String(slotKey==='primary'?animators[0]:animators[2]),String(slotKey==='primary'?animators[2]:animators[0])])).rows[0];
            const assignment={...input,staffId:animators[1],originalStaffId:animators[0],professionKey:'animator',temporaryAdmission:false,
                sourceType:'afisha',sourceId:String(event.id),slotKey,workDate:'2099-01-17',originalTreatment:'retain',
                startsAt:`2099-01-17T${hour}:00:00+02:00`,endsAt:`2099-01-17T${hour+1}:00:00+02:00`,allowConcurrent:true,concurrentReason:'Event inside approved animator shift'};
            const quoted=await service.preview('event_genix',actor,assignment);
            assert.deepEqual(quoted.blockers,[],slotKey);
            const savedRow=await service.mutate('event_genix',actor,'create',{input:assignment,previewFingerprint:quoted.fingerprint,effectsAcknowledged:true,requestKey:randomUUID()});
            const field=slotKey==='primary'?'line_id':'second_line_id';
            assert.equal(String((await db.query(`SELECT ${field} AS owner FROM afisha WHERE id=$1`,[event.id])).rows[0].owner),String(animators[1]));
            await service.mutate('event_genix',actor,'cancel',{expectedVersion:1,reason:'Synthetic restore',requestKey:randomUUID()},savedRow.id);
            assert.equal(String((await db.query(`SELECT ${field} AS owner FROM afisha WHERE id=$1`,[event.id])).rows[0].owner),String(animators[0]));
        }
        // Immutable accounting evidence stays in this disposable database, never a shared/live target.
    } finally { await db.end(); }
});
