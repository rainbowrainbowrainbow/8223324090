'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { DATABASES, assertLocalTarget, seedDataset } = require('../../scripts/lib/education-ready-dataset');
let pool, manifest, token, secondToken;
const secondName = 'education_serial_operator';
async function request(method, route, body, auth = token, expected = 200) {
    const response = await fetch(process.env.TEST_URL + route, {
        method, headers: { Authorization: `Bearer ${auth || ''}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json(); assert.equal(response.status, expected, data.error || route); return data;
}
before(async () => {
    assertLocalTarget('fixed'); assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    pool = new Pool({host:'127.0.0.1',port:55469,user:'postgres',database:DATABASES.fixed,ssl:false});
    manifest = (await seedDataset(pool,'fixed')).manifest;
    const login = await request('POST','/api/auth/login',{username:process.env.TEST_USER,password:process.env.TEST_PASS},''); token=login.accessToken||login.token;
    const password=crypto.randomBytes(24).toString('base64url');
    await request('POST','/api/users',{username:secondName,password,name:'Оператор Андрій',role:'creator',businessContexts:['dar'],defaultBusinessContext:'dar'});
    const second=await request('POST','/api/auth/login',{username:secondName,password},''); secondToken=second.accessToken||second.token;
});
after(async()=>{await pool?.end();});
test('frozen snapshots survive source name and backdated membership changes', async()=>{
    const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1'];
    const route=`/api/education/attendance/${id}?businessContext=dar`;
    const original=(await request('GET',route)).journal; assert.equal(original.frozen,true);
    const frozen=(await pool.query('SELECT child_id,child_name_snapshot,parent_name_snapshot,snapshot_at FROM education_attendance WHERE booking_id=$1 ORDER BY child_id',[id])).rows;
    // Disposable prerequisite deliberately contradicts the historical roster to prove snapshot ownership.
    await pool.query("UPDATE customer_children SET name='Данило після зміни імені' WHERE id=$1",[child]);
    await pool.query("UPDATE education_group_members SET end_date='2026-09-01' WHERE group_id=$1 AND child_id=$2",[manifest.ids.groups.english,child]);
    const current=(await request('GET',route)).journal;assert.deepEqual(current.members.map(m=>[m.child_id,m.child_name,m.parent_name]),original.members.map(m=>[m.child_id,m.child_name,m.parent_name]));
    await request('PUT',route,{marks:[{childId:Number(child),status:'excused'}]});
    assert.deepEqual((await pool.query('SELECT child_id,child_name_snapshot,parent_name_snapshot,snapshot_at FROM education_attendance WHERE booking_id=$1 ORDER BY child_id',[id])).rows,frozen);
});
test('two real operators wait on a row barrier and retain serialized last-write-wins history',async()=>{
    const id=manifest.ids.bookings['english-3'],child=manifest.ids.children['child-1'];const route=`/api/education/attendance/${id}?businessContext=dar`;
    const baseline=Number((await pool.query('SELECT count(*) n FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 AND a.child_id=$2',[id,child])).rows[0].n);
    const blocker=await pool.connect();let calls=[];
    try{
        await blocker.query('BEGIN');await blocker.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[id]);
        calls=[request('PUT',route,{marks:[{childId:Number(child),status:'present'}]},token),request('PUT',route,{marks:[{childId:Number(child),status:'absent'}]},secondToken)];
        const deadline=Date.now()+10000;let waiters=0;
        while(waiters<2&&Date.now()<deadline){waiters=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;await new Promise(setImmediate);}
        assert.equal(waiters,2,'Both real HTTP writes must reach the held row lock');
        await blocker.query('COMMIT');await Promise.all(calls);
        const history=(await pool.query('SELECT h.previous_status,h.new_status,h.changed_by,h.changed_at FROM education_attendance_history h JOIN education_attendance a ON a.id=h.attendance_id WHERE a.booking_id=$1 AND a.child_id=$2 ORDER BY h.id',[id,child])).rows;
        assert.equal(history.length,baseline+2);
        const last=history.slice(-2);assert.deepEqual(last.map(h=>h.changed_by).sort(),[process.env.TEST_USER,secondName].sort());
        assert.deepEqual(last.map(h=>h.new_status).sort(),['absent','present']);assert.equal(last[1].previous_status,last[0].new_status);assert.ok(last.every(h=>h.changed_at));
        const durable=(await pool.query('SELECT status,marked_by,marked_at FROM education_attendance WHERE booking_id=$1 AND child_id=$2',[id,child])).rows[0];
        assert.equal(durable.status,last[1].new_status);assert.equal(durable.marked_by,last[1].changed_by);assert.deepEqual(durable.marked_at,last[1].changed_at);
        const api=(await request('GET',route)).journal.members.find(m=>Number(m.child_id)===Number(child));assert.equal(api.status,durable.status);assert.equal(api.history.length,history.length);
    }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled(calls);}
});
test('cancelled journals reject writes, foreign and non-education contexts cannot read them',async()=>{
    const id=manifest.ids.bookings['robots-2'];
    assert.equal((await request('GET',`/api/education/attendance/${id}?businessContext=dar`)).journal.cancelled,true);
    await request('PUT',`/api/education/attendance/${id}?businessContext=dar`,{marks:[]},token,409);
    await request('GET',`/api/education/attendance/${id}?businessContext=maysternya_doli`,undefined,token,404);
    await request('GET',`/api/education/attendance/${id}?businessContext=event_genix`,undefined,token,404);
});
