'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { createSubstitutionService } = require('../../services/staffSubstitutions');
const { applyPayrollSubstitutions } = require('../../services/staffSubstitutionPayroll');
const enabled = process.env.RUN_SUBSTITUTION_INTEGRATION === 'true';
const schema = `substitution_test_${randomUUID().replaceAll('-', '')}`;
const actor = { username: 'synthetic_substitution_operator' };
let db, admin, service;
let failApply = false;

const input = (patch = {}) => ({ sourceType: 'standalone', sourceId: randomUUID(), staffId: 2, workDate: '2099-01-13',
    professionKey: 'reception', payUnit: 'hour', payMode: 'additional', startsAt: '2099-01-13T09:00:00+02:00',
    endsAt: '2099-01-13T13:30:00+02:00', breakMinutes: 30, workload: 'Synthetic reception coverage',
    reason: 'Synthetic test only', rateMode: 'individual', rate: '200', rateReason: 'Synthetic agreed rate', ...patch });

before(async () => {
    if (!enabled) return;
    const safe = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(safe.isLocal, true);
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false, options: `-c search_path=${schema},public`, max: 8 });
    await db.query(`CREATE TABLE staff(id INTEGER PRIMARY KEY,name TEXT);
        INSERT INTO staff VALUES(1,'Synthetic original'),(2,'Synthetic replacement');
        CREATE TABLE hr_time_records(id INTEGER PRIMARY KEY,staff_id INTEGER,record_date DATE,business_context TEXT,
            clock_out TIMESTAMPTZ,compensation_snapshot JSONB);
        CREATE TABLE payroll_reports(id INTEGER PRIMARY KEY,staff_id INTEGER,period_month TEXT,status TEXT);
        CREATE TABLE payroll_installments(id INTEGER PRIMARY KEY,payroll_report_id INTEGER,workflow_status TEXT);
        CREATE TABLE payroll_payment_movements(id INTEGER PRIMARY KEY,installment_id INTEGER);
        CREATE TABLE payroll_period_locks(period_month TEXT PRIMARY KEY,is_locked BOOLEAN DEFAULT false,
            locked_at TIMESTAMPTZ,locked_by TEXT,unlocked_at TIMESTAMPTZ,unlocked_by TEXT,note TEXT,meta_json JSONB);
        CREATE TABLE source_effects(substitution_id BIGINT,action TEXT);`);
    await db.query('CREATE TABLE hr_shifts(id INT PRIMARY KEY,staff_id INT); CREATE TABLE tasks(id INT PRIMARY KEY,owner_user_id INT,status TEXT)');
    await db.query('CREATE TABLE afisha(id INT PRIMARY KEY); CREATE TABLE leads(id INT PRIMARY KEY); CREATE TABLE procurement_lists(id INT PRIMARY KEY)');
    await db.query('CREATE TABLE hr_shift_segments(id INT PRIMARY KEY,hr_shift_id INT,notes TEXT)');
    const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/392_staff_substitutions.sql'), 'utf8');
    await db.query(migration);
    await db.query(migration);
    service = createSubstitutionService({ pool: db,
        loadContext: async () => ({ evidence: { policy: 'synthetic' }, commitments: [], blockers: [] }),
        sources: { loadScope: async () => ({ type: 'synthetic' }),
            applyAssignment: async (client, business, user, row) => {
                await client.query('INSERT INTO source_effects VALUES($1,$2)', [row.id,'apply']);
                if (failApply) throw new Error('synthetic adapter failure');
            }, reviseAssignment: async () => {}, restoreAssignment: async () => {}, assertCurrent: async () => {} }
    });
});

