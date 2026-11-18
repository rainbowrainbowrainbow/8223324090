'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createParkWorkFixture } = require('../helpers/park-work-app-fixture');
const { main } = require('../../scripts/trusted-qa-baseline-access-run');

test('the bounded operator CLI exercises normal UI login, canonical room details and both profession saves', async () => {
    const f = await createParkWorkFixture([]);
    const runId = 'baqa-' + crypto.randomBytes(6).toString('hex');
    const output = path.resolve(__dirname, '../../output/baseline-registered-browser');
    fs.mkdirSync(output, { recursive: true });
    const file = path.join(output, runId + '.json');
    try {
        await f.db.query(`INSERT INTO timeline_resources(business_context,resource_id,type,name,metadata,is_active)
            VALUES('event_genix','room-baseline-qa','room','Synthetic QA room','{"workArea":"game_zone"}',true);
            INSERT INTO settings(key,value) VALUES('timeline_display:event_genix',
            '{"mode":"park","roomTimelineEnabled":true,"defaultTimelineView":"animators"}')
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
            INSERT INTO lines_by_date(date,line_id,name,color,from_sheet,business_context)
            VALUES('2099-06-15','baseline-qa-line','SYNTHETIC_PERSON_NAME','#64748b',false,'event_genix')`);
        const { rows: [product] } = await f.db.query(`INSERT INTO products(id,code,timeline_code,name,label,category,duration,price,hosts,domain,business_context,is_active)
            VALUES('baseline-qa-program','BQA','BQA','Synthetic QA program','Synthetic QA program','quest',60,100,1,'program','event_genix',true) RETURNING id`);
        const plan = { runId, operatorId: f.root.id, businessId: Number(f.park.id), releaseSha: 'a'.repeat(40), ttlMinutes: 20,
            booking: { requestId: runId + '-booking', label: runId + '-event',
                productId: product.id, programId: product.id, programName: 'Synthetic QA program', programCode: 'BQA',
                category: 'quest', date: '2099-06-15', time: '13:00', duration: 60, hosts: 1, status: 'confirmed', pinataMode: 'none',
                lineId: 'baseline-qa-line', roomResourceId: 'room-baseline-qa', room: 'Synthetic QA room' } };
        fs.writeFileSync(file, JSON.stringify(plan), { flag: 'wx' });
        const args = ['--local','--plan-file',file];
        const env = { ...process.env, TEST_URL: f.origin };
        const preview = await main([...args,'--mode','plan'], env);
        assert.equal(preview.ready, true);
        assert.equal(preview.registeredEntities, 9);
        const result = await main([...args,'--mode','run','--approved-hash',preview.planHash,
            '--confirm','EXECUTE_EXACT_BASELINE_ACCESS_QA','--output-dir',output], env);
        assert.equal(result.success, true);
        assert.equal(result.browserResults.length, 4);
        assert.equal(result.cleanup, 'cleaned');
        assert.doesNotMatch(JSON.stringify(result), /password|token/);
        const { rows: runs } = await f.db.query('SELECT id,state FROM trusted_qa_runs WHERE run_id=ANY($1::text[])', [[runId,runId+'-booking']]);
        assert.equal(runs.length, 2);
        assert.ok(runs.every(row => row.state === 'cleaned'));
        const booking = (await f.db.query('SELECT status,skip_notification,customer_id FROM bookings WHERE label=$1', [runId+'-event'])).rows;
        assert.equal(booking.length, 1);
        assert.equal(booking[0].status, 'cancelled');
        assert.equal(booking[0].skip_notification, true);
        assert.equal(booking[0].customer_id, null);
        assert.equal((await f.db.query('SELECT is_active FROM products WHERE id=$1', [product.id])).rows[0].is_active, true);
        assert.equal((await f.db.query(`SELECT p.id FROM staff_shift_preferences p JOIN staff s ON s.id=p.staff_id WHERE s.name LIKE $1`, [runId+'%'])).rowCount, 0);
        // Failure after the real booking commit must cancel the child first,
        // then retire identities. No broad cleanup or real product retirement.
        const scenario = require('../../scripts/baseline-access-qa-browser');
        const originalExercise = scenario.exerciseBaselineBrowser;
        const { describeBaselineQaPlan } = require('../../services/baselineAccessQa');
        const { runTrustedQaCleanupWatchdog } = require('../../services/trustedQaRuns');
        try {
            for (const recovery of ['interrupted','expired','preference_drift']) {
                const recoveryId = 'baqa-' + crypto.randomBytes(6).toString('hex');
                const recoveryPlan = { ...plan, runId: recoveryId, booking: { ...plan.booking,
                    requestId: recoveryId+'-booking', label: recoveryId+'-event' } };
                fs.writeFileSync(file, JSON.stringify(recoveryPlan));
                let foreignPreference;
                scenario.exerciseBaselineBrowser = async ({ actors }) => {
                    if (recovery === 'interrupted') throw Object.assign(new Error('Synthetic interruption'), { code: 'SYNTHETIC_BROWSER_INTERRUPTION' });
                    if (recovery === 'preference_drift') {
                        const admin = actors.find(row => row.role === 'admin');
                        foreignPreference = (await f.db.query(`INSERT INTO staff_shift_preferences
                            (staff_id,profession_key,day_type,start_time,end_time,created_by,updated_by)
                            VALUES($1,'animator','weekday','10:00','20:00','synthetic-foreign','synthetic-foreign') RETURNING id`, [admin.staffId])).rows[0].id;
                        throw Object.assign(new Error('Synthetic interruption'), { code: 'SYNTHETIC_BROWSER_INTERRUPTION' });
                    }
                    // Identity retirement cannot precede its child, even when
                    // the canonical booking has no created_by client field.
                    const { finishBaselineQaRun } = require('../../services/baselineAccessQa');
                    const lock = await f.db.connect();
                    try {
                        await lock.query('BEGIN');
                        await assert.rejects(finishBaselineQaRun(lock,recoveryPlan,describeBaselineQaPlan(recoveryPlan).planHash),
                            {code:'BASELINE_QA_CLEANUP_DRIFT'});
                    } finally { await lock.query('ROLLBACK'); lock.release(); }
                    await f.db.query(`UPDATE trusted_qa_runs SET created_at=NOW()-INTERVAL '21 minutes',
                        expires_at=NOW()-INTERVAL '1 minute' WHERE run_id=ANY($1::text[])`, [[recoveryId,recoveryId+'-booking']]);
                    const { rows } = await f.db.query('SELECT id,run_id FROM trusted_qa_runs WHERE run_id=ANY($1::text[])', [[recoveryId,recoveryId+'-booking']]);
                    for (const publicId of [recoveryId+'-booking', recoveryId]) {
                        const client = await f.db.connect();
                        try { await runTrustedQaCleanupWatchdog({ client, runDatabaseId: Number(rows.find(row => row.run_id === publicId).id) }); }
                        finally { client.release(); }
                    }
                    return [{ recovery: 'expiry_watchdog' }];
                };
                const recoveryArgs = [...args,'--mode','run','--approved-hash',describeBaselineQaPlan(recoveryPlan).planHash,
                    '--confirm','EXECUTE_EXACT_BASELINE_ACCESS_QA'];
                if (recovery === 'preference_drift') {
                    await assert.rejects(main(recoveryArgs, env), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
                    assert.equal((await f.db.query('SELECT id FROM staff_shift_preferences WHERE id=$1', [foreignPreference])).rowCount, 1);
                    await f.db.query('DELETE FROM staff_shift_preferences WHERE id=$1', [foreignPreference]);
                    assert.equal((await main([...args,'--mode','finish','--approved-hash',describeBaselineQaPlan(recoveryPlan).planHash,
                        '--confirm','EXECUTE_EXACT_BASELINE_ACCESS_QA'], env)).state, 'cleaned');
                } else if (recovery === 'interrupted') await assert.rejects(main(recoveryArgs, env), { code: 'SYNTHETIC_BROWSER_INTERRUPTION' });
                else assert.equal((await main(recoveryArgs, env)).cleanup, 'cleaned');
                const states = (await f.db.query('SELECT state FROM trusted_qa_runs WHERE run_id=ANY($1::text[])', [[recoveryId,recoveryId+'-booking']])).rows;
                assert.equal(states.length, 2);
                assert.ok(states.every(row => row.state === 'cleaned'));
                assert.equal((await f.db.query('SELECT status FROM bookings WHERE label=$1', [recoveryId+'-event'])).rows[0].status, 'cancelled');
            }
        } finally { scenario.exerciseBaselineBrowser = originalExercise; }
    } finally { fs.rmSync(file, { force: true }); await f.db.end(); }
});
