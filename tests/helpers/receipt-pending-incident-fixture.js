'use strict';

const assert = require('node:assert/strict');

const sharedTestJob = Object.freeze({
    id: 101, fiscal_profile_id: 11, fiscal_register_id: 31,
    fiscal_operation_id: 21, payment_order_id: 41,
    operation_type: 'sale', job_type: 'receipt_sell', expected_is_test: true,
    current_expected_is_test: 'true', register_alias: 'shared_test',
    current_crm_profile_key: 'event_genix', current_profile_crm_profile_key: 'event_genix'
});

// Temporary tables shadow the ledger only on this disposable test connection.
// Execute the real resolver SQL, including its atomic audit INSERT, in PostgreSQL.
async function assertReceiptPendingSql(client, resolveIncidents) {
    await client.query('BEGIN');
    try {
        await client.query(`
            CREATE TEMP TABLE fiscal_operational_incidents (
                id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT NOT NULL,
                fiscal_register_id BIGINT, fiscal_operation_id BIGINT, payment_order_id BIGINT,
                status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')),
                incident_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
                details JSONB NOT NULL, recurrence_count INTEGER NOT NULL DEFAULT 0, resolved_at TIMESTAMPTZ
            ) ON COMMIT DROP;
            CREATE TEMP TABLE payment_outbox_jobs (
                id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT, fiscal_operation_id BIGINT,
                payment_order_id BIGINT, job_type TEXT
            ) ON COMMIT DROP;
            CREATE TEMP TABLE fiscal_audit_events (
                fiscal_profile_id BIGINT NOT NULL, actor_user_id INTEGER, event_type VARCHAR(80) NOT NULL,
                entity_table VARCHAR(80) NOT NULL, entity_id BIGINT, idempotency_key VARCHAR(160),
                after_snapshot JSONB, metadata JSONB NOT NULL
            ) ON COMMIT DROP;
            INSERT INTO payment_outbox_jobs VALUES
                (101,11,21,41,'receipt_sell'), (102,11,21,41,'receipt_status_lookup');
        `);
        const rows = [];
        const incident = (id, changes = {}, details = {}) => {
            const row = {id,fiscal_profile_id:11,fiscal_register_id:31,fiscal_operation_id:21,payment_order_id:41,status:'open',incident_type:'fiscal.unknown',idempotency_key:`fixture:${id}`,details:{job_id:101,error_code:'checkbox_receipt_pending',external_stage:'receipt_lookup',...details},...changes};
            rows.push(row);return row;
        };
        incident(1,{idempotency_key:'payment_outbox_incident:101:checkbox_receipt_pending'});
        incident(2,{status:'acknowledged',incident_type:'payment_outbox.failed',idempotency_key:'payment_outbox_incident:102:provider_receipt_pending'},{job_id:102,error_code:'provider_receipt_pending'});
        incident(3,{}, {error_code:'validation_failed'});
        incident(4,{}, {error_code:'ETIMEDOUT'});
        incident(5,{fiscal_operation_id:99});
        incident(6,{fiscal_register_id:99});
        incident(7,{fiscal_profile_id:99});
        incident(8,{payment_order_id:99});
        incident(9,{}, {external_stage:'receipt_validation'});
        incident(10,{}, {job_id:999});
        incident(11,{status:'resolved'});
        incident(12,{incident_type:'payment_outbox.dead',idempotency_key:'payment_outbox_incident:101:dead'});
        incident(13,{}, {job_id:103});
        incident(14,{}, {job_id:104});
        incident(15,{}, {job_id:'malformed'});
        incident(16);
        for (const row of rows.filter(row=>row.id>2)) {
            const jobId=100+row.id;
            row.details.job_id = row.id===15 ? 'malformed' : jobId;
            row.idempotency_key = row.id===16 ? 'fixture:wrong-key'
                : `payment_outbox_incident:${row.details.job_id}:${row.id===12 ? 'dead' : row.details.error_code}`;
            if (row.id!==10 && row.id!==15) {
                await client.query('INSERT INTO payment_outbox_jobs VALUES ($1,11,$2,41,$3)',
                    [jobId,row.id===13?99:21,row.id===14?'receipt_validate':'receipt_sell']);
            }
        }
        await client.query(`INSERT INTO fiscal_operational_incidents
            (id,fiscal_profile_id,fiscal_register_id,fiscal_operation_id,payment_order_id,status,incident_type,idempotency_key,details)
            SELECT id,fiscal_profile_id,fiscal_register_id,fiscal_operation_id,payment_order_id,status,incident_type,idempotency_key,details
              FROM jsonb_to_recordset($1::jsonb) AS x(id BIGINT,fiscal_profile_id BIGINT,fiscal_register_id BIGINT,fiscal_operation_id BIGINT,payment_order_id BIGINT,status TEXT,incident_type TEXT,idempotency_key TEXT,details JSONB)`, [JSON.stringify(rows)]);
        const snapshot = () => client.query('SELECT * FROM fiscal_operational_incidents ORDER BY id');
        const before = (await snapshot()).rows;
        await client.query('SAVEPOINT before_resolution');
        await resolveIncidents(client,{job:sharedTestJob});
        const after = (await snapshot()).rows;
        assert.deepEqual(after.filter(row=>row.id<=2).map(row=>row.status),['resolved','resolved']);
        assert.deepEqual(after.filter(row=>row.id>2),before.filter(row=>row.id>2));
        const audits = (await client.query('SELECT * FROM fiscal_audit_events ORDER BY entity_id')).rows;
        assert.equal(audits.length,2);
        assert.ok(audits.every(row=>row.event_type==='fiscal_incident_resolved' && row.metadata.reason==='verified_sale_receipt_completed'));
        await resolveIncidents(client,{job:sharedTestJob});
        assert.equal((await client.query('SELECT * FROM fiscal_audit_events')).rows.length,2,'repeated completion must not duplicate audit');
        await client.query('ROLLBACK TO SAVEPOINT before_resolution');
        assert.deepEqual((await snapshot()).rows,before);
        assert.equal((await client.query('SELECT * FROM fiscal_audit_events')).rows.length,0);
        // An audit failure must undo the CTE's incident update as well.
        await client.query("ALTER TABLE fiscal_audit_events ADD CONSTRAINT reject_fixture_audit CHECK (event_type <> 'fiscal_incident_resolved')");
        await client.query('SAVEPOINT failing_audit');
        await assert.rejects(resolveIncidents(client,{job:sharedTestJob}),error=>error.code==='23514');
        await client.query('ROLLBACK TO SAVEPOINT failing_audit');
        assert.deepEqual((await snapshot()).rows,before);
        assert.equal(before.length,16);
    } finally { await client.query('ROLLBACK'); }
}

module.exports = { sharedTestJob, assertReceiptPendingSql };