after(async () => {
    if (db) await db.end();
    if (admin) {
        // Exact schema owned by this run, inside an independently verified disposable local DB.
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});

async function create(raw = input(), patch = {}) {
    const quote = await service.preview('event_genix', actor, raw);
    const payload = { input: raw, previewFingerprint: quote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID(), ...patch };
    return { row: await service.mutate('event_genix',actor,'create',payload), payload };
}

test('draft report with an approved installment blocks new compensation', {skip:!enabled},async()=>{
    await db.query("INSERT INTO payroll_reports VALUES(900,2,'2099-01','draft'); INSERT INTO payroll_installments VALUES(900,900,'approved')");
    try { await assert.rejects(create(),{code:'SUBSTITUTION_PAYROLL_FROZEN'}); }
    finally { await db.query('DELETE FROM payroll_installments WHERE id=900; DELETE FROM payroll_reports WHERE id=900'); }
});

test('source guards reject bypass reassignment, segment edits and frozen aggregate edits',{skip:!enabled},async()=>{
    await db.query("INSERT INTO tasks VALUES(900,1,'todo'); INSERT INTO hr_shifts VALUES(900,1); INSERT INTO hr_shift_segments VALUES(900,900,'original')");
    const task=await create(input({sourceType:'task',sourceId:'900'}));
    await assert.rejects(db.query('UPDATE tasks SET owner_user_id=2 WHERE id=900'),{code:'23514'});
    await assert.rejects(db.query("UPDATE tasks SET status='cancelled' WHERE id=900"),{code:'23514'});
    await db.query("UPDATE tasks SET status='done' WHERE id=900");
    await assert.rejects(db.query('DELETE FROM staff_substitutions WHERE id=$1',[task.row.id]),{code:'23514'});
    const shift=await create(input({sourceType:'hr_shift',sourceId:'900'}));
    await assert.rejects(db.query("UPDATE hr_shift_segments SET notes='changed' WHERE id=900"),{code:'23514'});
    await assert.rejects(db.query('DELETE FROM hr_shifts WHERE id=900'),{code:'23514'});
    await service.mutate('event_genix',actor,'cancel',{reason:'Synthetic cancellation',expectedVersion:1,requestKey:randomUUID()},shift.row.id);
    await db.query("UPDATE hr_shift_segments SET notes='allowed after cancellation' WHERE id=900");
});

test('concurrent request replay produces one assignment and one immutable event', { skip: !enabled }, async () => {
    const raw = input();
    const quote = await service.preview('event_genix',actor,raw);
    const payload = { input: raw, previewFingerprint: quote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() };
    const rows = await Promise.all(Array.from({ length: 4 }, () => service.mutate('event_genix',actor,'create',payload)));
    assert.equal(new Set(rows.map(row => row.id)).size, 1);
    assert.equal((await db.query('SELECT * FROM source_effects WHERE substitution_id=$1',[rows[0].id])).rows.length, 1);
    assert.equal((await service.history('event_genix',rows[0].id)).events.length, 1);
    await assert.rejects(service.mutate('event_genix',actor,'create',{...payload,effectsAcknowledged:false}), { code: 'SUBSTITUTION_REQUEST_REUSED' });
    await assert.rejects(db.query('UPDATE staff_substitution_events SET reason=$1 WHERE substitution_id=$2', ['edited',rows[0].id]), { code: '23514' });
});

test('different keys cannot create duplicate source claims', { skip: !enabled }, async () => {
    const raw = input();
    const quote = await service.preview('event_genix',actor,raw);
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => service.mutate('event_genix',actor,'create',
        { input: raw, previewFingerprint: quote.fingerprint, effectsAcknowledged: true, requestKey: randomUUID() })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'SUBSTITUTION_DUPLICATE');
});

