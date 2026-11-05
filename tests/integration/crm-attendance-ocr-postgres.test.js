'use strict';
const {describe,it,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg');
const {assertSafeTestDatabaseUrl}=require('../../scripts/test-db-safety');
const {acquireIsolatedDatabaseLock}=require('../../scripts/run-isolated-postgres-tests');
const {createAttendanceOcrPreview}=require('../../services/crmAttendanceOcrPreview');
const {createAttendanceOcrApply}=require('../../services/crmAttendanceOcrApply');
const {reviewAttendanceDocument}=require('../../services/crmAttendanceOcr');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
describe('CRM actual attendance OCR durable preview',{skip:process.env.RUN_CRM_AUTOMATION_POSTGRES_INTEGRATION!=='true'},()=>{
 let pool,lock,actor,other,staff;const extraStaff=[];const tag='actual_ocr_'+randomUUID().slice(0,8);
 const env={CRM_ATTENDANCE_OCR_ENABLED:'true',CRM_ATTENDANCE_OCR_MODEL:'synthetic'};
 const input=date=>({actor,businessContext:'event_genix',confirmed:true,documentDate:date,file:{buffer:png,mimetype:'image/png'}});
 const review=date=>reviewAttendanceDocument({documentType:'attendance_sheet',documentDate:date,dateConfidence:0.99,pageNumber:2,pageCount:3,rows:[
  {sourceRowOrdinal:1,ocrName:staff.name,arrivalTime:'10:50',departureTime:'20:15',confidence:0.99,issues:[]},
  {sourceRowOrdinal:2,ocrName:'Synthetic blank',arrivalTime:null,departureTime:null,confidence:0.99,issues:[]}
 ]},date);
 before(async()=>{
  const target=assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL,process.env);assert.equal(target.isLocal,true);lock=await acquireIsolatedDatabaseLock(target);
  pool=new Pool({connectionString:target.url.toString(),ssl:false,max:4});
  assert.ok((await pool.query("SELECT to_regclass('crm_attendance_ocr_previews') AS name")).rows[0].name);
  for(const suffix of ['owner','other']){const row=(await pool.query("INSERT INTO users(username,password_hash,role,name) VALUES($1,'synthetic-not-login','manager','Synthetic OCR') RETURNING id",[tag+suffix])).rows[0];if(suffix==='owner')actor=row;else other=row;}
  staff=(await pool.query("INSERT INTO staff(name,display_name,department,position,role_type,hourly_rate,is_active,hr_pool_status,is_freelance) VALUES($1,$1,'Synthetic','Synthetic','wardrobe',100,true,'core',false) RETURNING id,name",[tag])).rows[0];
 });
 after(async()=>{try{if(pool){if(actor&&other){await pool.query('DELETE FROM crm_attendance_ocr_previews WHERE execution_id IN (SELECT id FROM crm_attendance_ocr_executions WHERE actor_user_id=ANY($1::int[]))',[[actor.id,other.id]]);await pool.query('DELETE FROM crm_attendance_ocr_executions WHERE actor_user_id=ANY($1::int[])',[[actor.id,other.id]]);}for(const fixture of [staff,...extraStaff].filter(Boolean)){await pool.query('DELETE FROM hr_audit_log WHERE staff_id=$1',[fixture.id]);await pool.query('DELETE FROM staff_schedule WHERE staff_id=$1',[fixture.id]);await pool.query('DELETE FROM staff WHERE id=$1',[fixture.id]);}if(actor&&other)await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[[actor.id,other.id]]);}}finally{if(pool)await pool.end();if(lock)await lock.release();}});

 const applyInput=preview=>({actor,businessContext:'event_genix',confirmed:true,previewId:preview.previewId,previewHash:preview.previewHash,selectedRowOrdinals:[1]});
 const applyService=now=>createAttendanceOcrApply({pool,env,now:()=>now||'2100-01-01T12:00:00Z'});
 const makePreview=async date=>createAttendanceOcrPreview({pool,env,recognize:async()=>review(date)}).preview(input(date));

 it('OCR confirmed apply preserves both columns through canonical attendance and mirrors; retries do not write twice',async()=>{
  const date='2099-10-20',preview=await makePreview(date),apply=applyService();
  const result=await apply(applyInput(preview));assert.equal(result.attendanceWrites,1);assert.equal(result.scheduleWrites,0);
  assert.equal(result.appliedRows[0].departureTime,'20:15');
  const record=(await pool.query("SELECT *,to_char(clock_in AT TIME ZONE 'Europe/Kyiv','HH24:MI') AS arrival,to_char(clock_out AT TIME ZONE 'Europe/Kyiv','HH24:MI') AS departure FROM hr_time_records WHERE staff_id=$1 AND record_date=$2",[staff.id,date])).rows[0];
  assert.equal(record.arrival,'10:50');assert.equal(record.departure,'20:15');assert.equal(record.total_worked_minutes,565);
  assert.equal(record.compensation_snapshot.state,'final');assert.equal(record.compensation_snapshot.manualReview,false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM staff_checkins WHERE staff_id=$1 AND date=$2',[staff.id,date])).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM staff_schedule WHERE staff_id=$1 AND date=$2',[staff.id,date])).rows[0].n,0);
  assert.equal((await apply(applyInput(preview))).reused,true);
  await assert.rejects(apply({...applyInput(preview),selectedRowOrdinals:[1,2]}),{code:'CRM_ATTENDANCE_OCR_ROWS_REQUIRE_REVIEW'});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM hr_audit_log WHERE staff_id=$1 AND action='clock_out'",[staff.id])).rows[0].n,1);
 });

 it('OCR apply rejects forged, unconfirmed, foreign and changed-compensation previews before attendance writes',async()=>{
  const date='2099-10-21',preview=await makePreview(date),apply=applyService();
  await assert.rejects(apply({...applyInput(preview),confirmed:false}),{code:'CRM_EXECUTION_CONFIRMATION_REQUIRED'});
  await assert.rejects(apply({...applyInput(preview),actor:other}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND'});
  await assert.rejects(apply({...applyInput(preview),previewHash:'0'.repeat(64)}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_STALE'});
  await assert.rejects(apply({...applyInput(preview),selectedRowOrdinals:[1,1]}),{code:'CRM_ATTENDANCE_OCR_APPLY_INVALID'});
  await pool.query('UPDATE staff SET hourly_rate=120 WHERE id=$1',[staff.id]);
  try{await assert.rejects(apply(applyInput(preview)),{code:'CRM_ATTENDANCE_OCR_PREVIEW_STALE'});}
  finally{await pool.query('UPDATE staff SET hourly_rate=100 WHERE id=$1',[staff.id]);}
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staff.id,date])).rows[0].n,0);
 });

 it('OCR apply holds closed periods and reviewed payroll history without reopening or overwriting them',async()=>{
  const date='2099-12-10',preview=await makePreview(date),apply=applyService();
  await pool.query("INSERT INTO payroll_period_locks(period_month,is_locked) VALUES('2099-12',true)");
  try{await assert.rejects(apply(applyInput(preview)),{code:'CRM_ATTENDANCE_OCR_PERIOD_CLOSED'});}
  finally{await pool.query("DELETE FROM payroll_period_locks WHERE period_month='2099-12'");}
  const report=(await pool.query("INSERT INTO payroll_reports(period_month,staff_id,status) VALUES('2099-12',$1,'approved') RETURNING id",[staff.id])).rows[0];
  try{await assert.rejects(apply(applyInput(preview)),{code:'CRM_ATTENDANCE_OCR_HISTORY_LOCKED'});}
  finally{await pool.query('DELETE FROM payroll_reports WHERE id=$1',[report.id]);}
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staff.id,date])).rows[0].n,0);
 });

 it('OCR apply rolls back the first full canonical pair when a later selected pair fails',async()=>{
  const second=(await pool.query("INSERT INTO staff(name,display_name,department,position,role_type,hourly_rate,is_active,hr_pool_status,is_freelance) VALUES($1,$1,'Synthetic','Synthetic','wardrobe',100,true,'core',false) RETURNING id,name",[tag+'second'])).rows[0];extraStaff.push(second);
  const date='2099-10-26',doc={...review(date),dateConfidence:0.99,rows:[
   {sourceRowOrdinal:1,ocrName:staff.name,arrivalTime:'10:00',departureTime:'11:00',confidence:0.99,issues:[]},
   {sourceRowOrdinal:2,ocrName:second.name,arrivalTime:'13:00',departureTime:'14:00',confidence:0.99,issues:[]} ]};
  const service=createAttendanceOcrPreview({pool,env,recognize:async()=>reviewAttendanceDocument(doc,date)}),preview=await service.preview(input(date));
  const before=(await pool.query('SELECT count(*)::int AS n FROM hr_audit_log WHERE staff_id=ANY($1::int[])',[[staff.id,second.id]])).rows[0].n;
  await assert.rejects(applyService(date+'T09:30:00Z')({...applyInput(preview),selectedRowOrdinals:[1,2]}),{code:'CRM_ATTENDANCE_OCR_TIME_REQUIRES_REVIEW'});
  for(const [table,column] of [['hr_time_records','record_date'],['staff_checkins','date']])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE staff_id=ANY($1::int[]) AND ${column}=$2`,[[staff.id,second.id],date])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_audit_log WHERE staff_id=ANY($1::int[])',[[staff.id,second.id]])).rows[0].n,before);
  assert.equal((await pool.query('SELECT applied_at FROM crm_attendance_ocr_previews WHERE id=$1',[preview.previewId])).rows[0].applied_at,null);
 });

 it('OCR apply never overwrites attendance created after preview',async()=>{
  const date='2099-10-22',preview=await makePreview(date);
  await pool.query("INSERT INTO hr_time_records(staff_id,record_date,clock_in,status) VALUES($1,$2,$3,'present')",[staff.id,date,date+'T08:00:00Z']);
  await assert.rejects(applyService()(applyInput(preview)),{code:'CRM_ATTENDANCE_OCR_PREVIEW_STALE'});
  const existing=(await pool.query('SELECT clock_in,clock_out FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staff.id,date])).rows[0];
  assert.equal(existing.clock_in.toISOString(),date+'T08:00:00.000Z');assert.equal(existing.clock_out,null);
 });

 it('OCR apply rejects expired, future and DST-transition days before business writes',async()=>{
  const date='2099-10-23',preview=await makePreview(date),expiredId=randomUUID();
  await pool.query(`INSERT INTO crm_attendance_ocr_previews(id,execution_id,revision,preview_rows,state_snapshot,preview_hash,created_at,expires_at)
   SELECT $1,execution_id,2,preview_rows,state_snapshot,preview_hash,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour' FROM crm_attendance_ocr_previews WHERE id=$2`,[expiredId,preview.previewId]);
  await assert.rejects(applyService()({...applyInput(preview),previewId:expiredId}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_EXPIRED'});
  await assert.rejects(applyService('2099-10-22T12:00:00Z')(applyInput(preview)),{code:'CRM_ATTENDANCE_OCR_FUTURE_DATE'});
  const transition=await makePreview('2026-10-25');
  await assert.rejects(applyService()(applyInput(transition)),{code:'CRM_ATTENDANCE_OCR_TIME_REQUIRES_REVIEW'});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date=ANY($2::date[])',[staff.id,[date,'2026-10-25']])).rows[0].n,0);
 });

 it('OCR concurrent applies create one attendance pair; a serialized retry replays the result',async()=>{
  const date='2099-10-24',preview=await makePreview(date),apply=applyService();
  const outcomes=await Promise.allSettled([apply(applyInput(preview)),apply(applyInput(preview))]);
  assert.ok(outcomes.some(result=>result.status==='fulfilled'));
  for(const result of outcomes)if(result.status==='rejected')assert.equal(result.reason.code,'40001');
  assert.equal((await apply(applyInput(preview))).reused,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staff.id,date])).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM staff_checkins WHERE staff_id=$1 AND date=$2',[staff.id,date])).rows[0].n,1);
 });

 it('OCR reserves before provider outside transaction, reopens after provider/model change and writes no attendance',async()=>{
  let calls=0;const date='2099-10-11';
  const service=createAttendanceOcrPreview({pool,env:{...env},recognize:async({onReceipt})=>{
   calls++;const prior=await pool.query("SELECT * FROM crm_attendance_ocr_executions WHERE actor_user_id=$1 AND document_date=$2",[actor.id,date]);
   assert.equal(prior.rowCount,1);assert.equal(prior.rows[0].status,'reserved');
   await onReceipt({provider:'kie',model:'synthetic',creditsConsumed:0.1,private:'must-not-persist'});return review(date);
  }});
  const first=await service.preview(input(date));assert.equal(first.rows[0].arrivalTime,'10:50');assert.equal(first.rows[0].departureTime,'20:15');
  assert.equal(first.rows[1].classification,'empty_unknown');assert.equal(first.applyAllowed,false);
  const reopened=createAttendanceOcrPreview({pool,env:{...env,CRM_ATTENDANCE_OCR_MODEL:'changed-without-key'},recognize:()=>assert.fail('paid replay')});
  assert.equal((await reopened.preview(input(date))).previewId,first.previewId);assert.equal(calls,1);
  const saved=await reopened.getPreview({actor,businessContext:'event_genix',previewId:first.previewId});
  assert.equal(saved.rows[0].departureTime,'20:15');assert.equal(saved.documentDate,date);assert.equal(saved.state_snapshot,undefined);
  await assert.rejects(reopened.getPreview({actor:other,businessContext:'event_genix',previewId:first.previewId}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND'});
  const stored=(await pool.query('SELECT provider_receipt FROM crm_attendance_ocr_executions WHERE actor_user_id=$1 AND document_date=$2',[actor.id,date])).rows[0];
  assert.equal(stored.provider_receipt.private,undefined);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hr_time_records WHERE staff_id=$1 AND record_date=$2',[staff.id,date])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM staff_schedule WHERE staff_id=$1 AND date=$2',[staff.id,date])).rows[0].n,0);
  await assert.rejects(pool.query("UPDATE crm_attendance_ocr_previews SET preview_rows='[]' WHERE id=$1",[first.previewId]),/immutable/);
  await assert.rejects(pool.query("UPDATE crm_attendance_ocr_executions SET model='different' WHERE actor_user_id=$1 AND document_date=$2",[actor.id,date]),/immutable/);
 });

 it('OCR keeps old preview immutable and creates a new conflict snapshot without another paid call',async()=>{
  const date='2099-10-12';let calls=0;
  const service=createAttendanceOcrPreview({pool,env,recognize:async()=>{calls++;return review(date);}});
  const first=await service.preview(input(date));assert.equal(first.rows[0].classification,'ready_for_confirmed_apply');
  await pool.query("INSERT INTO staff_schedule(staff_id,date,status) VALUES($1,$2,'dayoff')",[staff.id,date]);
  await assert.rejects(service.refreshPreview({actor:other,businessContext:'event_genix',previewId:first.previewId}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND'});
  const next=await service.refreshPreview({actor,businessContext:'event_genix',previewId:first.previewId});assert.notEqual(next.previewId,first.previewId);
  assert.equal(next.rows[0].classification,'schedule_conflict');assert.equal(calls,1);
  const old=(await pool.query('SELECT preview_rows FROM crm_attendance_ocr_previews WHERE id=$1',[first.previewId])).rows[0];
  assert.equal(old.preview_rows[0].classification,'ready_for_confirmed_apply');
  // Metadata-only fixture assertion; this is not a claim that actual apply exists.
  await pool.query("UPDATE crm_attendance_ocr_previews SET applied_at=NOW(),apply_result='{}' WHERE id=$1",[first.previewId]);
  await assert.rejects(pool.query("UPDATE crm_attendance_ocr_previews SET applied_at=NOW(),apply_result='{}' WHERE id=$1",[next.previewId]),/idx_crm_attendance_ocr_applied_once/);
  await assert.rejects(service.refreshPreview({actor,businessContext:'event_genix',previewId:next.previewId}),{code:'CRM_ATTENDANCE_OCR_ALREADY_APPLIED'});
  assert.equal((await service.getPreview({actor,businessContext:'event_genix',previewId:next.previewId})).applied,true);
 });

 it('OCR recovery cannot start paid work and resumes saved review even if no preview survived',async()=>{
  const date='2099-10-27';let calls=0;
  const service=createAttendanceOcrPreview({pool,env,recognize:async()=>{calls++;return review(date);}});
  const source={actor,businessContext:'event_genix',documentDate:date,imageSha256:createHash('sha256').update(png).digest('hex')};
  await assert.rejects(service.recoverPreview(source),{code:'CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND'});assert.equal(calls,0);
  const first=await service.preview(input(date));assert.equal((await service.recoverPreview(source)).previewId,first.previewId);
  await assert.rejects(service.recoverPreview({...source,actor:other}),{code:'CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND'});
  await pool.query('DELETE FROM crm_attendance_ocr_previews WHERE id=$1',[first.previewId]);
  const restarted=createAttendanceOcrPreview({pool,env:{CRM_ATTENDANCE_OCR_ENABLED:'true'},recognize:()=>assert.fail('recovery must not call provider')});
  assert.notEqual((await restarted.recoverPreview(source)).previewId,first.previewId);assert.equal(calls,1);
  await assert.rejects(service.recoverPreview({...source,documentDate:'2026-02-30'}),{code:'CRM_ATTENDANCE_OCR_APPLY_INVALID'});
 });

 it('OCR expired preview remains readable and refreshes from saved review without source image or provider',async()=>{
  const date='2099-10-19',service=createAttendanceOcrPreview({pool,env,recognize:async()=>review(date)});
  const first=await service.preview(input(date));
  const expiredId=randomUUID();
  await pool.query(`INSERT INTO crm_attendance_ocr_previews
   (id,execution_id,revision,preview_rows,state_snapshot,preview_hash,created_at,expires_at)
   SELECT $1,execution_id,2,preview_rows,state_snapshot,preview_hash,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour'
   FROM crm_attendance_ocr_previews WHERE id=$2`,[expiredId,first.previewId]);
  const restarted=createAttendanceOcrPreview({pool,env:{CRM_ATTENDANCE_OCR_ENABLED:'true'},recognize:()=>assert.fail('refresh must never charge')});
  assert.equal((await restarted.getPreview({actor,businessContext:'event_genix',previewId:expiredId})).expired,true);
  await assert.rejects(restarted.preview(input(date)),{code:'CRM_ATTENDANCE_OCR_PREVIEW_EXPIRED'});
  const refreshed=await restarted.refreshPreview({actor,businessContext:'event_genix',previewId:expiredId});
  assert.notEqual(refreshed.previewId,expiredId);assert.equal(refreshed.documentDate,date);
  assert.equal(refreshed.rows[0].departureTime,'20:15');assert.equal(refreshed.applyAllowed,false);
  assert.equal((await restarted.getPreview({actor,businessContext:'event_genix',previewId:expiredId})).expired,true);
 });

 it('OCR unknown provider outcome survives process recreation and blocks resubmission',async()=>{
  const date='2099-10-13';let calls=0;
  const service=createAttendanceOcrPreview({pool,env,recognize:async()=>{calls++;throw Error('synthetic timeout');}});
  await assert.rejects(service.preview(input(date)),{code:'CRM_OCR_EXECUTION_REQUIRES_REVIEW'});
  await assert.rejects(createAttendanceOcrPreview({pool,env,recognize:()=>assert.fail('repeat')}).preview(input(date)),{code:'CRM_OCR_EXECUTION_REQUIRES_REVIEW'});
  assert.equal(calls,1);assert.equal((await pool.query('SELECT status FROM crm_attendance_ocr_executions WHERE actor_user_id=$1 AND document_date=$2',[actor.id,date])).rows[0].status,'unknown');
 });

 it('OCR concurrent sessions cannot submit a second paid request while the first is in flight',async()=>{
  const date='2099-10-15';let release,entered;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});let calls=0;
  const service=createAttendanceOcrPreview({pool,env,recognize:async()=>{calls++;entered();await gate;return review(date);}});
  const first=service.preview(input(date));
  try {await started;await assert.rejects(service.preview(input(date)),{code:'CRM_PROVIDER_BUSY'});assert.equal(calls,1);}
  finally {release();await first;}
 });

 it('OCR rejects invalid context, missing confirmation and missing provider config before reservation',async()=>{
  const service=createAttendanceOcrPreview({pool,env});const date='2099-10-14';
  await assert.rejects(service.preview({...input(date),businessContext:'other'}),{code:'CRM_ATTENDANCE_OCR_CONTEXT_FORBIDDEN'});
  await assert.rejects(service.preview({...input(date),confirmed:false}),{code:'CRM_EXECUTION_CONFIRMATION_REQUIRED'});
  await assert.rejects(service.preview(input(date)),{code:'CRM_OCR_PROVIDER_NOT_CONFIGURED'});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM crm_attendance_ocr_executions WHERE document_date=$1 AND actor_user_id=$2',[date,actor.id])).rows[0].n,0);
 });

 it('OCR unresolved paid work across owners blocks a fourth reservation before spending',async()=>{
  for(const date of ['2099-10-16','2099-10-17'])await pool.query(`INSERT INTO crm_attendance_ocr_executions
   (id,business_context,actor_user_id,document_date,image_sha256,provider,model,status)
   VALUES($1,'event_genix',$2,$3,$4,'kie','synthetic','unknown')`,[randomUUID(),other.id,date,'a'.repeat(64)]);
  const service=createAttendanceOcrPreview({pool,env,recognize:()=>assert.fail('capacity must fail before provider')});
  await assert.rejects(service.preview(input('2099-10-18')),{code:'CRM_PROVIDER_BUSY'});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM crm_attendance_ocr_executions WHERE actor_user_id=$1 AND document_date='2099-10-18'",[actor.id])).rows[0].n,0);
 });
});
