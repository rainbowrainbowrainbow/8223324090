#!/usr/bin/env node
'use strict';

const { pool } = require('../db');

function parseArgs(argv) {
    const args = {
        crmProfileKey: 'event_genix',
        registerAlias: 'middle',
        mode: 'status'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
        args[key] = value;
        index += 1;
    }
    if (!['status', 'sync-plan'].includes(args.mode)) {
        throw new Error(`Unsupported mode: ${args.mode}`);
    }
    return args;
}

function asNumber(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const client = await pool.connect();
    try {
        const mapping = await client.query(
            `SELECT fp.id AS fiscal_profile_id,
                    fp.crm_profile_key,
                    fp.legal_entity_key,
                    fr.id AS fiscal_register_id,
                    fr.register_alias,
                    fr.feature_enabled,
                    fr.status AS register_status
               FROM fiscal_profiles fp
               JOIN fiscal_registers fr
                 ON fr.fiscal_profile_id = fp.id
                AND fr.crm_profile_key = fp.crm_profile_key
              WHERE fp.crm_profile_key = $1
                AND fr.register_alias = $2
              ORDER BY fp.id, fr.id`,
            [args.crmProfileKey, args.registerAlias]
        );
        if (mapping.rows.length !== 1) {
            console.log(JSON.stringify({ ok: false, code: mapping.rows.length > 1 ? 'mapping_ambiguous' : 'mapping_missing', matches: mapping.rows.length }, null, 2));
            return;
        }
        const row = mapping.rows[0];
        const readiness = await client.query(
            `SELECT readiness_code, integration_ready, provider_unavailable, stale_readiness,
                    shift_state, checked_at, expires_at, result_snapshot
               FROM checkbox_readiness_snapshots
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
              ORDER BY checked_at DESC, id DESC
              LIMIT 1`,
            [row.fiscal_profile_id, row.fiscal_register_id]
        );
        const queue = await client.query(
            `SELECT COUNT(*) FILTER (WHERE job.status IN ('queued', 'failed', 'claimed', 'running')) AS queue_depth,
                    MIN(job.created_at) FILTER (WHERE job.status IN ('queued', 'failed', 'claimed', 'running')) AS oldest_pending_at,
                    COUNT(*) FILTER (WHERE fo.status = 'unknown' OR po.fiscal_status = 'unknown') AS unknown_count,
                    COUNT(*) FILTER (WHERE job.status = 'dead') AS dead_count
               FROM payment_outbox_jobs job
               LEFT JOIN fiscal_operations fo
                 ON fo.id = job.fiscal_operation_id
                AND fo.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN payment_orders po
                 ON po.id = job.payment_order_id
                AND po.fiscal_profile_id = job.fiscal_profile_id
              WHERE job.fiscal_profile_id = $1
                AND COALESCE(po.fiscal_register_id, fo.fiscal_register_id) = $2`,
            [row.fiscal_profile_id, row.fiscal_register_id]
        );
        const shifts = await client.query(
            `SELECT id, status, lifecycle_stage, provider_shift_id, opened_at, closed_at
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status IN ('opening', 'open', 'closing')
              ORDER BY opened_at DESC NULLS LAST, id DESC
              LIMIT 5`,
            [row.fiscal_profile_id, row.fiscal_register_id]
        );
        const latest = readiness.rows[0] || null;
        const payload = {
            ok: true,
            mode: args.mode,
            crmProfileKey: row.crm_profile_key,
            fiscalProfileId: Number(row.fiscal_profile_id),
            fiscalRegisterId: Number(row.fiscal_register_id),
            registerAlias: row.register_alias,
            registerStatus: row.register_status,
            registerFeatureEnabled: Boolean(row.feature_enabled),
            readiness: latest ? {
                code: latest.readiness_code,
                integrationReady: Boolean(latest.integration_ready),
                providerUnavailable: Boolean(latest.provider_unavailable),
                staleReadiness: Boolean(latest.stale_readiness) || new Date(latest.expires_at).getTime() <= Date.now(),
                shiftState: latest.shift_state,
                checkedAt: latest.checked_at,
                expiresAt: latest.expires_at
            } : null,
            queue: {
                depth: asNumber(queue.rows[0]?.queue_depth),
                oldestPendingAt: queue.rows[0]?.oldest_pending_at || null,
                unknownCount: asNumber(queue.rows[0]?.unknown_count),
                deadCount: asNumber(queue.rows[0]?.dead_count)
            },
            localShifts: shifts.rows.map(shift => ({
                id: Number(shift.id),
                status: shift.status,
                lifecycleStage: shift.lifecycle_stage,
                providerShiftId: shift.provider_shift_id || null,
                openedAt: shift.opened_at || null,
                closedAt: shift.closed_at || null
            })),
            syncPlan: args.mode === 'sync-plan'
                ? 'Read-only. If Checkbox portal shows this shift closed while EventGenix is open/closing, run an authorized app sync/close flow; this script does not mutate DB.'
                : undefined
        };
        console.log(JSON.stringify(payload, null, 2));
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

main().catch(error => {
    console.error(JSON.stringify({ ok: false, code: error.code || 'checkbox_readiness_status_failed', error: error.message }, null, 2));
    process.exitCode = 1;
});