test('adapter failure rolls back source, aggregate, request and history together', { skip: !enabled }, async () => {
    failApply = true;
    const raw = input();
    try { await assert.rejects(create(raw), /synthetic adapter failure/); } finally { failApply = false; }
    assert.equal((await db.query('SELECT id FROM staff_substitutions WHERE source_id=$1',[raw.sourceId])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM source_effects e LEFT JOIN staff_substitutions s ON s.id=e.substitution_id WHERE s.id IS NULL')).rows.length, 0);
});

test('stale preview, stale revision, closed period and other business are rejected', { skip: !enabled }, async () => {
    await assert.rejects(create(input(), { previewFingerprint: 'old' }), { code: 'SUBSTITUTION_PREVIEW_STALE' });
    const { row } = await create();
    await assert.rejects(service.mutate('event_genix',actor,'cancel',{expectedVersion:9,reason:'Test',requestKey:randomUUID()},row.id), { code: 'SUBSTITUTION_STALE' });
    await assert.rejects(service.history('another_business',row.id), { code: 'SUBSTITUTION_NOT_FOUND' });
    await db.query("INSERT INTO payroll_period_locks(period_month,is_locked) VALUES('2099-02',true)");
    await assert.rejects(create(input({workDate:'2099-02-13',startsAt:'2099-02-13T09:00:00+02:00',endsAt:'2099-02-13T13:30:00+02:00'})), { statusCode: 423 });
});

test('completion freezes actual amount and retries do not duplicate earnings', { skip: !enabled }, async () => {
    const { row } = await create();
    const payload = {expectedVersion:1,reason:'Synthetic completion',workConfirmed:true,actualMinutes:180,workEvidence:'Synthetic signed work record',requestKey:randomUUID()};
    const completed = await service.mutate('event_genix',actor,'complete',payload,row.id);
    assert.equal(completed.quote.estimateMinor, 80000);
    assert.equal(completed.completion.amountMinor, 60000);
    assert.deepEqual(await service.mutate('event_genix',actor,'complete',payload,row.id), JSON.parse(JSON.stringify(completed)));
    await assert.rejects(service.mutate('event_genix',actor,'cancel',{expectedVersion:2,reason:'Test',requestKey:randomUUID()},row.id), { code: 'SUBSTITUTION_FROZEN' });
    const stored = (await db.query('SELECT *,work_date::text FROM staff_substitutions WHERE id=$1',[row.id])).rows[0];
    const payroll = applyPayrollSubstitutions({},[stored]);
    assert.equal(payroll.substitutionLines[0].amount,600);
    assert.equal(payroll.payrollBlockingIssues.length,0);
    assert.equal(applyPayrollSubstitutions({},[stored,stored]).payrollBlockingIssues[0].code,'SUBSTITUTION_DUPLICATE_PAY_SOURCE');
});

test('base replacement consumes exact frozen allocations once and detects later correction', { skip: !enabled }, async () => {
    const allocation = {allocationType:'base',professionKey:'manager',actualMinutes:180,plannedMinutes:240,overtimeMinutes:0,
        conditions:{rate:150,rateUnit:'hour',ruleVersion:'hr-pay-conditions-v2'}};
    const snapshot = {schemaVersion:2,compensationAllocations:[allocation]};
    await db.query("INSERT INTO hr_time_records VALUES(42,2,'2099-01-13','event_genix',NOW(),$1)",[JSON.stringify(snapshot)]);
    const { row } = await create(input({payMode:'replace_base'}));
    const done = await service.mutate('event_genix',actor,'complete',{expectedVersion:1,reason:'Synthetic replacement',workConfirmed:true,
        actualMinutes:180,attendanceId:42,baseAllocationIndices:[0],workEvidence:'Approved synthetic time',requestKey:randomUUID()},row.id);
    const stored = (await db.query('SELECT *,work_date::text FROM staff_substitutions WHERE id=$1',[done.id])).rows[0];
    const metrics = {conditionDays:[{date:'2099-01-13',attendanceRef:42,snapshot}]};
    const result = applyPayrollSubstitutions(metrics,[stored]);
    assert.equal(result.conditionDays[0].snapshot.compensationAllocations[0].actualMinutes,0);
    assert.equal(metrics.conditionDays[0].snapshot.compensationAllocations[0].actualMinutes,180);
    assert.equal(result.substitutionLines[0].amount,600);
    const changed = structuredClone(metrics);
    changed.conditionDays[0].snapshot.compensationAllocations[0].actualMinutes = 181;
    assert.equal(applyPayrollSubstitutions(changed,[stored]).payrollBlockingIssues[0].code,'SUBSTITUTION_BASE_EVIDENCE_CHANGED');
    const second = await create(input({payMode:'replace_base'}));
    await assert.rejects(service.mutate('event_genix',actor,'complete',{expectedVersion:1,reason:'Duplicate base',workConfirmed:true,
        actualMinutes:180,attendanceId:42,baseAllocationIndices:[0],workEvidence:'Synthetic duplicate',requestKey:randomUUID()},second.row.id), {code:'SUBSTITUTION_DUPLICATE'});
});
