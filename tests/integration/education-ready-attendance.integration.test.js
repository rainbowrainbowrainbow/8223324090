'use strict';
const {before,after,test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const {DATABASES,assertLocalTarget,seedDataset,buildPlan,expectedReport}=require('../../scripts/lib/education-ready-dataset');
let pool,manifest,token,secondToken;const secondName='education_serial_operator';
async function request(method,route,body,auth=token,expected=200) {
 const response=await fetch(process.env.TEST_URL+route,{method,headers:{Authorization:'Bearer '+(auth||''),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(expected!==null)assert.equal(response.status,expected,data.error||route);
 return expected===null?{status:response.status,data}:data;
}
const endpoint=(id,context='dar')=>'/api/education/attendance/'+id+'?businessContext='+context;
const read=async(id,context='dar')=>(await request('GET',endpoint(id,context))).journal;
const write=(id,revision,marks,expected=200,auth=token)=>request('PUT',endpoint(id),{revision,marks},auth,expected);
async function durable(id) {return {
 rows:(await pool.query('SELECT * FROM education_attendance WHERE booking_id=$1 ORDER BY id',[id])).rows,
 history:(await pool.query('SELECT h.* FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 ORDER BY h.id',[id])).rows};}
before(async()=>{
 assertLocalTarget('fixed');assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
 pool=new Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,ssl:false});
 manifest=(await seedDataset(pool,'fixed')).manifest;
 const login=await request('POST','/api/auth/login',{username:process.env.TEST_USER,password:process.env.TEST_PASS},'');token=login.accessToken||login.token;
 const password=crypto.randomBytes(24).toString('base64url');
 await request('POST','/api/users',{username:secondName,password,name:'Оператор Андрій',role:'creator',businessContexts:['dar'],defaultBusinessContext:'dar'});
 const second=await request('POST','/api/auth/login',{username:secondName,password},'');secondToken=second.accessToken||second.token;
});
after(async()=>{await pool?.end();});
test('canonical/legacy reports: independent totals, held/cancelled/future, archived groups, isolation',async()=>{
 const plan=buildPlan('fixed');
 for(const [key,format,canonical] of [['robots-1','education_lesson',undefined],['arts-1','bookingWorkspace',undefined],['archive-0','education_lesson',null],['school-0','education_lesson',false],['school-1','education_lesson',0],['english-1','education_lesson','']]) {
  const id=manifest.ids.bookings[key],extra=(await pool.query('SELECT extra_data FROM bookings WHERE id=$1',[id])).rows[0].extra_data,lesson=extra.educationLesson;
  delete extra.educationLesson;if(canonical!==undefined)extra.educationLesson=canonical;
  if(format==='bookingWorkspace')extra.bookingWorkspace={lesson};else extra[format]=lesson;
  await pool.query('UPDATE bookings SET extra_data=$2 WHERE id=$1',[id,extra]);assert.equal((await read(id)).booking.groupId,lesson.groupId);
 }
 await pool.query("UPDATE bookings SET extra_data=jsonb_set(extra_data,'{education_lesson}',$2::jsonb) WHERE id=$1",[manifest.ids.bookings['english-0'],JSON.stringify({groupId:manifest.ids.groups.robots,title:'Lower priority',groupName:'Lower priority'})]);
 const from='2026-08-01',to='2026-11-01';
 for(const group of [null,'english','robots','arts','school','archive']) {
  const report=(await request('GET','/api/education/reports?businessContext=dar&from='+from+'&to='+to+(group?'&groupId='+manifest.ids.groups[group]:''))).report;
  const expected=expectedReport(plan,'dar',from,to,group,'2026-10-03',720);assert.deepEqual(report.summary,expected.summary);assert.equal(report.lessons.length,expected.lessonCount);
  const ids=plan.lessons.filter(l=>l.context==='dar'&&l.date>=from&&l.date<=to&&(!group||l.groupKey===group)).map(l=>manifest.ids.bookings[l.key]).sort();assert.deepEqual(report.lessons.map(l=>l.bookingId).sort(),ids);
  for(const lesson of report.lessons) {
   const raw=(await pool.query('SELECT date::text,time,duration,status FROM bookings WHERE id=$1',[lesson.bookingId])).rows[0];
   const minutes=Number(raw.time.slice(0,2))*60+Number(raw.time.slice(3,5))+raw.duration;
   assert.equal(lesson.phase,raw.status==='cancelled'?'cancelled':raw.date<'2026-10-03'||raw.date==='2026-10-03'&&minutes<=720?'held':'scheduled');
   const rows=(await pool.query('SELECT status FROM education_attendance WHERE booking_id=$1',[lesson.bookingId])).rows,counts={present:0,absent:0,excused:0,unmarked:0};
   for(const r of rows)counts[r.status||'unmarked']++;assert.deepEqual(lesson.counts,counts);assert.equal(lesson.journalStarted,rows.length>0);
  }
 }
 const second=(await request('GET','/api/education/reports?businessContext=maysternya_doli&from='+from+'&to='+to)).report;
 assert.deepEqual(second.summary,expectedReport(plan,'maysternya_doli',from,to,null,'2026-10-03',720).summary);
 await request('GET','/api/education/reports?businessContext=dar&from='+from+'&to='+to+'&groupId='+manifest.ids.groups.secondary,undefined,token,404);
 const textId=manifest.ids.bookings['english-1'];
 await pool.query("UPDATE bookings SET extra_data=jsonb_set(extra_data,'{educationLesson}',$2::jsonb) WHERE id=$1",[textId,JSON.stringify({title:'Text-only group',groupName:'Англійська'})]);
 await request('GET',endpoint(textId),undefined,token,409);
 assert.ok(!(await request('GET','/api/education/reports?businessContext=dar&from='+from+'&to='+to)).report.lessons.some(l=>l.bookingId===textId));
});
test('frozen snapshots ignore later source name and backdated membership changes',async()=>{
 const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1'],original=await read(id);assert.equal(original.frozen,true);
 const snapshot=j=>j.members.map(m=>[m.child_id,m.child_name,m.parent_name,m.snapshot_at]),frozen=snapshot(original);
 await pool.query("UPDATE customer_children SET name='Данило після зміни імені' WHERE id=$1",[child]);
 await pool.query("UPDATE education_group_members SET end_date='2026-09-01' WHERE group_id=$1 AND child_id=$2",[manifest.ids.groups.english,child]);
 const current=await read(id);assert.equal(current.revision,original.revision);assert.deepEqual(snapshot(current),frozen);
 assert.deepEqual(snapshot((await write(id,current.revision,[{childId:Number(child),status:'excused'}])).journal),frozen);
});
test('two operators at SQL lock barrier: one200, one409, one exact history event',async()=>{
 const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1'],initial=await read(id),before=await durable(id),blocker=await pool.connect();let calls=[];
 try {
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[id]);
  calls=['present','absent'].map((status,i)=>write(id,initial.revision,[{childId:Number(child),status}],null,i?secondToken:token));
  const deadline=Date.now()+10000;let waiters=0;
  while(waiters<2&&Date.now()<deadline){waiters=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;await new Promise(setImmediate);}
  assert.equal(waiters,2);await blocker.query('COMMIT');const results=await Promise.all(calls);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(results.find(r=>r.status===409).data.code,'EDUCATION_JOURNAL_STALE');
  const after=await durable(id);assert.equal(after.history.length,before.history.length+1);
  const winner=results.findIndex(r=>r.status===200),last=after.history.at(-1),row=after.rows.find(r=>Number(r.child_id)===Number(child));
  assert.equal(last.changed_by,winner?secondName:process.env.TEST_USER);assert.ok(last.changed_at);
  assert.equal(row.status,winner?'absent':'present');assert.equal(row.marked_by,last.changed_by);assert.deepEqual(row.marked_at,last.changed_at);
  assert.equal((await read(id)).revision,results[winner].data.journal.revision);
 }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled(calls);}
});
test('missing revision, already-applied stale retry, fresh identical save and ABA are atomic',async()=>{
 const id=manifest.ids.bookings['arts-3'],initial=await read(id),child=initial.members[0].child_id,before=await durable(id);
 await request('PUT',endpoint(id),{marks:[{childId:child,status:'absent'}]},token,400);assert.deepEqual(await durable(id),before);
 const marks=[{childId:child,status:initial.members[0].status==='excused'?'absent':'excused'}],applied=await write(id,initial.revision,marks),after=await durable(id);
 await write(id,initial.revision,marks,409);assert.deepEqual(await durable(id),after);
 const repeated=await write(id,applied.journal.revision,marks);assert.equal(repeated.changes,0);assert.equal(repeated.journal.revision,applied.journal.revision);assert.deepEqual(await durable(id),after);
 const restored=await write(id,repeated.journal.revision,[{childId:child,status:initial.members[0].status}]);assert.notEqual(restored.journal.revision,initial.revision);
 const aba=await durable(id);await write(id,initial.revision,marks,409);assert.deepEqual(await durable(id),aba);
});
test('first freeze, changed preview roster and invalid member rollback leave no partial records',async()=>{
 const id=manifest.ids.bookings['robots-4'],initial=await read(id);assert.equal(initial.frozen,false);
 const child=initial.members[0].child_id,membership=(await pool.query('SELECT id,end_date FROM education_group_members WHERE group_id=$1 AND child_id=$2',[manifest.ids.groups.robots,child])).rows[0];
 await pool.query("UPDATE education_group_members SET end_date='2026-10-02' WHERE id=$1",[membership.id]);
 const empty=await durable(id);await write(id,initial.revision,[],409);assert.deepEqual(await durable(id),empty);
 await pool.query('UPDATE education_group_members SET end_date=$2 WHERE id=$1',[membership.id,membership.end_date]);
 const preview=await read(id);await write(id,preview.revision,[{childId:manifest.ids.children['child-23'],status:'present'}],404);assert.deepEqual(await durable(id),empty);
 const frozen=await write(id,preview.revision,[]);assert.equal(frozen.changes,0);assert.equal(frozen.journal.frozen,true);
 const state=await durable(id);assert.equal(state.rows.length,preview.members.length);assert.equal(state.history.length,0);
 await write(id,preview.revision,[],409);assert.deepEqual(await durable(id),state);assert.equal((await write(id,frozen.journal.revision,[])).changes,0);assert.deepEqual(await durable(id),state);
});
test('all statuses, null clearing, exact author/time and invalid/duplicate marks',async()=>{
 const id=manifest.ids.bookings['robots-3'];let journal=await read(id);const child=journal.members[0].child_id;
 for(const status of ['present','absent','excused',null]) {
  const before=await durable(id),previous=journal.members.find(m=>m.child_id===child).status,saved=await write(id,journal.revision,[{childId:child,status}]);journal=saved.journal;
  const after=await durable(id);assert.equal(after.history.length,before.history.length+(previous===status?0:1));
  const row=after.rows.find(r=>r.child_id===child);assert.equal(row.status,status);
  if(previous!==status){const h=after.history.at(-1);assert.equal(h.previous_status,previous);assert.equal(h.new_status,status);assert.equal(h.changed_by,process.env.TEST_USER);assert.ok(h.changed_at);assert.equal(row.marked_by,h.changed_by);}
  if(status===null)assert.equal(row.marked_at,null);
 }
 const before=await durable(id);for(const marks of [[{childId:child,status:'invalid'}],[{childId:child,status:'present'},{childId:child,status:'absent'}]]){await write(id,journal.revision,marks,400);assert.deepEqual(await durable(id),before);}
});
test('cancelled/foreign/non-education requests do not mutate business rows',async()=>{
 const id=manifest.ids.bookings['robots-2'],journal=await read(id),before=await durable(id);assert.equal(journal.cancelled,true);
 await write(id,journal.revision,[],409);assert.deepEqual(await durable(id),before);
 for(const context of ['maysternya_doli','event_genix']) {
  await request('GET',endpoint(id,context),undefined,token,404);await request('PUT',endpoint(id,context),{revision:journal.revision,marks:[]},token,404);assert.deepEqual(await durable(id),before);
 }
});
