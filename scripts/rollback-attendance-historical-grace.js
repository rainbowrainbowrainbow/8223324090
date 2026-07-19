#!/usr/bin/env node
'use strict';

/**
 * Rollback CLI for historical attendance grace data-fix.
 *
 * Default mode is dry-run. Apply mode restores only rows from a verified backup
 * artifact and aborts if current values drifted from the applied after-values.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
    assertPayrollWriteAllowed,
    beginApplyTransaction,
    loadBackupArtifact,
    loadPayrollImpact,
    lockPayrollGateTables,
    sslConfigForConnectionString,
    summarizeChanges
} = require('./fix-attendance-historical-grace');

const AUDIT_ACTOR_MAX_LENGTH = 50;

function usage() {
    return [
        'Usage:',
        '  node scripts/rollback-attendance-historical-grace.js --backup-file <absolute-backup-json> --plan-hash <hash> --executed-by "operator" --reason "rollback reason" [--format json|markdown]',
        '',
        'Apply, only after owner review of dry-run rollback output:',
        '  node scripts/rollback-attendance-historical-grace.js --apply --backup-file <absolute-backup-json> --plan-hash <hash> --executed-by "operator" --reason "rollback reason" --confirm <exact-confirmation>',
        '',
        'Connection:',
        '  Dry-run: ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL only.',
        '  Apply: ATTENDANCE_DATA_FIX_DATABASE_URL only.'
    ].join('\n');
}

function defaultExecutedBy() {
    return String(process.env.USERNAME || process.env.USER || 'codex_operator').trim();
}

function normalizeActor(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} is required`);
    if (text.length > AUDIT_ACTOR_MAX_LENGTH) {
        throw new Error(`${label} must be ${AUDIT_ACTOR_MAX_LENGTH} characters or less`);
    }
    return text;
}

function expectedRollbackConfirmation(planHash) {
    return `ROLLBACK_ATTENDANCE_HISTORICAL_FIX_${String(planHash || '').slice(0, 12)}`;
}

function parseArgs(argv) {
    const options = {
        apply: false,
        dryRun: true,
        backupFile: '',
        planHash: '',
        executedBy: '',
        reason: '',
        confirm: '',
        format: 'json',
        output: ''
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const readValue = name => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
            index += 1;
            return value.trim();
        };
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--apply') {
            options.apply = true;
            options.dryRun = false;
        } else if (arg === '--dry-run') {
            options.apply = false;
            options.dryRun = true;
        } else if (['--fix', '--write', '--execute', '--update'].includes(arg)) {
            throw new Error(`${arg} is not supported. Use --apply only after reviewed rollback dry-run approval.`);
        } else if (arg === '--backup-file') options.backupFile = readValue(arg);
        else if (arg === '--plan-hash') options.planHash = readValue(arg);
        else if (arg === '--executed-by') options.executedBy = readValue(arg);
        else if (arg === '--reason') options.reason = readValue(arg);
        else if (arg === '--confirm') options.confirm = readValue(arg);
        else if (arg === '--format') options.format = readValue(arg).toLowerCase();
        else if (arg === '--output') options.output = readValue(arg);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.help) return options;
    if (!path.isAbsolute(options.backupFile || '')) throw new Error('--backup-file must be an absolute path');
    if (!/^[a-f0-9]{64}$/i.test(options.planHash || '')) throw new Error('--plan-hash must be a 64 character SHA-256 hash');
    options.executedBy = normalizeActor(options.executedBy || defaultExecutedBy(), '--executed-by');
    options.reason = String(options.reason || '').trim();
    if (!options.reason) throw new Error('--reason is required');
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown');
    if (options.apply) {
        const expected = expectedRollbackConfirmation(options.planHash);
        if (options.confirm !== expected) {
            throw new Error(`--confirm must exactly equal: ${expected}`);
        }
    }
    return options;
}

function poolConfig(options) {
    const connectionString = options.apply
        ? process.env.ATTENDANCE_DATA_FIX_DATABASE_URL
        : (
            process.env.ATTENDANCE_AUDIT_DATABASE_URL
            || process.env.PRODUCTION_READONLY_DATABASE_URL
            || ''
        );
    if (connectionString) {
        return {
            connectionString,
            ssl: sslConfigForConnectionString(connectionString),
            application_name: options.apply
                ? 'attendance_historical_grace_rollback_apply'
                : 'attendance_historical_grace_rollback_dry_run'
        };
    }
    if (options.apply) throw new Error('Set ATTENDANCE_DATA_FIX_DATABASE_URL before rollback --apply');
    throw new Error('Set ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL before rollback dry-run');
}

function loadVerifiedBackup(options) {
    const artifact = loadBackupArtifact(options.backupFile);
    if (artifact.payload.planHash !== options.planHash || artifact.manifest.planHash !== options.planHash) {
        throw new Error('Backup artifact planHash does not match --plan-hash');
    }
    const changes = artifact.payload.plannedChanges || [];
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('Backup artifact has no plannedChanges to roll back');
    }
    return { artifact, changes };
}

function nullableInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
}

function sameValue(actual, expected) {
    return (actual ?? null) === (expected ?? null);
}

async function loadCurrentRows(client, changes, forUpdate = false) {
    const ids = changes.map(change => Number(change.id));
    const result = await client.query(
        `SELECT id,
                record_date::text AS record_date,
                COALESCE(business_context, 'event_genix') AS business_context,
                clock_in::text AS clock_in,
                clock_out::text AS clock_out,
                planned_start::text AS planned_start,
                planned_end::text AS planned_end,
                status,
                late_minutes::int AS late_minutes,
                early_leave_minutes::int AS early_leave_minutes,
                overtime_minutes::int AS overtime_minutes,
                COALESCE(total_worked_minutes, 0)::int AS total_worked_minutes
           FROM hr_time_records
          WHERE id = ANY($1::int[])
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [ids]
    );
    return new Map(result.rows.map(row => [Number(row.id), row]));
}

function assertRollbackCurrentState(rowsById, changes) {
    for (const change of changes) {
        const row = rowsById.get(Number(change.id));
        if (!row) throw new Error('Rollback drift detected: an attendance record is missing');
        if (row.record_date !== change.record_date) throw new Error('Rollback drift detected: record_date changed');
        if (row.business_context !== change.business_context) throw new Error('Rollback drift detected: business_context changed');
        for (const key of ['clock_in', 'clock_out', 'planned_start', 'planned_end']) {
            if (!sameValue(row[key], change.immutable?.[key])) {
                throw new Error(`Rollback drift detected: immutable ${key} changed`);
            }
        }
        if (!sameValue(nullableInteger(row.total_worked_minutes), change.immutable?.total_worked_minutes)) {
            throw new Error('Rollback drift detected: total_worked_minutes changed');
        }
        for (const [key, expected] of Object.entries(change.after)) {
            const actual = key.endsWith('_minutes') ? nullableInteger(row[key]) : (row[key] ?? null);
            if (!sameValue(actual, expected)) {
                throw new Error(`Rollback drift detected: ${key} no longer matches applied value`);
            }
        }
    }
}

async function applyRollback(client, options, artifact, changes) {
    const payload = changes.map(change => ({
        id: change.id,
        record_date: change.record_date,
        business_context: change.business_context,
        after_status: change.after.status,
        after_late_minutes: change.after.late_minutes,
        after_early_leave_minutes: change.after.early_leave_minutes,
        after_overtime_minutes: change.after.overtime_minutes,
        restore_status: change.before.status,
        restore_late_minutes: change.before.late_minutes,
        restore_overtime_minutes: change.before.overtime_minutes
    }));
    const updated = await client.query(
        `WITH changes AS (
            SELECT *
              FROM jsonb_to_recordset($1::jsonb)
                   AS x(
                       id int,
                       record_date text,
                       business_context text,
                       after_status text,
                       after_late_minutes int,
                       after_early_leave_minutes int,
                       after_overtime_minutes int,
                       restore_status text,
                       restore_late_minutes int,
                       restore_overtime_minutes int
                   )
         )
         UPDATE hr_time_records tr
            SET late_minutes = changes.restore_late_minutes,
                overtime_minutes = changes.restore_overtime_minutes,
                status = changes.restore_status,
                updated_at = NOW()
           FROM changes
          WHERE tr.id = changes.id
            AND tr.record_date = changes.record_date::date
            AND COALESCE(tr.business_context, 'event_genix') = changes.business_context
            AND tr.status IS NOT DISTINCT FROM changes.after_status
            AND tr.late_minutes IS NOT DISTINCT FROM changes.after_late_minutes
            AND tr.early_leave_minutes IS NOT DISTINCT FROM changes.after_early_leave_minutes
            AND tr.overtime_minutes IS NOT DISTINCT FROM changes.after_overtime_minutes
          RETURNING tr.id`,
        [JSON.stringify(payload)]
    );
    if (updated.rowCount !== changes.length) {
        throw new Error(`Rollback updated ${updated.rowCount} rows, expected ${changes.length}`);
    }
    const auditPayload = changes.map(change => ({
        staff_id: change.staff_id,
        details: {
            script: 'rollback-attendance-historical-grace',
            source_script: 'fix-attendance-historical-grace',
            operation_id: artifact.payload.approvalManifest?.operationId || artifact.manifest.operationId,
            plan_hash: artifact.payload.planHash,
            backup_artifact_id: artifact.manifest.artifactId,
            backup_checksum_sha256: artifact.manifest.checksumSha256,
            executed_by: options.executedBy,
            reason: options.reason,
            record_id: change.id,
            record_date: change.record_date,
            business_context: change.business_context,
            categories: change.categories,
            restored_from: change.after,
            restored_to: change.before
        }
    }));
    const audit = await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         SELECT 'attendance_historical_grace_data_fix_rollback',
                x.staff_id,
                $2,
                x.details,
                NULL
           FROM jsonb_to_recordset($1::jsonb)
                AS x(staff_id int, details jsonb)
         RETURNING id`,
        [JSON.stringify(auditPayload), options.executedBy]
    );
    if (audit.rowCount !== changes.length) {
        throw new Error(`Rollback inserted ${audit.rowCount} audit rows, expected ${changes.length}`);
    }
    const operationDetails = {
        script: 'rollback-attendance-historical-grace',
        operation_id: artifact.payload.approvalManifest?.operationId || artifact.manifest.operationId,
        plan_hash: artifact.payload.planHash,
        backup_artifact_id: artifact.manifest.artifactId,
        backup_checksum_sha256: artifact.manifest.checksumSha256,
        executed_by: options.executedBy,
        reason: options.reason,
        summary: summarizeChanges(changes)
    };
    const operationAudit = await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('attendance_historical_grace_rollback_operation', NULL, $1, $2::jsonb, NULL)
         RETURNING id`,
        [options.executedBy, JSON.stringify(operationDetails)]
    );
    if (operationAudit.rowCount !== 1) {
        throw new Error(`Rollback inserted ${operationAudit.rowCount} operation audit rows, expected 1`);
    }
    return { updatedRows: updated.rowCount, auditRows: audit.rowCount, operationAuditRows: operationAudit.rowCount };
}

function buildReport(options, artifact, changes, payrollImpact, extra = {}) {
    return {
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'apply' : 'dry_run',
        planHash: options.planHash,
        backupArtifact: {
            artifactId: artifact.manifest.artifactId,
            checksumSha256: artifact.manifest.checksumSha256,
            operationId: artifact.manifest.operationId,
            rowCounts: artifact.manifest.rowCounts
        },
        approval: {
            executedBy: options.executedBy,
            reason: options.reason
        },
        summary: summarizeChanges(changes),
        payrollImpact,
        applyGate: options.apply ? {
            confirmAccepted: options.confirm === expectedRollbackConfirmation(options.planHash)
        } : {
            nextStep: 'Review this rollback dry-run output. Apply requires --confirm equal to requiredConfirm.',
            requiredConfirm: expectedRollbackConfirmation(options.planHash)
        },
        ...extra
    };
}

async function runRollback(options) {
    const { artifact, changes } = loadVerifiedBackup(options);
    const config = poolConfig(options);
    const { Pool } = require('pg');
    const pool = new Pool(config);
    const client = await pool.connect();
    try {
        if (options.apply) {
            await beginApplyTransaction(client);
            const lockedTables = await lockPayrollGateTables(client);
            const rowsById = await loadCurrentRows(client, changes, true);
            assertRollbackCurrentState(rowsById, changes);
            const payrollImpact = await loadPayrollImpact(client, changes);
            assertPayrollWriteAllowed(payrollImpact);
            const rollbackResult = await applyRollback(client, options, artifact, changes);
            const readBack = await loadCurrentRows(client, changes, false);
            for (const change of changes) {
                const row = readBack.get(Number(change.id));
                if (!row) throw new Error('Rollback read-back failed: record missing');
                for (const [key, expected] of Object.entries(change.before)) {
                    const actual = key.endsWith('_minutes') ? nullableInteger(row[key]) : (row[key] ?? null);
                    if (!sameValue(actual, expected)) {
                        throw new Error(`Rollback read-back failed: ${key} was not restored`);
                    }
                }
            }
            const payrollImpactBeforeCommit = await loadPayrollImpact(client, changes);
            assertPayrollWriteAllowed(payrollImpactBeforeCommit);
            await client.query('COMMIT');
            return buildReport(options, artifact, changes, payrollImpact, {
                applied: true,
                rollbackResult,
                lockedTables,
                payrollImpactBeforeCommit
            });
        }

        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = '45s'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
        const rowsById = await loadCurrentRows(client, changes, false);
        assertRollbackCurrentState(rowsById, changes);
        const payrollImpact = await loadPayrollImpact(client, changes);
        await client.query('ROLLBACK');
        return buildReport(options, artifact, changes, payrollImpact, { applied: false });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function renderMarkdown(report) {
    return [
        '# Historical attendance grace rollback',
        '',
        `Generated: ${report.generatedAt}`,
        `Mode: ${report.mode}`,
        `Plan hash: ${report.planHash}`,
        `Backup artifact: ${report.backupArtifact.artifactId}`,
        `Checksum: ${report.backupArtifact.checksumSha256}`,
        '',
        '## Summary',
        '',
        `- Rows: ${report.summary.totalRows}`,
        `- Distinct staff: ${report.summary.distinctStaff}`,
        `- By category: ${JSON.stringify(report.summary.byCategory)}`,
        '',
        '## Payroll impact',
        '',
        `Risk: ${report.payrollImpact.risk}`,
        '',
        report.mode === 'dry_run'
            ? `Apply gate: rerun with --confirm "${report.applyGate.requiredConfirm}".`
            : `Applied: ${report.applied === true}`
    ].join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const report = await runRollback(options);
    const output = options.format === 'markdown' ? renderMarkdown(report) : JSON.stringify(report, null, 2);
    if (options.output) fs.writeFileSync(path.resolve(options.output), `${output}\n`, { encoding: 'utf8', flag: 'w' });
    else console.log(output);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`attendance historical grace rollback failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    assertRollbackCurrentState,
    buildReport,
    expectedRollbackConfirmation,
    loadVerifiedBackup,
    parseArgs,
    poolConfig,
    renderMarkdown,
    runRollback
};
