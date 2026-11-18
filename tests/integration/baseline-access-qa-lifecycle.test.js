'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createParkWorkFixture } = require('../helpers/park-work-app-fixture');
const { describeBaselineQaPlan, preflightBaselineQaPlan, createBaselineQaRun,
    finishBaselineQaRun } = require('../../services/baselineAccessQa');
const { cleanupTrustedQaRun, runTrustedQaCleanupWatchdog } = require('../../services/trustedQaRuns');
const { main: runOperatorTool } = require('../../scripts/trusted-qa-baseline-access-run');

test('registered baseline identities authenticate, fail closed on drift and retire through the watchdog', async t => {
    fs.mkdirSync(path.resolve(__dirname, '../../output'), { recursive: true });
    const f = await createParkWorkFixture([]);
    const transaction = async fn => {
        const client = await f.db.connect();
        try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    };
    const newPlan = () => ({ runId: 'baqa-' + crypto.randomBytes(6).toString('hex'), operatorId: f.root.id,
        businessId: Number(f.park.id), releaseSha: 'a'.repeat(40), ttlMinutes: 15 });
    let created;
    let plan;
    let planHash;
    try {
        await t.test('invalid plans, wrong hashes and foreign context cannot create identities', async () => {
            assert.throws(() => describeBaselineQaPlan({ ...newPlan(), roles: ['creator'] }), { code: 'BASELINE_QA_PLAN_INVALID' });
            assert.throws(() => describeBaselineQaPlan({ ...newPlan(), ttlMinutes: 31 }), { code: 'BASELINE_QA_PLAN_INVALID' });
            await assert.rejects(transaction(db => createBaselineQaRun(db, newPlan(), 'bad')), { code: 'BASELINE_QA_PLAN_HASH_MISMATCH' });
            await assert.rejects(preflightBaselineQaPlan(f.db, { ...newPlan(), businessId: Number(f.dar.id) }), { code: 'BASELINE_QA_OPERATOR_SCOPE_DENIED' });
        });
        await t.test('a mid-bootstrap failure rolls back the run and every new identity', async () => {
            const rejectedPlan = newPlan();
            const { planHash: hash } = describeBaselineQaPlan(rejectedPlan);
            const username = rejectedPlan.runId + '-account-2';
            const { rows: [collision] } = await f.db.query(`INSERT INTO users(username,name,password_hash,role,is_active)
                VALUES($1,$1,'synthetic-unusable-hash','animator',false) RETURNING id`, [username]);
            try {
                await assert.rejects(transaction(db => createBaselineQaRun(db, rejectedPlan, hash)), { code: '23505' });
                assert.equal((await f.db.query('SELECT id FROM trusted_qa_runs WHERE run_id=$1', [rejectedPlan.runId])).rowCount, 0);
                assert.equal((await f.db.query('SELECT id FROM staff WHERE name=ANY($1::text[])',
                    [[rejectedPlan.runId + '-staff-1', rejectedPlan.runId + '-staff-2']])).rowCount, 0);
                assert.equal((await f.db.query('SELECT id FROM users WHERE username=$1', [rejectedPlan.runId + '-account-1'])).rowCount, 0);
            } finally { await f.db.query('DELETE FROM users WHERE id=$1', [collision.id]); }
        });
        await t.test('creation is atomic and new accounts use normal login plus six actual API reads', async () => {
            plan = newPlan(); ({ planHash } = describeBaselineQaPlan(plan));
            created = await transaction(db => createBaselineQaRun(db, plan, planHash));
            assert.equal(created.actors.length, 2);
            assert.doesNotMatch(JSON.stringify(created), /password|password_hash|token_hash/);
            assert.ok(created.actors.every(actor => actor.password.length >= 24));
            assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM trusted_qa_run_entities WHERE run_id=$1', [created.runId])).rows[0].n, 8);
            await assert.rejects(transaction(db => createBaselineQaRun(db, newPlan(), planHash)), { code: 'BASELINE_QA_RUN_ALREADY_OPEN' });
            for (const actor of created.actors) {
                const response = await fetch(f.origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ username: actor.username, password: actor.password }) });
                const login = { status: response.status, data: await response.json() };
                assert.equal(login.status, 200, 'normal synthetic login');
                Object.defineProperty(actor, 'token', { value: login.data.token });
                const check = await f.api(actor, 'POST', '/api/work-access/check', {});
                assert.equal(check.status, 200);
                assert.equal(check.data.readiness.ready, true, 'actual six-read proof');
                const payroll = await f.api(actor, 'GET', '/api/hr/salary');
                assert.equal(payroll.status, 403, 'no payroll grant');
            }
            await assert.rejects(preflightBaselineQaPlan(f.db, { ...newPlan(), operatorId: created.actors[1].id }),
                { code: 'BASELINE_QA_OPERATOR_NOT_ISOLATED' });
        });
        await t.test('role, profile and foreign membership drift abort the whole cleanup', async () => {
            const actor = created.actors[0];
            await f.db.query("UPDATE users SET role='creator' WHERE id=$1", [actor.id]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM users WHERE id=ANY($1::int[]) AND is_active', [created.actors.map(a => a.id)])).rows[0].n, 2);
            await f.db.query("UPDATE users SET role='instructor' WHERE id=$1", [actor.id]);
            await f.db.query('UPDATE employee_profiles SET user_id=NULL WHERE id=$1', [actor.profileId]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            await f.db.query('UPDATE employee_profiles SET user_id=$2 WHERE id=$1', [actor.profileId, actor.id]);
            await f.db.query(`INSERT INTO business_memberships(organization_id,business_id,user_id,role)
                VALUES($1,$2,$3,'instructor')`, [f.org.id, f.dar.id, actor.id]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            await f.db.query('DELETE FROM business_memberships WHERE user_id=$1 AND business_id=$2 AND organization_id=$3', [actor.id, f.dar.id, f.org.id]);
            await assert.rejects(transaction(db => cleanupTrustedQaRun(db, created.runId)), { code: 'BASELINE_QA_CLEANUP_LOCK_REQUIRED' });
        });
        await t.test('the real synthetic admin saves professions without introducing financial rows', async () => {
            const actor = created.actors.find(row => row.role === 'admin');
            const result = await f.api(actor, 'PUT', `/api/hr/staff/${actor.staffId}/role-assignments`, {
                primary_role: 'host', assignments: [
                    { profession_key: 'host', is_primary: true, status: 'active', admission_status: 'approved', internship_status: 'completed' },
                    { profession_key: 'reception', is_primary: false, status: 'active', admission_status: 'pending', internship_status: 'none' }
                ] });
            assert.equal(result.status, 200);
            assert.ok(result.data.profile_revision);
            assert.equal((await f.db.query('SELECT id FROM payroll_schemes WHERE staff_id=$1', [actor.staffId])).rowCount, 0);
            assert.equal((await f.db.query('SELECT staff_id FROM staff_profession_rates WHERE staff_id=$1', [actor.staffId])).rowCount, 0);
            assert.equal(Number((await f.db.query('SELECT hourly_rate FROM staff WHERE id=$1', [actor.staffId])).rows[0].hourly_rate), 0);
        });
        await t.test('unexpected work dependencies prevent retirement without touching them', async () => {
            const actor = created.actors[0];
            const { rows: [entry] } = await f.db.query(`INSERT INTO staff_schedule(staff_id,date,shift_start,shift_end,status)
                VALUES($1,'2026-11-18','10:00','11:00','working') RETURNING id`, [actor.staffId]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            assert.equal((await f.db.query('SELECT id FROM staff_schedule WHERE id=$1', [entry.id])).rowCount, 1);
            await f.db.query('DELETE FROM staff_schedule WHERE id=$1', [entry.id]);
            await f.db.query('UPDATE staff SET hourly_rate=123 WHERE id=$1', [actor.staffId]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            assert.equal(Number((await f.db.query('SELECT hourly_rate FROM staff WHERE id=$1', [actor.staffId])).rows[0].hourly_rate), 123);
            await f.db.query('UPDATE staff SET hourly_rate=0 WHERE id=$1', [actor.staffId]);
            await f.db.query("UPDATE staff SET phone='synthetic-contact-drift' WHERE id=$1", [actor.staffId]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            await f.db.query('UPDATE staff SET phone=NULL WHERE id=$1', [actor.staffId]);
            const { rows: [preference] } = await f.db.query(`INSERT INTO staff_shift_preferences
                (staff_id,profession_key,day_type,start_time,end_time,created_by,updated_by)
                VALUES($1,'animator','weekday','10:00','20:00',$2,$2) RETURNING id`, [actor.staffId, actor.username]);
            await assert.rejects(transaction(db => finishBaselineQaRun(db, plan, planHash)), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
            assert.equal((await f.db.query('SELECT id FROM staff_shift_preferences WHERE id=$1', [preference.id])).rowCount, 1);
            await f.db.query('DELETE FROM staff_shift_preferences WHERE id=$1', [preference.id]);
        });
        await t.test('expiry watchdog retires all eight entities and invalidates existing sessions', async () => {
            await f.db.query(`UPDATE trusted_qa_runs SET created_at=NOW()-INTERVAL '31 minutes',
                expires_at=NOW()-INTERVAL '16 minutes' WHERE id=$1`, [created.runId]);
            const client = await f.db.connect();
            let result;
            try { result = await runTrustedQaCleanupWatchdog({ client, runDatabaseId: Number(created.runId), allowedSources: ['baseline_access_qa'] }); }
            finally { client.release(); }
            assert.ok(result.processed >= 1);
            assert.equal((await f.db.query('SELECT state FROM trusted_qa_runs WHERE id=$1', [created.runId])).rows[0].state, 'cleaned');
            for (const actor of created.actors) assert.equal((await f.api(actor, 'GET', '/api/auth/verify')).status, 401);
            const again = await transaction(db => finishBaselineQaRun(db, plan, planHash));
            assert.equal(again.idempotent, true);
            assert.equal((await f.db.query('SELECT is_active FROM users WHERE id=$1', [f.root.id])).rows[0].is_active, true);
        });
        await t.test('the actual operator CLI plans read-only, requires approval and finishes its API scenario', async () => {
            const toolPlan = newPlan();
            const file = path.resolve(__dirname, '../../output', toolPlan.runId + '.json');
            fs.writeFileSync(file, JSON.stringify(toolPlan), { flag: 'wx' });
            const args = ['--local', '--plan-file', file];
            const env = { ...process.env, TEST_URL: f.origin };
            try {
                const preview = await runOperatorTool([...args, '--mode', 'plan'], env);
                assert.equal(preview.readOnly, true);
                assert.equal((await f.db.query('SELECT id FROM trusted_qa_runs WHERE run_id=$1', [toolPlan.runId])).rowCount, 0);
                await assert.rejects(runOperatorTool([...args, '--mode', 'run'], env), { code: 'BASELINE_QA_APPROVAL_REQUIRED' });
                const result = await runOperatorTool([...args, '--mode', 'run', '--confirm', 'EXECUTE_EXACT_BASELINE_ACCESS_QA',
                    '--approved-hash', preview.planHash], env);
                assert.equal(result.success, true);
                assert.equal(result.cleanup, 'cleaned');
                assert.equal(result.results.length, 2);
                assert.doesNotMatch(JSON.stringify(result), /password|token/);
                assert.equal((await f.db.query('SELECT state FROM trusted_qa_runs WHERE run_id=$1', [toolPlan.runId])).rows[0].state, 'cleaned');
            } finally { fs.unlinkSync(file); }
        });
        await t.test('an API interruption still retires the exact newly registered run', async () => {
            const toolPlan = newPlan();
            const hash = describeBaselineQaPlan(toolPlan).planHash;
            const file = path.resolve(__dirname, '../../output', toolPlan.runId + '.json');
            fs.writeFileSync(file, JSON.stringify(toolPlan), { flag: 'wx' });
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => String(url) === f.origin + '/api/work-access/check'
                ? new Response('{"error":"synthetic-private-failure"}', { status: 503, headers: { 'content-type': 'application/json' } })
                : originalFetch(url, options);
            try {
                await assert.rejects(runOperatorTool(['--local', '--plan-file', file, '--mode', 'run',
                    '--confirm', 'EXECUTE_EXACT_BASELINE_ACCESS_QA', '--approved-hash', hash],
                { ...process.env, TEST_URL: f.origin }), { code: 'BASELINE_QA_API_READ_FAILED' });
                assert.equal((await f.db.query('SELECT state FROM trusted_qa_runs WHERE run_id=$1', [toolPlan.runId])).rows[0].state, 'cleaned');
            } finally { global.fetch = originalFetch; fs.unlinkSync(file); }
        });
    } finally { await f.db.end(); }
});
