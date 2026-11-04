'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock } = require('../../scripts/run-isolated-postgres-tests');
const { createCreativeExecutor } = require('../../services/crmCreativeExecution');
const { createScheduleOcr } = require('../../services/crmScheduleOcr');
const { createNotificationDelivery } = require('../../services/crmNotificationDelivery');
const { withProviderExecution, transaction } = require('../../services/crmProviderExecution');
const jobs = require('../../services/hermesJobs');
const outbox = require('../../services/notificationOutbox');

const enabled = process.env.RUN_CRM_AUTOMATION_POSTGRES_INTEGRATION === 'true';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const runId = `crm_ci_${randomUUID().slice(0, 8)}`;

describe('CRM automation on migrated disposable PostgreSQL', { skip: !enabled }, () => {
    let pool, actor, staff, base, originalFetch, databaseLock;
    const jobIds = [], taskIds = [], blobNames = [];

    before(async () => {
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true, 'No remote database is allowed');
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        databaseLock = await acquireIsolatedDatabaseLock(target);
        pool = new Pool({ connectionString: target.url.toString(), ssl: false, max: 4, connectionTimeoutMillis: 5000 });
        assert.ok((await pool.query("SELECT to_regclass('public.hermes_schedule_imports') AS name")).rows[0].name,
            'Run the canonical fresh DB startup before this suite');
        actor = (await pool.query(`INSERT INTO users (username, password_hash, role, name)
            VALUES ($1, 'not-a-login-hash', 'manager', 'Synthetic CRM CI manager') RETURNING id, username`, [runId])).rows[0];
        staff = (await pool.query(`INSERT INTO staff (name, display_name, department, position, is_active, hr_pool_status, is_freelance)
            VALUES ($1, $1, 'Synthetic CI', 'Synthetic CI', true, 'core', false) RETURNING id, name`, [runId])).rows[0];
        base = { businessContext: 'event_genix', actor, confirmed: true };
        originalFetch = global.fetch;
        global.fetch = async () => { throw new Error('Real HTTP is forbidden in CRM PostgreSQL verification'); };
    });

    after(async () => {
        if (originalFetch) global.fetch = originalFetch;
        try {
            if (!pool) return;
            await pool.query('DELETE FROM hermes_jobs WHERE id = ANY($1::bigint[])', [jobIds]);
            await pool.query('DELETE FROM catalog_image_blobs WHERE filename = ANY($1::text[])', [blobNames]);
            if (actor) await pool.query('DELETE FROM hermes_schedule_imports WHERE created_by_user_id = $1', [actor.id]);
            await pool.query('DELETE FROM notification_outbox WHERE task_id = ANY($1::int[])', [taskIds]);
            await pool.query('DELETE FROM tasks WHERE id = ANY($1::int[])', [taskIds]);
            if (staff) {
                await pool.query('DELETE FROM hr_audit_log WHERE staff_id = $1', [staff.id]);
                await pool.query('DELETE FROM staff WHERE id = $1', [staff.id]);
            }
            if (actor) await pool.query('DELETE FROM users WHERE id = $1', [actor.id]);
        } finally {
            if (pool) await pool.end();
            if (databaseLock) await databaseLock.release();
        }
    });

    async function creative() {
        const client = await pool.connect();
        try {
            const result = await transaction(client, () => jobs.createHermesJob(client, {
                jobType: 'creative_material_job', title: `Synthetic creative ${runId}`,
                payload: { brief: 'A blue circle on a white background', materialTypes: ['poster'], formats: ['square'] }
            }, base));
            jobIds.push(result.job.id);
            return result.job.id;
        } finally { client.release(); }
    }

    function imageResult() {
        return { sourceUrl: `data:image/png;base64,${png.toString('base64')}`, provider: 'synthetic', model: 'synthetic', size: '1024x1024' };
    }

    function ocrInput(documentDate) {
        return { ...base, documentDate, file: { buffer: png, mimetype: 'image/png' } };
    }

    async function notification() {
        const task = (await pool.query(`INSERT INTO tasks (title, status, owner_user_id, business_context, created_by)
            VALUES ($1, 'todo', $2, 'event_genix', $3) RETURNING *`, [runId, actor.id, actor.username])).rows[0];
        taskIds.push(task.id);
        const client = await pool.connect();
        try {
            return (await transaction(client, () => outbox.createNotificationOutboxEvent({ task, eventType: 'task_created' }, { pool: client }))).event;
        } finally { client.release(); }
    }

    function delivery(event, transport, recipient = { ownerUserId: actor.id, chatId: '123456789' }) {
        return createNotificationDelivery({ pool, transport, resolveRecipient: async () => recipient,
            env: { CRM_TASK_DELIVERY_ENABLED: 'true', CRM_TASK_DELIVERY_CUTOVER_CONFIRMED: 'true',
                CRM_TASK_DELIVERY_NOT_BEFORE: new Date(Date.now() - 60000).toISOString(),
                CRM_TASK_DELIVERY_APPROVED_EVENT_IDS: event.event_id } });
    }

    it('excludes concurrent paid work across PostgreSQL sessions and releases locks after failure', async () => {
        let entered, release;
        const enteredPromise = new Promise(resolve => { entered = resolve; });
        const hold = new Promise(resolve => { release = resolve; });
        const first = withProviderExecution(pool, async () => { entered(); await hold; return 'first'; });
        await enteredPromise;
        try {
            await assert.rejects(withProviderExecution(pool, () => assert.fail('Second provider must not run')), { code: 'CRM_PROVIDER_BUSY' });
        } finally { release(); await first; }
        await assert.rejects(withProviderExecution(pool, async () => { throw new Error('synthetic failure'); }), /synthetic failure/);
        assert.equal(await withProviderExecution(pool, async () => 'available'), 'available');
    });

    it('stores one creative draft and its image bytes, preserves approval history and avoids a second generation', async () => {
        const jobId = await creative();
        let calls = 0;
        const execute = createCreativeExecutor({ pool, env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' },
            generate: async () => { calls++; return imageResult(); } });
        const result = await execute({ ...base, jobId });
        assert.equal(result.job.status, 'ready_for_review');
        assert.equal(result.job.assets.length, 1);
        const filename = result.job.assets[0].storageKey;
        blobNames.push(filename);
        const stored = (await pool.query('SELECT data, metadata FROM catalog_image_blobs WHERE filename = $1', [filename])).rows[0];
        assert.deepEqual(stored.data, png);
        assert.equal(result.job.resultPayload.executor, 'crm');
        const client = await pool.connect();
        try { await transaction(client, () => jobs.recordHermesJobDecision(client, jobId, { decision: 'approved', notes: 'Synthetic review' }, base)); }
        finally { client.release(); }
        const replay = await execute({ ...base, jobId });
        assert.equal(replay.job.status, 'approved');
        assert.equal(replay.replayed, true);
        assert.equal(calls, 1);
        assert.equal(Number((await pool.query('SELECT count(*) FROM hermes_job_decisions WHERE job_id = $1', [jobId])).rows[0].count), 1);
    });

    it('persists a KIE task across Node processes and keeps the review blob and approval history', async () => {
        const jobId = await creative();
        let posts = 0, polls = 0;
        const env = { CRM_CREATIVE_EXECUTION_ENABLED: 'true', CRM_CREATIVE_IMAGE_GENERATOR: 'kie/gpt-image-2-5-flare-text-to-image' };
        const submitter = createCreativeExecutor({ pool, env,
            startKie: async () => { posts++; return { taskId: `synthetic_kie_${jobId}` }; },
            pollKie: async () => ({ status: 'generating' }) });
        const pending = await submitter({ ...base, jobId });
        assert.equal(pending.pending, true);
        const persisted = (await pool.query('SELECT status, result_payload FROM hermes_jobs WHERE id=$1', [jobId])).rows[0];
        assert.equal(persisted.status, 'in_progress');
        assert.equal(persisted.result_payload.providerTaskId, `synthetic_kie_${jobId}`);
        const child = spawn(process.execPath, ['tests/fixtures/crm-creative-kie-resume.cjs'], {
            cwd: path.join(__dirname, '../..'), windowsHide: true,
            env: { ...process.env, KIE_TEST_JOB_ID: String(jobId), KIE_TEST_ACTOR_ID: String(actor.id), KIE_TEST_PNG: png.toString('base64') },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let childOutput = ''; child.stdout.on('data', value => { childOutput += value; });
        child.stderr.resume();
        const childExit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        assert.equal(childExit, 0, 'Fresh Node process must recover the saved task');
        assert.match(childOutput, /"providerCalled":false/);
        const resumed = createCreativeExecutor({ pool, env,
            startKie: async () => { posts++; throw Error('Must not resubmit'); },
            pollKie: async task => { polls++; assert.equal(task, persisted.result_payload.providerTaskId); return { status: 'ready', sourceUrl: 'https://kie.ai/synthetic.png' }; },
            downloadKie: async () => ({ ...imageResult(), size: '1254x1254' }) });
        const result = await resumed({ ...base, jobId });
        assert.equal(result.job.status, 'ready_for_review'); assert.equal(result.job.assets.length, 1);
        assert.equal(result.job.resultPayload.generatedSize, '1254x1254');
        blobNames.push(result.job.assets[0].storageKey);
        const stored = (await pool.query('SELECT data FROM catalog_image_blobs WHERE filename=$1', [result.job.assets[0].storageKey])).rows[0];
        assert.deepEqual(stored.data, png);
        const client = await pool.connect();
        try { await transaction(client, () => jobs.recordHermesJobDecision(client, jobId, { decision: 'approved', notes: 'Synthetic KIE review' }, base)); }
        finally { client.release(); }
        assert.equal((await resumed({ ...base, jobId })).job.status, 'approved');
        assert.equal(posts, 1); assert.equal(polls, 0, 'parent only replays the child-persisted review result');
        assert.equal(Number((await pool.query('SELECT count(*) FROM hermes_job_decisions WHERE job_id=$1', [jobId])).rows[0].count), 1);
    });

    it('does not repeat a charge after provider failure or a rolled-back result write', async () => {
        for (const persistenceFailure of [false, true]) {
            const jobId = await creative();
            let calls = 0;
            const execute = createCreativeExecutor({ pool, env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' },
                jobs: persistenceFailure ? { ...jobs, recordHermesJobResult: async () => { throw new Error('synthetic database failure'); } } : jobs,
                generate: async () => { calls++; if (!persistenceFailure) throw new Error('ambiguous provider outcome'); return imageResult(); } });
            await assert.rejects(execute({ ...base, jobId }), { code: persistenceFailure
                ? 'CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW' : 'CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW' });
            assert.equal((await pool.query('SELECT status FROM hermes_jobs WHERE id=$1', [jobId])).rows[0].status,
                persistenceFailure ? 'claimed' : 'failed');
            await assert.rejects(execute({ ...base, jobId }), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' });
            assert.equal(calls, 1);
        }
    });

    it('keeps the committed creative claim when its executor process is terminated', async () => {
        const jobId = await creative();
        const program = `
            const { Pool } = require('pg');
            const { createCreativeExecutor } = require('./services/crmCreativeExecution');
            const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
            createCreativeExecutor({ pool, env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' },
                generate: async () => { process.send('provider-entered'); await new Promise(() => {}); }
            })({ jobId: ${Number(jobId)}, businessContext: 'event_genix', actor: { id: ${Number(actor.id)} }, confirmed: true })
                .catch(() => process.exit(1));
        `;
        const child = spawn(process.execPath, ['-e', program], {
            cwd: path.resolve(__dirname, '../..'), env: process.env,
            windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
        });
        const exited = new Promise(resolve => child.once('exit', resolve));
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Synthetic executor did not enter provider')), 10000);
                child.once('message', message => { clearTimeout(timer); message === 'provider-entered' ? resolve() : reject(new Error('Unexpected executor message')); });
                child.once('error', error => { clearTimeout(timer); reject(error); });
                child.once('exit', () => { clearTimeout(timer); reject(new Error('Executor exited before provider')); });
            });
        } finally { child.kill(); await exited; }
        assert.equal((await pool.query('SELECT status FROM hermes_jobs WHERE id=$1', [jobId])).rows[0].status, 'claimed');
        // Process exit can precede PostgreSQL observing the disconnected session.
        // Wait for the actual lock release, bounded; do not repeat provider work.
        const deadline = Date.now() + 10000;
        for (;;) {
            try { await withProviderExecution(pool, async () => 'released'); break; }
            catch (error) {
                if (error.code !== 'CRM_PROVIDER_BUSY' || Date.now() >= deadline) throw error;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        const execute = createCreativeExecutor({ pool, env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' },
            generate: () => assert.fail('A crashed execution must not automatically incur another charge') });
        await assert.rejects(execute({ ...base, jobId }), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' });
        assert.equal(await withProviderExecution(pool, async () => 'released'), 'released');
    });

    it('persists OCR once, blocks uncertain rows, applies only selected planned days and seals the preview', async () => {
        let calls = 0;
        const ocr = createScheduleOcr({ pool, env: { CRM_SCHEDULE_OCR_ENABLED: 'true' }, recognize: async () => {
            calls++;
            return [
                { employeeName: staff.name, date: '2099-02-01', status: 'dayoff', confidence: 0.99, issues: [] },
                { employeeName: staff.name, date: '2099-02-02', status: 'dayoff', confidence: 0.5, issues: [] }
            ];
        } });
        const beforeAttendance = (await pool.query('SELECT count(*)::int AS count FROM hr_time_records')).rows[0].count;
        const preview = await ocr.preview(ocrInput('2099-02-01'));
        assert.deepEqual(preview.rows.map(row => row.action), ['create', 'invalid']);
        const replay = await ocr.preview(ocrInput('2099-02-01'));
        assert.equal(replay.importId, preview.importId);
        assert.equal(calls, 1);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM staff_schedule WHERE staff_id=$1', [staff.id])).rows[0].count, 0);
        const apply = selectedRowIds => ocr.apply({ ...base, body: { previewId: preview.importId, selectedRowIds } });
        await assert.rejects(apply([preview.rows[1].rowId]), { code: 'HERMES_SCHEDULE_APPLY_ROW_BLOCKED' });
        await assert.rejects(ocr.apply({ ...base, actor: { ...actor, id: actor.id + 100000 }, body: {
            previewId: preview.importId, selectedRowIds: [preview.rows[0].rowId] } }), { code: 'CRM_OCR_PREVIEW_FORBIDDEN' });
        const result = await apply([preview.rows[0].rowId]);
        assert.equal(result.response.success, true);
        assert.deepEqual((await pool.query('SELECT date,status FROM staff_schedule WHERE staff_id=$1', [staff.id])).rows,
            [{ date: '2099-02-01', status: 'dayoff' }]);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM hr_time_records')).rows[0].count, beforeAttendance);
        await assert.rejects(apply([preview.rows[0].rowId]), { code: 'HERMES_SCHEDULE_IMPORT_ALREADY_APPLIED' });
        await assert.rejects(pool.query("UPDATE hermes_schedule_imports SET preview_rows='[]'::jsonb WHERE public_id=$1", [preview.importId]), { code: '55000' });
    });

    it('keeps a durable OCR reservation after an ambiguous provider failure', async () => {
        let calls = 0;
        const ocr = createScheduleOcr({ pool, env: { CRM_SCHEDULE_OCR_ENABLED: 'true' },
            recognize: async () => { calls++; throw new Error('synthetic timeout'); } });
        await assert.rejects(ocr.preview(ocrInput('2099-03-01')), { code: 'CRM_OCR_EXECUTION_REQUIRES_REVIEW' });
        await assert.rejects(ocr.preview(ocrInput('2099-03-01')), { code: 'CRM_OCR_EXECUTION_REQUIRES_REVIEW' });
        assert.equal(calls, 1);
        const rows = (await pool.query("SELECT status FROM hermes_schedule_imports WHERE created_by_user_id=$1 AND source='crm_schedule_ocr_execution' AND document_date='2099-03-01'", [actor.id])).rows;
        assert.deepEqual(rows, [{ status: 'draft' }]);
    });

    it('reopens an OCR preview when AI slots are full and rolls back new OCR before spending', async () => {
        let calls = 0;
        const ocr = createScheduleOcr({ pool, env: { CRM_SCHEDULE_OCR_ENABLED: 'true' },
            recognize: async ({ documentDate }) => {
                calls++;
                return [{ employeeName: staff.name, date: documentDate, status: 'dayoff', confidence: 0.99, issues: [] }];
            } });
        const first = await ocr.preview(ocrInput('2099-06-01'));
        const ids = [randomUUID(), randomUUID()];
        try {
            for (let i = 0; i < ids.length; i++) await pool.query(
                `INSERT INTO menu_image_paid_operations (operation_id, business_context, product_id, provider, status, created_by)
                 VALUES ($1, 'event_genix', $2, 'kie', 'unknown', $3)`, [ids[i], `${runId}-${i}`, actor.username]);
            const replay = await ocr.preview(ocrInput('2099-06-01'));
            assert.equal(replay.importId, first.importId);
            await assert.rejects(ocr.preview(ocrInput('2099-06-02')), { code: 'CRM_PROVIDER_BUSY' });
            assert.equal(calls, 1);
            const reserved = await pool.query(`SELECT count(*)::int AS count FROM hermes_schedule_imports
                WHERE created_by_user_id=$1 AND document_date='2099-06-02'`, [actor.id]);
            assert.equal(reserved.rows[0].count, 0);
        } finally {
            await pool.query('DELETE FROM menu_image_paid_operations WHERE operation_id = ANY($1::uuid[])', [ids]);
        }
        await ocr.preview(ocrInput('2099-06-02'));
        assert.equal(calls, 2);
    });

    it('rejects an OCR apply when the schedule changed after preview', async () => {
        const ocr = createScheduleOcr({ pool, env: { CRM_SCHEDULE_OCR_ENABLED: 'true' }, recognize: async () => [
            { employeeName: staff.name, date: '2099-04-01', status: 'dayoff', confidence: 0.99, issues: [] }
        ] });
        const preview = await ocr.preview(ocrInput('2099-04-01'));
        await pool.query("INSERT INTO staff_schedule (staff_id,date,status) VALUES ($1,'2099-04-01','vacation')", [staff.id]);
        await assert.rejects(ocr.apply({ ...base, body: { previewId: preview.importId, selectedRowIds: [preview.rows[0].rowId] } }),
            error => { assert.match(error.code, /STALE|STATE_CHANGED/); return true; });
        assert.equal((await pool.query("SELECT status FROM staff_schedule WHERE staff_id=$1 AND date='2099-04-01'", [staff.id])).rows[0].status, 'vacation');
        assert.equal((await pool.query('SELECT status FROM hermes_schedule_imports WHERE public_id=$1', [preview.importId])).rows[0].status, 'ready');
    });

    it('connects Studio HTTP execution and review to real PostgreSQL with a synthetic provider', async () => {
        const express = require('express');
        const { createHermesStudioRouter } = require('../../routes/hermes-studio');
        const jobId = await creative();
        let providerCalls = 0;
        const executeCreative = createCreativeExecutor({ pool, env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' }, generate: async () => { providerCalls++; return imageResult(); } });
        const app = express(); app.use(express.json());
        app.use('/studio', createHermesStudioRouter({ pool, executeCreative,
            authMiddleware: (req, res, next) => { req.user = { ...actor, role: 'creator' }; next(); },
            accessGuard: (req, res, next) => next() }));
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const url = 'http://127.0.0.1:' + server.address().port + '/studio/jobs/' + jobId;
        const post = (suffix, body) => originalFetch(url + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        try {
            assert.equal((await post('/execute', { businessContext: 'event_genix', confirmed: false })).status, 400);
            assert.equal(providerCalls, 0);
            const response = await post('/execute', { businessContext: 'event_genix', confirmed: true });
            assert.equal(response.status, 200); const generated = await response.json();
            assert.equal(generated.job.status, 'ready_for_review'); assert.equal(generated.job.assets.length, 1);
            blobNames.push(generated.job.assets[0].storageKey);
            assert.equal(providerCalls, 1);
            const review = await post('/decision', { businessContext: 'event_genix', decision: 'approved', notes: 'Synthetic review' });
            assert.equal(review.status, 200); assert.equal((await review.json()).job.status, 'approved');
            const replay = await post('/execute', { businessContext: 'event_genix', confirmed: true });
            assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true); assert.equal(providerCalls, 1);
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });

    it('connects the OCR HTTP boundary to real PostgreSQL without applying before confirmation', async () => {
        const express = require('express');
        const { createScheduleOcrHandlers } = require('../../services/crmScheduleOcrHttp');
        const { requireAction } = require('../../middleware/auth');
        let providerCalls = 0;
        const env = { CRM_SCHEDULE_OCR_ENABLED: 'true' };
        const schedule = createScheduleOcr({ pool, env, recognize: async () => {
            providerCalls++;
            return [{ employeeName: staff.name, date: '2099-05-01', status: 'dayoff', confidence: 0.99, issues: [] }];
        } });
        const handlers = createScheduleOcrHandlers({ env, schedule });
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.user = { ...actor, role: req.get('x-test-role') || 'creator' }; next(); });
        app.post('/preview', requireAction('hr.schedule.manage'), handlers.preview);
        app.post('/apply', requireAction('hr.schedule.manage'), handlers.apply);
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const url = 'http://127.0.0.1:' + server.address().port;
        const upload = () => {
            const form = new FormData();
            form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic.png');
            form.append('documentDate', '2099-05-01'); form.append('confirmed', 'true');
            return originalFetch(url + '/preview', { method: 'POST', body: form });
        };
        try {
            const denied = await originalFetch(url + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-role': 'animator' }, body: '{}' });
            assert.equal(denied.status, 403);
            const response = await upload(); assert.equal(response.status, 200);
            const preview = await response.json(); assert.equal(preview.rows[0].action, 'create');
            assert.equal((await pool.query('SELECT count(*)::int AS count FROM staff_schedule WHERE staff_id=$1 AND date=$2', [staff.id, '2099-05-01'])).rows[0].count, 0);
            const replay = await (await upload()).json(); assert.equal(replay.importId, preview.importId); assert.equal(providerCalls, 1);
            const apply = confirmed => originalFetch(url + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmed, previewId: preview.importId, selectedRowIds: [preview.rows[0].rowId] }) });
            assert.equal((await apply(false)).status, 400);
            assert.equal((await apply(true)).status, 200);
            assert.equal((await pool.query('SELECT status FROM staff_schedule WHERE staff_id=$1 AND date=$2', [staff.id, '2099-05-01'])).rows[0].status, 'dayoff');
            assert.notEqual((await apply(true)).status, 200);
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });

    it('runs KIE browser Studio through the real HTTP router and PostgreSQL with a fake provider', {
        skip: process.env.RUN_CRM_AUTOMATION_BROWSER_POSTGRES !== 'true' && process.env.RUN_CRM_AUTOMATION_KIE_BROWSER !== 'true'
    }, async () => {
        const express = require('express'); const { WebSocketServer } = require('ws');
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
        const { createServer } = require('../browser/staff-schedule-custom-range-browser-smoke');
        const { createHermesStudioRouter } = require('../../routes/hermes-studio');
        const jobId = await creative(); let providerCalls = 0;
        let ready = false;
        const executeCreative = createCreativeExecutor({pool,
            env:{CRM_CREATIVE_EXECUTION_ENABLED:'true',CRM_CREATIVE_IMAGE_GENERATOR:'kie/gpt-image-2-5-flare-text-to-image'},
            startKie:async()=>{providerCalls++;return {taskId:`synthetic_browser_${jobId}`}},
            pollKie:async taskId=>{assert.equal(taskId,`synthetic_browser_${jobId}`);return ready?{status:'ready',sourceUrl:'https://kie.ai/synthetic.png'}:{status:'generating'}},
            downloadKie:async()=>({...imageResult(),size:'1254x1254'})});
        const app = express(); app.use(express.json());
        app.get('/uploads/catalog-images/items/:filename', require('../../services/imageStorage').buildCatalogImageBlobFallbackHandler(pool));
        app.use('/studio', createHermesStudioRouter({pool,executeCreative,authMiddleware:(req,res,next)=>{req.user={...actor,role:'creator',defaultBusinessContext:'event_genix'};next()},accessGuard:(req,res,next)=>next()}));
        const api = app.listen(0,'127.0.0.1'); await new Promise(resolve=>api.once('listening',resolve));
        const apiBase = 'http://127.0.0.1:' + api.address().port;
        const {server,base:uiBase} = await createServer(); const ws=new WebSocketServer({server});
        ws.on('connection',client=>client.on('message',()=>{}));
        const browser=await chromium.launch({headless:true,executablePath:process.env.CRM_AUTOMATION_CHROME_PATH});
        const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
        try {
            await context.addInitScript(user=>{localStorage.setItem('pzp_token','synthetic-ui-token');localStorage.setItem('pzp_access_token','synthetic-ui-token');localStorage.setItem('pzp_current_user',JSON.stringify(user))},{id:1,name:'Schedule QA',username:'schedule.qa',role:'creator'});
            await context.route('**/*',route=>new URL(route.request().url()).origin===uiBase?route.continue():route.abort());
            const page=await context.newPage(); const statuses=[]; await page.route('**/api/hermes-studio/**',async route=>{
                const u=new URL(route.request().url());const response=await route.fetch({url:apiBase+'/studio'+u.pathname.substring('/api/hermes-studio'.length)+u.search});statuses.push({path:u.pathname,status:response.status()});await route.fulfill({response});
            });
            await page.route('**/uploads/catalog-images/items/*',async route=>{
                const u=new URL(route.request().url());
                const response=await route.fetch({url:apiBase+u.pathname});
                await route.fulfill({response});
            });
            await page.goto(uiBase+'/hermes-studio.html'); const execute=page.locator('#hermesStudioExecuteBtn');
            try { await execute.waitFor({state:'visible',timeout:12000}); } catch { throw new Error('Studio execute unavailable; API statuses: '+JSON.stringify(statuses)); } await execute.click(); await page.locator('.confirm-ok').click();
            await page.waitForFunction(()=>document.querySelector('#hermesStudioExecuteBtn').textContent==='Перевірити результат');
            assert.equal((await jobs.getHermesJobDetail(pool,jobId,'event_genix')).status,'in_progress');
            await page.reload();
            await page.waitForFunction(()=>document.querySelector('#hermesStudioExecuteBtn').textContent==='Перевірити результат');
            ready=true;await execute.click();
            await page.waitForFunction(()=>document.querySelector('#hermesStudioSelectedStatus').textContent==='ready for review');
            assert.equal(providerCalls,1); const detail=await jobs.getHermesJobDetail(pool,jobId,'event_genix');
            assert.equal(detail.status,'ready_for_review'); blobNames.push(detail.assets[0].storageKey);
            assert.equal(await page.locator('.confirm-ok').count(),0);
            await page.waitForFunction(()=>document.querySelector('.hermes-studio-detail img')?.naturalWidth>0);
            if(process.env.CRM_KIE_BROWSER_OUTPUT)await page.screenshot({path:path.join(process.env.CRM_KIE_BROWSER_OUTPUT,'studio-kie-real-postgres.png'),fullPage:true});
            await page.locator('[data-hermes-decision="approved"]').click();
            await page.waitForFunction(()=>document.querySelector('#hermesStudioSelectedStatus').textContent==='approved');
            assert.equal((await jobs.getHermesJobDetail(pool,jobId,'event_genix')).status,'approved');assert.equal(providerCalls,1);
        } finally {await context.close();await browser.close();for(const client of ws.clients)client.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>server.close(resolve));api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
    });

    it('retains the KIE outstanding slot after a user rejects a still-pending task', async () => {
        const jobId = await creative(); let posts = 0;
        const execute = createCreativeExecutor({ pool,
            env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true', CRM_CREATIVE_IMAGE_GENERATOR: 'kie/gpt-image-2-5-flare-text-to-image' },
            startKie: async () => { posts++; return { taskId: 'synthetic_rejected_pending' }; },
            pollKie: async () => ({ status: 'generating' }) });
        await execute({ ...base, jobId });
        const client = await pool.connect();
        try { await transaction(client, () => jobs.recordHermesJobDecision(client, jobId, { decision: 'rejected', notes: 'Synthetic pending-task rejection' }, base)); }
        finally { client.release(); }
        const nextJobId = await creative();
        await assert.rejects(execute({ ...base, jobId: nextJobId }), { code: 'CRM_PROVIDER_BUSY' });
        assert.equal(posts, 1);
        const detail = await jobs.getHermesJobDetail(pool, jobId, 'event_genix');
        assert.equal(detail.status, 'rejected'); assert.equal(detail.resultPayload.outcome, 'pending');
    });

    it('runs browser OCR through the real HTTP handlers and PostgreSQL with a fake provider', { skip: process.env.RUN_CRM_AUTOMATION_BROWSER_POSTGRES !== 'true' }, async () => {
        const express = require('express');
        const { WebSocketServer } = require('ws');
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
        const { createServer, openStaffPage } = require('../browser/staff-schedule-custom-range-browser-smoke');
        const { createScheduleOcrHandlers } = require('../../services/crmScheduleOcrHttp');
        const { requireAction } = require('../../middleware/auth');
        const env = { CRM_SCHEDULE_OCR_ENABLED: 'true' }; let providerCalls = 0;
        // The capacity/replay test uses the same PNG on June 1; a different
        // date ensures this browser flow creates and exercises its own request.
        const schedule = createScheduleOcr({ pool, env, recognize: async () => { providerCalls++;
            return [{ employeeName: staff.name, date: '2099-07-01', status: 'dayoff', confidence: 0.99, issues: [] }]; } });
        const handlers = createScheduleOcrHandlers({ env, schedule });
        const app = express(); app.use(express.json()); app.use((req,res,next) => { req.user = { ...actor, role: 'creator' }; next(); });
        app.post('/preview', requireAction('hr.schedule.manage'), handlers.preview);
        app.post('/apply', requireAction('hr.schedule.manage'), handlers.apply);
        const api = app.listen(0, '127.0.0.1'); await new Promise(resolve => api.once('listening', resolve));
        const apiBase = 'http://127.0.0.1:' + api.address().port;
        const { server, base: uiBase } = await createServer();
        const ws = new WebSocketServer({ server }); ws.on('connection', client => client.on('message', () => {}));
        const browser = await chromium.launch({ headless:true, executablePath:process.env.CRM_AUTOMATION_CHROME_PATH });
        let context;
        try {
            const opened = await openStaffPage(browser, uiBase, {width:1440,height:1000}, {serviceWorkers:'block', preparePage: async page => {
                await page.context().route('**/*', route => new URL(route.request().url()).origin === uiBase ? route.continue() : route.abort());
                await page.route('**/api/staff/schedule/ocr-*', async route => {
                    const suffix = route.request().url().endsWith('ocr-preview') ? '/preview' : '/apply';
                    const response = await route.fetch({ url: apiBase + suffix });
                    await route.fulfill({ response });
                });
            } });
            context = opened.context; const page = opened.page;
            await page.locator('#scheduleOcrPanel summary').click();
            await page.locator('#scheduleOcrDate').fill('2099-07-01');
            await page.locator('#scheduleOcrFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
            await page.locator('#scheduleOcrPaidConfirm').check(); await page.locator('#scheduleOcrPreviewBtn').click();
            await page.locator('#scheduleOcrReview').waitFor({state:'visible'});
            assert.equal(providerCalls,1);
            assert.equal((await pool.query('SELECT count(*)::int AS count FROM staff_schedule WHERE staff_id=$1 AND date=$2',[staff.id,'2099-07-01'])).rows[0].count,0);
            await page.locator('[data-ocr-row="0"]').check(); await page.locator('#scheduleOcrApplyConfirm').check();
            await page.locator('#scheduleOcrApplyBtn').click();
            await page.waitForFunction(() => document.querySelector('#scheduleOcrStatus').textContent.includes('застосовано'));
            assert.equal((await pool.query('SELECT status FROM staff_schedule WHERE staff_id=$1 AND date=$2',[staff.id,'2099-07-01'])).rows[0].status,'dayoff');
            assert.equal(providerCalls,1);
        } finally {
            if(context) await context.close(); await browser.close();
            for(const client of ws.clients) client.terminate(); await new Promise(resolve => ws.close(resolve));
            await new Promise(resolve => server.close(resolve)); api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
        }
    });

    it('keeps task and outbox creation atomic, sends one approved personal event and replays without sending', async () => {
        const client = await pool.connect();
        let rolledBackId;
        try {
            await client.query('BEGIN');
            const task = (await client.query(`INSERT INTO tasks (title,status,owner_user_id,business_context) VALUES ($1,'todo',$2,'event_genix') RETURNING *`, [runId, actor.id])).rows[0];
            rolledBackId = (await outbox.createNotificationOutboxEvent({ task, eventType: 'task_created' }, { pool: client })).event.event_id;
            await client.query('ROLLBACK');
        } finally { client.release(); }
        assert.equal(await outbox.findNotificationOutboxEventByEventId(rolledBackId, { pool }), null);
        const event = await notification();
        let sends = 0;
        const send = delivery(event, async ({ recipient, idempotencyKey }) => {
            sends++; assert.equal(recipient.chatId, '123456789'); assert.equal(idempotencyKey, event.event_id); return { accepted: true };
        });
        assert.equal((await send({ ...base, eventId: event.event_id })).status, 'sent');
        assert.equal((await send({ ...base, eventId: event.event_id })).status, 'already_sent');
        assert.equal(sends, 1);
        assert.equal((await outbox.findNotificationOutboxEventByEventId(event.event_id, { pool })).status, 'sent');
    });

    it('persists definite-send retries and quarantines ambiguous outcomes without group fallback or backlog replay', async () => {
        const retry = await notification();
        const rejected = delivery(retry, async () => ({ accepted: false, definitelyNotSent: true, retryable: true }));
        assert.equal((await rejected({ ...base, eventId: retry.event_id })).status, 'retry_scheduled');
        const failed = await outbox.findNotificationOutboxEventByEventId(retry.event_id, { pool });
        assert.equal(failed.status, 'failed');
        assert.ok(new Date(failed.available_at) > new Date(failed.updated_at));

        const ambiguous = await notification();
        let sends = 0;
        const uncertain = delivery(ambiguous, async () => { sends++; throw new Error('synthetic connection lost'); });
        await assert.rejects(uncertain({ ...base, eventId: ambiguous.event_id }), { code: 'CRM_DELIVERY_OUTCOME_UNKNOWN' });
        assert.equal((await outbox.findNotificationOutboxEventByEventId(ambiguous.event_id, { pool })).status, 'dead_letter');
        await assert.rejects(uncertain({ ...base, eventId: ambiguous.event_id }));
        assert.equal(sends, 1);

        const expiredClaim = await notification();
        await pool.query(`UPDATE notification_outbox SET status='claimed', claimed_by='old-synthetic-sender',
            locked_until=NOW()-INTERVAL '1 minute' WHERE event_id=$1`, [expiredClaim.event_id]);
        let expiredSends = 0;
        const blocked = delivery(expiredClaim, async () => { expiredSends++; return { accepted: true }; });
        await assert.rejects(blocked({ ...base, eventId: expiredClaim.event_id }), { code: 'OUTBOX_EVENT_ALREADY_CLAIMED' });
        assert.equal(expiredSends, 0);
        const stillClaimed = await outbox.findNotificationOutboxEventByEventId(expiredClaim.event_id, { pool });
        assert.equal(stillClaimed.status, 'claimed');
        assert.equal(stillClaimed.claimed_by, 'old-synthetic-sender');

        const raced = await notification();
        let racedSends = 0;
        const racedDelivery = createNotificationDelivery({ pool,
            env: { CRM_TASK_DELIVERY_ENABLED: 'true', CRM_TASK_DELIVERY_CUTOVER_CONFIRMED: 'true',
                CRM_TASK_DELIVERY_NOT_BEFORE: new Date(Date.now() - 60000).toISOString(),
                CRM_TASK_DELIVERY_APPROVED_EVENT_IDS: raced.event_id },
            resolveRecipient: async () => {
                await pool.query(`UPDATE notification_outbox SET status='claimed', claimed_by='other-synthetic-sender',
                    locked_until=NOW()-INTERVAL '1 minute' WHERE event_id=$1`, [raced.event_id]);
                return { ownerUserId: actor.id, chatId: '123456789' };
            },
            transport: async () => { racedSends++; return { accepted: true }; }
        });
        await assert.rejects(racedDelivery({ ...base, eventId: raced.event_id }), { code: 'OUTBOX_EVENT_ALREADY_CLAIMED' });
        assert.equal(racedSends, 0, 'claim must remain fenced after a concurrent state change');

        const legacyClaim = await notification();
        await pool.query(`UPDATE notification_outbox SET status='claimed', claimed_by='old-synthetic-sender',
            locked_until=NOW()-INTERVAL '1 minute' WHERE event_id=$1`, [legacyClaim.event_id]);
        const legacyResult = await outbox.claimNotificationOutboxEvent(legacyClaim.event_id,
            { workerId: 'legacy-synthetic-sender' }, { pool });
        assert.equal(legacyResult.claimed, true, 'existing callers retain their prior reclaim behavior');

        const group = await notification();
        await assert.rejects(delivery(group, () => assert.fail('Group transport must not run'), { ownerUserId: actor.id, chatId: '-123' })({ ...base, eventId: group.event_id }),
            { code: 'CRM_DELIVERY_PERSONAL_ROUTE_REQUIRED' });
        await pool.query("UPDATE notification_outbox SET created_at=NOW()-INTERVAL '1 day' WHERE event_id=$1", [group.event_id]);
        await assert.rejects(delivery(group, () => assert.fail('Backlog transport must not run'))({ ...base, eventId: group.event_id }),
            { code: 'CRM_DELIVERY_BACKLOG_REQUIRES_REVIEW' });
        assert.equal((await outbox.findNotificationOutboxEventByEventId(group.event_id, { pool })).status, 'pending');
    });
});
