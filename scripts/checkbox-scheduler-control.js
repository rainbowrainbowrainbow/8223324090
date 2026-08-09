#!/usr/bin/env node
'use strict';

const { pool } = require('../db');
const { canUseAction } = require('../middleware/auth');

const MODES = new Set(['status', 'resume']);
const CHECKBOX_SCHEDULERS = new Set(['runCheckboxReadinessProbeScheduler', 'processPaymentOutboxJobs']);

function parseArgs(argv) {
    const args = { mode: 'status' };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
        args[key] = value;
        index += 1;
    }
    if (!MODES.has(args.mode)) throw new Error(`Unsupported mode: ${args.mode}`);
    return args;
}

function positiveInt(value, label) {
    if (!/^\d+$/.test(String(value || ''))) throw new Error(`${label} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a safe positive integer`);
    return parsed;
}

async function loadActor(client, actorUserId, action = 'fiscal.configure') {
    const result = await client.query(
        `SELECT id, username, name, role, extra_roles, action_allowlist, action_denylist,
                business_contexts, default_business_context, is_active
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [actorUserId]
    );
    const actor = result.rows[0];
    if (!actor || actor.is_active === false) throw new Error('Active actor user is required');
    if (!canUseAction(actor, action)) throw new Error(`Actor lacks required capability ${action}`);
    return actor;
}

async function auditSchedulerControl(client, { fiscalProfileId, actorUserId, eventType, schedulerName, reason = null }) {
    await client.query(
        `INSERT INTO fiscal_audit_events (
         fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
         idempotency_key, metadata
         ) VALUES ($1, $2, $3, 'scheduler_executions', NULL, $4, $5::jsonb)`,
        [
            fiscalProfileId,
            actorUserId,
            eventType,
            `checkbox-scheduler-control:${eventType}:${schedulerName || 'all'}:${Date.now()}`,
            JSON.stringify({ scheduler_name: schedulerName || null, reason, actor_user_id: actorUserId, fiscal_profile_id: fiscalProfileId })
        ]
    );
}

async function status(client, schedulerName = null) {
    const params = [];
    let where = `WHERE scheduler_name = ANY($1::text[])`;
    params.push([...CHECKBOX_SCHEDULERS]);
    if (schedulerName) {
        if (!CHECKBOX_SCHEDULERS.has(schedulerName)) throw new Error(`Unsupported Checkbox scheduler: ${schedulerName}`);
        where += ` AND scheduler_name = $2`;
        params.push(schedulerName);
    }
    const result = await client.query(
        `SELECT scheduler_name, last_run_at, last_run_date, result, consecutive_failures,
                is_paused, error_message, duration_ms
           FROM scheduler_executions
          ${where}
          ORDER BY scheduler_name`,
        params
    );
    return result.rows;
}

async function resume(client, args) {
    const schedulerName = String(args.scheduler || '').trim();
    if (!CHECKBOX_SCHEDULERS.has(schedulerName)) throw new Error(`Unsupported Checkbox scheduler: ${schedulerName}`);
    const actorUserId = positiveInt(args.actorUserId, '--actor-user-id');
    const fiscalProfileId = positiveInt(args.profileId, '--profile-id');
    const reason = String(args.reason || '').trim();
    if (!reason) throw new Error('--reason is required for resume');
    const actor = await loadActor(client, actorUserId);
    const result = await client.query(
        `UPDATE scheduler_executions
            SET is_paused = false,
                consecutive_failures = 0,
                result = 'resumed',
                error_message = NULL,
                last_run_at = NOW()
          WHERE scheduler_name = $1
          RETURNING scheduler_name, is_paused, consecutive_failures, result`,
        [schedulerName]
    );
    await auditSchedulerControl(client, { fiscalProfileId, actorUserId: actor.id, eventType: 'checkbox_scheduler_resumed', schedulerName, reason });
    return result.rows[0] || { scheduler_name: schedulerName, is_paused: false, consecutive_failures: 0, result: 'not_found' };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const client = await pool.connect();
    try {
        if (args.mode === 'status') {
            const actorUserId = positiveInt(args.actorUserId, '--actor-user-id');
            const fiscalProfileId = positiveInt(args.profileId, '--profile-id');
            const actor = await loadActor(client, actorUserId, 'fiscal.audit.view');
            await client.query('BEGIN');
            const schedulers = await status(client, args.scheduler);
            await auditSchedulerControl(client, { fiscalProfileId, actorUserId: actor.id, eventType: 'checkbox_scheduler_status_viewed', schedulerName: args.scheduler || null });
            await client.query('COMMIT');
            console.log(JSON.stringify({ ok: true, schedulers }, null, 2));
            return;
        }
        await client.query('BEGIN');
        const resumed = await resume(client, args);
        await client.query('COMMIT');
        console.log(JSON.stringify({ ok: true, resumed }, null, 2));
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}
